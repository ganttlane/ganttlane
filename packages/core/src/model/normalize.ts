/**
 * `normalizeModel`: input `tasks` and `links` → immutable task and link models with indexes and
 * typed issues.
 */

import * as v from 'valibot';

import { DEV, isObject } from '../shared';
import { type ModelIssue, modelIssue, shapeIssues } from './issues';
import { buildLinkModel, linkIdOf, type LinkModel, type LinkSource } from './link';
import {
  type NormalizeModelOptions,
  type ResolvedModelOptions,
  resolveModelOptions,
} from './options';
import { LinkSchema, TaskSchema } from './schema';
import { buildTaskModel, invalidTaskModel, isTaskId, type TaskModel } from './task';
import type { Link, Task, TaskId } from './types';

/** The data to normalize (`GanttOptions.tasks` and `.links`). */
export interface ModelInput<TData = unknown> {
  /** The tasks, in display order. */
  readonly tasks: readonly Task<TData>[];
  /** The links; optional, `Task.dependencies` are merged in. */
  readonly links?: readonly Link[] | undefined;
}

/**
 * Result of {@link normalizeModel}: deeply frozen models (the caller's objects they reference are
 * not frozen) and every issue found.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface NormalizedModel<TData = unknown> {
  /** One model per task in input order, without dropped tasks (no usable id, duplicate id). */
  readonly tasks: readonly TaskModel<TData>[];
  /** Tasks by id (`===` semantics: `5` and `'5'` are different keys). */
  readonly taskById: ReadonlyMap<TaskId, TaskModel<TData>>;
  /** Valid links: the `links` array first, then `Task.dependencies` in task order. */
  readonly links: readonly LinkModel[];
  /** Links by id. */
  readonly linkById: ReadonlyMap<string, LinkModel>;
  /**
   * All issues in input order: options, then tasks, then links. Issues of tasks and links that
   * were kept are also on their models.
   */
  readonly issues: readonly ModelIssue[];
  /** The options with defaults applied, for the modules that build on the model. */
  readonly options: ResolvedModelOptions;
}

/**
 * Normalizes input tasks and links into immutable models. Never
 * throws on bad data and never mutates its input: problems become typed issues.
 *
 * Per task, in input order:
 * 1. **Shape** (`TaskSchema`): a task without a usable `id` (a string or a number,
 *    not `NaN`) is dropped with `'invalid-shape'`; a repeated id (compared with `===`) is dropped
 *    with `'duplicate-id'`, the first one wins; any other shape error makes the task invalid
 *    (a row without a bar) with one `'invalid-shape'` issue per field.
 * 2. **Dates**: `type: 'placeholder'` has no bar and its dates are ignored;
 *    no dates at all → a placeholder row plus a `'no-dates'` warning; `start` + `end` (`end`
 *    wins over `duration`, which is then ignored); `start` + `duration`; a milestone is
 *    zero-length at `start`. Anything else (only `start`, only `end`, a duration without a start)
 *    is invalid (`'incomplete-dates'`): ends are never projected backwards.
 * 3. **Precision**: see `TaskModel.precision`.
 * 4. **End semantics**: with `endInclusive` (default) a date-only `end` is the whole
 *    last day, unless `precision: 'time'` makes every value an exact moment. `end` before `start`
 *    → `'end-before-start'`.
 * 5. **Alignment**: `start`, `end` and the fixed part of `duration` are
 *    aligned to the granularity (to whole days for day-precision tasks) per `alignInput`, with a
 *    `'misaligned'` issue carrying `value` and `suggested`.
 * 6. **End from duration**: a number is days, a string or object a `DurationInput`. Months
 *    are calendar months in both modes; the rest is plain time (`'calendar'`) or working time
 *    (`'working'`; day precision: `WorkCalendar.workingSpanEnd`, the start counts when it is a
 *    working day; time precision: `addWorkingTime`).
 * 7. **Length**: longer than `maxSpan` → `'too-long'`. Then day and millisecond counts and the
 *    progress date (`progress` clamped to `0` … `100` with `'progress-out-of-range'`).
 *
 * Links: the `links` array, then each shape-valid task's `dependencies` (source = the listed id,
 * target = the task). Malformed links are dropped (`'invalid-shape'`), as are repeated ids
 * (`'duplicate-id'`; a default id can collide with an explicit one or with a link from the
 * shorthand) and invalid lags. A lag is a number of days or a fixed duration, aligned to the
 * nearest multiple of the granularity. References and cycles are checked later,
 * `parentId` by the hierarchy.
 *
 * @param input - Tasks and links as the caller passes them.
 * @param options - Calendar, granularity and the other data options.
 * @returns The models, indexes, issues and resolved options.
 *
 * @example
 * ```ts
 * const { calendar } = createWorkCalendar({ weekends: [0, 6] });
 * const model = normalizeModel(
 *   { tasks: [{ id: 1, name: 'Design', start: '2026-03-02', duration: 5 }] },
 *   { calendar },
 * );
 * model.taskById.get(1)?.span?.end; // 2026-03-06 (inclusive last day)
 * ```
 */
export function normalizeModel<TData = unknown>(
  input: ModelInput<TData>,
  options: NormalizeModelOptions,
): NormalizedModel<TData> {
  const issues: ModelIssue[] = [];
  const settings = resolveModelOptions(options, issues);
  const tasks = normalizeTasks(input.tasks, settings, issues);
  const links = normalizeLinks(input.links, tasks.withDependencies, settings, issues);
  return Object.freeze({
    tasks: Object.freeze(tasks.list),
    taskById: tasks.byId,
    links: Object.freeze(links.list),
    linkById: links.byId,
    issues: Object.freeze(issues),
    options: settings,
  });
}

/** Normalized tasks and the shape-valid ones that list dependencies, with their paths. */
interface TaskPhase<TData> {
  readonly list: TaskModel<TData>[];
  readonly byId: Map<TaskId, TaskModel<TData>>;
  readonly withDependencies: [Task<TData>, string][];
}

function normalizeTasks<TData>(
  input: readonly Task<TData>[],
  settings: ResolvedModelOptions,
  issues: ModelIssue[],
): TaskPhase<TData> {
  const phase: TaskPhase<TData> = { list: [], byId: new Map(), withDependencies: [] };
  const rawTasks = arrayOf(input, 'tasks', issues);
  for (let i = 0; i < rawTasks.length; i++) {
    const raw = rawTasks[i];
    const path = `tasks[${i}]`;
    const id = isObject(raw) ? raw.id : undefined;
    if (!isTaskId(id)) {
      issues.push(
        modelIssue('invalid-shape', 'error', isObject(raw) ? `${path}.id` : path, DROPPED_TASK, {
          value: isObject(raw) ? id : raw,
        }),
      );
      continue;
    }
    if (phase.byId.has(id)) {
      issues.push(
        duplicate(`${path}.id`, DEV ? `task id ${JSON.stringify(id)}` : '', { taskId: id }),
      );
      continue;
    }
    const task = raw as Task<TData>;
    const shape = v.safeParse(TaskSchema, task);
    const index = phase.list.length;
    let model: TaskModel<TData>;
    if (shape.success) {
      model = buildTaskModel(task, index, path, settings);
      if (task.dependencies !== undefined) phase.withDependencies.push([task, path]);
    } else {
      model = invalidTaskModel(task, index, settings, shapeIssues(shape.issues, path, id));
    }
    phase.list.push(model);
    phase.byId.set(id, model);
    for (const issue of model.issues) issues.push(issue);
  }
  return phase;
}

/** The `links` array, then the dependency shorthand of the given tasks. */
function normalizeLinks<TData>(
  input: readonly Link[] | undefined,
  withDependencies: readonly (readonly [Task<TData>, string])[],
  settings: ResolvedModelOptions,
  issues: ModelIssue[],
): { readonly list: LinkModel[]; readonly byId: Map<string, LinkModel> } {
  const list: LinkModel[] = [];
  const byId = new Map<string, LinkModel>();
  const add = (source: LinkSource, path: string): void => {
    const id = linkIdOf(source, settings);
    if (byId.has(id)) {
      const owner = { taskId: source.taskId, linkId: id };
      issues.push(duplicate(path, DEV ? `link id ${JSON.stringify(id)}` : '', owner));
      return;
    }
    const link = buildLinkModel(source, id, path, settings, issues);
    if (link === undefined) return;
    list.push(link);
    byId.set(id, link);
  };

  const rawLinks = input === undefined ? [] : arrayOf(input, 'links', issues);
  for (let i = 0; i < rawLinks.length; i++) {
    const raw = rawLinks[i];
    const path = `links[${i}]`;
    const shape = v.safeParse(LinkSchema, raw);
    if (!shape.success) {
      const id = isObject(raw) && typeof raw.id === 'string' ? raw.id : undefined;
      for (const issue of shapeIssues(shape.issues, path, undefined, id)) issues.push(issue);
      continue;
    }
    const link = raw as Link;
    const { id, source, target, type, lag, editable } = link;
    add({ id, source, target, type, lag, editable, link, taskId: undefined }, path);
  }
  for (const [task, taskPath] of withDependencies) {
    for (const [i, entry] of (task.dependencies ?? []).entries()) {
      const { id, type, lag } = typeof entry === 'object' ? entry : { id: entry };
      add(
        {
          id: undefined,
          source: id,
          target: task.id,
          type,
          lag,
          editable: undefined,
          link: undefined,
          taskId: task.id,
        },
        `${taskPath}.dependencies[${i}]`,
      );
    }
  }
  return { list, byId };
}

const DROPPED_TASK = DEV ? 'dropped: a task needs an id (a string or a number)' : '';

function duplicate(
  path: string,
  what: string,
  owner: { readonly taskId: TaskId | undefined; readonly linkId?: string },
): ModelIssue {
  return modelIssue(
    'duplicate-id',
    'error',
    path,
    DEV ? `${what} is used again, dropped` : '',
    owner,
  );
}

function arrayOf(value: unknown, path: string, issues: ModelIssue[]): readonly unknown[] {
  if (Array.isArray(value)) return value;
  issues.push(
    modelIssue('invalid-shape', 'error', path, DEV ? 'expected an array' : '', { value }),
  );
  return [];
}

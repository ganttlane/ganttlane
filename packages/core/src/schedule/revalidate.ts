/**
 * Re-validation of a `ChangeSet` that did not come from `propagate`: a change set modified by
 * `onBeforeTaskChange`, or one built by an API call, goes through the same alignment to the
 * granularity as input data, loses what cannot be applied, and gets its conflicts recomputed.
 */

import type { AlignInput, TaskId, TaskModel } from '../model';
import {
  DEV,
  isFiniteNumber,
  isObject,
  type Issue,
  type IssueSeverity,
  shortMessage,
} from '../shared';
import {
  alignCeil,
  alignFloor,
  alignNearest,
  asDateTimeMs,
  type DatePrecision,
  type DateTimeMs,
  DEFAULT_GRANULARITY,
  durationToString,
  type Granularity,
  toISODateTime,
} from '../time';
import type { Change, ChangeCause, ChangeSet, Conflict, TaskPatch } from './changeset';
import { applyChangeSet, type ConflictContext, detectConflicts } from './conflicts';

/**
 * Issue codes of {@link revalidateChangeSet}. Errors drop the change (the task keeps its
 * committed values), warnings report a value that was corrected:
 * - `'misaligned'`: `after.start` or `after.endExclusive` is not a multiple of the task's step
 *   (a whole day for day precision, else the granularity; the precision of `after.precision`
 *   when the change sets one). Warning when it was aligned per
 *   `scheduling.alignInput` (`suggested` is the applied value), error with `'reject'`;
 * - `'too-short'` (warning): a bar that is not a milestone would be shorter than one step; its
 *   end was moved to `start + step`;
 * - `'end-before-start'` (error): `after.endExclusive` lies before `after.start`;
 * - `'progress-out-of-range'` (warning): `after.progress` outside `0` … `100`, clamped;
 * - `'invalid-change'` (error): not a change object, a value that is not a finite time or
 *   number, or an `after.precision` other than `'day'` and `'time'`;
 * - `'unknown-task'` (error): no task with that id, or the task has no bar (a placeholder or an
 *   invalid task);
 * - `'locked-task'` (error): the task is `locked`;
 * - `'duplicate-change'` (error): a later change of the same task replaces this one.
 */
export type ChangeSetIssueCode =
  | 'misaligned'
  | 'too-short'
  | 'end-before-start'
  | 'progress-out-of-range'
  | 'invalid-change'
  | 'unknown-task'
  | 'locked-task'
  | 'duplicate-change';

/**
 * An {@link Issue} of {@link revalidateChangeSet}. `path` points into the change set
 * (`'changes[2].after.start'`); `value` and `suggested` are numbers (floating date-times or
 * percent).
 */
export type ChangeSetIssue = Issue<ChangeSetIssueCode>;

/** Result of {@link revalidateChangeSet}. */
export interface RevalidatedChangeSet {
  /** The valid change set; the input itself when it needed no correction. */
  readonly changeSet: ChangeSet;
  /** What was corrected or dropped, in the order of the changes. */
  readonly issues: readonly ChangeSetIssue[];
}

/**
 * Brings a change set from outside `propagate` (a before-hook's replacement, an API change) back
 * to the invariants of a `ChangeSet` on the given model. Pure and
 * deterministic; never throws on bad data, problems become {@link ChangeSetIssue}s.
 *
 * Each change, in order:
 * 1. **Dropped** (error issue) when it is not a change object, its values are not finite times
 *    (or a finite progress), its `after.precision` is neither `'day'` nor `'time'`, its task is
 *    unknown or has no bar, the task is `locked`, a later change of the same task follows (the
 *    later one wins, as in `applyChangeSet`), or its end lies before its start.
 * 2. **Aligned** like input data (`normalizeModel`): `after.start` and `after.endExclusive` to
 *    the step of the task's precision after the change — `after.precision` when given, else its
 *    own (`'time'` turns a day task into a timed one, `'day'` brings a timed one back)
 *    — a whole day for day precision, else `model.options.granularity`, per
 *    `model.options.alignInput` — `'expand'`: start down, end up; `'nearest'`: ties widen the
 *    bar; `'reject'`: the change is dropped. Each changed value is a `'misaligned'` issue.
 * 3. **Shaped**: a milestone stays zero-length (its end is its start). Any other bar keeps at
 *    least one step (`'too-short'` when the requested length was not positive, part of
 *    `'misaligned'` when alignment collapsed it), unless its committed bar is zero-length too.
 *    `after.progress` is clamped to `0` … `100`.
 * 4. **Completed**: `before` is taken from the model (the committed values); a change whose
 *    `after` equals them is dropped without an issue. An `after.precision` equal to the task's is
 *    left out; one that differs is kept, and `before.precision` is then the task's.
 *    `cause` and `via` are kept (an unknown `cause` becomes `'direct'`).
 *
 * `conflicts` are recomputed for the result, exactly as `propagate` computes them:
 * `detectConflicts(applyChangeSet(model, result), context, changedIds)`. `reason` is kept.
 *
 * The input is returned as it is (same object, no issues) when it needs no correction: every
 * change frozen with the model's `before` and valid values, and frozen conflicts equal to the
 * recomputed ones. A change set from `propagate` on the same model always is.
 *
 * @param changeSet - The change set to check, computed on `context.model`.
 * @param context - The model, its tree and its link graph (a store's `derived` fits).
 * @returns The valid, frozen change set and the issues found.
 *
 * @example
 * ```ts
 * // granularity '1h': a hook moved 'build' to 10:30 on a Saturday
 * const { changeSet, issues } = revalidateChangeSet(fromHook, context);
 * changeSet.changes[0].after.start; // 10:00
 * issues[0];                        // { code: 'misaligned', path: 'changes[0].after.start', … }
 * changeSet.conflicts[0].type;      // 'non-working-start'
 * ```
 */
export function revalidateChangeSet(
  changeSet: ChangeSet,
  context: ConflictContext,
): RevalidatedChangeSet {
  const input: readonly unknown[] = Array.isArray(changeSet.changes) ? changeSet.changes : [];
  const lastIndex = new Map<TaskId, number>();
  input.forEach((change, i) => {
    const id = isObject(change) ? change.id : undefined;
    if (isTaskId(id)) lastIndex.set(id, i);
  });
  const run: Run = { context, lastIndex, issues: [] };
  const changes: Change[] = [];
  let reused = 0;
  input.forEach((raw, i) => {
    const change = checkChange(run, raw, i);
    if (change === undefined) return;
    changes.push(change);
    if (change === raw) reused++;
  });
  const conflicts =
    changes.length === 0
      ? NO_CONFLICTS
      : detectConflicts(
          applyChangeSet(context.model, { changes }),
          context,
          changes.map((change) => change.id),
        );
  const { issues } = run;
  if (
    reused === input.length &&
    issues.length === 0 &&
    Object.isFrozen(changeSet) &&
    Object.isFrozen(changeSet.changes) &&
    sameConflicts(changeSet.conflicts, conflicts)
  ) {
    return Object.freeze({ changeSet, issues: NO_ISSUES });
  }
  return Object.freeze({
    changeSet: Object.freeze({
      reason: changeSet.reason,
      changes: Object.freeze(changes),
      conflicts,
    }),
    issues: Object.freeze(issues),
  });
}

/** State of one {@link revalidateChangeSet} call. */
interface Run {
  readonly context: ConflictContext;
  /** Index of the last change of each task id. */
  readonly lastIndex: ReadonlyMap<TaskId, number>;
  readonly issues: ChangeSetIssue[];
}

/** A task with a bar. */
type Dated = TaskModel & { readonly span: NonNullable<TaskModel['span']> };

const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);
const NO_ISSUES: readonly ChangeSetIssue[] = /* @__PURE__ */ Object.freeze([]);
const CAUSES: ReadonlySet<unknown> = /* @__PURE__ */ new Set<ChangeCause>([
  'direct',
  'link',
  'parent',
]);
/** ±8.64e15 ms around 1970: the range of a `Date`. */
const MAX_TIME = 8.64e15;

/** The valid change for `raw`, or `undefined` when it is dropped (see the rules above). */
function checkChange(run: Run, raw: unknown, i: number): Change | undefined {
  const path = `changes[${i}]`;
  const id = isObject(raw) ? raw.id : undefined;
  const after = isObject(raw) ? raw.after : undefined;
  if (!isObject(raw) || !isTaskId(id) || !isObject(after)) {
    const message = DEV ? 'not a change with an id and `after` values' : '';
    report(run, 'invalid-change', 'error', path, message, { value: raw });
    return undefined;
  }
  const extras = { taskId: id };
  const task = run.context.model.taskById.get(id);
  if (!hasBar(task)) {
    const message = DEV
      ? `${task === undefined ? 'no task has this id' : 'the task has no bar'}, the change is dropped`
      : '';
    report(run, 'unknown-task', 'error', path, message, extras);
    return undefined;
  }
  if (run.lastIndex.get(id) !== i) {
    const message = DEV ? 'a later change of the same task replaces it' : '';
    report(run, 'duplicate-change', 'error', path, message, extras);
    return undefined;
  }
  if (task.task.locked === true) {
    const message = DEV ? 'the task is locked, the change is dropped' : '';
    report(run, 'locked-task', 'error', path, message, extras);
    return undefined;
  }
  const { start, endExclusive, progress, precision } = after;
  if (!isTime(start) || !isTime(endExclusive) || !isFiniteNumber(progress)) {
    const message = DEV ? '`after` needs finite `start`, `endExclusive` and `progress` values' : '';
    report(run, 'invalid-change', 'error', `${path}.after`, message, { ...extras, value: after });
    return undefined;
  }
  if (precision !== undefined && !isPrecision(precision)) {
    const message = DEV ? "`after.precision` is neither 'day' nor 'time'" : '';
    report(run, 'invalid-change', 'error', `${path}.after.precision`, message, {
      ...extras,
      value: precision,
    });
    return undefined;
  }
  const target: DatePrecision = precision ?? task.precision;
  if (endExclusive < start) {
    const message = DEV ? `${toISODateTime(asDateTimeMs(endExclusive))} is before the start` : '';
    report(run, 'end-before-start', 'error', `${path}.after.endExclusive`, message, {
      ...extras,
      value: endExclusive,
    });
    return undefined;
  }
  const values = alignChange(run, task, path, start, endExclusive, target);
  if (values === undefined) return undefined;
  const clamped = progress < 0 ? 0 : progress > 100 ? 100 : progress;
  if (clamped !== progress) {
    const message = DEV ? `${progress} is outside 0…100, clamped` : '';
    report(run, 'progress-out-of-range', 'warning', `${path}.after.progress`, message, {
      ...extras,
      value: progress,
      suggested: clamped,
    });
  }
  const patch = { ...values, progress: clamped };
  return completeChange(
    raw,
    task,
    target === task.precision ? patch : { ...patch, precision: target },
  );
}

/**
 * `after.start` and `after.endExclusive` aligned to the step of `precision` and shaped (rules
 * 2–3), or `undefined` when `'reject'` drops the change.
 */
function alignChange(
  run: Run,
  task: Dated,
  path: string,
  start: number,
  endExclusive: number,
  precision: DatePrecision,
): { readonly start: DateTimeMs; readonly endExclusive: DateTimeMs } | undefined {
  const { granularity, alignInput } = run.context.model.options;
  const step = precision === 'day' ? DEFAULT_GRANULARITY : granularity;
  const milestone = task.type === 'milestone';
  const alignedStart = alignTo(start, step, alignInput, 'start');
  const endAligned = milestone ? alignedStart : alignTo(endExclusive, step, alignInput, 'end');
  // Like normalization: a bar with a length keeps at least one step; so does one whose committed
  // bar has a length, whatever was asked.
  const { span } = task;
  const keepsStep = !milestone && (endExclusive > start || span.endExclusive > span.start);
  const short = keepsStep && endAligned - alignedStart < step.ms;
  const alignedEnd = short ? asDateTimeMs(alignedStart + step.ms) : endAligned;
  let accepted = true;
  if (alignedStart !== start) {
    accepted = misaligned(run, `${path}.after.start`, step, start, alignedStart, task.id);
  }
  const endPath = `${path}.after.endExclusive`;
  if (!milestone && endAligned !== endExclusive) {
    accepted = misaligned(run, endPath, step, endExclusive, alignedEnd, task.id) && accepted;
  } else if (short) {
    const message = DEV
      ? `a bar keeps at least one step (${stepText(step)}), extended to ${toISODateTime(alignedEnd)}`
      : '';
    report(run, 'too-short', 'warning', endPath, message, {
      taskId: task.id,
      value: endExclusive,
      suggested: alignedEnd,
    });
  }
  return accepted ? { start: alignedStart, endExclusive: alignedEnd } : undefined;
}

/** The final change: `raw` itself when it is frozen with the same values, else a new one. */
function completeChange(
  raw: Readonly<Record<string, unknown>>,
  task: Dated,
  after: TaskPatch,
): Change | undefined {
  const { span } = task;
  const values = { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
  // A change of the precision is recorded on both sides (`TaskPatch.precision`).
  const before: TaskPatch =
    after.precision === undefined ? values : { ...values, precision: task.precision };
  if (samePatch(after, before)) return undefined;
  const cause = CAUSES.has(raw.cause) ? (raw.cause as ChangeCause) : 'direct';
  const { via } = raw;
  if (
    Object.isFrozen(raw) &&
    cause === raw.cause &&
    isFrozenPatch(raw.before, before) &&
    isFrozenPatch(raw.after, after)
  ) {
    return raw as unknown as Change;
  }
  const change = {
    id: task.id,
    before: Object.freeze(before),
    after: Object.freeze(after),
    cause,
  };
  return Object.freeze(isTaskId(via) ? { ...change, via } : change);
}

/** Aligns a date per `alignInput` as normalization does: starts down, ends up. */
function alignTo(
  value: number,
  step: Granularity,
  policy: AlignInput,
  edge: 'start' | 'end',
): DateTimeMs {
  const t = asDateTimeMs(value);
  if (policy === 'nearest') return alignNearest(t, step, edge === 'start' ? 'down' : 'up');
  return edge === 'start' ? alignFloor(t, step) : alignCeil(t, step);
}

/** Reports a misaligned value; returns `false` when `'reject'` drops the change. */
function misaligned(
  run: Run,
  path: string,
  step: Granularity,
  value: number,
  suggested: DateTimeMs,
  taskId: TaskId,
): boolean {
  const reject = run.context.model.options.alignInput === 'reject';
  const shown = DEV ? toISODateTime(suggested) : '';
  const message = DEV
    ? `not a multiple of the step ${stepText(step)}, ${reject ? `rejected, suggested ${shown}` : `aligned to ${shown}`}`
    : '';
  report(run, 'misaligned', reject ? 'error' : 'warning', path, message, {
    taskId,
    value,
    suggested,
  });
  return !reject;
}

function report(
  run: Run,
  code: ChangeSetIssueCode,
  severity: IssueSeverity,
  path: string,
  message: string,
  extras: { readonly taskId?: TaskId; readonly value?: unknown; readonly suggested?: unknown },
): void {
  const issue: { -readonly [K in keyof ChangeSetIssue]: ChangeSetIssue[K] } = {
    code,
    severity,
    message: DEV ? `${path}: ${message}` : shortMessage(code, path),
    path,
  };
  if (extras.taskId !== undefined) issue.taskId = extras.taskId;
  if ('value' in extras) issue.value = extras.value;
  if ('suggested' in extras) issue.suggested = extras.suggested;
  run.issues.push(Object.freeze(issue));
}

function stepText(step: Granularity): string {
  return durationToString({ months: 0, ms: step.ms });
}

function samePatch(a: { readonly [K in keyof TaskPatch]?: unknown }, b: TaskPatch): boolean {
  return (
    a.start === b.start &&
    a.endExclusive === b.endExclusive &&
    a.progress === b.progress &&
    a.precision === b.precision
  );
}

/** Whether a value is a frozen patch with the values of `patch`. */
function isFrozenPatch(value: unknown, patch: TaskPatch): boolean {
  return isObject(value) && Object.isFrozen(value) && samePatch(value, patch);
}

/**
 * Whether the conflicts of a change set (as given, maybe by a hook) are frozen and equal, field
 * by field, to recomputed ones.
 */
function sameConflicts(given: unknown, conflicts: readonly Conflict[]): boolean {
  if (!Array.isArray(given) || !Object.isFrozen(given) || given.length !== conflicts.length) {
    return false;
  }
  return conflicts.every((conflict, i) => sameRecord(given[i], conflict));
}

function sameRecord(given: unknown, expected: object): boolean {
  if (given === expected) return true;
  if (!isObject(given) || !Object.isFrozen(given)) return false;
  const want = expected as Readonly<Record<string, unknown>>;
  const keys = Object.keys(want);
  if (Object.keys(given).length !== keys.length) return false;
  return keys.every((key) => {
    const a = given[key];
    const b = want[key];
    if (Object.is(a, b)) return true;
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, j) => Object.is(item, b[j]))
    );
  });
}

function hasBar(task: TaskModel | undefined): task is Dated {
  return task?.span !== undefined;
}

function isTaskId(value: unknown): value is TaskId {
  return typeof value === 'string' || (typeof value === 'number' && !Number.isNaN(value));
}

function isPrecision(value: unknown): value is DatePrecision {
  return value === 'day' || value === 'time';
}

function isTime(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= MAX_TIME;
}

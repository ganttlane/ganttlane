/**
 * Public records: core's numeric task models turned into `Date`-based
 * `TaskRecord`s, memoized per task while the parts of the state they show are unchanged.
 */

import type { Hierarchy, HierarchyIssue, HierarchyNode } from '../hierarchy';
import type { RowLayout } from '../layout';
import type { NormalizedModel, ResolvedModelOptions, TaskId, TaskModel, TaskSpan } from '../model';
import type { Conflict } from '../schedule';
import type { Issue } from '../shared';
import type { StoreExpandedKeys } from '../store';
import { asDateTimeMs, type DateTimeMs, DAY, toDate } from '../time';
import type { DateRange, TaskDates, TaskRecord } from './types';

/** What the records of one state are built from. */
export interface RecordSource<TData> {
  /** The committed model. */
  readonly model: NormalizedModel<TData>;
  /** Its tree. */
  readonly hierarchy: Hierarchy;
  /** The row metrics of the visible rows. */
  readonly rows: RowLayout;
  /** The expanded parents. */
  readonly expandedKeys: StoreExpandedKeys;
  /** Conflicts by task. */
  readonly conflicts: ReadonlyMap<TaskId, readonly Conflict[]>;
}

/** Builds and caches the records of a facade. */
export interface RecordCache<TData> {
  /** The record of a task in `source`; `undefined` for an unknown id. */
  readonly get: (source: RecordSource<TData>, id: TaskId) => TaskRecord<TData> | undefined;
}

/** What one record shows, besides its task model. */
interface RecordInputs<TData> {
  readonly task: TaskModel<TData>;
  readonly node: HierarchyNode | undefined;
  readonly treeIssues: readonly HierarchyIssue[] | undefined;
  readonly rowIndex: number | undefined;
  readonly isExpanded: boolean;
  readonly conflicts: readonly Conflict[];
}

/** A cached record, the inputs it was built from and the source they were last checked for. */
interface Entry<TData> extends RecordInputs<TData> {
  readonly record: TaskRecord<TData>;
  readonly checked: number;
}

const NO_ISSUES: readonly Issue[] = /* @__PURE__ */ Object.freeze([]);
const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);

/**
 * A cache of task records: a record is the same object while what it shows is unchanged — the
 * caller's task and its normalized values, its tree node and hierarchy issues, its row, its
 * expanded state and its conflicts, compared by content — also across data and option changes
 * that rebuild the model or the conflicts. Within one state a record is looked up in O(1);
 * after a change each record is checked again when it is next asked for, and the records of
 * removed tasks are dropped.
 *
 * @internal
 */
export function createRecordCache<TData>(): RecordCache<TData> {
  let source: RecordSource<TData> | undefined;
  /** Grows with every new source: an entry with this number was checked against it. */
  let generation = 0;
  const entries = new Map<TaskId, Entry<TData>>();
  let expanded: ReadonlySet<TaskId> | 'all' = 'all';
  let treeIssues: ReadonlyMap<TaskId, readonly HierarchyIssue[]> = new Map();
  let issuesOf: Hierarchy | undefined;

  const adopt = (next: RecordSource<TData>): void => {
    if (source?.expandedKeys !== next.expandedKeys) {
      const keys = next.expandedKeys;
      expanded = keys === 'all' ? 'all' : new Set(keys);
    }
    if (issuesOf !== next.hierarchy) {
      issuesOf = next.hierarchy;
      treeIssues = byTask(next.hierarchy.issues);
    }
    if (source !== undefined && source.model !== next.model) {
      for (const id of entries.keys()) if (!next.model.taskById.has(id)) entries.delete(id);
    }
    source = next;
    generation++;
  };

  const get = (next: RecordSource<TData>, id: TaskId): TaskRecord<TData> | undefined => {
    if (source === undefined || !sameSource(source, next)) adopt(next);
    const entry = entries.get(id);
    if (entry?.checked === generation) return entry.record;
    const task = next.model.taskById.get(id);
    if (task === undefined) return undefined;
    const node = next.hierarchy.nodeById.get(id);
    const inputs: RecordInputs<TData> = {
      task,
      node,
      treeIssues: treeIssues.get(id),
      rowIndex: next.rows.rowOf(id)?.index,
      isExpanded: node?.hasChildren === true && (expanded === 'all' || expanded.has(id)),
      conflicts: next.conflicts.get(id) ?? NO_CONFLICTS,
    };
    const record =
      entry !== undefined && sameInputs(entry, inputs) ? entry.record : buildRecord(inputs);
    entries.set(id, { ...inputs, record, checked: generation });
    return record;
  };
  return Object.freeze({ get });
}

function sameSource<TData>(a: RecordSource<TData>, b: RecordSource<TData>): boolean {
  return (
    a.model === b.model &&
    a.hierarchy === b.hierarchy &&
    a.rows === b.rows &&
    a.expandedKeys === b.expandedKeys &&
    a.conflicts === b.conflicts
  );
}

/** Whether two sets of inputs give equal records. */
function sameInputs<TData>(a: RecordInputs<TData>, b: RecordInputs<TData>): boolean {
  return (
    a.rowIndex === b.rowIndex &&
    a.isExpanded === b.isExpanded &&
    sameTask(a.task, b.task) &&
    sameNode(a.node, b.node) &&
    sameList(a.treeIssues ?? NO_ISSUES, b.treeIssues ?? NO_ISSUES) &&
    sameList(a.conflicts, b.conflicts)
  );
}

/** Whether two models of a task show the same: the same caller's task and the same values. */
function sameTask(a: TaskModel, b: TaskModel): boolean {
  return (
    a === b ||
    (a.task === b.task &&
      a.name === b.name &&
      a.type === b.type &&
      a.precision === b.precision &&
      a.progress === b.progress &&
      sameSpan(a.span, b.span) &&
      sameList(a.issues, b.issues))
  );
}

function sameSpan(a: TaskSpan | undefined, b: TaskSpan | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start === b.start &&
    a.endExclusive === b.endExclusive &&
    a.end === b.end &&
    a.progressDate === b.progressDate &&
    sameFields(a.duration, b.duration)
  );
}

function sameNode(a: HierarchyNode | undefined, b: HierarchyNode | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a === b ||
    (a.depth === b.depth &&
      a.parentId === b.parentId &&
      a.hasChildren === b.hasChildren &&
      sameItems(a.childIds, b.childIds))
  );
}

/** Whether two lists of plain objects (issues, conflicts) have equal items, field by field. */
function sameList(a: readonly object[], b: readonly object[]): boolean {
  return a === b || (a.length === b.length && a.every((item, i) => sameFields(item, b[i])));
}

/** Whether two objects have the same own keys and values; arrays among them item by item. */
function sameFields(a: object, b: object | undefined): boolean {
  if (a === b) return true;
  if (b === undefined) return false;
  const x = a as Readonly<Record<string, unknown>>;
  const y = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((key) => {
      const [p, q] = [x[key], y[key]];
      return Object.is(p, q) || (Array.isArray(p) && Array.isArray(q) && sameItems(p, q));
    })
  );
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
}

function buildRecord<TData>(inputs: RecordInputs<TData>): TaskRecord<TData> {
  const { task, node, treeIssues } = inputs;
  const { span } = task;
  const issues =
    treeIssues === undefined
      ? task.issues.length === 0
        ? NO_ISSUES
        : task.issues
      : Object.freeze([...task.issues, ...treeIssues]);
  return Object.freeze({
    id: task.id,
    name: task.name,
    task: task.task,
    type: task.type,
    precision: task.precision,
    start: span && toDate(span.start),
    end: span && toDate(span.end),
    endExclusive: span && toDate(span.endExclusive),
    duration: span?.duration,
    progress: task.progress,
    progressDate: span && toDate(span.progressDate),
    level: node?.depth ?? 0,
    parentId: node?.parentId,
    childIds: node?.childIds ?? Object.freeze([]),
    rowIndex: inputs.rowIndex,
    isExpanded: inputs.isExpanded,
    issues,
    conflicts: inputs.conflicts,
  });
}

function byTask(issues: readonly HierarchyIssue[]): ReadonlyMap<TaskId, readonly HierarchyIssue[]> {
  const map = new Map<TaskId, HierarchyIssue[]>();
  for (const found of issues) {
    if (found.taskId === undefined) continue;
    const list = map.get(found.taskId);
    if (list) list.push(found);
    else map.set(found.taskId, [found]);
  }
  return map;
}

/**
 * A task's end in the semantics of its input: the last day for a day-precision task
 * of non-zero length with `endInclusive`, else the exclusive end.
 *
 * @internal
 */
export function inputEnd(
  task: Pick<TaskModel, 'precision'>,
  model: { readonly options: Pick<ResolvedModelOptions, 'endInclusive'> },
  start: DateTimeMs,
  endExclusive: DateTimeMs,
): DateTimeMs {
  const inclusive = task.precision === 'day' && model.options.endInclusive && endExclusive > start;
  return inclusive ? asDateTimeMs(endExclusive - DAY) : endExclusive;
}

/**
 * The public dates of a change (`onTaskDatesChange`).
 *
 * @internal
 */
export function taskDates(
  task: Pick<TaskModel, 'precision'>,
  model: { readonly options: Pick<ResolvedModelOptions, 'endInclusive'> },
  start: DateTimeMs,
  endExclusive: DateTimeMs,
): TaskDates {
  return Object.freeze({
    start: toDate(start),
    end: toDate(inputEnd(task, model, start, endExclusive)),
    endExclusive: toDate(endExclusive),
  });
}

/**
 * A floating range as local `Date`s.
 *
 * @internal
 */
export function dateRange(start: DateTimeMs, end: DateTimeMs): DateRange {
  return Object.freeze({ start: toDate(start), end: toDate(end) });
}

/**
 * `patchTask`: writes scheduled values (a committed `TaskPatch`) back into an input task in the
 * task's own representation (FR-TX-3 uncontrolled data, FR-TIME-8), so that normalizing the
 * patched task gives exactly the patched span.
 */

import {
  asDateTimeMs,
  type DateInput,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  type Duration,
  type DurationFields,
  type DurationInput,
  durationToString,
  HOUR,
  MINUTE,
  parseDateInput,
  parseDuration,
  toDate,
  toISODate,
  toISODateTime,
} from '../time';
import type { NormalizedModel } from './normalize';
import type { ResolvedModelOptions } from './options';
import { addTaskDuration, type TaskModel, type TaskSpan } from './task';
import type { Task, TaskId } from './types';

/**
 * The scheduled values {@link patchTask} writes: structurally the schedule module's `TaskPatch`
 * (declared here because `model` sits below `schedule`, `docs/architecture.md` §3.1).
 */
export type PatchValues = Pick<TaskSpan, 'start' | 'endExclusive'> & {
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
  /**
   * The task's new precision, when the patch changes it (`TaskPatch.precision`, FR-SNAP-7);
   * absent: the task keeps its own.
   */
  readonly precision?: DatePrecision | undefined;
};

/**
 * What {@link patchTask} reads besides the task: the normalized model the patch was computed on
 * (its task models and resolved options). A `NormalizedModel` fits.
 */
export type PatchTaskContext = Pick<NormalizedModel, 'taskById' | 'options'>;

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Returns a new task with a patch applied, in the task's own representation (FR-TX-3,
 * FR-TIME-8). Never mutates `task`; returns `task` itself when the patch changes nothing, and
 * when the context has no bar for it (unknown id, placeholder, invalid task). Normalizing the
 * result with the same options gives exactly `patch.start` / `patch.endExclusive` /
 * `patch.progress` and the precision `patch.precision` (the task's own when absent), provided the
 * patch is aligned like a `ChangeSet` (multiples of the granularity, whole days for day
 * precision) and keeps a bar with an inclusive end at least one day long.
 *
 * Representation rules:
 * - **Dates** keep their value type: a `Date` stays a `Date`, epoch ms stay a number (both
 *   through the local wall clock, `toDate`), an ISO string stays an ISO string of the same
 *   precision: date-only while the value is a midnight (else date-time), date-time with the same
 *   separator and at least the same fields (`:ss`, `.sss`) as before. A value that does not
 *   change is kept as it is (the same `Date` object). A `Date` cannot express a wall-clock time
 *   in a DST gap of the runtime zone (`toDate` moves it forward).
 * - **`end`** (when the task has one; milestones only get `start`): a date-only end that would be
 *   read as the inclusive last day (`dates.endInclusive`, no `precision: 'time'`) is written as
 *   that day, `endExclusive - 1d`.
 * - **`duration`** (when the task has no `end`): kept as is while it still gives the new end from
 *   the new start. Otherwise the length in the task's `durationMode` (working time in working
 *   mode) in the same form: a number of days (falling back to the canonical string when a number
 *   cannot hold it exactly, e.g. 13 minutes), an ISO 8601 string for an ISO input, the canonical
 *   string (`'1d 4h'`) for other strings, `{ days, hours, minutes }` for an object. Calendar months
 *   are not kept once the length changes. When working time cannot express the span (its end lies
 *   in non-working time), the task gets an `end` in the form of `start` instead of `duration`.
 * - **`progress`** is set only when it differs from the model's (clamped) progress.
 * - **Precision**: when the new values alone would make a time-precision task date-only (all at
 *   midnight as `Date`s or date-only strings), `precision: 'time'` is added to keep it.
 * - **A precision change** (`patch.precision`, FR-SNAP-7): a day task becomes timed through its
 *   values when they carry a time of day (a date-only end that stays reads as the inclusive last
 *   day), else with `precision: 'time'`; an explicit `precision: 'day'` becomes `'time'`. A timed
 *   task goes back to day precision (an undo) with date-only ISO strings and midnight `Date`s;
 *   an explicit `precision: 'time'` is removed, and `precision: 'day'` is written only when the
 *   values would still read as times. Lengths are written by the rules of the new precision.
 *
 * @param task - The caller's task (the one the context's model was built from).
 * @param patch - The new values, e.g. a `Change.after` of a `ChangeSet`.
 * @param context - The normalized model the patch was computed on.
 * @returns A new task object, or `task` when nothing changes.
 *
 * @example
 * ```ts
 * const task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06' };
 * const model = normalizeModel({ tasks: [task] }, { calendar });
 * const [change] = propagate({ kind: 'move', id: 1, start: monday9th }, context).changes;
 * patchTask(task, change.after, model); // { …, start: '2026-03-09', end: '2026-03-13' }
 * ```
 */
export function patchTask<TData>(
  task: Task<TData>,
  patch: PatchValues,
  context: PatchTaskContext,
): Task<TData> {
  const model = context.taskById.get(task.id);
  const span = model?.span;
  if (model === undefined || span === undefined) return task;
  const next: Writable<Task<TData>> = { ...task };
  let changed = false;
  if (patch.progress !== model.progress) {
    next.progress = patch.progress;
    changed = true;
  }
  const precision = patch.precision ?? model.precision;
  if (
    patch.start !== span.start ||
    patch.endExclusive !== span.endExclusive ||
    precision !== model.precision
  ) {
    changed = true;
    const { options } = context;
    // An explicit precision that the patch changes: `'time'` is written, `'day'` is left to the
    // values (date-only), as an undo restores a task that had none.
    let explicit = task.precision;
    if (explicit !== undefined && explicit !== precision) {
      if (precision === 'time') next.precision = precision;
      else delete next.precision;
      explicit = next.precision;
    }
    const write = { task, model, patch, options, precision };
    writeDates(next, write, explicit);
    if (explicit === undefined && carriesTime(next, model) !== (precision === 'time')) {
      next.precision = precision;
      writeDates(next, write, precision);
    }
  }
  return changed ? next : task;
}

/**
 * The changes {@link patchTasks} applies: structurally the schedule module's `ChangeSet` (and so
 * also `SessionChanges`), declared here because `model` sits below `schedule`.
 */
export interface PatchChanges {
  /** Each change's task id and new values; of two changes of one task the later wins. */
  readonly changes: readonly { readonly id: TaskId; readonly after: PatchValues }[];
}

/**
 * Applies a change set to the caller's tasks in their own representation: each task with a
 * change is replaced by its {@link patchTask}, every other task is kept as it is. This is how
 * controlled data applies `onTasksChange`, or the inverse an `onEditRollback` carries, to the
 * tasks it passes back; `context` is the model the change set was computed on (the facade's
 * `getSnapshot().state.derived.model`).
 *
 * Like the model, only the first task with an id counts: later duplicates are kept unpatched.
 * Changes of unknown tasks and of tasks without a bar are skipped. Never mutates `tasks`.
 *
 * @param tasks - The caller's tasks.
 * @param changes - A `ChangeSet` or `SessionChanges`.
 * @param context - The normalized model the changes were computed on.
 * @returns A new array, or `tasks` itself when no task changes.
 *
 * @example
 * ```ts
 * const core = createGanttCore({ tasks, dataMode: 'controlled' });
 * core.on('tasksChange', (changeSet) => {
 *   tasks = patchTasks(tasks, changeSet, core.getSnapshot().state.derived.model);
 *   core.setTasks(tasks);
 * });
 * ```
 */
export function patchTasks<TData>(
  tasks: Task<TData>[],
  changes: PatchChanges,
  context: PatchTaskContext,
): Task<TData>[];
export function patchTasks<TData>(
  tasks: readonly Task<TData>[],
  changes: PatchChanges,
  context: PatchTaskContext,
): readonly Task<TData>[];
export function patchTasks<TData>(
  tasks: readonly Task<TData>[],
  changes: PatchChanges,
  context: PatchTaskContext,
): readonly Task<TData>[] {
  const patches = new Map<TaskId, PatchValues>();
  for (const change of changes.changes) patches.set(change.id, change.after);
  if (patches.size === 0) return tasks;
  const seen = new Set<TaskId>();
  let next: Task<TData>[] | undefined;
  for (const [i, task] of tasks.entries()) {
    // Untyped callers may pass anything: only objects are patched.
    const raw: unknown = task;
    if (typeof raw !== 'object' || raw === null || seen.has(task.id)) continue;
    seen.add(task.id);
    const patch = patches.get(task.id);
    if (patch === undefined) continue;
    const patched = patchTask(task, patch, context);
    if (patched !== task) (next ??= [...tasks])[i] = patched;
  }
  return next ?? tasks;
}

/** What {@link writeDates} writes: a patch onto a task, in the precision the task gets. */
interface DateWrite {
  readonly task: Task;
  readonly model: TaskModel;
  readonly patch: PatchValues;
  readonly options: ResolvedModelOptions;
  /** The task's precision after the patch. */
  readonly precision: DatePrecision;
}

/**
 * Writes `start` and `end` or `duration`; `explicit` is the task's explicit precision after the
 * patch.
 */
function writeDates(
  next: Writable<Task>,
  write: DateWrite,
  explicit: DatePrecision | undefined,
): void {
  const { task, model, patch, options, precision } = write;
  const { start, endExclusive } = patch;
  // A task going back to day precision gets date-only ISO strings (FR-SNAP-7).
  const dateOnly = precision === 'day' && model.precision === 'time';
  next.start = kept(writeDate(start, task.start, dateOnly), task.start);
  if (model.type === 'milestone') return;
  const inclusive = options.endInclusive && explicit !== 'time';
  if (task.end !== undefined) {
    next.end = kept(writeEnd(endExclusive, task.end, inclusive, dateOnly), task.end);
    return;
  }
  const duration = durationFor(task.duration, write);
  if (duration === undefined) {
    delete next.duration;
    next.end = writeEnd(endExclusive, task.start, inclusive, dateOnly);
  } else {
    next.duration = duration;
  }
}

/** Whether the written values make the task time-precision on their own (`TaskModel.precision`). */
function carriesTime(task: Task, model: TaskModel): boolean {
  if (isTimeValue(task.start)) return true;
  if (model.type === 'milestone') return false;
  if (task.end !== undefined) return isTimeValue(task.end);
  const length = readDuration(task.duration);
  return length !== undefined && length.ms % DAY !== 0;
}

function isTimeValue(value: DateInput | undefined): boolean {
  if (value === undefined) return false;
  const parsed = parseDateInput(value);
  return !parsed.ok || parsed.value.precision === 'time';
}

/** `original` when it is the same value as `written` (equal strings, numbers or `Date` times). */
function kept(written: DateInput, original: DateInput | undefined): DateInput {
  const same =
    written instanceof Date && original instanceof Date
      ? written.getTime() === original.getTime()
      : written === original;
  return same && original !== undefined ? original : written;
}

/**
 * `t` in the value type of `like`: an ISO string like it (date-only at midnight with `dateOnly`),
 * epoch ms or a `Date`.
 */
function writeDate(t: DateTimeMs, like: DateInput | undefined, dateOnly = false): DateInput {
  if (typeof like === 'string') return isoLike(t, like, dateOnly);
  const date = toDate(t);
  return typeof like === 'number' ? date.getTime() : date;
}

/** An end in the form of `like`; a date-only form that reads as the inclusive last day gets it. */
function writeEnd(
  endExclusive: DateTimeMs,
  like: DateInput | undefined,
  inclusive: boolean,
  dateOnly: boolean,
): DateInput {
  const value = writeDate(endExclusive, like, dateOnly);
  return inclusive && !isTimeValue(value)
    ? writeDate(asDateTimeMs(endExclusive - DAY), like, dateOnly)
    : value;
}

/** ISO text of `t` in the shape of `like` (see {@link patchTask}); date-only with `dateOnly`. */
function isoLike(t: DateTimeMs, like: string, dateOnly: boolean): string {
  if ((like.length === 10 || dateOnly) && t % DAY === 0) return toISODate(t);
  let text = toISODateTime(t);
  if (like.length > 16 && text.length === 16) text += ':00';
  if (like.length > 19 && text.length === 19) text += '.000';
  return like[10] === ' ' ? text.replace('T', ' ') : text;
}

/** A task `duration` (days or a `DurationInput`) as a {@link Duration}. */
function readDuration(value: Task['duration']): Duration | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return { months: 0, ms: value * DAY };
  const parsed = parseDuration(value);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * The `duration` that places the end of a task starting at `patch.start` at `patch.endExclusive`
 * by the rules of its new precision, in the form of `given`; `undefined` when the task's
 * duration mode cannot express it.
 */
function durationFor(given: Task['duration'], write: DateWrite): Task['duration'] {
  const { model, options, precision } = write;
  const { start, endExclusive } = write.patch;
  const { durationMode } = model;
  const endOf = (length: Duration): number | undefined =>
    addTaskDuration(start, length, precision, durationMode, options);
  const step = precision === 'day' ? DAY : options.granularity.ms;
  const current = readDuration(given);
  if (current !== undefined && current.ms % step === 0 && endOf(current) === endExclusive) {
    return given;
  }
  const ms =
    durationMode === 'working'
      ? options.calendar.countWorkingTime(start, endExclusive)
      : endExclusive - start;
  if (!(ms >= 0) || endOf({ months: 0, ms }) !== endExclusive) return undefined;
  return formatDuration(given, ms);
}

/** `ms` in the form of `like` (see {@link patchTask}). */
function formatDuration(like: Task['duration'], ms: number): number | DurationInput {
  if (typeof like === 'number' && (ms / DAY) * DAY === ms) return ms / DAY;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (typeof like === 'object') {
    const fields: Writable<DurationFields> = {};
    if (days > 0 || ms === 0) fields.days = days;
    if (hours > 0) fields.hours = hours;
    if (minutes > 0) fields.minutes = minutes;
    return fields;
  }
  if (typeof like === 'string' && /^p/i.test(like)) {
    const time = (hours > 0 ? `${hours}H` : '') + (minutes > 0 ? `${minutes}M` : '');
    return `P${days > 0 || time === '' ? `${days}D` : ''}${time === '' ? '' : `T${time}`}`;
  }
  return durationToString({ months: 0, ms });
}

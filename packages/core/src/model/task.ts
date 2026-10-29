/**
 * Normalization of one task into an immutable {@link TaskModel}, in this order: parse →
 * precision → alignment → end from the duration → day and millisecond counts → progress date.
 */

import { progressToDate } from '../progress';
import { DEV, type IssueSeverity } from '../shared';
import {
  addDuration,
  asDateTimeMs,
  asDayKey,
  type DateInput,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  DEFAULT_GRANULARITY,
  type Duration,
  durationToString,
  fromDayKey,
  type Granularity,
  parseDateInput,
  type ParsedDate,
  toDayKey,
} from '../time';
import { adoptIssue, type ModelIssue, modelIssue, type ModelIssueCode } from './issues';
import type { ResolvedModelOptions } from './options';
import type { DurationMode, Task, TaskId, TaskType } from './types';
import {
  alignTo,
  durationValue,
  isoText,
  type IssueOwner,
  readDaysOrDuration,
  reportMisaligned,
} from './values';

/**
 * Length of a task. Counts come from milliseconds, so they are whole numbers for
 * day-precision tasks and exact fractions for tasks with time (a working day is 24 h for now):
 * `calendarDays = ms / 1d`, `workingDays = workingMs / 1d`.
 */
export interface TaskDuration {
  /** All days of `[start, endExclusive)`. */
  readonly calendarDays: number;
  /** Working days of the work calendar. */
  readonly workingDays: number;
  /** `calendarDays - workingDays`. */
  readonly nonWorkingDays: number;
  /** `endExclusive - start` in milliseconds. */
  readonly ms: number;
  /** Working time in milliseconds. */
  readonly workingMs: number;
}

/**
 * Where a task's bar lies, in floating time. Every date is a multiple of the granularity;
 * day-precision tasks lie on day boundaries.
 */
export interface TaskSpan {
  /** First moment of the task. */
  readonly start: DateTimeMs;
  /** End of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: DateTimeMs;
  /**
   * End in the semantics of the input: for a day-precision task with
   * `endInclusive`, midnight of the last day (`endExclusive - 1d`, or `start` for a zero-length
   * task); otherwise `endExclusive`.
   */
  readonly end: DateTimeMs;
  /** Lengths in days and milliseconds. */
  readonly duration: TaskDuration;
  /**
   * Boundary of the done part at `progress` % of the calendar or working time (per
   * `durationMode`), aligned down to the granularity.
   */
  readonly progressDate: DateTimeMs;
}

/**
 * A normalized task: core's internal, numeric record of one input {@link Task}. Deeply frozen
 * except for `task` (the caller's object, referenced, never copied or mutated) and the `value`s
 * of issues. The public, `Date`-based `TaskRecord` is derived from it by the
 * facade, together with the hierarchy fields (`level`, `childIds`, `rowIndex`, …).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskModel<TData = unknown> {
  /** `task.id`. */
  readonly id: TaskId;
  /** Position in `NormalizedModel.tasks` (input order without dropped tasks). */
  readonly index: number;
  /** The caller's task. With `'invalid-shape'` issues it does not match {@link Task}. */
  readonly task: Task<TData>;
  /** `task.name`, or `''` when it is not a string. */
  readonly name: string;
  /**
   * Effective kind: `'placeholder'` also for a task without dates; `'task'` when
   * the input `type` is malformed.
   */
  readonly type: TaskType;
  /** `false` when an error issue made the task unusable: it is a row without a bar. */
  readonly valid: boolean;
  /**
   * `task.precision`, else `'time'` when a used `start` / `end` carries a time of day or the
   * `duration` has a part shorter than a day, else `'day'`.
   */
  readonly precision: DatePrecision;
  /** `task.durationMode` or the default from the options. */
  readonly durationMode: DurationMode;
  /** `task.progress` clamped to `0` … `100`; `0` when missing or malformed. */
  readonly progress: number;
  /** `task.parentId` as given (resolved by the hierarchy); `undefined` if malformed. */
  readonly parentId: TaskId | undefined;
  /** The bar; `undefined` for placeholders and invalid tasks. */
  readonly span: TaskSpan | undefined;
  /** Issues of this task, also listed in `NormalizedModel.issues`. */
  readonly issues: readonly ModelIssue[];
}

/** Result of scheduling a task's dates. */
type Outcome =
  | { readonly kind: 'placeholder' }
  | { readonly kind: 'invalid'; readonly precision: DatePrecision }
  | {
      readonly kind: 'span';
      readonly precision: DatePrecision;
      readonly start: DateTimeMs;
      readonly endExclusive: DateTimeMs;
    };

/** Per-task state shared by the steps. */
interface TaskContext {
  readonly task: Task;
  readonly path: string;
  readonly owner: IssueOwner;
  readonly settings: ResolvedModelOptions;
  readonly issues: ModelIssue[];
}

const PLACEHOLDER: Outcome = /* @__PURE__ */ Object.freeze({ kind: 'placeholder' });

/**
 * Normalizes a task that passed the shape check.
 *
 * @internal
 */
export function buildTaskModel<TData>(
  task: Task<TData>,
  index: number,
  path: string,
  settings: ResolvedModelOptions,
): TaskModel<TData> {
  const ctx: TaskContext = { task, path, owner: { taskId: task.id }, settings, issues: [] };
  const durationMode = task.durationMode ?? settings.durationMode;
  const outcome = task.type === 'placeholder' ? PLACEHOLDER : scheduleTask(ctx, durationMode);
  const progress = readProgress(ctx);
  const precision = outcome.kind === 'placeholder' ? (task.precision ?? 'day') : outcome.precision;
  const span =
    outcome.kind === 'span'
      ? spanOf(outcome.start, outcome.endExclusive, precision, durationMode, progress, settings)
      : undefined;
  return Object.freeze({
    id: task.id,
    index,
    task,
    name: task.name,
    type: outcome.kind === 'placeholder' ? 'placeholder' : (task.type ?? 'task'),
    valid: outcome.kind !== 'invalid',
    precision,
    durationMode,
    progress,
    parentId: task.parentId,
    span,
    issues: Object.freeze(ctx.issues),
  });
}

/**
 * The model of a task that failed the shape check: invalid, without a bar; `name` and
 * `parentId` are kept when they are well-formed so the row still shows in its place.
 *
 * @internal
 */
export function invalidTaskModel<TData>(
  task: Task<TData>,
  index: number,
  settings: ResolvedModelOptions,
  issues: readonly ModelIssue[],
): TaskModel<TData> {
  const { name, parentId } = task as { readonly name?: unknown; readonly parentId?: unknown };
  return Object.freeze({
    id: task.id,
    index,
    task,
    name: typeof name === 'string' ? name : '',
    type: 'task',
    valid: false,
    precision: 'day',
    durationMode: settings.durationMode,
    progress: 0,
    parentId: isTaskId(parentId) ? parentId : undefined,
    span: undefined,
    issues: Object.freeze(issues),
  });
}

/**
 * Whether a value can be a task id: a string or a number other than `NaN` (as `TaskSchema`).
 *
 * @internal
 */
export function isTaskId(value: unknown): value is TaskId {
  return typeof value === 'string' || (typeof value === 'number' && !Number.isNaN(value));
}

function report(
  ctx: TaskContext,
  code: ModelIssueCode,
  severity: IssueSeverity,
  field: string,
  message: string,
  extras?: { readonly value?: unknown; readonly suggested?: unknown },
): void {
  const path = field === '' ? ctx.path : `${ctx.path}.${field}`;
  ctx.issues.push(modelIssue(code, severity, path, message, { ...ctx.owner, ...extras }));
}

/** The parsed date fields of a task and its precision. */
interface TaskDates {
  readonly start: ParsedDate;
  /** The `end` value, when the task uses it. */
  readonly end: ParsedDate | undefined;
  /** The `duration`, when the task uses it (start + duration). */
  readonly length: Duration | undefined;
  readonly precision: DatePrecision;
}

/**
 * Turns the dates of a task into a half-open interval: `start` + `end` (`end` wins
 * over `duration`), `start` + `duration`, or a zero-length milestone at `start`.
 */
function scheduleTask(ctx: TaskContext, mode: DurationMode): Outcome {
  const dates = readDates(ctx);
  return 'kind' in dates ? dates : placeTask(ctx, dates, mode);
}

/** The first two stages of normalization: which fields are used, parsing, precision. */
function readDates(ctx: TaskContext): TaskDates | Outcome {
  const { task } = ctx;
  const { start, end, duration } = task;
  const milestone = task.type === 'milestone';
  const usesEnd = !milestone && end !== undefined;
  const usesDuration = !milestone && !usesEnd && duration !== undefined;
  if (start === undefined && end === undefined && duration === undefined) {
    report(ctx, 'no-dates', 'warning', '', DEV ? 'no dates, shown as a row without a bar' : '');
    return PLACEHOLDER;
  }
  if (start === undefined || (!milestone && !usesEnd && !usesDuration)) {
    const missing = !DEV
      ? ''
      : start === undefined
        ? `${end === undefined ? 'duration' : 'end'} without start`
        : 'start without end or duration';
    report(ctx, 'incomplete-dates', 'error', '', missing);
    return { kind: 'invalid', precision: task.precision ?? 'day' };
  }
  const startDate = readDate(ctx, start, 'start');
  const endDate = usesEnd ? readDate(ctx, end, 'end') : undefined;
  const length = usesDuration
    ? readDaysOrDuration(duration, `${ctx.path}.duration`, ctx.owner, ctx.issues, false)
    : undefined;
  if (startDate === undefined || (usesEnd && !endDate) || (usesDuration && !length)) {
    return { kind: 'invalid', precision: task.precision ?? startDate?.precision ?? 'day' };
  }
  const precision =
    task.precision ??
    (startDate.precision === 'time' ||
    endDate?.precision === 'time' ||
    (length !== undefined && length.ms % DAY !== 0)
      ? 'time'
      : 'day');
  return { start: startDate, end: endDate, length, precision };
}

/** The next stages: end semantics, alignment, end from the duration, maximum length. */
function placeTask(ctx: TaskContext, dates: TaskDates, mode: DurationMode): Outcome {
  const { task, settings } = ctx;
  const { start, end, length, precision } = dates;
  // Day-precision tasks stay on day boundaries, a multiple of every granularity.
  const step = precision === 'day' ? DEFAULT_GRANULARITY : settings.granularity;
  const policy = settings.alignInput;
  let rawEnd: number | undefined;
  if (end !== undefined) {
    // A date-only `end` is the inclusive last day, unless every value is a moment ('time').
    const inclusive = settings.endInclusive && end.precision === 'day' && task.precision !== 'time';
    rawEnd = inclusive ? end.value + DAY : end.value;
    if (inclusive ? rawEnd <= start.value : rawEnd < start.value) {
      const message = DEV ? `${isoText(end.value, end.precision)} is before the start` : '';
      report(ctx, 'end-before-start', 'error', 'end', message, { value: task.end });
      return { kind: 'invalid', precision };
    }
  }

  let accepted = true;
  const startAt = alignTo(start.value, step, policy, true);
  if (startAt !== start.value) {
    accepted = misaligned(ctx, 'start', step, task.start, isoText(startAt, precision)) && accepted;
  }
  let endExclusive: DateTimeMs | undefined = startAt;
  // Rounding the edges on their own (`'nearest'`) can collapse a short task (10:40 … 10:50 at
  // `'1h'` → 11:00 … 11:00): a task that had a length keeps at least one step.
  if (rawEnd !== undefined) {
    endExclusive = alignTo(rawEnd, step, policy, false);
    if (endExclusive <= startAt && rawEnd > start.value) {
      endExclusive = asDateTimeMs(startAt + step.ms);
    }
    if (endExclusive !== rawEnd) {
      const shown =
        precision === 'day' && settings.endInclusive ? endExclusive - DAY : endExclusive;
      const suggested = isoText(asDateTimeMs(shown), precision);
      accepted = misaligned(ctx, 'end', step, task.end, suggested) && accepted;
    }
  } else if (length !== undefined) {
    let ms: number = alignTo(length.ms, step, policy, false);
    if (ms <= 0 && length.ms > 0 && length.months === 0) ms = step.ms;
    const aligned: Duration = { months: length.months, ms };
    if (aligned.ms !== length.ms) {
      const suggested = durationValue(task.duration, aligned);
      accepted = misaligned(ctx, 'duration', step, task.duration, suggested) && accepted;
    }
    endExclusive = addTaskDuration(startAt, aligned, precision, mode, settings);
    if (endExclusive === undefined) {
      const message = DEV ? 'the calendar has no working days to place it' : '';
      report(ctx, 'no-working-time', 'error', 'duration', message);
      return { kind: 'invalid', precision };
    }
  }
  if (!accepted) return { kind: 'invalid', precision };
  if (!(endExclusive <= addDuration(startAt, settings.maxSpan))) {
    const field = end === undefined ? 'duration' : 'end';
    const message = DEV ? `longer than ${durationToString(settings.maxSpan)}` : '';
    report(ctx, 'too-long', 'error', field, message);
    return { kind: 'invalid', precision };
  }
  return { kind: 'span', precision, start: startAt, endExclusive };
}

function misaligned(
  ctx: TaskContext,
  field: string,
  step: Granularity,
  value: unknown,
  suggested: string | number,
): boolean {
  const { path, owner, settings, issues } = ctx;
  return reportMisaligned(
    issues,
    `${path}.${field}`,
    owner,
    step,
    settings.alignInput,
    value,
    suggested,
  );
}

function readDate(ctx: TaskContext, value: DateInput, field: string): ParsedDate | undefined {
  const parsed = parseDateInput(value);
  if (parsed.ok) return parsed.value;
  ctx.issues.push(adoptIssue(parsed.issue, `${ctx.path}.${field}`, ctx.owner.taskId));
  return undefined;
}

/**
 * End of `start + duration`: calendar months first (in both modes, months have no
 * working length), then the fixed part as plain time (`'calendar'`) or working time
 * (`'working'`). Day precision in working mode keeps the rule of `workingSpanEnd`: the
 * start counts when it is a working day, the end is the day after the last working day.
 * Scheduling reuses it to keep a task's length when it moves.
 *
 * @internal
 */
export function addTaskDuration(
  start: DateTimeMs,
  duration: Duration,
  precision: DatePrecision,
  mode: DurationMode,
  settings: ResolvedModelOptions,
): DateTimeMs | undefined {
  const { calendar } = settings;
  const base = addDuration(start, { months: duration.months, ms: 0 });
  if (mode === 'calendar' || duration.ms === 0) return asDateTimeMs(base + duration.ms);
  if (precision === 'time') return calendar.addWorkingTime(base, duration.ms);
  const last = calendar.workingSpanEnd(toDayKey(base), duration.ms / DAY);
  return last === undefined ? undefined : fromDayKey(asDayKey(last + 1));
}

function readProgress(ctx: TaskContext): number {
  const { progress } = ctx.task;
  if (progress === undefined) return 0;
  if (progress >= 0 && progress <= 100) return progress;
  const clamped = progress < 0 ? 0 : 100;
  report(
    ctx,
    'progress-out-of-range',
    'warning',
    'progress',
    DEV ? `${progress} is outside 0…100, clamped` : '',
    {
      value: progress,
      suggested: clamped,
    },
  );
  return clamped;
}

function spanOf(
  start: DateTimeMs,
  endExclusive: DateTimeMs,
  precision: DatePrecision,
  mode: DurationMode,
  progress: number,
  settings: ResolvedModelOptions,
): TaskSpan {
  const { calendar, granularity } = settings;
  const ms = endExclusive - start;
  const workingMs = calendar.countWorkingTime(start, endExclusive);
  const inclusive = precision === 'day' && settings.endInclusive && ms > 0;
  return Object.freeze({
    start,
    endExclusive,
    end: inclusive ? asDateTimeMs(endExclusive - DAY) : endExclusive,
    duration: Object.freeze({
      calendarDays: ms / DAY,
      workingDays: workingMs / DAY,
      nonWorkingDays: (ms - workingMs) / DAY,
      ms,
      workingMs,
    }),
    progressDate: progressToDate({ start, endExclusive, progress, mode, calendar, granularity }),
  });
}

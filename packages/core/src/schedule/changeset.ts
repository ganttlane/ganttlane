/**
 * The `ChangeSet` (`docs/api.md` §5, FR-TX-1, FR-SCH-5, FR-SCH-6): every task an edit changes,
 * directly or through propagation, with its values before and after, and the scheduling conflicts
 * of the result. Produced by `propagate`; conflicts are found by `detectConflicts`.
 */

import type { TaskId } from '../model';
import type { DatePrecision, DateTimeMs } from '../time';

/**
 * What produced a change set: a drag of the whole bar (`'move'`), of its start or end edge, of
 * the progress handle (`'progress'`), a programmatic change (`'api'`), stepping back or forward in
 * the history (`'undo'`, `'redo'`), or an edit session: its aggregated diff (`'session'`) and the
 * inverse a rollback reverts (`'rollback'`).
 */
export type ChangeReason =
  | 'move'
  | 'resize-start'
  | 'resize-end'
  | 'progress'
  | 'api'
  | 'undo'
  | 'redo'
  | 'session'
  | 'rollback';

/**
 * Why a task changed (FR-SCH-5): it was edited (`'direct'`), a predecessor moved it through a link
 * (`'link'`), or its parent moved it (`'parent'`).
 */
export type ChangeCause = 'direct' | 'link' | 'parent';

/**
 * Where a task's bar lies: the half-open interval `[start, endExclusive)` (FR-TIME-3). A
 * `TaskSpan` and a {@link TaskPatch} have these fields.
 */
export interface TaskBounds {
  /** First moment of the task. */
  readonly start: DateTimeMs;
  /** End of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: DateTimeMs;
}

/**
 * The scheduled values of a task in core's numeric form. Every date is a multiple of
 * `scheduling.granularity`, and of a whole day for day-precision tasks (FR-SNAP-12).
 */
export interface TaskPatch extends TaskBounds {
  /** Progress in percent, `0` … `100`, not rounded (FR-PROG-2). */
  readonly progress: number;
  /**
   * The task's precision, present only in a {@link Change} that changes it (FR-SNAP-7): a drag
   * with `scheduling.keepDayPrecision: false` turns a day-precision task into a timed one, so
   * its change has `before.precision: 'day'` and `after.precision: 'time'` (and an undo swaps
   * them). Absent: the task keeps its precision. The dates follow the precision of `after`:
   * multiples of the granularity for `'time'`, of a whole day for `'day'`.
   */
  readonly precision?: DatePrecision | undefined;
}

/** One changed task of a {@link ChangeSet}. Deeply frozen. */
export interface Change {
  /** The task. */
  readonly id: TaskId;
  /** Its values before the edit (from the model). */
  readonly before: TaskPatch;
  /**
   * Its values after the edit; always different from `before`: in `start` or `endExclusive` for
   * the changes of `propagate` (and in `precision` when the edit turns a day-precision task into
   * a timed one), in `progress` for a progress drag.
   */
  readonly after: TaskPatch;
  /** Why it changed. */
  readonly cause: ChangeCause;
  /**
   * For `'link'`: the predecessor whose link placed it; for `'parent'`: the parent. Absent for
   * `'direct'`.
   */
  readonly via?: TaskId;
}

/**
 * Kinds of {@link Conflict} (FR-SCH-6), in the order conflicts of one task are listed:
 * - `'non-working-start'`: the bar starts on a non-working day;
 * - `'non-working-end'`: the bar's last day is a non-working day;
 * - `'outside-parent'`: the bar sticks out of its parent's bar;
 * - `'link-violated'`: a link's gap is below its required minimum.
 */
export type ConflictType = Conflict['type'];

/** Fields shared by every {@link Conflict}. */
export interface ConflictBase {
  /** Always `'warning'`: a conflict is accepted data, reported so that the app can react. */
  readonly severity: 'warning';
  /** The task the conflict is shown on (for `'link-violated'`: the link's target). */
  readonly id: TaskId;
  /** Short English explanation with the offending date, parent or link. */
  readonly message: string;
}

/**
 * The start or the last day of a bar lies on a non-working day of the model's work calendar
 * (FR-SCH-6, FR-SCH-7: "start on Saturday + ignore"). These are exactly the edges that
 * `skipNonWorkingDays` would roll onto working time.
 */
export interface NonWorkingDayConflict extends ConflictBase {
  /**
   * `'non-working-start'`: the day of `start`; `'non-working-end'`: the day of the bar's last
   * instant (`endExclusive - 1 ms`). Milestones and other zero-length bars only have a start.
   */
  readonly type: 'non-working-start' | 'non-working-end';
  /** Midnight of the non-working day (floating time). */
  readonly date: DateTimeMs;
}

/** A child's bar starts before its parent's bar or ends after it (FR-SCH-6). */
export interface OutsideParentConflict extends ConflictBase {
  /** Discriminant. */
  readonly type: 'outside-parent';
  /** The resolved parent (it has a bar). */
  readonly parentId: TaskId;
  /**
   * The child's edges outside the parent, in this order: `'start'` (it starts before the
   * parent's start), `'end'` (it ends after the parent's end). Never empty.
   */
  readonly edges: readonly ('start' | 'end')[];
}

/**
 * An active link that is not on a cycle has a gap between its anchors below the minimum it
 * requires (FR-SCH-6, FR-LINK-1): the successor is closer to its predecessor, or overlaps it
 * more, than the link allows. The minimum is the lag for an explicit `Link.lag`, and
 * `min(derived lag, 0)` for a lag derived from the initial gap (ADR-007).
 */
export interface LinkViolatedConflict extends ConflictBase {
  /** Discriminant. */
  readonly type: 'link-violated';
  /** The link (`LinkRecord.id`); `id` is its target. */
  readonly linkId: string;
  /** The smallest allowed gap, in milliseconds of the target's `durationMode` time. */
  readonly requiredMs: number;
  /** The current gap, measured like the lag (`measureLag`); always below `requiredMs`. */
  readonly actualMs: number;
}

/**
 * A scheduling problem in a state of the plan (FR-SCH-6): a start or end on a non-working day, a
 * child outside its parent or a violated link. Conflicts are warnings: core never refuses or
 * corrects a state because of them. They feed `onBeforeTaskChange` (FR-TX-2), which may cancel or
 * modify the edit, and `TaskRecord.issues`. Narrow with `type`. Deeply frozen.
 */
export type Conflict = NonWorkingDayConflict | OutsideParentConflict | LinkViolatedConflict;

/**
 * The outcome of one user action or API call (FR-TX-1): every task it changes, directly or through
 * propagation, each once, in a deterministic order (FR-SCH-5). Deeply frozen; applying it is the
 * store's job (plan step 3.1).
 */
export interface ChangeSet {
  /** What produced it. */
  readonly reason: ChangeReason;
  /** The changed tasks: the edited task first, then the others in topological order. */
  readonly changes: readonly Change[];
  /**
   * Conflicts of the result that involve a changed task, in model order of their task, then by
   * {@link ConflictType}.
   */
  readonly conflicts: readonly Conflict[];
}

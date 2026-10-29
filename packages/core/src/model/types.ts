/**
 * Public input types of the data model: what callers pass as `tasks` and
 * `links`. Hand-written with TSDoc as the source of truth for IDEs; the valibot schemas in
 * `schema.ts` describe the same shape at run time and a type test keeps both in sync.
 *
 * Optional fields accept an explicit `undefined` (treated as absent), so objects built with
 * `{ start: row.start ?? undefined }` type-check under `exactOptionalPropertyTypes`.
 */

import type { DateInput, DatePrecision, DurationInput } from '../time';

/**
 * Identifier of a task. Never changed by the library and compared with `===`, so `5` and `'5'`
 * are different tasks (keep `parentId`, `links` and `dependencies` in the same form as `id`).
 */
export type TaskId = string | number;

/**
 * Type of a dependency between a predecessor (`source`) and a successor (`target`):
 * - `'FS'` finish-to-start: the successor starts after the predecessor finishes;
 * - `'SS'` start-to-start, `'FF'` finish-to-finish, `'SF'` start-to-finish.
 *
 * Each link pins one edge of the successor to an edge of the predecessor, so two links between
 * the same tasks pin both edges of the successor. An `FS` + `FF` pair without lags hangs both
 * pins from the predecessor's end: the successor moves rigidly and keeps its length. It
 * stretches when its pins come from different edges, as with `SS` + `FF`, or when explicit lags
 * ask for another length than it has.
 */
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * Kind of a task row:
 * - `'task'` (default): a bar from `start` to `end`;
 * - `'milestone'`: a zero-length point at `start` (`end` and `duration` are ignored);
 * - `'placeholder'`: a row without a bar; its dates are ignored.
 */
export type TaskType = 'task' | 'milestone' | 'placeholder';

/**
 * How durations and lags are counted: `'calendar'` counts all time, `'working'` only working time
 * of the work calendar.
 */
export type DurationMode = 'calendar' | 'working';

/** Per-interaction editing switches (the `editing` option); omitted ones are inherited. */
export interface EditingFlags {
  /** Dragging the whole bar. */
  readonly move?: boolean | undefined;
  /** Dragging an edge of the bar. */
  readonly resize?: boolean | undefined;
  /** Dragging the progress handle. */
  readonly progress?: boolean | undefined;
  /** Creating and deleting links from the UI. */
  readonly links?: boolean | undefined;
}

/**
 * One entry of the `Task.dependencies` shorthand in object form: a link from the task `id` to the
 * task that lists it.
 */
export interface TaskDependency {
  /** The predecessor (`Link.source`). */
  readonly id: TaskId;
  /** Link type; defaults to `scheduling.defaultLinkType`. */
  readonly type?: LinkType | undefined;
  /** As {@link Link.lag}. */
  readonly lag?: number | DurationInput | undefined;
}

/**
 * A task as callers pass it in. Never mutated by the library.
 *
 * Dates: give `start` with `end` or with `duration` (`end` wins when both are set); a task
 * without any date is a row without a bar.
 *
 * @typeParam TData - Type of the caller's payload in {@link Task.data}.
 */
export interface Task<TData = unknown> {
  /** Stable identifier, unique among the tasks. */
  readonly id: TaskId;
  /** Label of the bar and the row. */
  readonly name: string;
  /** First moment of the task: `'YYYY-MM-DD'`, `'YYYY-MM-DDTHH:mm[:ss]'`, `Date` or epoch ms. */
  readonly start?: DateInput | undefined;
  /**
   * End of the task. A date-only value is the **last day**, inclusive (`dates.endInclusive`,
   * default `true`); a value with a time of day is the exact moment the task ends (exclusive).
   */
  readonly end?: DateInput | undefined;
  /**
   * Length from `start` when there is no `end`: a number of days (`3`, `0.5`) or a duration
   * (`'6h'`, `'1d 4h'`, `{ hours: 4 }`), counted in calendar or working time per `durationMode`.
   */
  readonly duration?: number | DurationInput | undefined;
  /**
   * Overrides the precision derived from the input: `'day'` puts the task on day
   * boundaries, `'time'` treats every value as an exact moment (also a `Date` at midnight).
   */
  readonly precision?: DatePrecision | undefined;
  /** How `duration` is counted; defaults to `scheduling.durationMode`. */
  readonly durationMode?: DurationMode | undefined;
  /** Progress in percent, `0` … `100` (out-of-range values are clamped with a warning). */
  readonly progress?: number | undefined;
  /** What stays fixed when the task is resized: the done part (`'start'`) or the rest (`'end'`). */
  readonly progressAnchor?: 'start' | 'end' | undefined;
  /** Row kind, default `'task'`. */
  readonly type?: TaskType | undefined;
  /** Id of the parent task. */
  readonly parentId?: TaskId | undefined;
  /**
   * Which edges of the task are pinned to which edges of its parent: one link type or one per
   * task edge, e.g. `['SS', 'FF']` (the start follows the parent's start, the end the parent's
   * end). Default `hierarchy.childAnchor`. It is only read for a child with
   * `followParent: true`; other children ignore it (with `hierarchy.moveChildren: 'all'` they
   * shift with their parent's start instead).
   */
  readonly parentAnchor?: LinkType | readonly LinkType[] | undefined;
  /**
   * Pins the task to its parent per `parentAnchor`, so that it follows the parent's edges when
   * the parent moves or is resized. Without it, a child shifts with its parent's start only when
   * `hierarchy.moveChildren` is `'all'` (the default); with `'following'` only children with
   * `followParent` move with their parent, and with `'none'` no child does.
   */
  readonly followParent?: boolean | undefined;
  /** Neither editable nor moved by propagation. */
  readonly locked?: boolean | undefined;
  /** Keeps its duration when an edge is pushed. */
  readonly fixedDuration?: boolean | undefined;
  /** Whether links can be drawn from and to the task. */
  readonly linkable?: boolean | undefined;
  /** Overrides the global `editing` option for this task. */
  readonly editable?: boolean | EditingFlags | undefined;
  /** CSS class of the bar. */
  readonly className?: string | undefined;
  /** CSS class of the row. */
  readonly rowClassName?: string | undefined;
  /** Bar colour, set as `--gantt-bar-color`. */
  readonly color?: string | undefined;
  /** Progress colour. */
  readonly progressColor?: string | undefined;
  /** Free text, e.g. for a tooltip. */
  readonly description?: string | undefined;
  /**
   * Shorthand for links that end at this task: predecessor ids or {@link TaskDependency} objects.
   * Merged into `links`; the canonical form is the separate `links` array.
   */
  readonly dependencies?: readonly (TaskId | TaskDependency)[] | undefined;
  /** The caller's payload, never read by the library. */
  readonly data?: TData | undefined;
}

/** A dependency between two tasks. Never mutated by the library. */
export interface Link {
  /** Unique id; defaults to `` `${source}:${type}:${target}` ``. */
  readonly id?: string | undefined;
  /** Predecessor. */
  readonly source: TaskId;
  /** Successor. */
  readonly target: TaskId;
  /** Link type; defaults to `scheduling.defaultLinkType`. */
  readonly type?: LinkType | undefined;
  /**
   * Gap the link keeps: a number of days (negative for a lead) or a duration (`'4h'`), counted in
   * the successor's `durationMode`. Omitted: the current gap is kept.
   */
  readonly lag?: number | DurationInput | undefined;
  /**
   * Whether the UI offers to delete the link (the Remove action of the link menu), default
   * `true`. Like `Task.editable` and the `editing` option it is a permission of the UI only:
   * `removeLink()` deletes the link whatever it says.
   */
  readonly editable?: boolean | undefined;
}

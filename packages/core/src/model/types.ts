/**
 * Public input types of the data model (`docs/api.md` §2): what callers pass as `tasks` and
 * `links`. Hand-written with TSDoc as the source of truth for IDEs; the valibot schemas in
 * `schema.ts` describe the same shape at run time and a type test keeps both in sync (ADR-016).
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
 * An `FS` + `FF` pair between the same tasks makes the successor stretch with the predecessor
 * (FR-LINK-2).
 */
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * Kind of a task row:
 * - `'task'` (default): a bar from `start` to `end`;
 * - `'milestone'`: a zero-length point at `start` (`end` and `duration` are ignored);
 * - `'placeholder'`: a row without a bar (legacy `virtual`); its dates are ignored.
 */
export type TaskType = 'task' | 'milestone' | 'placeholder';

/**
 * How durations and lags are counted: `'calendar'` counts all time, `'working'` only working time
 * of the work calendar (legacy `duration_is_actual`).
 */
export type DurationMode = 'calendar' | 'working';

/** Per-interaction editing switches (`docs/api.md` §3 `editing`); omitted ones are inherited. */
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
 * A task as callers pass it in (`docs/api.md` §2). Never mutated by the library.
 *
 * Dates: give `start` with `end` or with `duration` (`end` wins when both are set); a task
 * without any date is a row without a bar (FR-DATA-3).
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
   * Overrides the precision derived from the input (ADR-015): `'day'` puts the task on day
   * boundaries, `'time'` treats every value as an exact moment (also a `Date` at midnight).
   */
  readonly precision?: DatePrecision | undefined;
  /** How `duration` is counted; defaults to `scheduling.durationMode` (legacy `duration_is_actual`). */
  readonly durationMode?: DurationMode | undefined;
  /** Progress in percent, `0` … `100` (out-of-range values are clamped with a warning). */
  readonly progress?: number | undefined;
  /** What stays fixed when the task is resized: the done part (`'start'`) or the rest (`'end'`). */
  readonly progressAnchor?: 'start' | 'end' | undefined;
  /** Row kind, default `'task'`. */
  readonly type?: TaskType | undefined;
  /** Id of the parent task (legacy `parent.id`). */
  readonly parentId?: TaskId | undefined;
  /** Which parent edges the task is pinned to (legacy `parent.pinned_to`); default `hierarchy.childAnchor`. */
  readonly parentAnchor?: LinkType | readonly LinkType[] | undefined;
  /** Moves with its parent when `hierarchy.moveChildren` is `'following'` (legacy `follows_parent`). */
  readonly followParent?: boolean | undefined;
  /** Neither editable nor moved by propagation (legacy `frozen`). */
  readonly locked?: boolean | undefined;
  /** Keeps its duration when an edge is pushed (legacy `duration_as_constant`). */
  readonly fixedDuration?: boolean | undefined;
  /** Whether links can be drawn from and to the task (legacy `!readonly_dependencies`). */
  readonly linkable?: boolean | undefined;
  /** Overrides the global `editing` option for this task. */
  readonly editable?: boolean | EditingFlags | undefined;
  /** CSS class of the bar (legacy `custom_class`). */
  readonly className?: string | undefined;
  /** CSS class of the row (legacy `custom_row_class`). */
  readonly rowClassName?: string | undefined;
  /** Bar colour, set as `--gantt-bar-color`. */
  readonly color?: string | undefined;
  /** Progress colour (legacy `color_progress`). */
  readonly progressColor?: string | undefined;
  /** Free text, e.g. for a tooltip. */
  readonly description?: string | undefined;
  /**
   * Shorthand for links that end at this task: predecessor ids or {@link TaskDependency} objects.
   * Merged into `links` (ADR-007); the canonical form is the separate `links` array.
   */
  readonly dependencies?: readonly (TaskId | TaskDependency)[] | undefined;
  /** The caller's payload, never read by the library. */
  readonly data?: TData | undefined;
}

/** A dependency between two tasks (`docs/api.md` §2, ADR-007). Never mutated by the library. */
export interface Link {
  /** Unique id; defaults to `` `${source}:${type}:${target}` ``. */
  readonly id?: string | undefined;
  /** Predecessor (legacy `dependencies[].id`). */
  readonly source: TaskId;
  /** Successor (legacy: the task that lists the dependency). */
  readonly target: TaskId;
  /** Link type; defaults to `scheduling.defaultLinkType` (legacy `pinned_to`). */
  readonly type?: LinkType | undefined;
  /**
   * Gap the link keeps: a number of days (negative for a lead) or a duration (`'4h'`), counted in
   * the successor's `durationMode`. Omitted: the current gap is kept (ADR-007).
   */
  readonly lag?: number | DurationInput | undefined;
  /** Whether the link can be deleted from the UI, default `true`. */
  readonly editable?: boolean | undefined;
}

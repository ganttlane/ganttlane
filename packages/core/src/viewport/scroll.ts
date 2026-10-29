/**
 * Scroll targets (FR-SCROLL-1, FR-SCROLL-2, FR-TL-6): the scroll offsets that show a date, an
 * interval, a task's bar and row, and the initial scroll position, growing the infinite
 * timeline first when the target is outside its range.
 */

import type { Layout } from '../layout';
import type { TaskId } from '../model';
import type { TimeRange } from '../scale';
import type { DateTimeMs } from '../time';
import { alignFraction, type ScrollAlign } from './align';
import {
  ensureContains,
  type EnsureContainsOptions,
  targetRange,
  type ViewportChange,
} from './extension';
import type { RangeSpan } from './range';
import {
  checkFinite,
  checkGeometry,
  checkState,
  clamp,
  maxScrollLeft,
  type TimelineState,
} from './state';

/**
 * A horizontal scroll to perform: first apply `change` (when the infinite timeline had to grow,
 * FR-TL-6), then scroll to `scrollLeft`, which is in the coordinates of the changed state.
 * Frozen.
 */
export interface ScrollPlan {
  /** The target scroll offset, clamped to the content. */
  readonly scrollLeft: number;
  /** The range change to apply before scrolling, or `undefined`. */
  readonly change: ViewportChange | undefined;
  /**
   * Whether `change` cut the current view away: over `maxSpan` / `maxWidth` the side away from
   * the target was trimmed together with the viewport, so `change.scrollLeft` is clamped and no
   * longer shows the old picture. Scroll to `scrollLeft` instantly then: a smooth scroll would
   * start from an unrelated place, and the extensions and trims it triggers on its way could
   * cut the target away. `false` without a change.
   */
  readonly jump: boolean;
}

/** A scroll to a task: {@link ScrollPlan} plus the vertical offset (FR-SCROLL-2). Frozen. */
export interface TaskScrollPlan extends ScrollPlan {
  /** The target vertical scroll offset in body pixels, clamped to the rows. */
  readonly scrollTop: number;
}

/** Below this a clamped offset counts as the same picture (float rounding of the shift). */
const JUMP_TOLERANCE_PX = 1e-3;

/** Options of {@link planScrollTo} (named apart from the DOM's `ScrollToOptions`). */
export interface PlanScrollOptions {
  /** Where the target lands in the viewport; default `'start'`. */
  readonly align?: ScrollAlign | undefined;
  /**
   * The infinite timeline's policy: grow the range first when the target is outside it
   * ({@link ensureContains}). `undefined` or `false` for a fixed range: the offset is clamped.
   */
  readonly infinite?: EnsureContainsOptions | false | undefined;
}

/** Options of {@link scrollToTask}. */
export interface TaskScrollOptions extends PlanScrollOptions {
  /** Where the row lands vertically; default `align`. */
  readonly alignY?: ScrollAlign | undefined;
  /** Height of the body area visible below the sticky header, `0` or more. */
  readonly viewportHeight: number;
}

/**
 * The `scroll.initial` option, parsed (FR-SCROLL-1): today, the range start or end, the first
 * task, no scroll, or a date.
 */
export type InitialScroll = 'today' | 'start' | 'end' | 'first-task' | 'none' | DateTimeMs;

/** Input of {@link resolveInitialScroll}. */
export interface InitialScrollInput extends PlanScrollOptions {
  /** The timeline as mounted (range from `resolveRange`, scroll offset `0`). */
  readonly state: TimelineState;
  /**
   * The range `'start'` and `'end'` refer to: the data range from `resolveRange`. Default
   * `state.range`; pass it when the infinite timeline has grown or trimmed `state` since.
   */
  readonly range?: TimeRange | undefined;
  /** "Today" in floating time. */
  readonly now: DateTimeMs;
  /** The tasks' spans, for `'first-task'`; `undefined` entries are skipped. */
  readonly spans?: Iterable<RangeSpan | undefined> | undefined;
}

/**
 * The scroll offset that shows a date or an interval at `align` (FR-SCROLL-1, FR-SCROLL-2):
 * `x - fraction × (viewportWidth - width)`, clamped to `[0, contentWidth - viewportWidth]`. A
 * date (width `0`) lands at that fraction of the viewport; an interval (a bar) starts at the
 * left edge for `'start'`, ends at the right edge for `'end'`, is centred for `'center'`.
 *
 * Targets outside the range are clamped to an end of the content; for the infinite timeline use
 * {@link planScrollTo}, which grows the range first.
 *
 * @param target - A date or an interval `[start, end]`.
 * @param align - Where it lands.
 * @param state - Range, scale and viewport width (`scrollLeft` is not read).
 * @returns The clamped scroll offset.
 * @throws RangeError for an invalid state or target, or a non-finite `align`.
 */
export function scrollLeftFor(
  target: DateTimeMs | TimeRange,
  align: ScrollAlign,
  state: Pick<TimelineState, 'range' | 'scale' | 'viewportWidth'>,
): number {
  const { range, scale, viewportWidth } = state;
  checkGeometry(range, scale, viewportWidth);
  const { start, end } = targetRange(target);
  const x = scale.dateToX(start);
  const left = x - alignFraction(align) * (viewportWidth - (scale.dateToX(end) - x));
  return clamp(left, 0, maxScrollLeft(range, scale, viewportWidth));
}

/**
 * The vertical scroll offset that shows a row at `align` (FR-SCROLL-2), in body pixels (the
 * coordinates of `RowMetrics.y` and `Viewport.scrollTop`): `'start'` puts the row at the top of
 * the body area, right below the sticky header, `'end'` at its bottom, `'center'` in its middle;
 * clamped to `[0, bodyHeight - viewportHeight]`.
 *
 * @param rowY - Top of the row (`RowMetrics.y`).
 * @param rowHeight - Height of the row, `0` or more.
 * @param align - Where it lands.
 * @param viewportHeight - Height of the body area visible below the sticky header, `0` or more.
 * @param bodyHeight - Height of all rows (`RowLayout.bodyHeight`).
 * @returns The clamped scroll offset.
 * @throws RangeError for non-finite or negative sizes, or a non-finite `align`.
 */
export function scrollTopFor(
  rowY: number,
  rowHeight: number,
  align: ScrollAlign,
  viewportHeight: number,
  bodyHeight: number,
): number {
  checkFinite(rowY, 'rowY');
  for (const [value, what] of [
    [rowHeight, 'rowHeight'],
    [viewportHeight, 'viewportHeight'],
    [bodyHeight, 'bodyHeight'],
  ] as const) {
    if (!(Number.isFinite(value) && value >= 0)) {
      throw new RangeError(`${what} must be a finite number, 0 or more, got ${value}.`);
    }
  }
  const top = rowY - alignFraction(align) * (viewportHeight - rowHeight);
  return clamp(top, 0, Math.max(bodyHeight - viewportHeight, 0));
}

/**
 * A scroll to a date or an interval (FR-SCROLL-2, FR-TL-6, `scrollToDate` / `scrollToToday`):
 * with `infinite`, the range first grows to contain the target ({@link ensureContains}), so a
 * date outside it is reachable; the offset is then {@link scrollLeftFor} in the grown state.
 *
 * When the change cut the current view away (`jump`), scroll instantly.
 *
 * @param target - A date or an interval.
 * @param state - The current timeline.
 * @param options - `align` and the infinite timeline's policy.
 * @returns The frozen plan: the change to apply first (if any), the target offset and `jump`.
 * @throws RangeError for an invalid state, target or policy.
 *
 * @example
 * ```ts
 * const { change, scrollLeft } = planScrollTo(date, state, { align: 'center', infinite: policy });
 * if (change) applyChange(change); // range, content width, scrollLeft += change.shift
 * scroller.scrollTo({ left: scrollLeft, behavior });
 * ```
 */
export function planScrollTo(
  target: DateTimeMs | TimeRange,
  state: TimelineState,
  options: PlanScrollOptions = {},
): ScrollPlan {
  checkState(state);
  const { infinite } = options;
  const change =
    infinite === undefined || infinite === false
      ? undefined
      : ensureContains(state, target, infinite);
  const scrollLeft = scrollLeftFor(target, options.align ?? 'start', change ?? state);
  // The compensated offset had to be clamped: the old view is not in the new range.
  const jump =
    change !== undefined &&
    Math.abs(change.scrollLeft - (state.scrollLeft + change.shift)) > JUMP_TOLERANCE_PX;
  return Object.freeze({ scrollLeft, change, jump });
}

/**
 * A scroll to a task on both axes (FR-SCROLL-2, FR-TL-6, `scrollToTask`): its row at `alignY`
 * and its bar at `align`, the range grown first with `infinite` when the bar is outside it. A
 * task without a bar (placeholder, invalid) keeps the horizontal offset.
 *
 * @param id - The task.
 * @param layout - The layout built on `state.scale` (same origin and zoom).
 * @param state - The current timeline.
 * @param options - Alignments, the body viewport height and the infinite timeline's policy.
 * @returns The frozen plan, or `undefined` when the task has no visible row (unknown id,
 * collapsed parent).
 * @throws RangeError for an invalid state, a layout built on another scale or bad options.
 */
export function scrollToTask(
  id: TaskId,
  layout: Layout,
  state: TimelineState,
  options: TaskScrollOptions,
): TaskScrollPlan | undefined {
  checkState(state);
  const { scale } = state;
  if (layout.scale.origin !== scale.origin || layout.scale.pxPerDay !== scale.pxPerDay) {
    throw new RangeError('The layout was built on another scale: rebuild it for this state.');
  }
  const row = layout.getRowMetrics(id);
  if (row === undefined) return undefined;
  const align = options.align ?? 'start';
  const scrollTop = scrollTopFor(
    row.y,
    row.height,
    options.alignY ?? align,
    options.viewportHeight,
    layout.rows.bodyHeight,
  );
  const bar = layout.getBarRect(id);
  if (bar === undefined) {
    const scrollLeft = clamp(
      state.scrollLeft,
      0,
      maxScrollLeft(state.range, scale, state.viewportWidth),
    );
    return Object.freeze({ scrollLeft, scrollTop, change: undefined, jump: false });
  }
  const target = { start: scale.xToDate(bar.x), end: scale.xToDate(bar.x + bar.width) };
  return Object.freeze({ ...planScrollTo(target, state, options), scrollTop });
}

/**
 * The initial horizontal scroll (FR-SCROLL-1, `scroll.initial`), with the same meaning whether
 * the timeline is infinite or not:
 * - `'start'` / `'end'`: the start of `range` (default `state.range`) at the left edge / its end
 *   at the right edge. They are date targets like the others: the infinite timeline grows
 *   around them, so the chart opens on the data's first (last) column with more timeline before
 *   (after) it;
 * - `'today'`: `now` at `align`;
 * - `'first-task'`: the earliest task start at `align`, or today without tasks;
 * - a date: that date at `align`;
 * - `'none'`: no scroll (`undefined`).
 *
 * With `infinite`, a target outside the range grows it first ({@link planScrollTo}).
 *
 * @param initial - The parsed option.
 * @param input - The mounted timeline, today, the spans, `align` and the infinite policy.
 * @returns The frozen plan, or `undefined` for `'none'`.
 * @throws RangeError for an invalid state or policy.
 */
export function resolveInitialScroll(
  initial: InitialScroll,
  input: InitialScrollInput,
): ScrollPlan | undefined {
  const { state } = input;
  const range = input.range ?? state.range;
  switch (initial) {
    case 'none':
      return undefined;
    case 'start':
      return planScrollTo(range.start, state, { ...input, align: 'start' });
    case 'end':
      return planScrollTo(range.end, state, { ...input, align: 'end' });
    case 'today':
      return planScrollTo(input.now, state, input);
    case 'first-task':
      return planScrollTo(firstStart(input.spans) ?? input.now, state, input);
    default:
      return planScrollTo(initial, state, input);
  }
}

function firstStart(spans: Iterable<RangeSpan | undefined> | undefined): DateTimeMs | undefined {
  let first: DateTimeMs | undefined;
  for (const span of spans ?? []) {
    if (span !== undefined && (first === undefined || span.start < first)) first = span.start;
  }
  return first;
}

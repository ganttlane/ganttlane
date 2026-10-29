/**
 * The infinite timeline (FR-TL-2 … FR-TL-6, `docs/architecture.md` §7): when to grow or trim the
 * range, by how much, and the `scrollLeft` compensation that keeps the date under the viewport's
 * left edge in place. Pure math over a {@link TimelineState}: the renderer feeds it the scroll
 * position from every `scroll` event and applies the returned change in the same frame.
 */

import { createTimeScale, type TimeRange, type TimeScale } from '../scale';
import { asDateTimeMs, type DateAdapter, type DateTimeMs, type Duration } from '../time';
import { ceilToColumn, type ColumnGrid, floorToColumn } from './columns';
import { VIEWPORT_DEFAULTS } from './defaults';
import {
  checkFinite,
  checkPositive,
  checkRange,
  checkState,
  clamp,
  contentWidth,
  maxScrollLeft,
  shiftBy,
  type TimelineState,
} from './state';

/** Limits of the infinite timeline (`timeline.infinite.bounds`): it never extends past them. */
export interface TimelineBounds {
  /** The range never starts before this date by extension. */
  readonly min?: DateTimeMs | undefined;
  /** The range never ends after this date by extension. */
  readonly max?: DateTimeMs | undefined;
}

/**
 * How the infinite timeline grows and shrinks (`timeline.infinite`, parsed by
 * `resolveTimelineOptions`), plus the view mode's columns and calendar math. Every field is
 * optional; defaults depend on the viewport width.
 */
export interface ExtensionPolicy {
  /**
   * Distance in px from the viewport to a range edge at or below which that edge is extended,
   * `0` or more. Default: the viewport width.
   */
  readonly threshold?: number | undefined;
  /**
   * How much one extension adds at least, positive; more when that would leave the edge within
   * the threshold; rounded up to whole columns. Also the smallest trim. Counts as a quarter of
   * `maxWidth` at most (in px), so the trims can always make room for the next extension under
   * the cap of twice `maxWidth`. Default: two viewport widths of time
   * (`scale.pxToDuration(2 × viewportWidth)`).
   */
  readonly extendBy?: Duration | undefined;
  /** The range never extends past these dates. */
  readonly bounds?: TimelineBounds | undefined;
  /** Longest range, positive: the edge farther from the viewport is trimmed down to it. */
  readonly maxSpan?: Duration | undefined;
  /**
   * Widest content in px, like `maxSpan` in pixels: trimmed down to it, never extended or grown
   * for a scroll target past twice it (browsers cap element sizes). Default
   * `VIEWPORT_DEFAULTS.maxWidth` (4 000 000).
   */
  readonly maxWidth?: number | undefined;
  /** Column boundaries of the view mode (`columnGrid`): range edges stay on them. */
  readonly columns?: ColumnGrid | undefined;
  /** Calendar math for durations with months; default the built-in floating arithmetic. */
  readonly adapter?: DateAdapter | undefined;
}

/**
 * Why a {@link ViewportChange} happened: an edge extended or trimmed by {@link planExtension},
 * or the range grown for a programmatic scroll ({@link ensureContains}).
 */
export type ViewportChangeReason =
  'extend-start' | 'extend-end' | 'trim-start' | 'trim-end' | 'scroll-to';

/**
 * A new range with its scale and the compensated scroll offset. It is the next
 * {@link TimelineState} as is (`state = change`), plus what the renderer needs to apply it.
 * Frozen.
 */
export interface ViewportChange extends TimelineState {
  /** The new range. */
  readonly range: TimeRange;
  /** A scale with the new origin (`range.start`); the same object when the start is unchanged. */
  readonly scale: TimeScale;
  /**
   * The compensated scroll offset: the old one plus {@link ViewportChange.shift}, clamped to the
   * new content. Clamping only happens when the content is narrower than the viewport, or when
   * {@link ensureContains} had to cut the old view away.
   */
  readonly scrollLeft: number;
  /**
   * How far every date moved on the content, in px: `newScale.dateToX(t) - oldScale.dateToX(t)`
   * for any `t`. Positive when the start was extended, negative when it was trimmed, `0` when
   * only the end changed. Apply it relative to the live scroll offset (`scrollLeft += shift`)
   * and to rendered x positions, in the same frame as the new content width.
   */
  readonly shift: number;
  /** Why the range changed. */
  readonly reason: ViewportChangeReason;
}

/** Options of {@link ensureContains}: the policy plus the room to keep around the target. */
export interface EnsureContainsOptions extends ExtensionPolicy {
  /**
   * Pixels of timeline to have on each side of the target, `0` or more. Default
   * `threshold + viewportWidth + 1`: enough to align the target anywhere in the viewport with
   * every edge farther than the threshold, so no extension fires while scrolling to it.
   */
  readonly padding?: number | undefined;
}

type Side = 'start' | 'end';

const START_FIRST: readonly Side[] = ['start', 'end'];
const END_FIRST: readonly Side[] = ['end', 'start'];

/** A policy with defaults applied, for one state. */
interface Plan {
  readonly state: TimelineState;
  /** Pixels per millisecond. */
  readonly k: number;
  readonly threshold: number;
  readonly extendBy: Duration;
  /** The most one `extendBy` moves an edge, in ms: a quarter of `maxWidth`. */
  readonly reach: number;
  readonly min: number;
  readonly max: number;
  readonly maxSpan: Duration | undefined;
  readonly maxWidth: number;
  readonly columns: ColumnGrid | undefined;
  readonly adapter: DateAdapter | undefined;
}

/**
 * The next step of the infinite timeline for a scroll position (FR-TL-2 … FR-TL-5), or
 * `undefined` when the range is fine as it is. Pure, O(1); at most **one** change per call: the
 * renderer calls it once per frame from its `scroll` listener (every scroll source: wheel,
 * scrollbar, keyboard, touch, programmatic, drag autoscroll), applies the change and lets the
 * next frame call again.
 *
 * `extendBy` below counts as a quarter of `maxWidth` at most (in px of the current zoom: a year
 * of extension at the hour mode would be wider than the browsers allow).
 *
 * Rules, in order:
 * 1. **Extend** an edge the viewport is near: `scrollLeft <= threshold` for the start,
 *    `contentWidth - scrollLeft - viewportWidth <= threshold` for the end. The nearer edge goes
 *    first (the end on a tie, as it needs no compensation); an edge at its bound is skipped, and
 *    so, for now, is one whose extension would make the content wider than `2 × maxWidth`. The
 *    edge moves by `extendBy` (calendar-aware), or further when that would still leave it within
 *    the threshold (a jump to the edge, content narrower than the viewport), so one extension
 *    always takes the edge out of it; then outward to the next column boundary (so by at least
 *    one column), stopping at `bounds.min` / `bounds.max`.
 * 2. **Trim** when the range is longer than `maxSpan` or wider than `maxWidth`: the edge farther
 *    from the viewport first, inward to a column boundary, down to the limit but never closer to
 *    the viewport than `threshold + extendBy` (what an extension of that edge would leave), so a
 *    trimmed edge is not extended again until the user scrolls `extendBy` towards it, and an
 *    edge just extended is never trimmed. Like extensions, trims come in chunks: an edge is
 *    trimmed only by `extendBy` or more, so scrolling away from it changes the range once per
 *    `extendBy`, not once per column. When one edge has nothing to trim, the other is tried. The
 *    limits therefore hold down to `viewportWidth + 2 × (threshold + 2 × extendBy)` (11 viewport
 *    widths with the defaults); a shorter limit leaves the span above it, by at most that.
 * 3. **Extend within the cap**: an edge skipped in rule 1 for the cap, when nothing could be
 *    trimmed first, grows by the room left under `2 × maxWidth` (inward to a column boundary),
 *    so no edge is ever blocked while there is room. The content never exceeds `2 × maxWidth`
 *    by an extension.
 *
 * **Compensation** (FR-TL-3): changing the start moves the scale origin, so every x moves by
 * `shift = oldScale.durationToPx(oldStart - newStart)` and `scrollLeft += shift`. The date under
 * the viewport's left edge is exactly the same before and after (up to float rounding, far
 * below a pixel) whenever the content is at least as wide as the viewport. Changing the end
 * moves nothing (`shift = 0`). Content width changes exactly by the added or removed time.
 *
 * Idempotent: once nothing is needed it returns `undefined` until the scroll position, the
 * viewport or the policy change. Without scrolling it settles within four calls (at most one
 * extension and one trim per edge), so a renderer may also loop it to completion before the
 * first paint.
 *
 * @param state - Range, scale (origin `range.start`), scroll offset and viewport width.
 * @param policy - Threshold, extension size, bounds, limits and the view mode's columns.
 * @returns The change to apply, or `undefined`. Always `undefined` for a zero-width viewport.
 * @throws RangeError for a state that breaks the {@link TimelineState} contract (scale origin
 * other than `range.start`, empty range, non-finite values) or an unusable policy (negative
 * threshold, empty or negative durations, `bounds.min >= bounds.max`, `maxWidth <= 0`).
 *
 * @example
 * ```ts
 * scroller.addEventListener('scroll', () => requestFrame(() => {
 *   const change = planExtension({ ...state, scrollLeft: scroller.scrollLeft }, policy);
 *   if (!change) return;
 *   const { range, scale } = change;
 *   content.style.width = `${scale.durationToPx(range.end - range.start)}px`; // grow first
 *   scroller.scrollLeft += change.shift; // then compensate, in the same frame, before paint
 *   state = change;
 * }), { signal });
 * ```
 */
export function planExtension(
  state: TimelineState,
  policy: ExtensionPolicy = {},
): ViewportChange | undefined {
  checkState(state);
  if (state.viewportWidth <= 0) return undefined;
  const plan = resolvePlan(state, policy);
  const { range, scale, scrollLeft, viewportWidth } = state;
  const width = contentWidth(range, scale);
  const toStart = scrollLeft;
  const toEnd = width - scrollLeft - viewportWidth;

  /** An edge to extend whose whole extension does not fit under the cap, with its base. */
  let capped: { readonly side: Side; readonly base: number } | undefined;
  for (const side of toStart < toEnd ? START_FIRST : END_FIRST) {
    if ((side === 'start' ? toStart : toEnd) > plan.threshold) continue;
    // Growing the start by d px leaves it `d + min(scrollLeft, width - viewportWidth)` away: on
    // content narrower than the viewport the compensated offset is clamped.
    const base = side === 'start' ? Math.min(toStart, width - viewportWidth) : toEnd;
    const change = extend(plan, side, base, false);
    if (change !== undefined) return change;
    capped ??= { side, base };
  }
  if (range.end > latestEnd(plan, range.start)) {
    for (const side of toStart > toEnd ? START_FIRST : END_FIRST) {
      const change = trim(plan, side);
      if (change !== undefined) return change;
    }
  }
  // Nothing to trim first: the extension takes the room left under the cap.
  return capped === undefined ? undefined : extend(plan, capped.side, capped.base, true);
}

/**
 * Grows the range so it contains a date or an interval with `padding` px around it, for a
 * programmatic scroll outside the range (FR-TL-6, `scrollToDate` / `scrollToTask`): extend
 * first, then scroll in the returned state. `undefined` when the range already contains it.
 *
 * - Each edge that does not cover `target ± padding` moves outward to a column boundary, within
 *   `bounds` (a target past a bound is reached as far as the bound allows).
 * - The start compensates like {@link planExtension}: `scrollLeft += shift`, so a smooth scroll
 *   can start from the same picture.
 * - When the grown range exceeds `maxSpan` / `maxWidth`, the side away from the target is
 *   trimmed, never into `target ± padding`; if that cuts the current view away, `scrollLeft` is
 *   clamped (the old position is gone: scroll to the target instantly, `ScrollPlan.jump`).
 * - The range never grows wider than `2 × maxWidth`: a target that is wider with its padding
 *   (a bar of decades at the hour mode) keeps its start, and its end side is cut.
 *
 * @param state - The current timeline.
 * @param target - A date, or an interval `[start, end]` (a bar) with `end >= start`.
 * @param options - The extension policy (bounds, limits, columns) and `padding`.
 * @returns The change, reason `'scroll-to'`, or `undefined`.
 * @throws RangeError like {@link planExtension}, and for a non-finite target or padding.
 */
export function ensureContains(
  state: TimelineState,
  target: DateTimeMs | TimeRange,
  options: EnsureContainsOptions = {},
): ViewportChange | undefined {
  checkState(state);
  const plan = resolvePlan(state, options);
  const { range, viewportWidth } = state;
  const wanted = targetRange(target);
  const padding = options.padding ?? plan.threshold + viewportWidth + 1;
  if (!(Number.isFinite(padding) && padding >= 0)) {
    throw new RangeError(`padding must be a finite number, 0 or more, got ${padding}.`);
  }
  const { columns } = plan;
  const lo = asDateTimeMs(clamp(Math.floor(wanted.start - padding / plan.k), plan.min, plan.max));
  const hi = asDateTimeMs(clamp(Math.ceil(wanted.end + padding / plan.k), plan.min, plan.max));
  let start = lo < range.start ? Math.max(floorToColumn(lo, columns), plan.min) : range.start;
  let end = hi > range.end ? Math.min(ceilToColumn(hi, columns), plan.max) : range.end;
  if (start === range.start && end === range.end) return undefined;
  if (end > latestEnd(plan, start)) {
    if (start === range.start) {
      const earliest = ceilToColumn(asDateTimeMs(earliestStart(plan, end)), columns);
      start = Math.max(range.start, Math.min(earliest, floorToColumn(lo, columns)));
    } else if (end === range.end) {
      const latest = floorToColumn(asDateTimeMs(latestEnd(plan, start)), columns);
      end = Math.min(range.end, Math.max(latest, ceilToColumn(hi, columns)));
    }
  }
  // The hard cap: a target (with its padding) wider than twice maxWidth is reached at its start.
  const cap = Math.floor((2 * plan.maxWidth) / plan.k);
  if (end - start > cap) {
    const cut = floorToColumn(asDateTimeMs(start + cap), columns);
    end = cut > start ? cut : start + cap;
  }
  return rebuild(plan, asDateTimeMs(start), asDateTimeMs(end), 'scroll-to');
}

function resolvePlan(state: TimelineState, policy: ExtensionPolicy): Plan {
  const { scale, viewportWidth } = state;
  const threshold = policy.threshold ?? viewportWidth;
  if (!(Number.isFinite(threshold) && threshold >= 0)) {
    throw new RangeError(`threshold must be a finite number, 0 or more, got ${threshold}.`);
  }
  const extendBy = policy.extendBy ?? {
    months: 0,
    ms: Math.max(scale.pxToDuration(2 * viewportWidth), 1),
  };
  checkPositive(extendBy, 'extendBy');
  const { maxSpan } = policy;
  if (maxSpan !== undefined) checkPositive(maxSpan, 'maxSpan');
  const maxWidth = policy.maxWidth ?? VIEWPORT_DEFAULTS.maxWidth;
  if (!(Number.isFinite(maxWidth) && maxWidth > 0)) {
    throw new RangeError(`maxWidth must be a finite number greater than 0, got ${maxWidth}.`);
  }
  const min = policy.bounds?.min ?? -Infinity;
  const max = policy.bounds?.max ?? Infinity;
  if (policy.bounds?.min !== undefined) checkFinite(min, 'bounds.min');
  if (policy.bounds?.max !== undefined) checkFinite(max, 'bounds.max');
  if (min >= max) throw new RangeError(`bounds.min (${min}) must be before bounds.max (${max}).`);
  const k = scale.durationToPx(1);
  return {
    state,
    k,
    threshold,
    extendBy,
    reach: Math.max(Math.floor(maxWidth / 4 / k), 1),
    min,
    max,
    maxSpan,
    maxWidth,
    columns: policy.columns,
    adapter: policy.adapter,
  };
}

/**
 * Extends an edge (see {@link planExtension}, rule 1) that growing by `d` px leaves `base + d` px
 * from the viewport. `clamp`: an extension past the cap of twice `maxWidth` is cut to the room
 * left (inward to a column boundary) instead of being skipped.
 */
function extend(plan: Plan, side: Side, base: number, clamp: boolean): ViewportChange | undefined {
  const { state, columns } = plan;
  const { start, end } = state.range;
  // The least growth, in whole ms, that puts the edge farther than the threshold.
  const needed = Math.floor((plan.threshold - base) / plan.k) + 1;
  // The most the range can grow by under the cap.
  const room = Math.floor((2 * plan.maxWidth) / plan.k) - (end - start);
  if (side === 'start') {
    const by = Math.min(step(plan, start, -1), start - needed);
    let next = floorToColumn(asDateTimeMs(by), columns);
    if (start - next > room) {
      if (!clamp) return undefined;
      next = ceilToColumn(asDateTimeMs(start - room), columns);
    }
    const bounded = asDateTimeMs(Math.max(next, plan.min));
    return bounded < start ? rebuild(plan, bounded, end, 'extend-start') : undefined;
  }
  const by = Math.max(step(plan, end, 1), end + needed);
  let next = ceilToColumn(asDateTimeMs(by), columns);
  if (next - end > room) {
    if (!clamp) return undefined;
    next = floorToColumn(asDateTimeMs(end + room), columns);
  }
  const bounded = asDateTimeMs(Math.min(next, plan.max));
  return bounded > end ? rebuild(plan, start, bounded, 'extend-end') : undefined;
}

function trim(plan: Plan, side: Side): ViewportChange | undefined {
  const { state, k, columns } = plan;
  const { range, scrollLeft, viewportWidth } = state;
  const margin = plan.threshold / k;
  if (side === 'start') {
    const left = range.start + scrollLeft / k;
    const keep = asDateTimeMs(step(plan, Math.floor(left - margin), -1));
    const earliest = ceilToColumn(asDateTimeMs(earliestStart(plan, range.end)), columns);
    const next = asDateTimeMs(Math.min(earliest, floorToColumn(keep, columns)));
    const fits = next >= step(plan, range.start, 1) && next < range.end;
    return fits ? rebuild(plan, next, range.end, 'trim-start') : undefined;
  }
  const right = range.start + (scrollLeft + viewportWidth) / k;
  const keep = asDateTimeMs(step(plan, Math.ceil(right + margin), 1));
  const latest = floorToColumn(asDateTimeMs(latestEnd(plan, range.start)), columns);
  const next = asDateTimeMs(Math.max(latest, ceilToColumn(keep, columns)));
  const fits = next <= step(plan, range.end, -1) && next > range.start;
  return fits ? rebuild(plan, range.start, next, 'trim-end') : undefined;
}

/**
 * `t` moved by one `extendBy` (calendar-aware), later for `sign` `1`, earlier for `-1`, but by
 * no more than `reach`: so extensions fit under the cap and trims can always make room for them.
 */
function step(plan: Plan, t: number, sign: 1 | -1): number {
  const moved = shiftBy(asDateTimeMs(t), plan.extendBy, sign, plan.adapter);
  return sign === 1 ? Math.min(moved, t + plan.reach) : Math.max(moved, t - plan.reach);
}

/** The latest end that keeps a range starting at `start` within `maxSpan` and `maxWidth`. */
function latestEnd(plan: Plan, start: number): number {
  const byWidth = start + Math.floor(plan.maxWidth / plan.k);
  if (plan.maxSpan === undefined) return byWidth;
  return Math.min(byWidth, shiftBy(asDateTimeMs(start), plan.maxSpan, 1, plan.adapter));
}

/** The earliest start that keeps a range ending at `end` within `maxSpan` and `maxWidth`. */
function earliestStart(plan: Plan, end: number): number {
  const byWidth = end - Math.floor(plan.maxWidth / plan.k);
  if (plan.maxSpan === undefined) return byWidth;
  return Math.max(byWidth, shiftBy(asDateTimeMs(end), plan.maxSpan, -1, plan.adapter));
}

/** The change to `[start, end)`, with the scale moved to `start` and `scrollLeft` compensated. */
function rebuild(
  plan: Plan,
  start: DateTimeMs,
  end: DateTimeMs,
  reason: ViewportChangeReason,
): ViewportChange {
  const { range, scale, scrollLeft, viewportWidth } = plan.state;
  const nextRange: TimeRange = Object.freeze({ start, end });
  const nextScale =
    start === range.start
      ? scale
      : createTimeScale({ origin: start, pxPerDay: scale.pxPerDay, direction: scale.direction });
  const shift = scale.durationToPx(range.start - start) + 0;
  return Object.freeze({
    range: nextRange,
    scale: nextScale,
    scrollLeft: clamp(scrollLeft + shift, 0, maxScrollLeft(nextRange, nextScale, viewportWidth)),
    viewportWidth,
    shift,
    reason,
  });
}

/**
 * A date as an empty interval; an interval checked.
 *
 * @internal
 */
export function targetRange(target: DateTimeMs | TimeRange): TimeRange {
  if (typeof target === 'number') {
    checkFinite(target, 'target');
    return { start: target, end: target };
  }
  checkRange(target, 'target', true);
  return target;
}

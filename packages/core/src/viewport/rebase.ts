/**
 * Changing the scale or the range under the viewport while a date stays put: view mode switches,
 * zoom, and a range re-resolved for new data.
 */

import { createTimeScale, type TimeRange, type TimeScale } from '../scale';
import { asDateTimeMs, DAY } from '../time';
import { type ColumnGrid, snapRange } from './columns';
import type { TimelineBounds } from './extension';
import {
  checkFinite,
  checkRange,
  checkState,
  clamp,
  maxScrollLeft,
  type TimelineState,
} from './state';

/**
 * The scroll offset in `newScale` that keeps the date at viewport position `anchorX` (from the
 * left edge, e.g. the cursor or the centre) at `anchorX`. Exact: it
 * works on the scales' origins and zoom levels without rounding the anchor date, so the anchor
 * stays put within float rounding at any zoom (hour 960 px/day ↔ year 1 px/day) and for any
 * origins. Not clamped: clamp it to the new content (`rebaseTimeline` does).
 *
 * @param oldScale - The scale `scrollLeft` belongs to.
 * @param newScale - The scale to scroll in (another `pxPerDay`, another origin, or both).
 * @param scrollLeft - The scroll offset in `oldScale`.
 * @param anchorX - Viewport x of the anchor, `0` for the left edge.
 * @returns The scroll offset in `newScale`.
 * @throws RangeError for a non-finite `scrollLeft` or `anchorX`.
 *
 * @example
 * ```ts
 * const month = createTimeScale({ origin: range.start, pxPerDay: 4 });
 * scroller.scrollLeft = keepAnchor(dayScale, month, scroller.scrollLeft, viewportWidth / 2);
 * ```
 */
export function keepAnchor(
  oldScale: TimeScale,
  newScale: TimeScale,
  scrollLeft: number,
  anchorX: number,
): number {
  checkFinite(scrollLeft, 'scrollLeft');
  checkFinite(anchorX, 'anchorX');
  // Anchor date relative to the new origin, in ms: an exact integer plus a float, no rounding.
  const fromNewOrigin =
    oldScale.origin - newScale.origin + ((scrollLeft + anchorX) * DAY) / oldScale.pxPerDay;
  return (fromNewOrigin * newScale.pxPerDay) / DAY - anchorX + 0;
}

/** Options of {@link rebaseTimeline}. */
export interface RebaseOptions {
  /** The new range before snapping; default the current one. `end > start`. */
  readonly range?: TimeRange | undefined;
  /** The new zoom level (a view mode's `pxPerDay`); default the current one. */
  readonly pxPerDay?: number | undefined;
  /** Viewport x of the date that stays put; default `0`, the left edge. */
  readonly anchorX?: number | undefined;
  /** Column boundaries of the new view mode (`columnGrid`) to snap the range outward to. */
  readonly columns?: ColumnGrid | undefined;
  /**
   * Infinite timeline: also grow the range so the anchored viewport lies inside it (within
   * `bounds`), so the anchor can be kept even when the old range is too short for the new zoom.
   * Default `false`.
   */
  readonly fit?: boolean | undefined;
  /** With `fit`, the range is not grown past these dates. */
  readonly bounds?: TimelineBounds | undefined;
}

/**
 * The timeline on a new range and / or zoom level with the date at `anchorX` kept in place:
 * a view mode switch (new `pxPerDay` and columns, anchor usually the centre), a zoom (not
 * available yet; anchor at the cursor), or a range re-resolved after a data change (anchor at
 * the left edge). Pure; the result is frozen.
 *
 * 1. The range (`range`, or the current one) is snapped outward to `columns`; with `fit` it is
 *    first widened to contain the anchored viewport, within `bounds`.
 * 2. The scale is rebuilt on the range start with the new `pxPerDay` (direction kept).
 * 3. `scrollLeft` comes from {@link keepAnchor}, clamped to the new content; the anchor date
 *    stays at `anchorX` unless the clamp moves it (content narrower than the viewport without
 *    `fit`, or the anchored viewport crossing a bound).
 *
 * In the infinite timeline, run `planExtension` to rest afterwards (up to four calls), before the
 * new state is shown or scrolled to: `fit` keeps the whole old range, which at a higher zoom can
 * be far wider than `maxWidth` and than browsers allow (decades at the hour mode), and only the
 * trims bring it back. Their compensation keeps the anchored picture in place.
 *
 * @param state - The current timeline.
 * @param options - New range, zoom, anchor, columns and `fit`.
 * @returns The new frozen {@link TimelineState}.
 * @throws RangeError for an invalid state, range, `pxPerDay` or `anchorX`.
 *
 * @example
 * ```ts
 * // Switch to the month mode around the centre of the viewport.
 * state = rebaseTimeline(state, {
 *   pxPerDay: month.pxPerDay,
 *   columns: columnGrid(month, adapter),
 *   anchorX: state.viewportWidth / 2,
 *   fit: infinite,
 * });
 * ```
 */
export function rebaseTimeline(state: TimelineState, options: RebaseOptions = {}): TimelineState {
  checkState(state);
  const { scale, scrollLeft, viewportWidth } = state;
  const anchorX = options.anchorX ?? 0;
  checkFinite(anchorX, 'anchorX');
  const pxPerDay = options.pxPerDay ?? scale.pxPerDay;
  const base = options.range ?? state.range;
  checkRange(base, 'range');
  let { start, end } = base;
  const min = options.bounds?.min ?? -Infinity;
  const max = options.bounds?.max ?? Infinity;
  if (options.fit === true) {
    const anchor = state.range.start + ((scrollLeft + anchorX) * DAY) / scale.pxPerDay;
    const msPerPx = DAY / pxPerDay;
    start = asDateTimeMs(Math.min(start, clamp(Math.floor(anchor - anchorX * msPerPx), min, max)));
    end = asDateTimeMs(
      Math.max(end, clamp(Math.ceil(anchor + (viewportWidth - anchorX) * msPerPx), min, max)),
    );
  }
  let range = snapRange({ start, end }, options.columns);
  if (options.fit === true) {
    // Snapping must not carry an edge past a bound it respected (bounds are exact, like in
    // `planExtension`); an edge already past its bound is left as it is.
    const lower = start >= min ? min : -Infinity;
    const upper = end <= max ? max : Infinity;
    if (range.start < lower || range.end > upper) {
      range = Object.freeze({
        start: asDateTimeMs(Math.max(range.start, lower)),
        end: asDateTimeMs(Math.min(range.end, upper)),
      });
    }
  }
  const nextScale = createTimeScale({ origin: range.start, pxPerDay, direction: scale.direction });
  const next = keepAnchor(scale, nextScale, scrollLeft, anchorX);
  return Object.freeze({
    range,
    scale: nextScale,
    scrollLeft: clamp(next, 0, maxScrollLeft(range, nextScale, viewportWidth)),
    viewportWidth,
  });
}

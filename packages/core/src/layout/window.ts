/**
 * The virtualization window: which rows and
 * which part of the time axis are on screen, plus overscan, and the bars inside it.
 */

import type { TimeRange, TimeScale } from '../scale';
import type { BarGeometry } from './bars';
import { LAYOUT_DEFAULTS } from './dimensions';
import type { Layout } from './layout';
import type { RowLayout } from './rows';

/**
 * The visible part of the chart (glossary: Viewport): the scroller's scroll offsets and its
 * client size, in CSS pixels, as the renderer reads them from the scroll container.
 * The sticky header covers the top `headerHeight` pixels of it.
 */
export interface Viewport {
  /** Horizontal scroll offset: the time scale x at the left edge of the viewport. */
  readonly scrollLeft: number;
  /** Vertical scroll offset: the body y at the bottom edge of the sticky header. */
  readonly scrollTop: number;
  /** Width of the viewport. */
  readonly width: number;
  /** Height of the viewport, header included. */
  readonly height: number;
}

/** Options of {@link visibleWindow}. */
export interface WindowOptions {
  /** Rows to render above and below the visible ones, whole rows. Default 5. */
  readonly overscanRows?: number | undefined;
  /** Pixels of time axis to render left and right of the viewport. Default 400. */
  readonly overscanPx?: number | undefined;
}

/**
 * What to render: rows `firstRow … lastRow` (inclusive) and the time range `[start, end)`,
 * overscan included. Being a {@link TimeRange}, it can be passed to `headerRows` and `gridLines`
 * as is. Frozen.
 */
export interface LayoutWindow extends TimeRange {
  /** First row to render; with no row to render, `firstRow > lastRow`. */
  readonly firstRow: number;
  /** Last row to render, inclusive. */
  readonly lastRow: number;
  /** Left edge in time scale pixels (`scrollLeft - overscanPx`); `start` is the date there. */
  readonly left: number;
  /** Right edge in time scale pixels (`scrollLeft + width + overscanPx`); `end` is the date there. */
  readonly right: number;
}

/**
 * The part of the chart to render for a viewport. Pure, O(1) for uniform rows.
 *
 * - **Rows**: the sticky header sits on top of the body, so the body rows in view are those
 *   intersecting `[scrollTop, scrollTop + height - headerHeight)`, widened by `overscanRows` on
 *   each side within the existing rows. A viewport that shows no row gives no rows.
 * - **Time**: `[scrollLeft - overscanPx, scrollLeft + width + overscanPx]` in time scale pixels,
 *   which assumes the renderer keeps scale `x = 0` at the left edge of the scrolled content.
 *   The range is not clipped to the timeline range: that is the viewport module's job.
 *
 * @param viewport - Scroll offsets and client size of the scroller.
 * @param rows - The row metrics (`layoutRows`), for the row positions and the header height.
 * @param scale - The time scale.
 * @param options - Overscan; defaults from `LAYOUT_DEFAULTS`. Negative values count as `0`, a
 * value that is not finite (`NaN`, `Infinity`) as the default, and `overscanRows` is floored to
 * whole rows.
 * @returns The frozen window.
 *
 * @example
 * ```ts
 * const window = visibleWindow(
 *   { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, width: el.clientWidth, height: el.clientHeight },
 *   layout.rows,
 *   layout.scale,
 * );
 * for (const bar of barsInWindow(window, layout)) draw(bar);
 * ```
 */
export function visibleWindow(
  viewport: Viewport,
  rows: RowLayout,
  scale: TimeScale,
  options: WindowOptions = {},
): LayoutWindow {
  const overscanRows = Math.floor(overscan(options.overscanRows, LAYOUT_DEFAULTS.overscanRows));
  const overscanPx = overscan(options.overscanPx, LAYOUT_DEFAULTS.overscanPx);
  const { scrollLeft, scrollTop } = viewport;
  const bodyHeight = Math.max(viewport.height - rows.headerHeight, 0);
  const { first, last } = rows.rowRange(scrollTop, scrollTop + bodyHeight);
  const left = scrollLeft - overscanPx;
  const right = scrollLeft + Math.max(viewport.width, 0) + overscanPx;
  const empty = first > last;
  return Object.freeze({
    firstRow: empty ? first : Math.max(first - overscanRows, 0),
    lastRow: empty ? last : Math.min(last + overscanRows, rows.rows.length - 1),
    start: scale.xToDate(left),
    end: scale.xToDate(right),
    left,
    right,
  });
}

/** An overscan option: the default when it is not a finite number, `0` for a negative one. */
function overscan(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

/**
 * The bars to render in a window: bars of rows `firstRow … lastRow` whose box touches
 * `[left, right]` (edges included, so a zero-width bar on the edge counts). Rows of collapsed
 * parents are not in the layout, so their bars never appear. O(rows in the window): the layout
 * indexes bars by row, nothing scans all tasks.
 *
 * @param window - From {@link visibleWindow} over the same layout's rows.
 * @param layout - The prepared layout (`createLayout`).
 * @returns The bars in row order, frozen.
 */
export function barsInWindow(window: LayoutWindow, layout: Layout): readonly BarGeometry[] {
  const { left, right } = window;
  const bars: BarGeometry[] = [];
  const last = Math.min(window.lastRow, layout.rows.rows.length - 1);
  for (let index = Math.max(window.firstRow, 0); index <= last; index++) {
    const bar = layout.barAt(index);
    if (bar !== undefined && bar.x <= right && bar.x + bar.width >= left) bars.push(bar);
  }
  return Object.freeze(bars);
}

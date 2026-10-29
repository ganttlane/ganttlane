/**
 * Row metrics: where every visible row lies in the body, the header height, and O(1)
 * lookups by position and by task id.
 */

import type { TaskId } from '../model';
import { LAYOUT_DEFAULTS } from './dimensions';

/** Where one visible row lies, in body pixels. Frozen. */
export interface RowMetrics {
  /** The task id. */
  readonly id: TaskId;
  /** Position among the visible rows (`Row.index`). */
  readonly index: number;
  /** Top edge; `0` is the top of the first row, right below the header. */
  readonly y: number;
  /** Height of the row. */
  readonly height: number;
}

/** The rows a vertical band `[top, bottom)` touches: indexes `first … last`, both inclusive. */
export interface RowRange {
  /** First row; with no row in the band, `first > last`. */
  readonly first: number;
  /** Last row, inclusive. */
  readonly last: number;
}

/** Options of {@link layoutRows}, sizes in pixels (see `resolveLayoutOptions`). */
export interface RowLayoutOptions {
  /** Height of every row; finite and greater than `0`. Default 48. */
  readonly rowHeight?: number | undefined;
  /** Height of each header row, top first; finite, `0` or more. Default `[45, 30]`. */
  readonly headerRowHeights?: readonly number[] | undefined;
}

/**
 * The vertical layout of the visible rows: what an external sidebar needs to line its
 * rows up with the chart (row order, `y`, heights, header height). Frozen.
 *
 * Coordinates are **body** pixels: `y = 0` is the top of the first row. The body sits right
 * below the header (a sticky header above the SVG body inside one
 * scroller), so in scroller content pixels a row starts at `headerHeight + y`.
 *
 * Every row has the same height for now, which makes the lookups O(1); they are methods so that
 * variable row heights can later switch them to a binary search without changing callers.
 */
export interface RowLayout {
  /** The visible rows in order, `rows[i].index === i`. */
  readonly rows: readonly RowMetrics[];
  /** Height of every row. */
  readonly rowHeight: number;
  /** Total height of the rows: `rows.length * rowHeight`. */
  readonly bodyHeight: number;
  /** Height of each header row, top first. */
  readonly headerRowHeights: readonly number[];
  /** Sum of the header row heights (no extra margin). */
  readonly headerHeight: number;
  /**
   * The row under a body position: the last row with `y <= at`, so a boundary belongs to the row
   * below it. Positions are compared with the stored `y` values (a row's band is `y` up to the
   * next row's `y`, the last one's up to `bodyHeight`), so `rowAt(row.y)` is always `row`, also
   * for a row height that is not a binary fraction. `undefined` above the first row, from
   * `bodyHeight` down and for `NaN`.
   */
  readonly rowAt: (at: number) => RowMetrics | undefined;
  /** The row of a task, `undefined` when it is not visible (collapsed parent, unknown id). */
  readonly rowOf: (id: TaskId) => RowMetrics | undefined;
  /**
   * The rows that intersect the band `[top, bottom)` (a row counts when its band, as in
   * {@link RowLayout.rowAt}, overlaps it by more than nothing). Empty (`first > last`) for an
   * empty band or one outside the body.
   */
  readonly rowRange: (top: number, bottom: number) => RowRange;
}

const EMPTY_RANGE: RowRange = /* @__PURE__ */ Object.freeze({ first: 0, last: -1 });

/**
 * Lays out the visible rows top to bottom, each `rowHeight` tall, and sums the header
 * rows. Pure and O(rows); the result is frozen.
 *
 * The options come from `resolveLayoutOptions` (checked caller options) or from code, so an
 * unusable size is a programming error and throws, like `createTimeScale`.
 *
 * @param rows - The visible rows in order (`visibleRows`); only `id` is read.
 * @param options - Row and header row heights; defaults from `LAYOUT_DEFAULTS`.
 * @returns The frozen {@link RowLayout}.
 * @throws RangeError if `rowHeight` is not a finite number greater than `0` or a header row
 * height is not a finite number, `0` or more.
 *
 * @example
 * ```ts
 * const layout = layoutRows(visibleRows(tree, expandedKeys), { rowHeight: 40 });
 * layout.rowAt(85)?.index; // 2
 * layout.headerHeight;     // 75
 * ```
 */
export function layoutRows(
  rows: readonly { readonly id: TaskId }[],
  options: RowLayoutOptions = {},
): RowLayout {
  const rowHeight = options.rowHeight ?? LAYOUT_DEFAULTS.rowHeight;
  if (!(Number.isFinite(rowHeight) && rowHeight > 0)) {
    throw new RangeError(`rowHeight must be a finite number greater than 0, got ${rowHeight}.`);
  }
  const headerRowHeights = Object.freeze([
    ...(options.headerRowHeights ?? LAYOUT_DEFAULTS.headerRowHeights),
  ]);
  let headerHeight = 0;
  for (const height of headerRowHeights) {
    if (!(Number.isFinite(height) && height >= 0)) {
      throw new RangeError(`header row heights must be finite, 0 or more, got ${height}.`);
    }
    headerHeight += height;
  }

  const metrics: RowMetrics[] = [];
  const byId = new Map<TaskId, RowMetrics>();
  for (const [index, { id }] of rows.entries()) {
    const row: RowMetrics = Object.freeze({ id, index, y: index * rowHeight, height: rowHeight });
    metrics.push(row);
    byId.set(id, row);
  }
  const count = metrics.length;
  const bodyHeight = count * rowHeight;
  const yOf = (index: number): number => metrics[index]?.y ?? bodyHeight;
  // The quotient by the row height can be one off the stored `y = index × rowHeight` (both are
  // rounded: 63 × 33.3 is stored as 2097.8999999999996, and 2097.8999999999996 / 33.3 floors to
  // 62), so the estimate is corrected against the stored values.
  /** The last row with `y <= at`, for `0 <= at < bodyHeight`. */
  const lastAtOrAbove = (at: number): number => {
    const index = Math.min(Math.floor(at / rowHeight), count - 1);
    if (yOf(index) > at) return index - 1;
    return yOf(index + 1) <= at && index + 1 < count ? index + 1 : index;
  };
  /** The last row with `y < at`, for `0 < at <= bodyHeight`. */
  const lastAbove = (at: number): number => {
    const index = Math.min(Math.ceil(at / rowHeight), count) - 1;
    if (yOf(index) >= at) return index - 1;
    return yOf(index + 1) < at && index + 1 < count ? index + 1 : index;
  };

  return Object.freeze({
    rows: Object.freeze(metrics),
    rowHeight,
    bodyHeight,
    headerRowHeights,
    headerHeight,
    rowAt: (at: number): RowMetrics | undefined =>
      at >= 0 && at < bodyHeight ? metrics[lastAtOrAbove(at)] : undefined,
    rowOf: (id: TaskId): RowMetrics | undefined => byId.get(id),
    rowRange: (top: number, bottom: number): RowRange => {
      const from = Math.max(top, 0);
      const to = Math.min(bottom, bodyHeight);
      if (!(from < to)) return EMPTY_RANGE;
      return Object.freeze({ first: lastAtOrAbove(from), last: lastAbove(to) });
    },
  });
}

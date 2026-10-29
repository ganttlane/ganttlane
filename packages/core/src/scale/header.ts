/**
 * Header rows (FR-SCALE-4, `docs/architecture.md` §6): lazy generators of the cells of each
 * header row for a range, and the cell under a position for sticky labels.
 *
 * Every row produces cells of its own unit and step, each as wide as its real interval on the
 * linear scale, so a month cell over day columns is one merged cell. Generation is lazy, so the
 * renderer asks only for the visible window plus overscan (`docs/architecture.md` §7a).
 */

import type { DateAdapter, DateTimeMs } from '../time';
import { type CellGrid, cellGrid, checkRange, type TimeRange } from './cell-grid';
import type { TimeScale } from './time-scale';
import type { HeaderCellRange, HeaderRowSpec, ViewMode } from './view-modes';

/** What the scale generators need: the date ↔ x mapping and the calendar math. */
export interface ScaleContext {
  /** Maps cell boundaries to x. */
  readonly scale: TimeScale;
  /** Calendar math: unit starts, week start, adding calendar units. */
  readonly adapter: DateAdapter;
}

/** What header cells need: {@link ScaleContext} plus the locale of their labels. */
export interface HeaderContext extends ScaleContext {
  /** BCP 47 language tag for the labels, e.g. `'en'` or `'uk'`. */
  readonly locale: string;
}

/**
 * One header cell: its interval `[start, end)`, its position on the scale and its label. Cells
 * are not clipped to the requested range, so the first and last cell may stick out of it.
 */
export interface HeaderCell extends HeaderCellRange {
  /** `scale.dateToX(start)`; negative when the cell starts left of `x = 0`. */
  readonly x: number;
  /** `scale.dateToX(end) - x`: the real length of the interval on the scale. */
  readonly width: number;
  /** The row's `format` applied to the cell. */
  readonly label: string;
}

/**
 * Lazily generates the cells of one header row that intersect `range` (FR-SCALE-4), in order.
 *
 * Cells are `row.step` (default `1`) × `row.unit` long and anchored to fixed points, so they do
 * not move while scrolling: hours and minutes count from midnight (`step: 6` → 00, 06, 12, 18;
 * a step that does not divide the day ends its last cell at midnight), days at midnight, weeks
 * at `adapter.startOf(t, 'week')` (honours `weekStartsOn`), months, quarters and years at their
 * starts, and steps of calendar units count from year 0 (`{ unit: 'year', step: 10 }` gives
 * decades 2020–2029, `{ unit: 'month', step: 3 }` quarters).
 *
 * Consecutive cells are contiguous (`previous.end === next.start`). The first cell contains
 * `range.start` and the last one contains the instant before `range.end`; neither is clipped.
 * Labels come from `adapter.formatter(format, locale)` for `Intl.DateTimeFormatOptions`, resolved
 * once per row when the first cell is generated, or from `format({ start, end }, locale, adapter)`
 * for a function.
 *
 * Nothing is computed until the generator is iterated, and each cell costs O(1), so taking the
 * visible window of a range spanning centuries is as cheap as for a short one.
 *
 * @param row - The header row: unit, step and label format.
 * @param range - The range to cover, `[start, end)`; empty when `end <= start`.
 * @param ctx - Scale, adapter and locale.
 * @returns A generator of the cells.
 * @throws RangeError (on the call, not on iteration) if `row.step` is not a positive integer or
 * the range has a non-finite bound.
 *
 * @example
 * ```ts
 * const ctx = { scale, adapter: createFloatingAdapter(), locale: 'en' };
 * for (const cell of headerCells({ unit: 'month', format: { month: 'long' } }, visible, ctx)) {
 *   draw(cell.x, cell.width, cell.label);
 * }
 * ```
 */
export function headerCells(
  row: HeaderRowSpec,
  range: TimeRange,
  ctx: HeaderContext,
): Generator<HeaderCell, void, undefined> {
  return cells(rowGrid(row, ctx.adapter), rowLabel(row, ctx), checkRange(range), ctx.scale);
}

/**
 * The header rows of a view mode for a range: one lazy, re-iterable sequence of
 * {@link headerCells} per row of `viewMode.headers`, in the same order (top row first). Each
 * `for … of` over a row starts a fresh generator; the row's label formatter is resolved once, on
 * the first iteration, and reused by later ones.
 *
 * @param viewMode - A view mode (only `headers` is read).
 * @param range - The range to cover, `[start, end)`.
 * @param ctx - Scale, adapter and locale.
 * @returns A frozen array with one iterable of cells per header row.
 * @throws RangeError if a row step is not a positive integer or the range has a non-finite bound.
 *
 * @example
 * ```ts
 * const [months, days] = headerRows(dayMode, visible, ctx);
 * ```
 */
export function headerRows(
  viewMode: Pick<ViewMode, 'headers'>,
  range: TimeRange,
  ctx: HeaderContext,
): readonly Iterable<HeaderCell>[] {
  const checked = checkRange(range);
  return Object.freeze(
    viewMode.headers.map((row, index): Iterable<HeaderCell> => {
      const grid = rowGrid(row, ctx.adapter, index);
      const label = rowLabel(row, ctx);
      return { [Symbol.iterator]: () => cells(grid, label, checked, ctx.scale) };
    }),
  );
}

/**
 * The cell of a header row that contains the date at `x`, e.g. the cell under the left edge of
 * the viewport for a sticky label (FR-SCALE-4). O(1): the cell start comes from
 * `adapter.startOf` for the row unit, nothing is scanned. Cells are half-open, so an `x` exactly
 * on a boundary belongs to the cell that starts there.
 *
 * @param row - The header row.
 * @param x - Position on the scale, finite (the date is `scale.xToDate(x)`).
 * @param ctx - Scale, adapter and locale.
 * @returns The cell containing `scale.xToDate(x)`, with its label.
 * @throws RangeError if `x` is not finite or `row.step` is not a positive integer.
 *
 * @example
 * ```ts
 * const sticky = currentCell(dayMode.headers[0], scrollLeft, ctx); // the month at the left edge
 * ```
 */
export function currentCell(row: HeaderRowSpec, x: number, ctx: HeaderContext): HeaderCell {
  if (!Number.isFinite(x)) throw new RangeError(`x must be a finite number, got ${String(x)}.`);
  const grid = rowGrid(row, ctx.adapter);
  const start = grid.floor(ctx.scale.xToDate(x));
  return cell(start, grid.next(start), rowLabel(row, ctx)(), ctx.scale);
}

/** Labels of a row's cells. */
type CellLabel = (start: DateTimeMs, end: DateTimeMs) => string;

function* cells(
  grid: CellGrid,
  label: () => CellLabel,
  range: TimeRange,
  scale: TimeScale,
): Generator<HeaderCell, void, undefined> {
  if (range.end <= range.start) return;
  const format = label();
  let start = grid.floor(range.start);
  while (start < range.end) {
    const end = grid.next(start);
    yield cell(start, end, format, scale);
    start = end;
  }
}

function cell(start: DateTimeMs, end: DateTimeMs, label: CellLabel, scale: TimeScale): HeaderCell {
  const x = scale.dateToX(start);
  return { start, end, x, width: scale.dateToX(end) - x, label: label(start, end) };
}

/**
 * The label function of a row, resolved lazily and once: an `Intl` format becomes one
 * `adapter.formatter` (the cache key is built once per row, not per cell). Lazy so that nothing
 * is formatted, and nothing can throw, before the first cell is requested.
 */
function rowLabel(row: HeaderRowSpec, { adapter, locale }: HeaderContext): () => CellLabel {
  let resolved: CellLabel | undefined;
  return () => {
    if (resolved) return resolved;
    const { format } = row;
    if (typeof format === 'function') {
      resolved = (start, end) => format({ start, end }, locale, adapter);
    } else {
      resolved = adapter.formatter(format, locale);
    }
    return resolved;
  };
}

function rowGrid(row: HeaderRowSpec, adapter: DateAdapter, index?: number): CellGrid {
  const what = index === undefined ? 'header row step' : `headers[${index}].step`;
  return cellGrid(row.unit, row.step ?? 1, adapter, what);
}

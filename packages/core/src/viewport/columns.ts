/**
 * Column boundaries of a view mode (FR-TL-1, FR-TL-4): the timeline range snaps outward to them
 * so the first and last header cells are whole, and the infinite timeline grows and trims it by
 * whole columns.
 */

import {
  createTimeScale,
  headerCells,
  type HeaderContext,
  type HeaderRowSpec,
  type TimeRange,
  type ViewMode,
} from '../scale';
import { asDateTimeMs, type DateAdapter, type DateTimeMs } from '../time';

/**
 * The column boundaries of a view mode, as two O(1) queries. {@link columnGrid} builds the grid
 * of a view mode; tests and custom renderers may pass any grid whose boundaries are increasing
 * whole milliseconds.
 */
export interface ColumnGrid {
  /** The boundary at or before `t`: the start of the column containing `t`. */
  readonly floor: (t: DateTimeMs) => DateTimeMs;
  /** The first boundary after `t`: the end of the column containing `t`. */
  readonly next: (t: DateTimeMs) => DateTimeMs;
}

const NO_LABEL = (): string => '';

/**
 * The column grid of a view mode: columns of `viewMode.step` (default `1`) × `viewMode.unit`,
 * anchored exactly like header cells and grid lines (`headerCells`): hours from midnight, weeks
 * from `adapter.weekStartsOn`, months, quarters and years from their starts, steps of calendar
 * units from year 0 (`{ unit: 'year', step: 10 }` gives decades 2020–2029).
 *
 * @param viewMode - The view mode; only `unit` and `step` are read.
 * @param adapter - Calendar math (week start included), the chart's adapter.
 * @returns The frozen grid.
 * @throws RangeError if `viewMode.step` is not a positive integer.
 *
 * @example
 * ```ts
 * const columns = columnGrid(weekMode, adapter);
 * columns.floor(wednesday); // the Monday before, 00:00
 * columns.next(wednesday);  // the next Monday, 00:00
 * ```
 */
export function columnGrid(
  viewMode: Pick<ViewMode, 'unit' | 'step'>,
  adapter: DateAdapter,
): ColumnGrid {
  const row: HeaderRowSpec = { unit: viewMode.unit, step: viewMode.step ?? 1, format: NO_LABEL };
  // Only the cell boundaries are read: no label is formatted and cell x positions are ignored.
  const ctx: HeaderContext = {
    scale: createTimeScale({ origin: asDateTimeMs(0), pxPerDay: 1 }),
    adapter,
    locale: 'en',
  };
  // Fails fast on an invalid step (the generator checks it on the call, before iterating).
  headerCells(row, { start: asDateTimeMs(0), end: asDateTimeMs(0) }, ctx);
  const cellAt = (t: DateTimeMs): TimeRange => {
    const cell = headerCells(row, { start: t, end: asDateTimeMs(t + 1) }, ctx).next();
    if (cell.done === true) throw new RangeError(`No column contains ${String(t)}.`);
    return cell.value;
  };
  return Object.freeze({
    floor: (t: DateTimeMs): DateTimeMs => cellAt(t).start,
    next: (t: DateTimeMs): DateTimeMs => cellAt(t).end,
  });
}

/**
 * `t` moved back to a column boundary; `t` itself without a grid.
 *
 * @internal
 */
export function floorToColumn(t: DateTimeMs, columns: ColumnGrid | undefined): DateTimeMs {
  return columns === undefined ? t : columns.floor(t);
}

/**
 * `t` moved forward to a column boundary; `t` itself without a grid or on a boundary.
 *
 * @internal
 */
export function ceilToColumn(t: DateTimeMs, columns: ColumnGrid | undefined): DateTimeMs {
  if (columns === undefined || columns.floor(t) === t) return t;
  return columns.next(t);
}

/**
 * A range widened outward to column boundaries, never empty (at least one column, or one
 * millisecond without a grid). Frozen.
 *
 * @internal
 */
export function snapRange(range: TimeRange, columns: ColumnGrid | undefined): TimeRange {
  const start = floorToColumn(range.start, columns);
  let end = ceilToColumn(range.end, columns);
  if (end <= start) end = columns === undefined ? asDateTimeMs(start + 1) : columns.next(start);
  return Object.freeze({ start, end });
}

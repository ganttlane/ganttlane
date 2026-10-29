/**
 * Calendar-aligned cell grids shared by the header rows and the grid lines: where the cells of
 * `step` × `unit` start and end. Internal to `scale/`, except for the {@link TimeRange} type, which
 * `scale/index.ts` re-exports.
 *
 * Cells are anchored to fixed points, never to the rendered range, so they do not move while the
 * timeline scrolls or grows:
 * - `minute` / `hour`: from every midnight (`step: 6` → 00, 06, 12, 18). A step that does not
 *   divide the day leaves a shorter last cell that ends at midnight.
 * - `day`: from 1970-01-01; `week`: from the adapter's week start (`weekStartsOn`), counted from
 *   the week containing 1970-01-01.
 * - `month` / `quarter` / `year`: from their starts, counted from year 0, so 3 months are
 *   quarters (January, April, July, October) and 10 years are decades (2020–2029).
 *
 * Every calendar-aware step (day, week, month, quarter and year starts, adding calendar units)
 * goes through the {@link DateAdapter}; hours and minutes inside a day are plain numbers.
 */

import { assertNever } from '../shared';
import {
  asDateTimeMs,
  type DateAdapter,
  type DateTimeMs,
  HOUR,
  MINUTE,
  type TimeUnit,
} from '../time';
import { describeValue } from './check';

/**
 * A half-open range of floating time `[start, end)`: the timeline range or the visible part of
 * it (glossary: Range). An empty or reversed range (`end <= start`) contains nothing.
 */
export interface TimeRange {
  /** First instant of the range. */
  readonly start: DateTimeMs;
  /** Exclusive end of the range. */
  readonly end: DateTimeMs;
}

/**
 * The cells of one unit and step: `[floor(t), next(floor(t)))` is the cell containing `t`.
 *
 * @internal
 */
export interface CellGrid {
  /** Start of the cell containing `t`, O(1). */
  readonly floor: (t: DateTimeMs) => DateTimeMs;
  /** Exclusive end of the cell that starts at the aligned `start`: the next cell's start. */
  readonly next: (start: DateTimeMs) => DateTimeMs;
}

/** Floating 1970-01-01T00:00, the anchor of day and week steps. */
const EPOCH = /* @__PURE__ */ asDateTimeMs(0);

/**
 * Builds the grid of `step` × `unit` cells (see the module comment for the anchors).
 *
 * @param unit - Cell unit.
 * @param step - Units per cell; a positive safe integer.
 * @param adapter - Calendar math (week start included).
 * @param what - Name of the step in the error message, e.g. `'header row step'`.
 * @returns The grid.
 * @throws RangeError if `step` is not a positive safe integer; TypeError for an unknown unit.
 * @internal
 */
export function cellGrid(
  unit: TimeUnit,
  step: number,
  adapter: DateAdapter,
  what = 'step',
): CellGrid {
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new RangeError(`${what} must be a positive integer, got ${describeValue(step)}.`);
  }
  switch (unit) {
    case 'minute':
      return dayCycleGrid(step * MINUTE, adapter);
    case 'hour':
      return dayCycleGrid(step * HOUR, adapter);
    case 'day':
      return indexedGrid(unit, step, adapter, (start) => adapter.diffDays(EPOCH, start));
    case 'week': {
      const firstWeek = adapter.startOf(EPOCH, 'week');
      return indexedGrid(unit, step, adapter, (start) =>
        Math.round(adapter.diffDays(firstWeek, start) / 7),
      );
    }
    case 'month':
      return indexedGrid(unit, step, adapter, (start) => {
        const { year, month } = adapter.getParts(start);
        return year * 12 + month - 1;
      });
    case 'quarter':
      return indexedGrid(unit, step, adapter, (start) => {
        const { year, month } = adapter.getParts(start);
        return year * 4 + (month - 1) / 3;
      });
    case 'year':
      return indexedGrid(unit, step, adapter, (start) => adapter.getParts(start).year);
    default:
      return assertNever(unit, 'Unknown time unit');
  }
}

/**
 * Starts of the cells of `grid` inside `range` (`range.start <= t < range.end`), in order. Lazy:
 * each value is computed when it is requested.
 *
 * @internal
 */
export function* boundaries(
  grid: CellGrid,
  range: TimeRange,
): Generator<DateTimeMs, void, undefined> {
  let start = grid.floor(range.start);
  if (start < range.start) start = grid.next(start);
  while (start < range.end) {
    yield start;
    start = grid.next(start);
  }
}

/**
 * A copy of a range with finite bounds; ranges come from code, so a non-finite bound is a
 * programming error (it would make the generators endless).
 *
 * @throws RangeError for a non-finite `start` or `end`.
 * @internal
 */
export function checkRange(range: TimeRange): TimeRange {
  const { start, end } = range;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError(
      `range must have finite start and end, got ${describeValue(start)} … ${describeValue(end)}.`,
    );
  }
  return { start, end };
}

/** Cells of a fixed size counted from every midnight; the last one of a day ends at midnight. */
function dayCycleGrid(size: number, adapter: DateAdapter): CellGrid {
  return {
    floor: (t) => {
      const day = adapter.startOf(t, 'day');
      return asDateTimeMs(day + Math.floor((t - day) / size) * size);
    },
    next: (start) => asDateTimeMs(Math.min(start + size, adapter.endOf(start, 'day'))),
  };
}

/**
 * Cells of `step` calendar units: the unit start moved back to the nearest multiple of `step`,
 * where `index` numbers the unit starts from the anchor.
 */
function indexedGrid(
  unit: TimeUnit,
  step: number,
  adapter: DateAdapter,
  index: (start: DateTimeMs) => number,
): CellGrid {
  const next = (start: DateTimeMs): DateTimeMs => adapter.add(start, step, unit);
  if (step === 1) return { floor: (t) => adapter.startOf(t, unit), next };
  return {
    floor: (t) => {
      const start = adapter.startOf(t, unit);
      const offset = floorMod(index(start), step);
      return offset === 0 ? start : adapter.add(start, -offset, unit);
    },
    next,
  };
}

/** Euclidean remainder: in `[0, divisor)` also for negative values (dates before the anchor). */
function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

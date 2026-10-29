/**
 * Vertical grid lines (FR-SCALE-5, FR-SNAP-9, `docs/architecture.md` §6): column boundaries,
 * major lines by the view mode's rule and minor lines that appear only when they are not
 * denser than a pixel threshold.
 */

import {
  type DateTimeMs,
  DAY,
  type Duration,
  HOUR,
  MINUTE,
  parseDuration,
  type TimeUnit,
} from '../time';
import { boundaries, type CellGrid, cellGrid, checkRange, type TimeRange } from './cell-grid';
import { describeValue } from './check';
import type { ScaleContext } from './header';
import type { ViewMode } from './view-modes';

/**
 * Kind of a grid line, by precedence when positions coincide: `'major'` (the view mode's
 * `majorLine`), `'column'` (a column boundary), `'minor'` (the view mode's `minorLine`).
 */
export type GridLineKind = 'column' | 'major' | 'minor';

/** One vertical grid line. */
export interface GridLine {
  /** Its date. */
  readonly t: DateTimeMs;
  /** `scale.dateToX(t)`. */
  readonly x: number;
  /** What the line marks; one line per position, the strongest kind wins. */
  readonly kind: GridLineKind;
}

/** Options of {@link gridLines}. */
export interface GridLineOptions {
  /**
   * Minor lines are generated only when they are at least this many pixels apart (FR-SNAP-9).
   * A non-negative number, default `6`.
   */
  readonly minMinorSpacingPx?: number;
}

/** Default {@link GridLineOptions.minMinorSpacingPx}. */
const DEFAULT_MIN_MINOR_SPACING_PX = 6;

type UnitStep = readonly [unit: TimeUnit, step: number];

/** Fixed units a minor step is expressed in, the largest first; minutes divide every step. */
const FIXED_UNITS: readonly (readonly [unit: TimeUnit, ms: number])[] = [
  ['week', 7 * DAY],
  ['day', DAY],
  ['hour', HOUR],
];
const MINUTES: readonly [unit: TimeUnit, ms: number] = ['minute', MINUTE];

/**
 * Lazily generates the vertical grid lines of a view mode inside `range`
 * (`range.start <= t < range.end`), in order, one per position (FR-SCALE-5, FR-SNAP-9):
 *
 * - `'column'`: the start of every column (`viewMode.unit` × `viewMode.step`), aligned like
 *   header cells (`headerCells`).
 * - `'major'`: per `viewMode.majorLine`: every start of its unit (`{ unit: 'month' }` also
 *   between week columns, where the month header cells meet), or every column start for which
 *   the predicate returns `true`; `false` or absent for none. A major line replaces the column
 *   line at the same position.
 * - `'minor'`: every `viewMode.minorLine` step, counted like a header row of that step
 *   (`'15min'` from midnight, `'1w'` from the week start, `'1mo'` from month starts), only when
 *   the step is at least `minMinorSpacingPx` wide on the scale (calendar months count as 28
 *   days) and never where a column or major line already is.
 *
 * @param viewMode - A view mode (only `unit`, `step`, `majorLine` and `minorLine` are read).
 * @param range - The range to cover, `[start, end)`; empty when `end <= start`.
 * @param ctx - Scale and adapter.
 * @param options - `minMinorSpacingPx`, default `6`.
 * @returns A generator of the lines; nothing is computed until it is iterated.
 * @throws RangeError (on the call) for a non-finite range bound, an invalid step, a malformed,
 * empty or mixed (`'1mo 1d'`) `minorLine`, or a negative `minMinorSpacingPx`. View modes from
 * `resolveViewModes` never cause one.
 *
 * @example
 * ```ts
 * for (const line of gridLines(hourMode, visible, { scale, adapter })) {
 *   drawLine(line.x, line.kind); // 'minor' every 15 min once it is at least 6 px apart
 * }
 * ```
 */
export function gridLines(
  viewMode: Pick<ViewMode, 'unit' | 'step' | 'majorLine' | 'minorLine'>,
  range: TimeRange,
  ctx: ScaleContext,
  options: GridLineOptions = {},
): Generator<GridLine, void, undefined> {
  const checked = checkRange(range);
  const { adapter } = ctx;
  const minSpacing: unknown = options.minMinorSpacingPx ?? DEFAULT_MIN_MINOR_SPACING_PX;
  if (typeof minSpacing !== 'number' || !(minSpacing >= 0)) {
    throw new RangeError(
      `minMinorSpacingPx must be a non-negative number, got ${describeValue(minSpacing)}.`,
    );
  }

  const columns = boundaries(
    cellGrid(viewMode.unit, viewMode.step ?? 1, adapter, 'view mode step'),
    checked,
  );
  const { majorLine } = viewMode;
  const majors =
    typeof majorLine === 'object'
      ? boundaries(cellGrid(majorLine.unit, 1, adapter), checked)
      : undefined;
  const isMajor = typeof majorLine === 'function' ? majorLine : undefined;
  const minor = minorGrid(viewMode.minorLine, ctx, minSpacing);
  const minors = minor ? boundaries(minor, checked) : undefined;
  return merge(ctx, columns, majors, isMajor, minors);
}

/** Merges the sorted line streams, one line per position, the strongest kind first. */
function* merge(
  { scale }: ScaleContext,
  columns: Iterator<DateTimeMs, void>,
  majors: Iterator<DateTimeMs, void> | undefined,
  isMajor: ((date: DateTimeMs) => boolean) | undefined,
  minors: Iterator<DateTimeMs, void> | undefined,
): Generator<GridLine, void, undefined> {
  let column = head(columns);
  let major = head(majors);
  let minor = head(minors);
  for (;;) {
    const t = earliest(earliest(column, major), minor);
    if (t === undefined) return;
    let kind: GridLineKind = 'minor';
    if (major === t || (column === t && isMajor?.(t) === true)) kind = 'major';
    else if (column === t) kind = 'column';
    yield { t, x: scale.dateToX(t), kind };
    if (column === t) column = head(columns);
    if (major === t) major = head(majors);
    if (minor === t) minor = head(minors);
  }
}

/** The grid of minor lines, or nothing when the mode has none or they would be too dense. */
function minorGrid(
  minorLine: ViewMode['minorLine'],
  { scale, adapter }: ScaleContext,
  minSpacing: number,
): CellGrid | undefined {
  if (minorLine === undefined || minorLine === false) return undefined;
  const parsed = parseDuration(minorLine);
  if (!parsed.ok) throw new RangeError(`Invalid minorLine: ${parsed.issue.message}`);
  const step = unitStep(parsed.value);
  if (!step) {
    throw new RangeError(
      `Invalid minorLine ${describeValue(minorLine)}: use a non-empty step of one kind, calendar ("1mo") or fixed ("15min").`,
    );
  }
  const shortestMs = parsed.value.months * 28 * DAY + parsed.value.ms;
  if (scale.durationToPx(shortestMs) < minSpacing) return undefined;
  return cellGrid(step[0], step[1], adapter);
}

/**
 * A duration as `step` × the largest unit dividing it (`'1q'` → 3 months, `'2h'` → 2 hours,
 * `'14d'` → 2 weeks); nothing for an empty duration or one mixing months and fixed time.
 */
function unitStep({ months, ms }: Duration): UnitStep | undefined {
  if (months > 0) {
    if (ms !== 0) return undefined;
    return months % 12 === 0 ? ['year', months / 12] : ['month', months];
  }
  if (ms <= 0) return undefined;
  const [unit, size] = FIXED_UNITS.find(([, candidate]) => ms % candidate === 0) ?? MINUTES;
  return [unit, ms / size];
}

function head(iterator: Iterator<DateTimeMs, void> | undefined): DateTimeMs | undefined {
  const result = iterator?.next();
  return result && !result.done ? result.value : undefined;
}

function earliest(a: DateTimeMs | undefined, b: DateTimeMs | undefined): DateTimeMs | undefined {
  if (a === undefined) return b;
  return b === undefined || a <= b ? a : b;
}

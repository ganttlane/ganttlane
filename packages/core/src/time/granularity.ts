/**
 * The data step `scheduling.granularity` (FR-SNAP-12, ADR-017): the smallest time step of task
 * dates, durations and lags, plus the helpers that align values to it. Used by normalization
 * (`model/`) and by snapping (`scale/snap`).
 *
 * The grid starts at midnight of every day: a granularity divides 24 h exactly, so midnight is
 * always a boundary and day-precision values are always aligned.
 */

import { assertNever, DEV, err, ok, type Result } from '../shared';
import { asDateTimeMs, type DateTimeMs, DAY } from './datetime';
import { type Duration, type DurationInput, parseDuration } from './duration';
import { describeValue, type ParseOptions, type TimeIssue, timeIssue, withPath } from './issues';

declare const granularityBrand: unique symbol;

/**
 * A valid data step, created by {@link parseGranularity} or {@link DEFAULT_GRANULARITY}: a
 * fixed step that divides 24 h exactly (`1min` … `12h`) or exactly one day.
 */
export interface Granularity {
  /** Length of the step in milliseconds: a whole number of minutes that divides one day. */
  readonly ms: number;
  /** Brand: only {@link parseGranularity} and {@link DEFAULT_GRANULARITY} make granularities. */
  readonly [granularityBrand]: true;
}

/** How a value is aligned: down, up or to the nearest boundary. */
export type AlignMode = 'floor' | 'ceil' | 'nearest';

/** Which way {@link alignNearest} goes when a value is exactly halfway between boundaries. */
export type AlignTie = 'up' | 'down';

/** The default granularity: one day (`'1d'`), day-level planning as in the fork. */
export const DEFAULT_GRANULARITY: Granularity = /* @__PURE__ */ Object.freeze({
  ms: DAY,
}) as Granularity;

/**
 * Parses `scheduling.granularity` (FR-SNAP-12). Allowed: a fixed sub-day step that divides 24 h
 * exactly (`'1min'`, `'5min'`, `'15min'`, `'90min'`, `'1h'`, `'6h'`, `'12h'`, …) or exactly one
 * day (`'1d'`, the default). Never throws.
 *
 * @param input - The caller's granularity.
 * @param options - `path` to put into the issue.
 * @returns The granularity, `'invalid-duration'` for malformed input such as `'5m'`, or
 * `'invalid-granularity'` for a valid duration that is not allowed (`'7min'`, `'5h'`, `'2d'`,
 * `'1mo'`).
 *
 * @example
 * ```ts
 * parseGranularity('15min'); // { ok: true, value: { ms: 900_000 } }
 * parseGranularity('5h');    // { ok: false, issue: { code: 'invalid-granularity', … } }
 * ```
 */
export function parseGranularity(
  input: DurationInput,
  options?: ParseOptions,
): Result<Granularity, TimeIssue> {
  const parsed = parseDuration(input, options);
  if (!parsed.ok) return parsed;
  const { months, ms } = parsed.value;
  if (months === 0 && ms > 0 && DAY % ms === 0) return ok(Object.freeze({ ms }) as Granularity);
  const issue = timeIssue(
    'invalid-granularity',
    input,
    DEV
      ? `Invalid granularity ${describeValue(input)}: use a step that divides 24 hours ("15min", "1h", "6h") or "1d".`
      : '',
  );
  return withPath(err(issue), options);
}

/**
 * The boundary at or before `t`.
 *
 * @param t - Floating date-time.
 * @param granularity - The data step.
 * @returns The greatest multiple of the step `<= t`.
 */
export function alignFloor(t: DateTimeMs, granularity: Granularity): DateTimeMs {
  return asDateTimeMs(alignToStep(t, granularity.ms, 'floor'));
}

/**
 * The boundary at or after `t`.
 *
 * @param t - Floating date-time.
 * @param granularity - The data step.
 * @returns The smallest multiple of the step `>= t`.
 */
export function alignCeil(t: DateTimeMs, granularity: Granularity): DateTimeMs {
  return asDateTimeMs(alignToStep(t, granularity.ms, 'ceil'));
}

/**
 * The boundary nearest to `t`.
 *
 * @param t - Floating date-time.
 * @param granularity - The data step.
 * @param tie - Where a value exactly halfway goes: `'up'` (default) or `'down'`.
 * @returns The nearest multiple of the step.
 */
export function alignNearest(
  t: DateTimeMs,
  granularity: Granularity,
  tie: AlignTie = 'up',
): DateTimeMs {
  return asDateTimeMs(alignToStep(t, granularity.ms, 'nearest', tie));
}

/**
 * Whether a date-time, or a fixed duration in milliseconds, is a multiple of the step. Dates
 * and durations share the grid: midnight is a boundary, so the time of day decides.
 *
 * @param value - Floating date-time or milliseconds.
 * @param granularity - The data step.
 * @returns `true` for aligned values (every midnight and every whole number of days).
 */
export function isAligned(value: number, granularity: Granularity): boolean {
  return value % granularity.ms === 0;
}

/**
 * Aligns a fixed duration (or a lag, which may be negative) to the step. In `'nearest'` mode a
 * value exactly halfway goes up, toward +∞ (for durations the longer one, as `alignInput:
 * 'nearest'` wants).
 *
 * @param ms - Milliseconds.
 * @param granularity - The data step.
 * @param mode - `'floor'`, `'ceil'` or `'nearest'`.
 * @returns A multiple of the step.
 */
export function alignDurationMs(ms: number, granularity: Granularity, mode: AlignMode): number {
  return alignToStep(ms, granularity.ms, mode);
}

/**
 * Aligns a {@link Duration}. The calendar part needs nothing: whole months are whole days, so
 * they are aligned for any granularity; only the fixed part is aligned with
 * {@link alignDurationMs}.
 *
 * @param duration - Duration to align.
 * @param granularity - The data step.
 * @param mode - `'floor'`, `'ceil'` or `'nearest'`.
 * @returns The duration with an aligned fixed part (the same object when already aligned).
 */
export function alignDuration(
  duration: Duration,
  granularity: Granularity,
  mode: AlignMode,
): Duration {
  const ms = alignToStep(duration.ms, granularity.ms, mode);
  return ms === duration.ms ? duration : { months: duration.months, ms };
}

/**
 * Whether a {@link Duration} is aligned: its fixed part is a multiple of the step (the calendar
 * part always is).
 *
 * @param duration - Duration to test.
 * @param granularity - The data step.
 * @returns `true` when `duration.ms` is a multiple of the step.
 */
export function isDurationAligned(duration: Duration, granularity: Granularity): boolean {
  return isAligned(duration.ms, granularity);
}

/**
 * Aligns a number to multiples of a positive `step` (not only a granularity); ties of
 * `'nearest'` follow `tie`. Exact: the result is always a multiple of `step` (never `-0`), also
 * for fractional values and values just below zero.
 *
 * @internal
 */
export function alignToStep(
  value: number,
  step: number,
  mode: AlignMode,
  tie: AlignTie = 'up',
): number {
  // `%` is exact and keeps the sign; `value - remainder` is the multiple toward zero.
  const remainder = value % step;
  if (remainder === 0) return value === 0 ? 0 : value; // never -0
  const lower = value - remainder - (remainder < 0 ? step : 0);
  const rest = remainder < 0 ? remainder + step : remainder;
  switch (mode) {
    case 'floor':
      return lower;
    case 'ceil':
      return lower + step;
    case 'nearest':
      return rest * 2 > step || (rest * 2 === step && tie === 'up') ? lower + step : lower;
    default:
      return assertNever(mode, 'Unknown align mode');
  }
}

/**
 * `DateAdapter`: the Strategy through which core does calendar-aware math (ADR-003). The
 * built-in implementation runs on `@internationalized/date` (ADR-018).
 */

import {
  addUnits,
  dayOfWeek,
  DEFAULT_WEEK_STARTS_ON,
  diffDays,
  diffMonths,
  endOf,
  type IsoWeek,
  isoWeek,
  startOf,
  type TimeUnit,
  type WeekOptions,
} from './arithmetic';
import {
  type DateTimeFields,
  type DateTimeMs,
  type DateTimeParts,
  fromParts,
  getParts,
  type Weekday,
} from './datetime';
import { addDuration, type Duration } from './duration';
import { createFormatterCache, type DateFormatFn } from './format';

/**
 * Calendar-aware operations on {@link DateTimeMs} (ADR-003, Strategy). Core modules whose
 * results depend on calendar conventions (week start, month lengths, later zoned time or other
 * calendars) receive an adapter instead of importing the arithmetic directly. The built-in
 * implementation is {@link createFloatingAdapter}.
 *
 * Members are plain functions (no `this`), so they can be passed around unbound.
 */
export interface DateAdapter {
  /** First day of the week used by `startOf` / `endOf` with `'week'`, `0` = Sunday. */
  readonly weekStartsOn: Weekday;
  /** Adds `amount` units (month-based units clamp to the month end). */
  readonly add: (t: DateTimeMs, amount: number, unit: TimeUnit) => DateTimeMs;
  /** Applies a {@link Duration}: months first, then fixed ms; `sign = -1` subtracts. */
  readonly addDuration: (t: DateTimeMs, duration: Duration, sign?: 1 | -1) => DateTimeMs;
  /** Start of the unit containing `t` (inclusive). */
  readonly startOf: (t: DateTimeMs, unit: TimeUnit) => DateTimeMs;
  /** End of the unit containing `t`, exclusive: the start of the next unit. */
  readonly endOf: (t: DateTimeMs, unit: TimeUnit) => DateTimeMs;
  /** Wall-clock components of `t`. */
  readonly getParts: (t: DateTimeMs) => DateTimeParts;
  /** Builds a date-time from wall-clock components (overflowing fields roll over). */
  readonly fromParts: (fields: DateTimeFields) => DateTimeMs;
  /** Day of the week, `0` = Sunday. */
  readonly dayOfWeek: (t: DateTimeMs) => Weekday;
  /** ISO 8601 week and week-numbering year. */
  readonly isoWeek: (t: DateTimeMs) => IsoWeek;
  /** Whole calendar days from `start` to `end` (time of day ignored). */
  readonly diffDays: (start: DateTimeMs, end: DateTimeMs) => number;
  /** Whole calendar months from `start` to `end` (month-end clamping aware). */
  readonly diffMonths: (start: DateTimeMs, end: DateTimeMs) => number;
  /**
   * Resolves a locale-aware formatter once (`Intl.DateTimeFormat` underneath), for formatting
   * many dates with the same options, e.g. every cell of a header row. Floating time has no
   * zone, so `timeZone` and `timeZoneName` in `options` are ignored: the output shows the
   * wall-clock components in every runtime time zone. The built-in adapter caches formatters
   * per adapter (bounded), so equal options in any key order return the same function.
   *
   * @param options - `Intl.DateTimeFormat` options, e.g. `{ month: 'short', day: 'numeric' }`.
   * @param locale - BCP 47 language tag, e.g. `'en'` or `'uk'`.
   * @returns A function formatting a floating date-time; it throws RangeError for a non-finite
   * date (from `Intl`).
   * @throws RangeError for an invalid locale or option value (from `Intl`).
   */
  readonly formatter: (options: Intl.DateTimeFormatOptions, locale: string) => DateFormatFn;
  /**
   * Formats one date: a convenience for `formatter(options, locale)(t)`, which custom adapters
   * must keep equivalent to it (core formats header rows through `formatter`).
   *
   * @throws RangeError for an invalid locale, invalid options or a non-finite `t` (from `Intl`).
   */
  readonly format: (t: DateTimeMs, options: Intl.DateTimeFormatOptions, locale: string) => string;
}

/** Options of {@link createFloatingAdapter}. */
export interface FloatingAdapterOptions {
  /** First day of the week, `0` = Sunday … `6` = Saturday. Default `1` (Monday, ISO 8601). */
  readonly weekStartsOn?: Weekday;
}

/**
 * Creates the built-in adapter for floating wall-clock time: every date is its wall-clock
 * components (`CalendarDateTime` semantics, Gregorian calendar), days are 24 h, weeks start on
 * `weekStartsOn` (default Monday, ISO 8601) and formatting uses `Intl` with `timeZone: 'UTC'`.
 * Each adapter owns its formatter cache (at most 64 formatters, cleared when full); nothing is
 * shared between adapters.
 *
 * Month-based units, `startOf` / `endOf` of weeks, months, quarters and years, weekdays and
 * formatting run on `@internationalized/date` (ADR-018); fixed-length units and day keys are
 * plain arithmetic on the numbers.
 *
 * @param options - `weekStartsOn`: `0` = Sunday … `6` = Saturday, default `1`.
 * @returns A frozen adapter.
 * @throws RangeError if `weekStartsOn` is not an integer `0` … `6` (a programming error).
 *
 * @example
 * ```ts
 * const dates = createFloatingAdapter({ weekStartsOn: 0 });
 * dates.startOf(t, 'week'); // the Sunday on or before t, 00:00
 * ```
 */
export function createFloatingAdapter(options: FloatingAdapterOptions = {}): DateAdapter {
  const weekStartsOn: unknown = options.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON;
  if (!isWeekday(weekStartsOn)) {
    throw new RangeError(
      `weekStartsOn must be an integer from 0 (Sunday) to 6 (Saturday), got ${String(weekStartsOn)}.`,
    );
  }
  const week: WeekOptions = { weekStartsOn };
  const formatter = createFormatterCache().get;
  return Object.freeze({
    weekStartsOn,
    add: addUnits,
    addDuration,
    startOf: (t: DateTimeMs, unit: TimeUnit) => startOf(t, unit, week),
    endOf: (t: DateTimeMs, unit: TimeUnit) => endOf(t, unit, week),
    getParts,
    fromParts,
    dayOfWeek,
    isoWeek,
    diffDays,
    diffMonths,
    formatter,
    format: (t: DateTimeMs, options: Intl.DateTimeFormatOptions, locale: string) =>
      formatter(options, locale)(t),
  });
}

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

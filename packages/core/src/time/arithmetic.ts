/**
 * Calendar arithmetic on floating date-times. Calendar units (months,
 * quarters, years, week / month / quarter / year starts, weekdays, month lengths) go through
 * `@internationalized/date` (see `engine.ts` for the conversion window); fixed-length units
 * (minutes, hours, days, weeks) and day keys stay plain arithmetic on numbers, the hot path.
 *
 * Other core modules should do calendar math through a `DateAdapter` they receive (week
 * start and, later, zoned time can vary); these functions stay exported for internal fast paths
 * whose behaviour cannot vary (fixed-length units, day keys).
 */

import {
  CalendarDate,
  type DayOfWeek,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from '@internationalized/date';

import { assertNever } from '../shared';
import {
  asDateTimeMs,
  type DateTimeMs,
  DAY,
  floorMod,
  fromDayKey,
  HOUR,
  MINUTE,
  toDayKey,
  utc,
  type Weekday,
} from './datetime';
import {
  CYCLE_MONTHS,
  GREGORIAN,
  mapCalendarDate,
  mapCalendarDateTime,
  windowYear,
} from './engine';

/** A calendar unit for arithmetic, `startOf` / `endOf` and header rows. */
export type TimeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** ISO 8601 week number together with its week-numbering year. */
export interface IsoWeek {
  /** ISO week-numbering year: may differ from the calendar year around New Year. */
  readonly year: number;
  /** Week of that year, `1` … `53`. */
  readonly week: number;
}

/** Options for week-based calculations. */
export interface WeekOptions {
  /** First day of the week, `0` = Sunday … `6` = Saturday. Default `1` (Monday, ISO 8601). */
  readonly weekStartsOn?: Weekday;
}

/** Default first day of the week: Monday, as in ISO 8601. */
export const DEFAULT_WEEK_STARTS_ON: Weekday = 1;

/** Library names of the weekdays, indexed by {@link Weekday}. */
const DAYS_OF_WEEK: readonly DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Locale for the library's week functions. Never consulted: core always passes the first day of
 * the week explicitly, so results never depend on a locale's week data.
 */
const WEEK_LOCALE = 'und';

/**
 * Whether a year is a leap year in the proleptic Gregorian calendar (1900 no, 2000 yes, 2100 no).
 *
 * @param year - Full year.
 * @returns `true` for a leap year.
 */
export function isLeapYear(year: number): boolean {
  return GREGORIAN.getDaysInYear(new CalendarDate(GREGORIAN, windowYear(year), 1, 1)) === 366;
}

/**
 * Number of days in a month.
 *
 * @param year - Full year.
 * @param month - Month, `1` … `12`.
 * @returns `28` … `31`, or `NaN` for a month outside `1` … `12`.
 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return Number.NaN;
  return GREGORIAN.getDaysInMonth(new CalendarDate(GREGORIAN, windowYear(year), month, 1));
}

/**
 * Day of the week of a floating date-time.
 *
 * @param t - Floating date-time.
 * @returns `0` = Sunday … `6` = Saturday.
 */
export function dayOfWeek(t: DateTimeMs): Weekday {
  // Plain day-key arithmetic (1970-01-01 was a Thursday): this sits in hot loops (work calendar),
  // and the library call is ~36x slower for a result that is pure modular arithmetic.
  return floorMod(toDayKey(t) + 4, 7) as Weekday;
}

/**
 * ISO 8601 week: weeks start on Monday and week 1 is the one containing the year's first
 * Thursday, so 2026-12-31 is 2026-W53 and 2027-01-01 is 2026-W53 too.
 *
 * Plain day-key arithmetic: `@internationalized/date` has no ISO week API.
 *
 * @param t - Floating date-time.
 * @returns Week-numbering year and week `1` … `53`.
 */
export function isoWeek(t: DateTimeMs): IsoWeek {
  const key = toDayKey(t);
  const thursday = key - floorMod(key + 3, 7) + 3; // Thursday of the same Monday-based week
  const year = new Date(thursday * DAY).getUTCFullYear();
  const firstDay = Math.floor(utc(year, 0, 1) / DAY);
  return { year, week: Math.floor((thursday - firstDay) / 7) + 1 };
}

/**
 * Adds minutes.
 *
 * @param t - Floating date-time.
 * @param amount - Minutes to add (may be negative).
 * @returns Shifted date-time.
 */
export function addMinutes(t: DateTimeMs, amount: number): DateTimeMs {
  return asDateTimeMs(t + amount * MINUTE);
}

/**
 * Adds hours.
 *
 * @param t - Floating date-time.
 * @param amount - Hours to add (may be negative).
 * @returns Shifted date-time.
 */
export function addHours(t: DateTimeMs, amount: number): DateTimeMs {
  return asDateTimeMs(t + amount * HOUR);
}

/**
 * Adds days. Floating days are always 24 h long, so the time of day is kept.
 *
 * @param t - Floating date-time.
 * @param amount - Days to add (may be negative).
 * @returns Shifted date-time.
 */
export function addDays(t: DateTimeMs, amount: number): DateTimeMs {
  return asDateTimeMs(t + amount * DAY);
}

/**
 * Adds weeks (7 days each).
 *
 * @param t - Floating date-time.
 * @param amount - Weeks to add (may be negative).
 * @returns Shifted date-time.
 */
export function addWeeks(t: DateTimeMs, amount: number): DateTimeMs {
  return asDateTimeMs(t + amount * 7 * DAY);
}

/**
 * Adds calendar months, clamping the day to the end of the target month
 * (Jan 31 + 1 month = Feb 28, or Feb 29 in a leap year). The time of day is kept.
 *
 * @param t - Floating date-time.
 * @param amount - Months to add (may be negative; truncated to an integer).
 * @returns Shifted date-time.
 */
export function addMonths(t: DateTimeMs, amount: number): DateTimeMs {
  const months = Math.trunc(amount);
  if (months === 0) return t;
  // Whole 400-year cycles are a plain shift (the calendar repeats), so the library only ever
  // adds less than one cycle and stays inside its AD 1 … 9999 range. Splitting the rest into
  // years and months gives the same result as months alone without the library's month loop.
  const cycles = Math.trunc(months / CYCLE_MONTHS);
  const rest = months - cycles * CYCLE_MONTHS;
  const duration = { years: Math.trunc(rest / 12), months: rest % 12 };
  return mapCalendarDateTime(t, (date) => date.add(duration), cycles);
}

/**
 * Adds quarters (3 months each) with month-end clamping, see {@link addMonths}.
 *
 * @param t - Floating date-time.
 * @param amount - Quarters to add (may be negative; truncated to an integer).
 * @returns Shifted date-time.
 */
export function addQuarters(t: DateTimeMs, amount: number): DateTimeMs {
  return addMonths(t, Math.trunc(amount) * 3);
}

/**
 * Adds years with month-end clamping (Feb 29 + 1 year = Feb 28), see {@link addMonths}.
 *
 * @param t - Floating date-time.
 * @param amount - Years to add (may be negative; truncated to an integer).
 * @returns Shifted date-time.
 */
export function addYears(t: DateTimeMs, amount: number): DateTimeMs {
  return addMonths(t, Math.trunc(amount) * 12);
}

/**
 * Adds an amount of any {@link TimeUnit}.
 *
 * @param t - Floating date-time.
 * @param amount - Units to add (may be negative; truncated for month-based units).
 * @param unit - Unit of `amount`.
 * @returns Shifted date-time.
 */
export function addUnits(t: DateTimeMs, amount: number, unit: TimeUnit): DateTimeMs {
  switch (unit) {
    case 'minute':
      return addMinutes(t, amount);
    case 'hour':
      return addHours(t, amount);
    case 'day':
      return addDays(t, amount);
    case 'week':
      return addWeeks(t, amount);
    case 'month':
      return addMonths(t, amount);
    case 'quarter':
      return addQuarters(t, amount);
    case 'year':
      return addYears(t, amount);
    default:
      return assertNever(unit, 'Unknown time unit');
  }
}

/**
 * Start of the unit containing `t` (inclusive). Weeks start on `options.weekStartsOn`
 * (default Monday); quarters start in January, April, July and October.
 *
 * @param t - Floating date-time.
 * @param unit - Unit to truncate to.
 * @param options - Week start for `'week'`.
 * @returns The greatest unit boundary `<= t`.
 */
export function startOf(t: DateTimeMs, unit: TimeUnit, options?: WeekOptions): DateTimeMs {
  switch (unit) {
    case 'minute':
      return asDateTimeMs(t - floorMod(t, MINUTE));
    case 'hour':
      return asDateTimeMs(t - floorMod(t, HOUR));
    case 'day':
      return asDateTimeMs(t - floorMod(t, DAY));
    case 'week': {
      const firstDay = DAYS_OF_WEEK[options?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON];
      return dayStart(t, (date) => startOfWeek(date, WEEK_LOCALE, firstDay));
    }
    case 'month':
      return dayStart(t, startOfMonth);
    case 'quarter':
      return dayStart(t, (date) => startOfMonth(date).subtract({ months: (date.month - 1) % 3 }));
    case 'year':
      return dayStart(t, startOfYear);
    default:
      return assertNever(unit, 'Unknown time unit');
  }
}

/**
 * End of the unit containing `t`, **exclusive**: the start of the next unit, so
 * `startOf(t, unit) <= t < endOf(t, unit)` and the unit is the half-open range
 * `[startOf, endOf)`. For the last moment inside the unit subtract the precision you need.
 *
 * @param t - Floating date-time.
 * @param unit - Unit to round up to.
 * @param options - Week start for `'week'`.
 * @returns The smallest unit boundary `> t`.
 */
export function endOf(t: DateTimeMs, unit: TimeUnit, options?: WeekOptions): DateTimeMs {
  return addUnits(startOf(t, unit, options), 1, unit);
}

/**
 * Whole calendar days from `start` to `end`, comparing the days they fall on and ignoring the
 * time of day (Mon 23:00 → Tue 01:00 is `1`).
 *
 * @param start - Floating date-time.
 * @param end - Floating date-time.
 * @returns `toDayKey(end) - toDayKey(start)`, negative if `end` is on an earlier day.
 */
export function diffDays(start: DateTimeMs, end: DateTimeMs): number {
  return toDayKey(end) - toDayKey(start);
}

/**
 * Whole calendar months from `start` to `end`: the largest `n` with
 * `addMonths(start, n) <= end` (month-end clamping included, so Jan 31 → Feb 28 is `1`).
 * Antisymmetric: `diffMonths(a, b) === -diffMonths(b, a)`.
 *
 * `@internationalized/date` has no difference API, so this estimates `n` from the
 * year and month and corrects it with the library-backed {@link addMonths}.
 *
 * @param start - Floating date-time.
 * @param end - Floating date-time.
 * @returns Whole months, negative if `end` is before `start`.
 */
export function diffMonths(start: DateTimeMs, end: DateTimeMs): number {
  if (end < start) return 0 - diffMonths(end, start);
  const from = new Date(start);
  const to = new Date(end);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return addMonths(start, months) > end ? months - 1 : months;
}

/** Midnight of the day a library operation on the calendar day of `t` returns. */
function dayStart(t: DateTimeMs, operation: (date: CalendarDate) => CalendarDate): DateTimeMs {
  return fromDayKey(mapCalendarDate(toDayKey(t), operation));
}

/**
 * Bridge between floating numbers and `@internationalized/date` (ADR-018), the engine behind
 * the calendar arithmetic, ISO parsing and formatting of this module. Internal to `time/`.
 *
 * **The window.** The library covers AD 1 … 9999 only: `add` clamps results to that range,
 * `parseDate('0000-01-01')` reads year 1, and its BC era misses leap years (1 BC, i.e. year `0`,
 * gets a 28-day February). Floating time spans the whole `Date` range (about ±275 000 years), so
 * every library object core creates holds a date of 2000 … 2399: values are moved into that
 * window by whole 400-year Gregorian cycles before they reach the library and moved back after.
 * The calendar repeats exactly every cycle (146 097 days, a whole number of weeks), so month
 * lengths, leap days and weekdays are unchanged by the shift.
 */

import {
  type AnyCalendarDate,
  type CalendarDate,
  CalendarDateTime,
  GregorianCalendar,
} from '@internationalized/date';

import {
  asDateTimeMs,
  asDayKey,
  type DateTimeMs,
  DAY,
  type DayKey,
  fromDayKey,
  HOUR,
  MINUTE,
  toDayKey,
} from './datetime';

/**
 * The calendar of every library object core creates. Stateless (it only carries its identifier
 * `'gregory'`), so one shared instance is safe and saves an allocation per object.
 *
 * Annotated as pure: a bundler cannot see that the constructor has no side effects, and without
 * the annotation `new GregorianCalendar()` keeps the whole date library in the bundle of an app
 * that imports one function that never needs it (`parseDuration`; plan step 6.2, ADR-019).
 */
export const GREGORIAN: GregorianCalendar = /* @__PURE__ */ new GregorianCalendar();

/** Years in one Gregorian cycle. */
export const CYCLE_YEARS: number = 400;
/** Months in one Gregorian cycle. */
export const CYCLE_MONTHS: number = 4800;
/** Days in one Gregorian cycle (20 871 weeks). */
export const CYCLE_DAYS: number = 146_097;
/** Floating milliseconds in one Gregorian cycle. */
export const CYCLE_MS: number = CYCLE_DAYS * DAY;

/** First year of the window. */
const WINDOW_START_YEAR = 2000;
/** Day key of 2000-01-01, the first day of the window. */
const WINDOW_START_DAY = 10_957;
/** Julian day number of 1970-01-01 (day key `0`) in the library's numbering. */
const UNIX_EPOCH_JULIAN_DAY = 2_440_588;

/**
 * Whole cycles from the window to the year: `year - cycles * CYCLE_YEARS` is in 2000 … 2399.
 *
 * @param year - Full year (proleptic Gregorian, `0` is 1 BC).
 * @returns Cycles, negative before 2000.
 */
export function yearCycles(year: number): number {
  return Math.floor((year - WINDOW_START_YEAR) / CYCLE_YEARS);
}

/**
 * Whole cycles from the window to the day: `key - cycles * CYCLE_DAYS` is in 2000 … 2399.
 *
 * @param key - Calendar day.
 * @returns Cycles, negative before 2000.
 */
export function dayCycles(key: DayKey): number {
  return Math.floor((key - WINDOW_START_DAY) / CYCLE_DAYS);
}

/**
 * The year moved into the window (same leap-year status).
 *
 * @param year - Full year.
 * @returns A year in 2000 … 2399.
 */
export function windowYear(year: number): number {
  return year - yearCycles(year) * CYCLE_YEARS;
}

/**
 * The day moved into the window (same weekday, month and day of the month).
 *
 * @param key - Calendar day.
 * @returns A day key in 2000 … 2399.
 */
export function windowDay(key: DayKey): DayKey {
  return asDayKey(key - dayCycles(key) * CYCLE_DAYS);
}

/**
 * Library date of a day key. Exact for AD 1 … 9999; callers move the day into the window first.
 *
 * @param key - Calendar day.
 * @returns The `CalendarDate` of that day.
 */
export function toCalendarDate(key: DayKey): CalendarDate {
  return GREGORIAN.fromJulianDay(key + UNIX_EPOCH_JULIAN_DAY);
}

/**
 * Day key of a library date (any calendar; the time of a date-time is ignored).
 *
 * @param date - Library date or date-time.
 * @returns Its calendar day.
 */
export function fromCalendarDate(date: AnyCalendarDate): DayKey {
  return asDayKey(date.calendar.toJulianDay(date) - UNIX_EPOCH_JULIAN_DAY);
}

/**
 * Library date-time of a floating date-time. Exact for AD 1 … 9999; callers move the value into
 * the window first.
 *
 * @param t - Floating date-time.
 * @returns The `CalendarDateTime` with the same wall clock.
 */
export function toCalendarDateTime(t: DateTimeMs): CalendarDateTime {
  const key = toDayKey(t);
  const { era, year, month, day } = toCalendarDate(key);
  const time = t - key * DAY;
  return new CalendarDateTime(
    GREGORIAN,
    era,
    year,
    month,
    day,
    Math.floor(time / HOUR),
    Math.floor((time % HOUR) / MINUTE),
    Math.floor((time % MINUTE) / 1000),
    time % 1000,
  );
}

/**
 * Floating date-time of a library date-time.
 *
 * @param date - Library date-time.
 * @returns Floating milliseconds with the same wall clock.
 */
export function fromCalendarDateTime(date: CalendarDateTime): DateTimeMs {
  const time = date.hour * HOUR + date.minute * MINUTE + date.second * 1000 + date.millisecond;
  return asDateTimeMs(fromDayKey(fromCalendarDate(date)) + time);
}

/**
 * Runs a library operation on a calendar day inside the window.
 *
 * @param key - Calendar day.
 * @param operation - Library operation on the day's `CalendarDate`.
 * @returns The resulting day, moved back out of the window.
 */
export function mapCalendarDate(
  key: DayKey,
  operation: (date: CalendarDate) => CalendarDate,
): DayKey {
  const shift = dayCycles(key) * CYCLE_DAYS;
  return asDayKey(fromCalendarDate(operation(toCalendarDate(asDayKey(key - shift)))) + shift);
}

/**
 * Runs a library operation on a floating date-time inside the window.
 *
 * @param t - Floating date-time.
 * @param operation - Library operation on the value's `CalendarDateTime`.
 * @param extraCycles - Whole cycles to add to the result on top of the window shift (lets
 *   callers apply huge month amounts without the library leaving its range).
 * @returns The resulting floating date-time, moved back out of the window.
 */
export function mapCalendarDateTime(
  t: DateTimeMs,
  operation: (date: CalendarDateTime) => CalendarDateTime,
  extraCycles = 0,
): DateTimeMs {
  const cycles = dayCycles(toDayKey(t));
  const result = operation(toCalendarDateTime(asDateTimeMs(t - cycles * CYCLE_MS)));
  return asDateTimeMs(fromCalendarDateTime(result) + (cycles + extraCycles) * CYCLE_MS);
}

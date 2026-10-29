/**
 * Numeric representation of floating wall-clock time (ADR-003, `docs/architecture.md` §5).
 *
 * A floating date-time stores the wall-clock components (year … millisecond) as if they were
 * UTC, so all arithmetic goes through `Date.UTC` / `getUTC*` and never sees a time zone or DST.
 */

declare const dateTimeMsBrand: unique symbol;
declare const dayKeyBrand: unique symbol;

/**
 * A floating wall-clock date-time in milliseconds: the wall-clock components encoded as if they
 * were UTC (`Date.UTC(year, month - 1, day, hour, minute, second, ms)`).
 *
 * It is *not* an instant: `2026-03-08T10:00` is the same number in every time zone. Never mix it
 * with real epoch milliseconds (`Date.prototype.getTime()`); convert at the boundary with
 * `parseDateInput` and `toDate`.
 */
export type DateTimeMs = number & { readonly [dateTimeMsBrand]: true };

/**
 * A calendar day as an integer: `floor(dateTimeMs / DAY)`, i.e. days since 1970-01-01
 * (negative before). Used for day-level sets and prefix sums (holidays, working days).
 */
export type DayKey = number & { readonly [dayKeyBrand]: true };

/** Day of the week, `0` = Sunday … `6` = Saturday (the `Date.prototype.getUTCDay` convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One minute in milliseconds. */
export const MINUTE: number = 60_000;
/** One hour in milliseconds. */
export const HOUR: number = 3_600_000;
/** One floating day in milliseconds (always 24 h: floating time has no DST). */
export const DAY: number = 86_400_000;

/** Wall-clock components of a {@link DateTimeMs}. */
export interface DateTimeParts {
  /** Full year, e.g. `2026` (proleptic Gregorian; `0` is 1 BC). */
  readonly year: number;
  /** Month, `1` = January … `12` = December. */
  readonly month: number;
  /** Day of the month, `1` … `31`. */
  readonly day: number;
  /** Hour, `0` … `23`. */
  readonly hour: number;
  /** Minute, `0` … `59`. */
  readonly minute: number;
  /** Second, `0` … `59`. */
  readonly second: number;
  /** Millisecond, `0` … `999`. */
  readonly ms: number;
  /** Day of the week, `0` = Sunday. */
  readonly weekday: Weekday;
}

/** Wall-clock components accepted by {@link fromParts}; omitted time fields are `0`. */
export interface DateTimeFields {
  /** Full year (`0` … `99` are real years, not 1900 … 1999). */
  readonly year: number;
  /** Month, `1` … `12`. */
  readonly month: number;
  /** Day of the month, `1` … `31`. */
  readonly day: number;
  /** Hour, `0` … `23`. */
  readonly hour?: number;
  /** Minute, `0` … `59`. */
  readonly minute?: number;
  /** Second, `0` … `59`. */
  readonly second?: number;
  /** Millisecond, `0` … `999`. */
  readonly ms?: number;
}

/** 400 Gregorian years are exactly 146 097 days, so shifting by them keeps every date intact. */
const GREGORIAN_CYCLE_YEARS = 400;
const GREGORIAN_CYCLE_MS = 146_097 * DAY;

/**
 * Brands a number as a {@link DateTimeMs} without any check. For internal arithmetic on values
 * that already are floating time (`t + n * DAY`, `x / pxPerDay`).
 *
 * @param ms - Floating milliseconds.
 * @returns The same number, branded.
 */
export function asDateTimeMs(ms: number): DateTimeMs {
  return ms as DateTimeMs;
}

/**
 * Brands a number as a {@link DayKey} without any check.
 *
 * @param days - Days since 1970-01-01 (an integer).
 * @returns The same number, branded.
 */
export function asDayKey(days: number): DayKey {
  return days as DayKey;
}

/**
 * Euclidean remainder: always in `[0, divisor)`, also for negative dividends (dates before 1970).
 *
 * @internal
 */
export function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * `Date.UTC` with real years `0` … `99` (`Date.UTC` maps them to 1900 … 1999). Out-of-range
 * fields overflow into the next unit (month 13 is January of the next year).
 *
 * @internal
 */
export function utc(
  year: number,
  monthIndex: number,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): number {
  if (year >= 0 && year < 100) {
    const shifted = Date.UTC(
      year + GREGORIAN_CYCLE_YEARS,
      monthIndex,
      day,
      hour,
      minute,
      second,
      ms,
    );
    return shifted - GREGORIAN_CYCLE_MS;
  }
  return Date.UTC(year, monthIndex, day, hour, minute, second, ms);
}

/**
 * Day key of a floating date-time (the calendar day it falls on).
 *
 * @param t - Floating date-time.
 * @returns `floor(t / DAY)`.
 */
export function toDayKey(t: DateTimeMs): DayKey {
  return asDayKey(Math.floor(t / DAY));
}

/**
 * Midnight of a day key.
 *
 * @param key - Calendar day.
 * @returns Floating date-time at `00:00` of that day.
 */
export function fromDayKey(key: DayKey): DateTimeMs {
  return asDateTimeMs(key * DAY);
}

/**
 * Splits a floating date-time into its wall-clock components.
 *
 * @param t - Floating date-time (finite; otherwise every component is `NaN`).
 * @returns Year, month (`1` … `12`), day, time of day and weekday.
 */
export function getParts(t: DateTimeMs): DateTimeParts {
  const date = new Date(t);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    ms: date.getUTCMilliseconds(),
    weekday: date.getUTCDay() as Weekday,
  };
}

/**
 * Builds a floating date-time from wall-clock components. Not a validator: out-of-range fields
 * overflow like `Date.UTC` (`{ month: 13 }` is January of the next year), which arithmetic relies
 * on. Use `parseDateInput` for strict validation of caller input.
 *
 * @param fields - Year, month (`1` … `12`), day and optional time of day.
 * @returns Floating date-time, `NaN` outside the `Date` range.
 */
export function fromParts(fields: DateTimeFields): DateTimeMs {
  return asDateTimeMs(
    utc(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour ?? 0,
      fields.minute ?? 0,
      fields.second ?? 0,
      fields.ms ?? 0,
    ),
  );
}

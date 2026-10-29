/**
 * Conversion between caller dates (`Date`, ISO strings, epoch ms) and floating time.
 */

import { parseDate, parseDateTime } from '@internationalized/date';

import { DEV, err, ok, type Result } from '../shared';
import { daysInMonth } from './arithmetic';
import { asDateTimeMs, type DateTimeMs, fromDayKey, fromParts, getParts } from './datetime';
import {
  CYCLE_MS,
  CYCLE_YEARS,
  fromCalendarDate,
  fromCalendarDateTime,
  yearCycles,
} from './engine';
import { describeValue, type ParseOptions, type TimeIssue, timeIssue, withPath } from './issues';

/**
 * A date as callers pass it:
 * - `Date` or epoch-ms `number`: read through the runtime's **local** wall clock;
 * - `'YYYY-MM-DD'`: a date-only value (precision `'day'`);
 * - `'YYYY-MM-DDTHH:mm[:ss[.sss]]'` (or with a space instead of `T`): a floating date-time
 *   (precision `'time'`). Strings with `Z` or a UTC offset are not supported.
 */
export type DateInput = Date | string | number;

/**
 * Precision of a date: `'day'` for date-only values (midnight, whole days), `'time'`
 * for values that carry a time of day.
 */
export type DatePrecision = 'day' | 'time';

/** A successfully parsed {@link DateInput}. */
export interface ParsedDate {
  /** Floating wall-clock value. */
  readonly value: DateTimeMs;
  /** Whether the input was date-only (`'day'`) or carried a time of day (`'time'`). */
  readonly precision: DatePrecision;
}

/** Date or date-time without offset: groups year, month, day, hour, minute, second, fraction. */
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;
/** The same date-time shape followed by a time zone designator or a UTC offset. */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;
/** Largest absolute time value of a `Date` (ECMA-262 TimeClip). */
const MAX_TIME_VALUE = 8.64e15;

/**
 * Parses a caller date into floating time. Strict and total: it
 * never throws, also for values outside {@link DateInput} coming from untyped JS.
 *
 * - `Date` and epoch-ms `number`: the runtime-local wall-clock components (`getFullYear()` …)
 *   become the floating value. Precision is `'day'` when the local time is exactly
 *   `00:00:00.000` or the value is the first instant of its local day (what `new Date(y, m, d)`
 *   returns), else `'time'`. The two differ in zones whose DST starts at midnight
 *   (`America/Santiago`, `America/Asuncion`, historically `America/Sao_Paulo`): there that day
 *   starts at `01:00`, and such a `Date` is the date-only value at floating 00:00 of the day.
 * - `'YYYY-MM-DD'`: precision `'day'`.
 * - `'YYYY-MM-DDTHH:mm'`, `…:ss`, `…:ss.sss` (`T` or a single space): precision `'time'`, even at
 *   `00:00`. Fraction digits beyond milliseconds are truncated.
 * - Anything with `Z` or a UTC offset: issue `'unsupported-offset'` (zoned dates are planned for
 *   later; convert first, e.g. pass `new Date(value)`, which the local clock reads).
 * - Not a real date (`'2026-02-30'`, `'2026-01-05T25:00'`), another format, `NaN` or an invalid
 *   `Date`: issue `'invalid-date'` with the offending `value` and a hint in `message`.
 *
 * ISO strings are validated by `@internationalized/date` (`parseDate` / `parseDateTime`) after a
 * stricter shape check of our own (four-digit year, minutes required, no offset).
 *
 * @param value - The caller's date.
 * @param options - `path` to put into the issue.
 * @returns The floating value with its precision, or an error issue.
 *
 * @example
 * ```ts
 * parseDateInput('2026-03-08');        // { ok: true, value: { value: …, precision: 'day' } }
 * parseDateInput('2026-03-08T00:00');  // precision 'time'
 * parseDateInput('2026-03-08T10:00Z'); // { ok: false, issue: { code: 'unsupported-offset', … } }
 * ```
 */
export function parseDateInput(
  value: DateInput,
  options?: ParseOptions,
): Result<ParsedDate, TimeIssue> {
  return withPath(parseDateValue(value), options);
}

/**
 * Converts a floating date-time to a `Date` with the same **local** wall-clock components
 * (`new Date(year, month - 1, day, hour, minute, second, ms)`), the inverse of passing a `Date`
 * to {@link parseDateInput}.
 *
 * DST caveat: a wall-clock time inside the runtime zone's spring-forward gap does not exist, so
 * the `Date` is moved forward by the gap (e.g. `2026-03-08T02:30` in New York becomes 03:30
 * EDT); a time repeated at fall-back maps to its first occurrence. Midnight of a date-only value
 * is only affected in zones that start DST at midnight: there it becomes `01:00`, the start of
 * that local day, which {@link parseDateInput} reads back as the same date-only value.
 *
 * @param t - Floating date-time.
 * @returns A new local `Date`.
 */
export function toDate(t: DateTimeMs): Date {
  const { year, month, day, hour, minute, second, ms } = getParts(t);
  const date = new Date(year, month - 1, day, hour, minute, second, ms);
  // `new Date(y, …)` maps years 0 … 99 to 1900 … 1999.
  if (year >= 0 && year < 100) date.setFullYear(year, month - 1, day);
  return date;
}

/**
 * Formats the calendar day of a floating date-time as `'YYYY-MM-DD'` (the time of day is
 * dropped). Years outside `0000` … `9999` use the expanded `±YYYYYY` form.
 *
 * @param t - Floating date-time.
 * @returns Date-only ISO string.
 */
export function toISODate(t: DateTimeMs): string {
  const { year, month, day } = getParts(t);
  return `${formatYear(year)}-${pad(month)}-${pad(day)}`;
}

/**
 * Formats a floating date-time as ISO 8601 without offset, in the shortest lossless form:
 * `'YYYY-MM-DDTHH:mm'`, with `:ss` only when seconds or milliseconds are set and `.sss` only
 * when milliseconds are set. The output parses back to the same value with {@link parseDateInput}.
 *
 * @param t - Floating date-time.
 * @returns Floating date-time ISO string.
 */
export function toISODateTime(t: DateTimeMs): string {
  const { hour, minute, second, ms } = getParts(t);
  let time = `${pad(hour)}:${pad(minute)}`;
  if (second !== 0 || ms !== 0) time += `:${pad(second)}`;
  if (ms !== 0) time += `.${pad(ms, 3)}`;
  return `${toISODate(t)}T${time}`;
}

function parseDateValue(value: unknown): Result<ParsedDate, TimeIssue> {
  if (typeof value === 'string') return parseIsoString(value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalid(
        value,
        DEV ? 'Invalid date: the Date object is invalid (its time is NaN).' : '',
      );
    }
    return fromLocalDate(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalid(value, DEV ? `Invalid date ${value}: epoch milliseconds must be finite.` : '');
    }
    if (Math.abs(value) > MAX_TIME_VALUE) return outOfRange(value);
    return fromLocalDate(new Date(value));
  }
  return invalid(
    value,
    DEV
      ? `Invalid date ${describeValue(value)}: expected a Date, epoch milliseconds or an ISO string.`
      : '',
  );
}

function parseIsoString(input: string): Result<ParsedDate, TimeIssue> {
  const match = ISO_DATE_TIME.exec(input);
  if (!match) {
    if (ISO_WITH_OFFSET.test(input)) {
      return err(
        timeIssue(
          'unsupported-offset',
          input,
          DEV
            ? `Unsupported date ${JSON.stringify(input)}: time zone designators and UTC offsets are not supported. ` +
                'Pass the floating wall-clock time without "Z" / "+hh:mm", or convert it first: new Date(value) is read on the local clock.'
            : '',
        ),
      );
    }
    return invalid(
      input,
      DEV
        ? `Invalid date ${JSON.stringify(input)}: expected "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss[.sss]]" without a time zone.`
        : '',
    );
  }

  const [, year = '', month = '', day = '', hour = '', minute = '00', second = '00', fraction] =
    match;
  const fields: IsoFields = { year, month, day, hour, minute, second };
  const value = parseIsoFields(fields);
  if (value === undefined) {
    return invalid(
      input,
      DEV ? `Invalid date ${JSON.stringify(input)}: ${explainInvalid(fields)}.` : '',
    );
  }
  const ms = fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, '0'));
  return ok({ value: asDateTimeMs(value + ms), precision: hour === '' ? 'day' : 'time' });
}

/** Digit groups of a string matching {@link ISO_DATE_TIME}; `hour` is `''` for a date-only value. */
interface IsoFields {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

/**
 * Validates and converts the fields with the library's `parseDate` / `parseDateTime`. The year
 * is moved into the engine window first: the library reads `0000` as year 1 and covers
 * AD 1 … 9999 only.
 *
 * @returns Floating milliseconds without the fraction, or `undefined` if it is not a real date.
 */
function parseIsoFields(fields: IsoFields): number | undefined {
  // `parseDateTime` accepts day 00.
  if (fields.day === '00') return undefined;
  const year = Number(fields.year);
  const cycles = yearCycles(year);
  const date = `${year - cycles * CYCLE_YEARS}-${fields.month}-${fields.day}`;
  try {
    const value =
      fields.hour === ''
        ? fromDayKey(fromCalendarDate(parseDate(date)))
        : fromCalendarDateTime(
            parseDateTime(`${date}T${fields.hour}:${fields.minute}:${fields.second}`),
          );
    return value + cycles * CYCLE_MS;
  } catch {
    return undefined; // `explainInvalid` names the field.
  }
}

/**
 * Names the first out-of-range field of a date {@link parseIsoFields} rejected. The shape check
 * leaves only these fields to fail, so a date that passes the other checks has a bad second.
 */
function explainInvalid(fields: IsoFields): string {
  const { year, month, day, hour, minute, second } = fields;
  if (Number(month) < 1 || Number(month) > 12) return `month ${month} is out of range (01-12)`;
  const days = daysInMonth(Number(year), Number(month));
  if (Number(day) < 1 || Number(day) > days) {
    return `${year}-${month} has no day ${day} (it has ${days} days)`;
  }
  if (Number(hour) > 23) return `hour ${hour} is out of range (00-23)`;
  if (Number(minute) > 59) return `minute ${minute} is out of range (00-59)`;
  return `second ${second} is out of range (00-59)`;
}

/**
 * Reads the local wall clock of a valid `Date`. A `Date` at local 00:00:00.000 or at the start
 * of its local day is date-only (precision `'day'`, floating 00:00), also in zones where DST starts at midnight and
 * the day therefore starts at 01:00 (`America/Santiago`, `America/Asuncion`, historically
 * `America/Sao_Paulo`): `new Date(y, m, d)` lands there and must still be the day `d`.
 */
function fromLocalDate(date: Date): Result<ParsedDate, TimeIssue> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();
  const ms = date.getMilliseconds();
  const dayOnly =
    (hour === 0 && minute === 0 && second === 0 && ms === 0) ||
    date.getTime() === localDayStart(year, month - 1, day);
  const value = dayOnly
    ? fromParts({ year, month, day })
    : fromParts({ year, month, day, hour, minute, second, ms });
  // The local wall clock of a Date at the very edge of the range can fall outside it.
  if (!Number.isFinite(value)) return outOfRange(date);
  return ok({ value, precision: dayOnly ? 'day' : 'time' });
}

/**
 * Epoch ms of the first instant of a local calendar day: `new Date(year, month, day)`, which
 * the runtime moves past a DST gap at midnight (to 01:00 in zones that start DST at 00:00).
 * `NaN` outside the `Date` range.
 */
function localDayStart(year: number, month: number, day: number): number {
  const start = new Date(year, month, day);
  // `new Date(y, …)` maps years 0 … 99 to 1900 … 1999.
  if (year >= 0 && year < 100) start.setFullYear(year, month, day);
  return start.getTime();
}

function invalid(value: unknown, message: string): Result<never, TimeIssue> {
  return err(timeIssue('invalid-date', value, message));
}

function outOfRange(value: unknown): Result<never, TimeIssue> {
  return invalid(
    value,
    DEV
      ? `Invalid date ${describeValue(value)}: outside the range a Date can represent (±8.64e15 ms around 1970).`
      : '',
  );
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
}

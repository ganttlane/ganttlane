/**
 * Strict durations: `'1y' '1q' '1mo' '2w' '3d' '6h' '30min'`, compounds such as
 * `'1d 4h'`, ISO 8601 durations such as `'P1DT4H'` and the object form `{ hours: 4 }`,
 * normalized to a calendar part and a fixed part.
 */

import { parseDuration as parseIsoDuration } from '@internationalized/date';

import { DEV, err, isRecord, ok, type Result } from '../shared';
import { addMonths } from './arithmetic';
import { asDateTimeMs, type DateTimeMs, DAY, HOUR, MINUTE } from './datetime';
import { describeValue, type ParseOptions, type TimeIssue, timeIssue, withPath } from './issues';

/** Object form of a duration: non-negative integers, at least one field. */
export interface DurationFields {
  /** Calendar years (12 months each). */
  readonly years?: number;
  /** Calendar quarters (3 months each). */
  readonly quarters?: number;
  /** Calendar months. */
  readonly months?: number;
  /** Weeks of 7 days. */
  readonly weeks?: number;
  /** Days (24 h in floating time). */
  readonly days?: number;
  /** Hours. */
  readonly hours?: number;
  /** Minutes (the smallest unit: core has minute precision). */
  readonly minutes?: number;
}

/**
 * A duration as callers pass it: a string of space-separated `<int><unit>`
 * tokens with units `y`, `q`, `mo`, `w`, `d`, `h`, `min` (`'30min'`, `'1d 4h'`, `'1q'`), an
 * ISO 8601 duration (`'P1DT4H'`, `'P2W'`, `'P1M'`), or {@link DurationFields}. The unit `m` is
 * rejected as ambiguous; seconds are not supported.
 */
export type DurationInput = string | DurationFields;

/**
 * A normalized duration: a calendar part in months (years and quarters folded in; its length
 * depends on where it is applied) plus a fixed part in milliseconds (weeks, days, hours and
 * minutes; floating days are always 24 h). Apply it with `addDuration`: months first, then ms.
 */
export interface Duration {
  /** Calendar months (`1y` = 12, `1q` = 3). */
  readonly months: number;
  /** Fixed milliseconds. */
  readonly ms: number;
}

/** Calendar months and fixed milliseconds of one unit. */
type UnitSize = readonly [months: number, ms: number];

/** Unit sizes keyed by the string unit. */
const STRING_UNITS: ReadonlyMap<string, UnitSize> = /* @__PURE__ */ new Map<string, UnitSize>([
  ['y', [12, 0]],
  ['q', [3, 0]],
  ['mo', [1, 0]],
  ['w', [0, 7 * DAY]],
  ['d', [0, DAY]],
  ['h', [0, HOUR]],
  ['min', [0, MINUTE]],
]);

/** Unit sizes keyed by the object field. */
const FIELD_UNITS: ReadonlyMap<string, UnitSize> = /* @__PURE__ */ new Map<string, UnitSize>([
  ['years', [12, 0]],
  ['quarters', [3, 0]],
  ['months', [1, 0]],
  ['weeks', [0, 7 * DAY]],
  ['days', [0, DAY]],
  ['hours', [0, HOUR]],
  ['minutes', [0, MINUTE]],
]);

const TOKEN = /^(\d+)([A-Za-z]+)$/;
const SECOND_UNITS = /* @__PURE__ */ new Set(['s', 'sec', 'ms']);
const EXPECTED_STRING =
  'expected space-separated tokens like "1y", "1q", "1mo", "2w", "3d", "6h" or "30min" (e.g. "1d 4h") or an ISO 8601 duration such as "P1DT4H"';
const EXPECTED_ISO =
  'expected an ISO 8601 duration such as "P1DT4H", "P2W" or "P1M" with whole years, months, weeks, days, hours and minutes';
/** A designator (`P1D`, `T4H`) without an amount in front of it, which the library reads as 0. */
const ISO_MISSING_AMOUNT = /(?<!\d)[YMWDHS]/;

/**
 * Parses a duration strictly. Never throws, also for values outside
 * {@link DurationInput} coming from untyped JS.
 *
 * - Strings: `<int><unit>` tokens separated by single spaces, each unit at most once, units
 *   `y`, `q`, `mo`, `w`, `d`, `h`, `min`. `'m'` is rejected as ambiguous (use `mo` or `min`);
 *   seconds, fractions and signs are rejected.
 * - ISO 8601 strings (starting with `P`, parsed by `@internationalized/date`): years, months,
 *   weeks, days, hours and minutes (`'P1Y2M'`, `'P2W'`, `'PT90M'`, `'P1DT4H'`). Seconds,
 *   fractions (`'PT1.5H'`) and signs are rejected: core has minute precision.
 * - Objects: fields of {@link DurationFields} with non-negative integer values; unknown fields
 *   are rejected, `undefined` fields are ignored, at least one field must be set.
 * - Numbers are rejected: "a number means days" is a rule of task durations and link lags, not
 *   of this parser.
 *
 * Use `negate` for a negative duration.
 *
 * @param input - The caller's duration.
 * @param options - `path` to put into the issue.
 * @returns The normalized duration, or an `'invalid-duration'` error issue with a hint.
 *
 * @example
 * ```ts
 * parseDuration('1d 4h');   // { ok: true, value: { months: 0, ms: 100_800_000 } }
 * parseDuration('1q');      // { ok: true, value: { months: 3, ms: 0 } }
 * parseDuration('P1DT4H');  // the same as '1d 4h'
 * parseDuration('5m');      // { ok: false, issue: { code: 'invalid-duration', … } }
 * ```
 */
export function parseDuration(
  input: DurationInput,
  options?: ParseOptions,
): Result<Duration, TimeIssue> {
  return withPath(parseDurationValue(input), options);
}

/**
 * Applies a duration: adds the calendar months first (with month-end clamping), then the fixed
 * milliseconds. With `sign = -1` it subtracts in the same order.
 *
 * @param t - Floating date-time.
 * @param duration - Duration to apply.
 * @param sign - `1` to add (default), `-1` to subtract.
 * @returns Shifted date-time.
 */
export function addDuration(t: DateTimeMs, duration: Duration, sign: 1 | -1 = 1): DateTimeMs {
  return asDateTimeMs(addMonths(t, sign * duration.months) + sign * duration.ms);
}

/**
 * The opposite duration (both parts negated).
 *
 * @param duration - Duration to negate.
 * @returns `{ months: -months, ms: -ms }` (never `-0`).
 */
export function negate(duration: Duration): Duration {
  return { months: 0 - duration.months, ms: 0 - duration.ms };
}

/**
 * Whether a duration is empty.
 *
 * @param duration - Duration to test.
 * @returns `true` when both parts are `0`.
 */
export function isZeroDuration(duration: Duration): boolean {
  return duration.months === 0 && duration.ms === 0;
}

/**
 * Compares the fixed parts of two durations. Only meaningful when both have `months === 0`:
 * a calendar part has no fixed length (1 month is 28 … 31 days).
 *
 * @param a - First duration.
 * @param b - Second duration.
 * @returns `-1` if `a` is shorter, `1` if longer, `0` if equal.
 */
export function compareFixed(a: Duration, b: Duration): -1 | 0 | 1 {
  if (a.ms === b.ms) return 0;
  return a.ms < b.ms ? -1 : 1;
}

/**
 * Formats a duration in the canonical string form: years and months for the calendar part,
 * days, hours and minutes for the fixed part (`'1y 2mo 1d 4h 30min'`; weeks become days and
 * quarters months). Every token of a negative part carries a `-` (`'-1d -4h'`); an empty duration
 * is `'0d'`. Sub-minute remainders cannot be expressed and are truncated toward zero.
 *
 * @param duration - Duration to format.
 * @returns Canonical duration string; non-negative ones parse back with {@link parseDuration}.
 */
export function durationToString(duration: Duration): string {
  const tokens: string[] = [];
  const push = (amount: number, unit: string, sign: string): void => {
    if (amount !== 0) tokens.push(`${sign}${amount}${unit}`);
  };

  const monthSign = duration.months < 0 ? '-' : '';
  const months = Math.abs(Math.trunc(duration.months));
  push(Math.floor(months / 12), 'y', monthSign);
  push(months % 12, 'mo', monthSign);

  const msSign = duration.ms < 0 ? '-' : '';
  const minutes = Math.abs(Math.trunc(duration.ms / MINUTE));
  push(Math.floor(minutes / 1440), 'd', msSign);
  push(Math.floor((minutes % 1440) / 60), 'h', msSign);
  push(minutes % 60, 'min', msSign);

  return tokens.length === 0 ? '0d' : tokens.join(' ');
}

function parseDurationValue(value: unknown): Result<Duration, TimeIssue> {
  if (typeof value === 'string') return parseDurationString(value);
  if (isRecord(value)) return parseDurationFields(value);
  return invalid(
    value,
    DEV
      ? `Invalid duration ${describeValue(value)}: ${
          typeof value === 'number'
            ? 'plain numbers are accepted only where they mean days (task duration, link lag)'
            : 'expected a string such as "1d 4h" or an object such as { hours: 4 }'
        }.`
      : '',
  );
}

function parseDurationString(input: string): Result<Duration, TimeIssue> {
  if (input === '') return invalid(input, DEV ? `Invalid duration "": ${EXPECTED_STRING}.` : '');
  if (input.startsWith('P')) return parseIsoDurationString(input);

  let months = 0;
  let ms = 0;
  const seen = new Set<string>();
  for (const token of input.split(' ')) {
    const match = TOKEN.exec(token);
    const [, digits = '', unit = ''] = match ?? [];
    const size = STRING_UNITS.get(unit);
    if (!match || !size) {
      return invalid(
        input,
        DEV ? `Invalid duration ${quote(input)}: ${tokenHint(token, unit)}.` : '',
      );
    }
    if (seen.has(unit)) {
      return invalid(
        input,
        DEV ? `Invalid duration ${quote(input)}: unit "${unit}" appears more than once.` : '',
      );
    }
    seen.add(unit);
    const amount = Number(digits);
    months += amount * size[0];
    ms += amount * size[1];
  }
  return safeDuration(input, months, ms);
}

function tokenHint(token: string, unit: string): string {
  if (token === '') return `separate tokens with single spaces; ${EXPECTED_STRING}`;
  if (unit === 'm') return 'unit "m" is ambiguous, use "mo" for months or "min" for minutes';
  if (SECOND_UNITS.has(unit)) {
    return 'seconds are not supported (minute precision), use "min" as the smallest unit';
  }
  if (unit !== '') return `unknown unit "${unit}", use y, q, mo, w, d, h or min`;
  if (token.startsWith('-')) return 'durations are non-negative, negate them in code instead';
  if (/^\d+[.,]\d+/.test(token)) {
    return 'amounts must be whole numbers, e.g. "1d 12h" instead of "1.5d"';
  }
  return EXPECTED_STRING;
}

function parseIsoDurationString(input: string): Result<Duration, TimeIssue> {
  let fields: ReturnType<typeof parseIsoDuration> | undefined;
  try {
    if (!ISO_MISSING_AMOUNT.test(input)) fields = parseIsoDuration(input);
  } catch {
    // Explained by the hint below.
  }
  if (!fields)
    return invalid(input, DEV ? `Invalid duration ${quote(input)}: ${EXPECTED_ISO}.` : '');
  // Seconds are the last ISO component: present exactly when the string ends in "S".
  if (input.endsWith('S')) {
    return invalid(
      input,
      DEV
        ? `Invalid duration ${quote(input)}: seconds are not supported (minute precision), use minutes ("PT1M") as the smallest unit.`
        : '',
    );
  }
  if (/[.,]/.test(input)) {
    return invalid(
      input,
      DEV
        ? `Invalid duration ${quote(input)}: amounts must be whole numbers, e.g. "PT1H30M" instead of "PT1.5H".`
        : '',
    );
  }
  const { years, months, weeks, days, hours, minutes } = fields;
  return safeDuration(
    input,
    years * 12 + months,
    (weeks * 7 + days) * DAY + hours * HOUR + minutes * MINUTE,
  );
}

function parseDurationFields(input: object): Result<Duration, TimeIssue> {
  let months = 0;
  let ms = 0;
  let fields = 0;
  for (const [field, amount] of Object.entries(input)) {
    const size = FIELD_UNITS.get(field);
    if (!size) {
      return invalid(
        input,
        DEV
          ? `Invalid duration: unknown field "${field}", use years, quarters, months, weeks, days, hours or minutes.`
          : '',
      );
    }
    if (amount === undefined) continue;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
      return invalid(
        input,
        DEV
          ? `Invalid duration: "${field}" must be a non-negative integer, got ${describeValue(amount)}.`
          : '',
      );
    }
    fields++;
    months += amount * size[0];
    ms += amount * size[1];
  }
  if (fields === 0) {
    return invalid(
      input,
      DEV ? 'Invalid duration: the object sets no field, e.g. { days: 1 }.' : '',
    );
  }
  return safeDuration(input, months, ms);
}

function safeDuration(input: unknown, months: number, ms: number): Result<Duration, TimeIssue> {
  if (!Number.isSafeInteger(months) || !Number.isSafeInteger(ms)) {
    return invalid(
      input,
      DEV ? `Invalid duration ${describeValue(input)}: the amount is too large.` : '',
    );
  }
  return ok({ months, ms });
}

/** A string input quoted for a message. */
function quote(input: string): string {
  return JSON.stringify(input);
}

function invalid(value: unknown, message: string): Result<never, TimeIssue> {
  return err(timeIssue('invalid-duration', value, message));
}

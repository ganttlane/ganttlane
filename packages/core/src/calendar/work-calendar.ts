/**
 * The work calendar (FR-CAL-1 … FR-CAL-7, FR-CAL-10): which days are working days and arithmetic
 * over working days and working time.
 */

import { assertNever } from '../shared';
import {
  asDateTimeMs,
  asDayKey,
  type DateTimeMs,
  DAY,
  type DayKey,
  fromDayKey,
  getParts,
  toDayKey,
} from '../time';
import {
  DAY_CUSTOM_OFF,
  DAY_CUSTOM_WORKING,
  DAY_EXCEPTION,
  DAY_HOLIDAY,
  DAY_WEEKEND,
  DAY_WORKING,
  type DayClassifier,
  type DayCode,
  DayIndex,
  isWorkingCode,
  MAX_DAY_KEY,
  MAX_INDEX_DAYS,
  MIN_DAY_KEY,
} from './day-index';
import type { CalendarIssue } from './issues';
import { type CalendarRules, readCalendarOptions, type WorkCalendarOptions } from './options';

/**
 * Why a day is or is not a working day, i.e. which rule decided it (FR-CAL-3):
 * - `'exception'`: listed in `workingDays` (working);
 * - `'holiday'`: listed in `holidays` (non-working);
 * - `'custom'`: the `isWorkingDay` rule returned `true` or `false`;
 * - `'weekend'`: its weekday is in `weekends` (non-working);
 * - `'working'`: none of the above, an ordinary working day.
 */
export type DayReason = 'working' | 'weekend' | 'holiday' | 'custom' | 'exception';

/** Result of `WorkCalendar.explain` (FR-CAL-5). */
export interface DayExplanation {
  /** Whether the day is a working day. */
  readonly working: boolean;
  /** Which rule decided it. */
  readonly reason: DayReason;
  /** Name of the holiday, for a named holiday (FR-CAL-2), e.g. for a tooltip. */
  readonly label?: string;
}

/** Day counts of a half-open range, see `WorkCalendar.countDays` (FR-CAL-4). */
export interface DayCounts {
  /** All days: `endExclusive - start`. */
  readonly calendar: number;
  /** Working days. */
  readonly working: number;
  /** Non-working days: `calendar - working`. */
  readonly nonWorking: number;
}

/** Options of `WorkCalendar.nextWorkingDay` / `prevWorkingDay`. */
export interface WorkingDaySearchOptions {
  /** `true` returns the given day itself when it is a working day. Default `false`. */
  readonly inclusive?: boolean | undefined;
}

/**
 * What kind of instant `WorkCalendar.rollToWorking` rolls, which decides the day it checks:
 * - `'start'`: the start of something (a task's start): the day of `t`;
 * - `'end'`: an exclusive end: the day of its last instant, `t - 1 ms` (an end at Saturday 00:00
 *   is the end of Friday);
 * - `'boundary'`: a point between two instants (the boundary of a progress bar's done part): it is
 *   in non-working time only when both the instant after it and the instant before it are, so the
 *   midnights that delimit a non-working stretch (Saturday 00:00 after a working Friday, Monday
 *   00:00) stay. It rolls like a `'start'` forward and like an `'end'` backward.
 */
export type RollEdge = 'start' | 'end' | 'boundary';

/** Options of `WorkCalendar.rollToWorking`. */
export interface RollToWorkingOptions {
  /** What kind of instant is rolled. Default `'start'`. */
  readonly edge?: RollEdge | undefined;
  /**
   * `true` moves by whole days, keeping the time of day; `false` (default) lands on a midnight:
   * the start (00:00) of the target day for a `'start'`, its end (24:00) for an `'end'`.
   */
  readonly keepTimeOfDay?: boolean | undefined;
}

/**
 * An immutable work calendar (FR-CAL-1 … FR-CAL-7, FR-CAL-10), created by
 * {@link createWorkCalendar}. Usable on its own, without a chart (FR-CAL-6).
 *
 * **Days and times.** Day-level methods take and return {@link DayKey}s (whole days; get one from
 * a date-time with `toDayKey`). Time-level methods (`countWorkingTime`, `addWorkingTime`) take
 * {@link DateTimeMs}. In P0 a working day is the full 24 h (ADR-015), so working time is the
 * milliseconds that fall on working days. Floating time has no DST: every day is 24 h.
 *
 * **Performance.** Answers come from a per-day cache with prefix sums that grows on demand and
 * lives as long as the calendar: counting is amortized O(1), searches O(log n). Caching is why
 * the calendar is immutable; to change the rules, create a new calendar (FR-CAL-7).
 *
 * **Outside the calendar.** Day keys are floored to integers. Keys that are not finite or lie
 * beyond ±100 000 000 days (where no `Date` exists) are outside the calendar: they are non-working
 * (`explain` reports `{ working: false, reason: 'custom' }`), counts are `NaN` and arithmetic
 * returns `undefined`.
 *
 * **No working day.** Arithmetic that runs out of working days returns `undefined`: a search
 * always crosses a run of non-working days shorter than 100 years (36 525 days), and treats a
 * calendar without working days for that long in its direction as having none.
 *
 * The methods do not use `this`, so they can be passed around detached
 * (`days.filter(calendar.isWorkingDay)`).
 */
export interface WorkCalendar {
  /**
   * Whether a day is a working day (FR-CAL-5).
   *
   * @param day - The day.
   * @returns `true` for a working day.
   */
  readonly isWorkingDay: (day: DayKey) => boolean;

  /**
   * Whether a day is a working day, which rule decided it and the holiday name (FR-CAL-5).
   *
   * @param day - The day.
   * @returns A shared, immutable explanation.
   *
   * @example
   * ```ts
   * calendar.explain(christmas); // { working: false, reason: 'holiday', label: 'Christmas' }
   * ```
   */
  readonly explain: (day: DayKey) => DayExplanation;

  /**
   * Counts calendar, working and non-working days in the half-open range
   * `[start, endExclusive)`, in amortized O(1) (FR-CAL-4).
   *
   * Signed: when `endExclusive < start` every count is negated
   * (`countDays(b, a)` is `-countDays(a, b)`), so counts of adjacent ranges add up.
   *
   * @param start - First day of the range.
   * @param endExclusive - Day after the last day of the range.
   * @returns The counts; `NaN` counts for keys outside the calendar.
   */
  readonly countDays: (start: DayKey, endExclusive: DayKey) => DayCounts;

  /**
   * Number of working days in the closed range `[start, end]`, `0` when `end < start`.
   *
   * Legacy semantics (inclusive end dates, as in the frappe-gantt fork) for tasks whose
   * `durationMode` is `'working'`; equals `countDays(start, end + 1).working` for `end >= start`.
   *
   * @param start - First day.
   * @param end - Last day (inclusive).
   * @returns The working-day count; `NaN` for keys outside the calendar.
   */
  readonly countWorkingDaysInclusive: (start: DayKey, end: DayKey) => number;

  /**
   * Working time in milliseconds in `[start, end)`, including partial days at both ends
   * (FR-CAL-10): the part of the range that falls on working days. Amortized O(1).
   *
   * Signed like {@link WorkCalendar.countDays}: `countWorkingTime(b, a)` is
   * `-countWorkingTime(a, b)`, so `countWorkingTime(a, b) + countWorkingTime(b, c)` always equals
   * `countWorkingTime(a, c)`.
   *
   * @param start - Start of the range.
   * @param end - End of the range (exclusive).
   * @returns Working milliseconds; `NaN` for non-finite or out-of-calendar times.
   *
   * @example
   * ```ts
   * // Friday 18:00 → Monday 06:00 with Sat/Sun off: 6 h on Friday + 6 h on Monday.
   * calendar.countWorkingTime(fri18, mon06); // 12 * HOUR
   * ```
   */
  readonly countWorkingTime: (start: DateTimeMs, end: DateTimeMs) => number;

  /**
   * Moves a day by `amount` working days (FR-CAL-5).
   *
   * - `amount > 0`: the `amount`-th working day strictly **after** `day`;
   * - `amount < 0`: the `|amount|`-th working day strictly **before** `day`;
   * - `amount === 0`: `day` itself, unchanged even when it is a non-working day (use
   *   {@link WorkCalendar.nextWorkingDay} with `inclusive` to roll it onto a working day).
   *
   * Whether `day` itself is a working day does not matter for a non-zero `amount`: counting starts
   * at the neighbouring day. With Saturday and Sunday off, `+1` from Friday, Saturday or Sunday is
   * Monday, and `-1` from Saturday, Sunday or Monday is Friday. Hence the result is always a
   * working day, and `addWorkingDays(addWorkingDays(d, n), -n) === d` for any working day `d`.
   * A fractional `amount` is truncated toward zero.
   *
   * @param day - The start day.
   * @param amount - Working days to move, may be negative.
   * @returns The day, or `undefined` when the calendar runs out of working days (or for a key
   *   outside the calendar or a non-finite `amount`).
   */
  readonly addWorkingDays: (day: DayKey, amount: number) => DayKey | undefined;

  /**
   * Moves a date-time by `ms` milliseconds of working time, skipping non-working days
   * (FR-CAL-10).
   *
   * The result is the **first** instant, going from `t` in the direction of `ms`, at which exactly
   * `|ms|` of working time lies between `t` and it, so
   * `countWorkingTime(t, addWorkingTime(t, ms)) === ms` always holds. Consequences:
   * - the time of day is preserved when jumping over non-working days: with Saturday and Sunday
   *   off, Friday 10:00 `+ 1 day` is Monday 10:00 and Monday 10:00 `- 1 day` is Friday 10:00;
   * - a result that reaches the edge of a working stretch stays there instead of jumping over the
   *   following non-working days: Friday 00:00 `+ 1 day` is Saturday 00:00 (the end of Friday),
   *   Monday 10:00 `- 10 h` is Monday 00:00. Roll a start onto working time with
   *   {@link WorkCalendar.nextWorkingDay} if needed;
   * - from a non-working day, working time starts accruing at the next (previous) working day:
   *   Saturday 10:00 `+ 2 h` is Monday 02:00, not Monday 12:00;
   * - `ms === 0` returns `t` unchanged.
   *
   * @param t - The start.
   * @param ms - Working milliseconds to move, may be negative.
   * @returns The moved date-time, or `undefined` when the calendar runs out of working days (or for
   *   non-finite input).
   */
  readonly addWorkingTime: (t: DateTimeMs, ms: number) => DateTimeMs | undefined;

  /**
   * The first working day after `day` (FR-CAL-5); with `inclusive: true`, `day` itself when it is
   * a working day.
   *
   * @param day - The start day.
   * @param options - `inclusive` (default `false`).
   * @returns The working day, or `undefined` when there is none.
   */
  readonly nextWorkingDay: (day: DayKey, options?: WorkingDaySearchOptions) => DayKey | undefined;

  /**
   * The last working day before `day` (FR-CAL-5); with `inclusive: true`, `day` itself when it is
   * a working day.
   *
   * @param day - The start day.
   * @param options - `inclusive` (default `false`).
   * @returns The working day, or `undefined` when there is none.
   */
  readonly prevWorkingDay: (day: DayKey, options?: WorkingDaySearchOptions) => DayKey | undefined;

  /**
   * Moves an instant that lies in non-working time to the next (`direction` `1`) or previous
   * (`-1`) working day (FR-SCH-4, FR-SNAP-8): the shared rule of `skipNonWorkingDays`.
   *
   * 1. **The checked day** depends on `edge` (see {@link RollEdge}): the day of `t` for a
   *    `'start'`, the day of `t - 1 ms` for an exclusive `'end'`; for a `'boundary'` the day of `t`
   *    forward and of `t - 1 ms` backward. When it is a working day, `t` is returned unchanged; a
   *    `'boundary'` also stays when the other of the two days is a working day.
   * 2. **The target day** is the first working day after the checked day (`1`) or the last one
   *    before it (`-1`).
   * 3. **The result**: with `keepTimeOfDay`, `t` moved by whole days from the checked day to the
   *    target day (Saturday 10:00 → Monday 10:00 forward, Friday 10:00 backward; an end at Sunday
   *    00:00 → Saturday 00:00 backward, Tuesday 00:00 forward). Otherwise a midnight of the target
   *    day: a `'start'` goes to its start (Saturday 10:00 → Monday 00:00 forward, Friday 00:00
   *    backward), an `'end'` to its end (an end at Sunday 10:00 → Saturday 00:00 backward,
   *    Tuesday 00:00 forward), a `'boundary'` to the edge of its non-working stretch (Monday 00:00
   *    forward, Saturday 00:00 backward).
   *
   * Every result is an instant whose checked day is a working day.
   *
   * @param t - The instant.
   * @param direction - `1` to roll forward, `-1` to roll backward.
   * @param options - `edge` (default `'start'`) and `keepTimeOfDay` (default `false`).
   * @returns The rolled instant (`t` itself when it is already on working time), or `undefined`
   *   when there is no working day in that direction (or `t` is outside the calendar).
   *
   * @example
   * ```ts
   * // Saturday and Sunday off.
   * calendar.rollToWorking(sat10, 1, { keepTimeOfDay: true }); // Monday 10:00
   * calendar.rollToWorking(sun00, -1, { edge: 'end' }); // Saturday 00:00, the end of Friday
   * calendar.rollToWorking(sat00, 1, { edge: 'boundary' }); // Saturday 00:00: Friday's end
   * ```
   */
  readonly rollToWorking: (
    t: DateTimeMs,
    direction: 1 | -1,
    options?: RollToWorkingOptions,
  ) => DateTimeMs | undefined;

  /**
   * The last day of a span that starts at `start` and contains `workingDays` working days: the
   * smallest `end >= start` with `countWorkingDaysInclusive(start, end) === workingDays`.
   *
   * Legacy semantics (the frappe-gantt fork's "end by working duration", inclusive end) for tasks
   * whose `durationMode` is `'working'`: `start` counts as the first working day when it is one;
   * when it is not, it counts 0 and counting starts at the next working day. The walk goes forward
   * day by day until `workingDays` working days are counted, so the result is a working day.
   * With Saturday and Sunday off: Monday + 5 → Friday, Saturday + 1 → Monday, Friday + 2 → Monday.
   * For `workingDays <= 0` the result is `start` itself (even a non-working one). A fractional
   * count is rounded up.
   *
   * @param start - First day of the span.
   * @param workingDays - Working days the span must contain.
   * @returns The last day of the span, or `undefined` when the calendar runs out of working days.
   */
  readonly workingSpanEnd: (start: DayKey, workingDays: number) => DayKey | undefined;
}

/** Result of {@link createWorkCalendar}. */
export interface WorkCalendarResult {
  /** The calendar. */
  readonly calendar: WorkCalendar;
  /** Problems found in the options; the offending parts were skipped. */
  readonly issues: readonly CalendarIssue[];
}

/**
 * Creates an immutable work calendar (FR-CAL-1 … FR-CAL-7, FR-CAL-10). Never throws on bad
 * options: invalid entries become issues and are skipped.
 *
 * A day is decided by the first rule that applies (FR-CAL-3): a `workingDays` exception makes it
 * working; else a holiday makes it non-working; else the `isWorkingDay` rule decides when it
 * returns a boolean; else it is non-working when its weekday is in `weekends`.
 *
 * @param options - Weekends, holidays, exceptions and a custom rule; all optional.
 * @returns The calendar and the issues found in `options`.
 *
 * @example
 * ```ts
 * const { calendar, issues } = createWorkCalendar({
 *   weekends: [0, 6],
 *   holidays: ['2026-01-01', { date: '2026-12-25', name: 'Christmas' }],
 *   workingDays: ['2026-12-26'],
 * });
 * calendar.addWorkingDays(toDayKey(friday), 1); // Monday
 * ```
 */
export function createWorkCalendar(options?: WorkCalendarOptions): WorkCalendarResult {
  return buildWorkCalendar(options, MAX_INDEX_DAYS);
}

const WORKING: DayExplanation = /* @__PURE__ */ Object.freeze({ working: true, reason: 'working' });
const WEEKEND: DayExplanation = /* @__PURE__ */ Object.freeze({
  working: false,
  reason: 'weekend',
});
const HOLIDAY: DayExplanation = /* @__PURE__ */ Object.freeze({
  working: false,
  reason: 'holiday',
});
const CUSTOM_WORKING: DayExplanation = /* @__PURE__ */ Object.freeze({
  working: true,
  reason: 'custom',
});
const CUSTOM_OFF: DayExplanation = /* @__PURE__ */ Object.freeze({
  working: false,
  reason: 'custom',
});
const EXCEPTION: DayExplanation = /* @__PURE__ */ Object.freeze({
  working: true,
  reason: 'exception',
});
/** Explanation of a key outside the calendar. */
const OUTSIDE: DayExplanation = CUSTOM_OFF;
const NAN_COUNTS: DayCounts = /* @__PURE__ */ Object.freeze({
  calendar: NaN,
  working: NaN,
  nonWorking: NaN,
});

/**
 * {@link createWorkCalendar} with a configurable cache cap (tests use a small one to exercise
 * the uncached paths).
 *
 * @internal
 */
export function buildWorkCalendar(
  options: WorkCalendarOptions | undefined,
  maxIndexDays: number,
): WorkCalendarResult {
  const { rules, issues } = readCalendarOptions(options);
  const index = new DayIndex(classifier(rules), maxIndexDays);

  const holidayExplanations = new Map<number, DayExplanation>();
  for (const [day, name] of rules.holidays) {
    if (name !== undefined) {
      holidayExplanations.set(
        day,
        Object.freeze({ working: false, reason: 'holiday', label: name }),
      );
    }
  }

  const working = (day: number): boolean => isWorkingCode(index.codeAt(day));

  const isWorkingDay = (day: DayKey): boolean => {
    const key = Math.floor(day);
    return inCalendar(key) && working(key);
  };

  const explain = (day: DayKey): DayExplanation => {
    const key = Math.floor(day);
    if (!inCalendar(key)) return OUTSIDE;
    const code = index.codeAt(key);
    switch (code) {
      case DAY_WORKING:
        return WORKING;
      case DAY_WEEKEND:
        return WEEKEND;
      case DAY_HOLIDAY:
        return holidayExplanations.get(key) ?? HOLIDAY;
      case DAY_CUSTOM_WORKING:
        return CUSTOM_WORKING;
      case DAY_CUSTOM_OFF:
        return CUSTOM_OFF;
      case DAY_EXCEPTION:
        return EXCEPTION;
      default:
        return assertNever(code, 'Unknown day code');
    }
  };

  const countDays = (start: DayKey, endExclusive: DayKey): DayCounts => {
    const a = Math.floor(start);
    const b = Math.floor(endExclusive);
    if (!inCalendar(a, 1) || !inCalendar(b, 1)) return NAN_COUNTS;
    if (a <= b) {
      const workingDays = index.count(a, b);
      return { calendar: b - a, working: workingDays, nonWorking: b - a - workingDays };
    }
    const workingDays = index.count(b, a);
    return { calendar: b - a, working: 0 - workingDays, nonWorking: b - a + workingDays };
  };

  const countWorkingDaysInclusive = (start: DayKey, end: DayKey): number => {
    const a = Math.floor(start);
    const b = Math.floor(end);
    if (!inCalendar(a) || !inCalendar(b)) return NaN;
    return b < a ? 0 : index.count(a, b + 1);
  };

  const countWorkingTime = (start: DateTimeMs, end: DateTimeMs): number => {
    if (start > end) return 0 - countWorkingTime(end, start);
    const first = toDayKey(start);
    const last = toDayKey(end);
    if (!inCalendar(first) || !inCalendar(last)) return NaN;
    if (first === last) return working(first) ? end - start : 0;
    index.cover(first, last + 1);
    const lastStart = fromDayKey(last);
    const head = working(first) ? fromDayKey(asDayKey(first + 1)) - start : 0;
    const tail = end > lastStart && working(last) ? end - lastStart : 0;
    return head + index.count(first + 1, last) * DAY + tail;
  };

  const addWorkingDays = (day: DayKey, amount: number): DayKey | undefined => {
    const key = Math.floor(day);
    const n = Math.trunc(amount);
    if (!inCalendar(key) || !Number.isFinite(n)) return undefined;
    if (n === 0) return asDayKey(key);
    return toKey(n > 0 ? index.nthAfter(key, n) : index.nthBefore(key, -n));
  };

  const addWorkingTime = (t: DateTimeMs, ms: number): DateTimeMs | undefined => {
    if (!Number.isFinite(ms)) return undefined;
    const day = toDayKey(t);
    if (!inCalendar(day)) return undefined;
    if (ms === 0) return t;
    const dayStart = fromDayKey(day);
    const onWorkingDay = working(day);
    if (ms > 0) {
      let rest = ms;
      if (onWorkingDay) {
        const available = dayStart + DAY - t;
        if (rest <= available) return asDateTimeMs(t + rest);
        rest -= available;
      }
      // `rest` working ms from the start of the following working days: whole days, then a part.
      const days = Math.ceil(rest / DAY);
      const target = index.nthAfter(day, days);
      return target === undefined
        ? undefined
        : asDateTimeMs(target * DAY + rest - (days - 1) * DAY);
    }
    let rest = -ms;
    if (onWorkingDay) {
      const available = t - dayStart;
      if (rest <= available) return asDateTimeMs(t - rest);
      rest -= available;
    }
    const days = Math.ceil(rest / DAY);
    const target = index.nthBefore(day, days);
    return target === undefined
      ? undefined
      : asDateTimeMs((target + 1) * DAY - (rest - (days - 1) * DAY));
  };

  const nextWorkingDay = (day: DayKey, options?: WorkingDaySearchOptions): DayKey | undefined => {
    const key = Math.floor(day);
    if (!inCalendar(key)) return undefined;
    if (options?.inclusive === true && working(key)) return asDayKey(key);
    return toKey(index.nthAfter(key, 1));
  };

  const prevWorkingDay = (day: DayKey, options?: WorkingDaySearchOptions): DayKey | undefined => {
    const key = Math.floor(day);
    if (!inCalendar(key)) return undefined;
    if (options?.inclusive === true && working(key)) return asDayKey(key);
    return toKey(index.nthBefore(key, 1));
  };

  const rollToWorking = (
    t: DateTimeMs,
    direction: 1 | -1,
    options?: RollToWorkingOptions,
  ): DateTimeMs | undefined => {
    const edge = options?.edge ?? 'start';
    const forward = direction > 0;
    const after = toDayKey(t);
    const before = toDayKey(asDateTimeMs(t - 1));
    const startLike = edge === 'start' || (edge === 'boundary' && forward);
    const day = startLike ? after : before;
    if (!inCalendar(day)) return undefined;
    if (working(day)) return t;
    if (edge === 'boundary') {
      const other = forward ? before : after;
      if (inCalendar(other) && working(other)) return t;
    }
    const target = forward ? index.nthAfter(day, 1) : index.nthBefore(day, 1);
    if (target === undefined) return undefined;
    if (options?.keepTimeOfDay === true) return asDateTimeMs(t + (target - day) * DAY);
    return fromDayKey(asDayKey(startLike ? target : target + 1));
  };

  const workingSpanEnd = (start: DayKey, workingDays: number): DayKey | undefined => {
    const key = Math.floor(start);
    if (!inCalendar(key) || Number.isNaN(workingDays)) return undefined;
    if (workingDays <= 0) return asDayKey(key);
    const n = Math.ceil(workingDays);
    const counted = working(key) ? 1 : 0;
    return n === counted ? asDayKey(key) : toKey(index.nthAfter(key, n - counted));
  };

  const calendar: WorkCalendar = Object.freeze({
    isWorkingDay,
    explain,
    countDays,
    countWorkingDaysInclusive,
    countWorkingTime,
    addWorkingDays,
    addWorkingTime,
    nextWorkingDay,
    prevWorkingDay,
    rollToWorking,
    workingSpanEnd,
  });
  return { calendar, issues };
}

/** The rule chain of FR-CAL-3: exception > holiday > custom rule > weekends. */
function classifier(rules: CalendarRules): DayClassifier {
  const { weekendMask, holidays, exceptions, rule } = rules;
  return (day, weekday): DayCode => {
    if (exceptions.has(day)) return DAY_EXCEPTION;
    if (holidays.has(day)) return DAY_HOLIDAY;
    if (rule !== undefined) {
      const dayKey = asDayKey(day);
      const date = fromDayKey(dayKey);
      const parts = getParts(date);
      const verdict = rule({
        dayKey,
        date,
        weekday,
        year: parts.year,
        month: parts.month,
        day: parts.day,
      });
      if (verdict === true) return DAY_CUSTOM_WORKING;
      if (verdict === false) return DAY_CUSTOM_OFF;
    }
    return ((weekendMask >> weekday) & 1) === 1 ? DAY_WEEKEND : DAY_WORKING;
  };
}

/**
 * Whether a floored day key is inside the calendar (`NaN` is not). `slack` admits keys just past
 * the end, for exclusive range ends.
 */
function inCalendar(key: number, slack = 0): boolean {
  return key >= MIN_DAY_KEY && key <= MAX_DAY_KEY + slack;
}

function toKey(day: number | undefined): DayKey | undefined {
  return day === undefined ? undefined : asDayKey(day);
}

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, asDayKey, DAY, MINUTE } from '../time';
import { MAX_INDEX_DAYS } from './day-index';
import type { CalendarDay, WorkCalendarOptions } from './options';
import { buildWorkCalendar, type WorkCalendar } from './work-calendar';

/** 2026-01-01; generated days lie within ±RANGE days of it. */
const BASE = Date.UTC(2026, 0, 1) / DAY;
const RANGE = 1500;

interface Config {
  readonly weekends: readonly number[];
  readonly holidays: readonly number[];
  readonly exceptions: readonly number[];
  readonly rule: boolean;
  /** Cache cap: tiny caps force the uncached paths. */
  readonly cap: number;
}

/** A pure custom rule: every 11th day off, every 13th day on, otherwise no opinion. */
function rule(day: CalendarDay): boolean | undefined {
  if (day.dayKey % 11 === 0) return false;
  if (day.dayKey % 13 === 0) return true;
  return undefined;
}

const isoDay = (key: number): string => new Date(key * DAY).toISOString().slice(0, 10);

const offset = fc.integer({ min: -RANGE, max: RANGE });
const config: fc.Arbitrary<Config> = fc.record({
  // At most six weekend days, so every week keeps a working day.
  weekends: fc.subarray([0, 1, 2, 3, 4, 5, 6], { maxLength: 6 }),
  holidays: fc.array(
    offset.map((o) => BASE + o),
    { maxLength: 80 },
  ),
  exceptions: fc.array(
    offset.map((o) => BASE + o),
    { maxLength: 20 },
  ),
  rule: fc.boolean(),
  cap: fc.constantFrom(40, 3000, MAX_INDEX_DAYS),
});
const anyDay = offset.map((o) => BASE + o);
/** A floating date-time within the range, minute precision. */
const anyTime = fc
  .integer({ min: -RANGE * 1440, max: RANGE * 1440 })
  .map((minutes) => BASE * DAY + minutes * MINUTE);

/** The calendar under test and an independent oracle of the FR-CAL-3 rule chain. */
function setup(c: Config): { calendar: WorkCalendar; working: (day: number) => boolean } {
  const options: WorkCalendarOptions = {
    weekends: c.weekends,
    holidays: c.holidays.map((key, i) => (i % 2 === 0 ? isoDay(key) : { date: isoDay(key) })),
    workingDays: c.exceptions.map(isoDay),
    isWorkingDay: c.rule ? rule : undefined,
  };
  const { calendar } = buildWorkCalendar(options, c.cap);
  const holidays = new Set(c.holidays);
  const exceptions = new Set(c.exceptions);
  const working = (day: number): boolean => {
    if (exceptions.has(day)) return true;
    if (holidays.has(day)) return false;
    if (c.rule) {
      if (day % 11 === 0) return false;
      if (day % 13 === 0) return true;
    }
    const weekday = (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
    return !c.weekends.includes(weekday);
  };
  return { calendar, working };
}

function naiveCount(working: (day: number) => boolean, start: number, end: number): number {
  let count = 0;
  for (let day = start; day < end; day++) if (working(day)) count++;
  return count;
}

function naiveWorkingTime(working: (day: number) => boolean, start: number, end: number): number {
  // `0 - x`, not `-x`: the calendar never returns negative zero.
  if (start > end) return 0 - naiveWorkingTime(working, end, start);
  let total = 0;
  for (let day = Math.floor(start / DAY); day * DAY < end; day++) {
    if (!working(day)) continue;
    total += Math.min(end, (day + 1) * DAY) - Math.max(start, day * DAY);
  }
  return total;
}

function naiveAddWorkingDays(working: (day: number) => boolean, start: number, n: number): number {
  const step = Math.sign(n);
  let day = start;
  for (let left = Math.abs(n); left > 0;) {
    day += step;
    if (working(day)) left--;
  }
  return day;
}

describe('calendar/WorkCalendar properties', () => {
  it('FR-CAL-4: countDays equals a day-by-day count, in any query order', () => {
    fc.assert(
      fc.property(
        config,
        fc.array(fc.tuple(anyDay, anyDay), { minLength: 1, maxLength: 8 }),
        (c, ranges) => {
          const { calendar, working } = setup(c);
          for (const [a, b] of ranges) {
            const counts = calendar.countDays(asDayKey(a), asDayKey(b));
            const count = naiveCount(working, Math.min(a, b), Math.max(a, b));
            const expected = a <= b ? count : 0 - count;
            expect(counts.calendar).toBe(b - a);
            expect(counts.working).toBe(expected);
            expect(counts.nonWorking).toBe(b - a - expected);
            if (a <= b) {
              const inclusive =
                b > a ? calendar.countWorkingDaysInclusive(asDayKey(a), asDayKey(b - 1)) : 0;
              expect(inclusive).toBe(expected);
            }
          }
        },
      ),
    );
  });

  it('FR-CAL-3/5: isWorkingDay and explain agree with the rule chain', () => {
    fc.assert(
      fc.property(config, fc.array(anyDay, { minLength: 1, maxLength: 20 }), (c, days) => {
        const { calendar, working } = setup(c);
        for (const day of days) {
          expect(calendar.isWorkingDay(asDayKey(day))).toBe(working(day));
          expect(calendar.explain(asDayKey(day)).working).toBe(working(day));
        }
      }),
    );
  });

  it('FR-CAL-5: addWorkingDays matches a day-by-day walk and round-trips between working days', () => {
    fc.assert(
      fc.property(config, anyDay, fc.integer({ min: -40, max: 40 }), (c, start, n) => {
        const { calendar, working } = setup(c);
        const end = calendar.addWorkingDays(asDayKey(start), n);
        expect(end).toBe(n === 0 ? start : naiveAddWorkingDays(working, start, n));
        if (working(start)) expect(calendar.addWorkingDays(end!, -n)).toBe(start);
      }),
    );
  });

  it('FR-CAL-5: nextWorkingDay / prevWorkingDay return a working day and skip none', () => {
    fc.assert(
      fc.property(config, anyDay, fc.boolean(), (c, start, inclusive) => {
        const { calendar, working } = setup(c);
        const next = calendar.nextWorkingDay(asDayKey(start), { inclusive })!;
        const prev = calendar.prevWorkingDay(asDayKey(start), { inclusive })!;
        expect(working(next)).toBe(true);
        expect(working(prev)).toBe(true);
        const first = inclusive ? start : start + 1;
        const last = inclusive ? start : start - 1;
        expect(next).toBeGreaterThanOrEqual(first);
        expect(prev).toBeLessThanOrEqual(last);
        expect(naiveCount(working, first, next)).toBe(0);
        expect(naiveCount(working, prev + 1, last + 1)).toBe(0);
      }),
    );
  });

  it('FR-CAL-10: countWorkingTime matches the overlap with working days and is additive', () => {
    fc.assert(
      fc.property(config, anyTime, anyTime, anyTime, (c, a, b, m) => {
        const { calendar, working } = setup(c);
        const ta = asDateTimeMs(a);
        const tb = asDateTimeMs(b);
        const tm = asDateTimeMs(m);
        expect(calendar.countWorkingTime(ta, tb)).toBe(naiveWorkingTime(working, a, b));
        expect(calendar.countWorkingTime(ta, tm) + calendar.countWorkingTime(tm, tb)).toBe(
          calendar.countWorkingTime(ta, tb),
        );
      }),
    );
  });

  it('FR-CAL-10: addWorkingTime moves by exactly ms of working time, to the first such instant', () => {
    fc.assert(
      fc.property(
        config,
        anyTime,
        fc.integer({ min: -60 * 1440, max: 60 * 1440 }),
        (c, t, minutes) => {
          const { calendar } = setup(c);
          const ms = minutes * MINUTE;
          const start = asDateTimeMs(t);
          const end = calendar.addWorkingTime(start, ms)!;
          expect(calendar.countWorkingTime(start, end)).toBe(ms);
          if (ms > 0) expect(calendar.countWorkingTime(start, asDateTimeMs(end - 1))).toBe(ms - 1);
          if (ms < 0) expect(calendar.countWorkingTime(start, asDateTimeMs(end + 1))).toBe(ms + 1);
          if (ms === 0) expect(end).toBe(start);
        },
      ),
    );
  });

  it('legacy: workingSpanEnd is the first day whose inclusive working count reaches n', () => {
    fc.assert(
      fc.property(config, anyDay, fc.integer({ min: 1, max: 40 }), (c, start, n) => {
        const { calendar, working } = setup(c);
        const end = calendar.workingSpanEnd(asDayKey(start), n)!;
        expect(working(end)).toBe(true);
        expect(calendar.countWorkingDaysInclusive(asDayKey(start), end)).toBe(n);
        expect(naiveCount(working, start, end)).toBe(n - 1);
      }),
    );
  });
});

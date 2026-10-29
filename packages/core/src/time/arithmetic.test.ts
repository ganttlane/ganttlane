import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addQuarters,
  addUnits,
  addWeeks,
  addYears,
  dayOfWeek,
  daysInMonth,
  diffDays,
  diffMonths,
  endOf,
  isLeapYear,
  isoWeek,
  startOf,
  type TimeUnit,
} from './arithmetic';
import { asDateTimeMs, type DateTimeMs, DAY, getParts, utc, type Weekday } from './datetime';

/** `'YYYY-MM-DD'` or `'YYYY-MM-DDTHH:mm[:ss[.sss]]'` read as floating time (UTC encoding). */
function at(iso: string): DateTimeMs {
  const t = Date.parse(iso.includes('T') ? `${iso}Z` : iso);
  if (Number.isNaN(t)) throw new Error(`bad test date ${iso}`);
  return asDateTimeMs(t);
}

/** Floating time as a short ISO string: `YYYY-MM-DD` at midnight, else `…T10:30[:15[.123]]`. */
function show(t: number): string {
  return new Date(t)
    .toISOString()
    .replace(/(:00)?\.000Z$|Z$/, '')
    .replace(/T00:00$/, '');
}

const UNITS: readonly TimeUnit[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Floating date-times in years 1 … 9999. */
const anyDateTime = fc
  .integer({ min: utc(1, 0, 1), max: utc(9999, 11, 31, 23, 59, 59, 999) })
  .map(asDateTimeMs);
const anyUnit = fc.constantFrom(...UNITS);
const anyWeekday = fc.constantFrom(...WEEKDAYS);

describe('time/arithmetic', () => {
  describe('isLeapYear / daysInMonth', () => {
    it.each([
      [1900, false],
      [2000, true],
      [2100, false],
      [2024, true],
      [2026, false],
      [2400, true],
      [0, true],
      [-4, true],
    ])('isLeapYear(%i) = %s', (year, leap) => {
      expect(isLeapYear(year)).toBe(leap);
    });

    it('days in every month of a common year', () => {
      const days = Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1));
      expect(days).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    });

    it.each([
      [2024, 29],
      [2026, 28],
      [1900, 28],
      [2000, 29],
      [2100, 28],
    ])('February %i has %i days', (year, days) => {
      expect(daysInMonth(year, 2)).toBe(days);
    });

    it('NaN for a month outside 1-12', () => {
      expect(daysInMonth(2026, 0)).toBeNaN();
      expect(daysInMonth(2026, 13)).toBeNaN();
    });
  });

  describe('fixed-length units', () => {
    it.each([
      ['2026-03-08T23:50', 15, '2026-03-09T00:05'],
      ['2026-03-08T00:05', -10, '2026-03-07T23:55'],
      ['1970-01-01', -1, '1969-12-31T23:59'],
    ])('addMinutes(%s, %i) = %s', (from, n, expected) => {
      expect(show(addMinutes(at(from), n))).toBe(expected);
    });

    it.each([
      ['2026-03-08T22:00', 3, '2026-03-09T01:00'],
      ['2026-03-08T01:00', -2, '2026-03-07T23:00'],
    ])('addHours(%s, %i) = %s', (from, n, expected) => {
      expect(show(addHours(at(from), n))).toBe(expected);
    });

    it.each([
      // US and EU DST days are plain 24 h days in floating time.
      ['2026-03-07T10:30', 1, '2026-03-08T10:30'],
      ['2026-03-28T10:30', 2, '2026-03-30T10:30'],
      ['2024-02-28', 1, '2024-02-29'],
      ['2026-02-28', 1, '2026-03-01'],
      ['2026-12-31', 1, '2027-01-01'],
      ['2026-01-01', -1, '2025-12-31'],
      ['1970-01-01', -365, '1969-01-01'],
    ])('addDays(%s, %i) = %s', (from, n, expected) => {
      expect(show(addDays(at(from), n))).toBe(expected);
    });

    it.each([
      ['2026-12-28', 1, '2027-01-04'],
      ['2026-01-05T08:00', -2, '2025-12-22T08:00'],
    ])('addWeeks(%s, %i) = %s', (from, n, expected) => {
      expect(show(addWeeks(at(from), n))).toBe(expected);
    });
  });

  describe('calendar units', () => {
    it.each([
      ['2026-01-31', 1, '2026-02-28'],
      ['2024-01-31', 1, '2024-02-29'],
      ['1900-01-31', 1, '1900-02-28'],
      ['2000-01-31', 1, '2000-02-29'],
      ['2100-01-31', 1, '2100-02-28'],
      ['2026-01-31', 2, '2026-03-31'],
      ['2026-03-31', -1, '2026-02-28'],
      ['2026-05-31', 1, '2026-06-30'],
      ['2026-12-15', 1, '2027-01-15'],
      ['2026-01-15', -1, '2025-12-15'],
      ['2026-01-15', 25, '2028-02-15'],
      ['2026-01-15', -13, '2024-12-15'],
      ['2026-01-31T10:30', 1, '2026-02-28T10:30'],
      ['1969-12-31T23:59', 2, '1970-02-28T23:59'],
      ['0050-01-31', 1, '0050-02-28'],
      ['2026-01-31', 1.9, '2026-02-28'],
      ['2026-01-31', 0, '2026-01-31'],
    ])('FR-TIME-4: addMonths(%s, %d) = %s (clamped to month end)', (from, n, expected) => {
      expect(show(addMonths(at(from), n))).toBe(expected);
    });

    it.each([
      ['2026-11-30', 1, '2027-02-28'],
      ['2026-01-15', -1, '2025-10-15'],
      ['2026-03-31', 4, '2027-03-31'],
    ])('addQuarters(%s, %i) = %s', (from, n, expected) => {
      expect(show(addQuarters(at(from), n))).toBe(expected);
    });

    it.each([
      ['2024-02-29', 1, '2025-02-28'],
      ['2024-02-29', 4, '2028-02-29'],
      ['2024-02-29', -1, '2023-02-28'],
      ['2000-02-29', 100, '2100-02-28'],
      ['1896-02-29', 4, '1900-02-28'],
      ['2026-12-31T23:59', 1, '2027-12-31T23:59'],
    ])('addYears(%s, %i) = %s (Feb 29 clamps)', (from, n, expected) => {
      expect(show(addYears(at(from), n))).toBe(expected);
    });
  });

  describe('addUnits', () => {
    it.each([
      ['minute', '2026-03-08T10:02'],
      ['hour', '2026-03-08T12:00'],
      ['day', '2026-03-10T10:00'],
      ['week', '2026-03-22T10:00'],
      ['month', '2026-05-08T10:00'],
      ['quarter', '2026-09-08T10:00'],
      ['year', '2028-03-08T10:00'],
    ] as const)('adds 2 × %s', (unit, expected) => {
      expect(show(addUnits(at('2026-03-08T10:00'), 2, unit))).toBe(expected);
    });

    it('throws for an unknown unit from untyped callers', () => {
      expect(() => addUnits(at('2026-03-08'), 1, 'decade' as never)).toThrow(TypeError);
    });
  });

  describe('startOf / endOf', () => {
    // Wednesday.
    const t = at('2026-08-19T14:37:25.123');

    it.each([
      ['minute', '2026-08-19T14:37', '2026-08-19T14:38'],
      ['hour', '2026-08-19T14:00', '2026-08-19T15:00'],
      ['day', '2026-08-19', '2026-08-20'],
      ['week', '2026-08-17', '2026-08-24'],
      ['month', '2026-08-01', '2026-09-01'],
      ['quarter', '2026-07-01', '2026-10-01'],
      ['year', '2026-01-01', '2027-01-01'],
    ] as const)('%s: [%s, %s) with the default Monday week', (unit, start, end) => {
      expect(show(startOf(t, unit))).toBe(start);
      expect(show(endOf(t, unit))).toBe(end);
    });

    it.each([
      [0, '2026-08-16', '2026-08-23'],
      [1, '2026-08-17', '2026-08-24'],
      [3, '2026-08-19', '2026-08-26'],
      [4, '2026-08-13', '2026-08-20'],
      [6, '2026-08-15', '2026-08-22'],
    ] as const)('week starting on weekday %i: [%s, %s)', (weekStartsOn, start, end) => {
      expect(show(startOf(t, 'week', { weekStartsOn }))).toBe(start);
      expect(show(endOf(t, 'week', { weekStartsOn }))).toBe(end);
    });

    it.each([
      ['2027-01-01', 'week', 1, '2026-12-28', '2027-01-04'],
      ['2027-01-01', 'week', 0, '2026-12-27', '2027-01-03'],
      ['2026-12-31T23:59', 'quarter', 1, '2026-10-01', '2027-01-01'],
      ['2026-04-01', 'quarter', 1, '2026-04-01', '2026-07-01'],
      ['2026-03-31T23:59', 'quarter', 1, '2026-01-01', '2026-04-01'],
      ['2026-12-31T23:59:59.999', 'year', 1, '2026-01-01', '2027-01-01'],
      ['2024-02-29T12:00', 'month', 1, '2024-02-01', '2024-03-01'],
      ['1969-12-31T12:00', 'day', 1, '1969-12-31', '1970-01-01'],
      ['1969-12-31T12:00', 'week', 1, '1969-12-29', '1970-01-05'],
    ] as const)(
      'boundary %s %s (week start %i): [%s, %s)',
      (from, unit, weekStartsOn, start, end) => {
        expect(show(startOf(at(from), unit, { weekStartsOn }))).toBe(start);
        expect(show(endOf(at(from), unit, { weekStartsOn }))).toBe(end);
      },
    );

    it('sub-day units before 1970', () => {
      expect(show(startOf(at('1969-12-31T23:59:30'), 'minute'))).toBe('1969-12-31T23:59');
      expect(show(startOf(at('1969-12-31T23:59:30'), 'hour'))).toBe('1969-12-31T23:00');
    });

    it('throws for an unknown unit from untyped callers', () => {
      expect(() => startOf(t, 'decade' as never)).toThrow(TypeError);
    });

    it('property: startOf is idempotent and startOf(t) <= t < endOf(t)', () => {
      fc.assert(
        fc.property(anyDateTime, anyUnit, anyWeekday, (time, unit, weekStartsOn) => {
          const options = { weekStartsOn };
          const start = startOf(time, unit, options);
          const end = endOf(time, unit, options);
          return (
            startOf(start, unit, options) === start &&
            start <= time &&
            time < end &&
            startOf(end, unit, options) === end
          );
        }),
      );
    });

    it('property: a week starts on weekStartsOn at midnight', () => {
      fc.assert(
        fc.property(anyDateTime, anyWeekday, (time, weekStartsOn) => {
          const start = startOf(time, 'week', { weekStartsOn });
          return dayOfWeek(start) === weekStartsOn && getParts(start).hour === 0;
        }),
      );
    });
  });

  describe('dayOfWeek / isoWeek', () => {
    it.each([
      ['1970-01-01', 4],
      ['1969-12-31', 3],
      ['2026-03-08T23:59', 0],
      ['2000-01-01', 6],
      ['1900-01-01', 1],
      ['2026-08-19', 3],
    ])('dayOfWeek(%s) = %i', (date, weekday) => {
      expect(dayOfWeek(at(date))).toBe(weekday);
    });

    it('property: dayOfWeek matches Date.prototype.getUTCDay', () => {
      fc.assert(fc.property(anyDateTime, (t) => dayOfWeek(t) === new Date(t).getUTCDay()));
    });

    it.each([
      ['2026-12-31', 2026, 53],
      ['2027-01-01', 2026, 53],
      ['2027-01-03', 2026, 53],
      ['2027-01-04', 2027, 1],
      ['2020-12-31', 2020, 53],
      ['2021-01-01', 2020, 53],
      ['2019-12-30', 2020, 1],
      ['2026-01-01', 2026, 1],
      ['2025-12-29', 2026, 1],
      ['2026-03-08T23:59', 2026, 10],
      ['2024-12-30', 2025, 1],
      ['2010-01-03', 2009, 53],
      ['1969-12-29', 1970, 1],
    ])('isoWeek(%s) = %i-W%i', (date, year, week) => {
      expect(isoWeek(at(date))).toEqual({ year, week });
    });

    it('property: isoWeek is constant within a Monday week and in 1-53', () => {
      fc.assert(
        fc.property(anyDateTime, (t) => {
          const week = isoWeek(t);
          const monday = startOf(t, 'week', { weekStartsOn: 1 });
          const sunday = addDays(monday, 6);
          return (
            week.week >= 1 &&
            week.week <= 53 &&
            Math.abs(week.year - getParts(t).year) <= 1 &&
            JSON.stringify(isoWeek(monday)) === JSON.stringify(week) &&
            JSON.stringify(isoWeek(sunday)) === JSON.stringify(week)
          );
        }),
      );
    });
  });

  describe('diffDays / diffMonths', () => {
    it.each([
      ['2026-03-08', '2026-03-08T23:59', 0],
      ['2026-03-09T23:00', '2026-03-10T01:00', 1],
      ['2026-03-10T01:00', '2026-03-09T23:00', -1],
      ['2026-01-01', '2027-01-01', 365],
      ['2024-01-01', '2025-01-01', 366],
      ['1969-12-31T23:00', '1970-01-01T01:00', 1],
    ])('diffDays(%s, %s) = %i', (start, end, days) => {
      expect(diffDays(at(start), at(end))).toBe(days);
    });

    it.each([
      ['2026-01-31', '2026-02-28', 1],
      ['2026-01-31', '2026-02-27', 0],
      ['2026-01-15', '2026-02-14', 0],
      ['2026-01-15', '2026-02-15', 1],
      ['2026-01-15T10:00', '2026-02-15T09:59', 0],
      ['2026-01-15T10:00', '2026-02-15T10:00', 1],
      ['2026-01-01', '2027-01-01', 12],
      ['2024-02-29', '2025-02-28', 12],
      ['2026-03-31', '2026-02-28', -1],
      ['2027-01-01', '2026-01-01', -12],
      ['2026-03-08', '2026-03-08', 0],
      ['1969-11-30', '1970-02-28', 3],
      ['1969-11-30', '1970-02-27', 2],
    ])('diffMonths(%s, %s) = %i', (start, end, months) => {
      expect(diffMonths(at(start), at(end))).toBe(months);
    });

    it('diffMonths never returns -0', () => {
      expect(Object.is(diffMonths(at('2026-02-27'), at('2026-01-31')), 0)).toBe(true);
    });

    it('property: diffMonths is antisymmetric and brackets end', () => {
      fc.assert(
        fc.property(anyDateTime, anyDateTime, (a, b) => {
          const n = diffMonths(a, b);
          if (n !== 0 - diffMonths(b, a)) return false;
          const [start, end, months] = a <= b ? [a, b, n] : [b, a, -n];
          return addMonths(start, months) <= end && addMonths(start, months + 1) > end;
        }),
      );
    });

    it('property: diffDays(t, addDays(t, n)) === n', () => {
      fc.assert(
        fc.property(anyDateTime, fc.integer({ min: -100_000, max: 100_000 }), (t, n) => {
          return diffDays(t, addDays(t, n)) === n;
        }),
      );
    });
  });

  describe('ADR-018: beyond the AD 1-9999 range of @internationalized/date', () => {
    /** Floating date-times across the `Date` range (about ±266 000 years, leaving headroom). */
    const fullRange = fc.integer({ min: -8.4e15, max: 8.4e15 }).map(asDateTimeMs);

    it.each([
      [0, true],
      [-1, false],
      [-100, false],
      [-400, true],
      [10_000, true],
      [10_100, false],
    ])('isLeapYear(%i) = %s', (year, leap) => {
      expect(isLeapYear(year)).toBe(leap);
    });

    it.each([
      [0, 2, 29],
      [-1, 2, 28],
      [10_000, 2, 29],
      [-271_820, 12, 31],
    ])('daysInMonth(%i, %i) = %i', (year, month, days) => {
      expect(daysInMonth(year, month)).toBe(days);
    });

    it('daysInMonth is NaN for a fractional month', () => {
      expect(daysInMonth(2026, 1.5)).toBeNaN();
    });

    it.each([
      ['9999-12-31', 1, '+010000-01-31'],
      ['9999-01-31', 13, '+010000-02-29'],
      ['0000-01-31', 1, '0000-02-29'],
      ['0001-03-31', -13, '0000-02-29'],
      ['-000001-03-31', -1, '-000001-02-28'],
      ['2024-02-29', 120_000, '+012024-02-29'],
      ['2024-02-29', -4801, '1624-01-29'],
      ['2026-01-31T10:30', 4800 * 5 + 1, '4026-02-28T10:30'],
    ])('addMonths(%s, %i) = %s', (from, n, expected) => {
      expect(show(addMonths(at(from), n))).toBe(expected);
    });

    it.each([
      ['+010000-03-15T12:00', 'week', '+010000-03-13'],
      ['+010000-12-31T12:00', 'year', '+010000-01-01'],
      ['0000-02-29T12:00', 'month', '0000-02-01'],
      ['-000001-11-15', 'quarter', '-000001-10-01'],
    ] as const)('startOf(%s, %s) = %s', (from, unit, expected) => {
      expect(show(startOf(at(from), unit))).toBe(expected);
    });

    it('endOf the year 9999 is 10000-01-01', () => {
      expect(show(endOf(at('9999-06-15'), 'year'))).toBe('+010000-01-01');
    });

    it('property: dayOfWeek matches getUTCDay across the whole Date range', () => {
      fc.assert(fc.property(fullRange, (t) => dayOfWeek(t) === new Date(t).getUTCDay()));
    });

    it('property: addMonths lands exactly n months later across the whole Date range', () => {
      fc.assert(
        fc.property(fullRange, fc.integer({ min: -50_000, max: 50_000 }), (t, n) => {
          const before = getParts(t);
          const after = getParts(addMonths(t, n));
          const monthIndex = before.year * 12 + before.month - 1 + n;
          return (
            after.year * 12 + after.month - 1 === monthIndex &&
            after.day === Math.min(before.day, daysInMonth(after.year, after.month)) &&
            after.hour === before.hour &&
            after.minute === before.minute
          );
        }),
      );
    });

    it('property: startOf is idempotent across the whole Date range', () => {
      fc.assert(
        fc.property(fullRange, anyUnit, anyWeekday, (time, unit, weekStartsOn) => {
          const start = startOf(time, unit, { weekStartsOn });
          return (
            start <= time &&
            time < endOf(time, unit, { weekStartsOn }) &&
            startOf(start, unit, { weekStartsOn }) === start
          );
        }),
      );
    });
  });

  describe('properties', () => {
    const amount = fc.integer({ min: -2000, max: 2000 });

    it('FR-TIME-2: addDays / addHours / addMinutes round-trip exactly', () => {
      fc.assert(
        fc.property(anyDateTime, amount, (t, n) => {
          return (
            addDays(addDays(t, n), -n) === t &&
            addHours(addHours(t, n), -n) === t &&
            addMinutes(addMinutes(t, n), -n) === t &&
            addWeeks(addWeeks(t, n), -n) === t
          );
        }),
      );
    });

    it('FR-TIME-2: addDays keeps the time of day', () => {
      fc.assert(
        fc.property(anyDateTime, amount, (t, n) => {
          const before = getParts(t);
          const after = getParts(addDays(t, n));
          return after.hour === before.hour && after.minute === before.minute;
        }),
      );
    });

    it('addMonths lands exactly n months later, never in the month after that', () => {
      fc.assert(
        fc.property(anyDateTime, fc.integer({ min: -1200, max: 1200 }), (t, n) => {
          const before = getParts(t);
          const after = getParts(addMonths(t, n));
          const monthIndex = before.year * 12 + before.month - 1 + n;
          return (
            after.year * 12 + after.month - 1 === monthIndex &&
            after.day <= before.day &&
            after.hour === before.hour &&
            after.minute === before.minute
          );
        }),
      );
    });

    it('addMonths round-trips for days 1-28', () => {
      fc.assert(
        fc.property(anyDateTime, fc.integer({ min: -1200, max: 1200 }), (t, n) => {
          fc.pre(getParts(t).day <= 28);
          return addMonths(addMonths(t, n), -n) === t;
        }),
      );
    });

    it('endOf is startOf of the next unit (exclusive end)', () => {
      fc.assert(
        fc.property(anyDateTime, anyUnit, (t, unit) => {
          const end = endOf(t, unit);
          return end === addUnits(startOf(t, unit), 1, unit) && end - DAY * 366 < t;
        }),
      );
    });
  });
});

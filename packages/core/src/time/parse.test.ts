import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { startOf } from './arithmetic';
import { asDateTimeMs, type DateTimeMs, fromParts, HOUR, utc } from './datetime';
import { type DateInput, parseDateInput, toDate, toISODate, toISODateTime } from './parse';

const floating = (...args: Parameters<typeof Date.UTC>): DateTimeMs =>
  asDateTimeMs(Date.UTC(...args));

/** Unwraps a successful parse or fails the test with the issue. */
function parsed(value: DateInput): { value: number; precision: string } {
  const result = parseDateInput(value);
  if (!result.ok) throw new Error(`expected ${String(value)} to parse: ${result.issue.message}`);
  return result.value;
}

function issueOf(value: unknown): { code: string; message: string; value?: unknown } {
  const result = parseDateInput(value as DateInput);
  if (result.ok) throw new Error(`expected ${String(value)} to be rejected`);
  return result.issue;
}

describe('time/parse', () => {
  describe('FR-TIME-1: ISO strings', () => {
    it.each([
      ['2026-03-08', floating(2026, 2, 8), 'day'],
      ['2024-02-29', floating(2024, 1, 29), 'day'],
      ['2000-02-29', floating(2000, 1, 29), 'day'],
      ['0001-01-01', utc(1, 0, 1), 'day'],
      ['0050-06-15', utc(50, 5, 15), 'day'],
      ['2026-03-08T00:00', floating(2026, 2, 8), 'time'],
      ['2026-03-08 00:00', floating(2026, 2, 8), 'time'],
      ['2026-03-08T10:30', floating(2026, 2, 8, 10, 30), 'time'],
      ['2026-03-08 10:30', floating(2026, 2, 8, 10, 30), 'time'],
      ['2026-03-08T10:30:15', floating(2026, 2, 8, 10, 30, 15), 'time'],
      ['2026-03-08T10:30:15.5', floating(2026, 2, 8, 10, 30, 15, 500), 'time'],
      ['2026-03-08T10:30:15.123', floating(2026, 2, 8, 10, 30, 15, 123), 'time'],
      ['2026-03-08T10:30:15.123999', floating(2026, 2, 8, 10, 30, 15, 123), 'time'],
      ['9999-12-31T23:59:59.999', floating(9999, 11, 31, 23, 59, 59, 999), 'time'],
    ])('accepts %s', (input, value, precision) => {
      expect(parseDateInput(input)).toEqual({ ok: true, value: { value, precision } });
    });

    it.each([
      ['2026-02-30', '2026-02 has no day 30 (it has 28 days)'],
      ['2026-02-29', '2026-02 has no day 29 (it has 28 days)'],
      ['1900-02-29', '1900-02 has no day 29'],
      ['2100-02-29', '2100-02 has no day 29'],
      ['2026-04-31', '2026-04 has no day 31 (it has 30 days)'],
      ['2026-01-00', '2026-01 has no day 00'],
      ['2026-13-01', 'month 13 is out of range'],
      ['2026-00-10', 'month 00 is out of range'],
      ['2026-01-05T25:00', 'hour 25 is out of range'],
      ['2026-01-05T24:00', 'hour 24 is out of range'],
      ['2026-01-05T10:60', 'minute 60 is out of range'],
      ['2026-01-05T10:00:60', 'second 60 is out of range'],
    ])('FR-TIME-1: rejects %s as invalid-date (%s)', (input, reason) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-date', severity: 'error', value: input });
      expect(issue.message).toContain(JSON.stringify(input));
      expect(issue.message).toContain(reason);
    });

    it.each([
      '',
      'foo',
      'March 8, 2026',
      '2026-3-8',
      '20260308',
      '2026/03/08',
      ' 2026-03-08',
      '2026-03-08 ',
      '2026-03-08T10',
      '2026-03-08T1:00',
      '2026-03-08T10:00:00.',
      '2026-03-08t10:00',
      '2026-03-08  10:00',
      '+002026-03-08',
      '2026-03-08Z',
    ])('FR-TIME-1: rejects garbage %j with the expected formats', (input) => {
      const issue = issueOf(input);
      expect(issue.code).toBe('invalid-date');
      expect(issue.message).toContain('expected "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss[.sss]]"');
    });

    it.each([
      '2026-03-08T10:00Z',
      '2026-03-08T10:00:00z',
      '2026-03-08T10:00:00.000Z',
      '2026-03-08T10:00+02:00',
      '2026-03-08T10:00:00-0500',
      '2026-03-08 10:00+05',
      '2026-02-30T10:00Z',
    ])('rejects %s with unsupported-offset', (input) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'unsupported-offset', value: input });
      expect(issue.message).toContain('new Date(value)');
    });
  });

  describe('ADR-018: ISO strings through @internationalized/date', () => {
    it.each([
      ['0000-02-29', utc(0, 1, 29), 'day'],
      ['0000-02-29T10:00', utc(0, 1, 29, 10), 'time'],
      ['0000-01-01', utc(0, 0, 1), 'day'],
      ['0001-01-01T00:00', utc(1, 0, 1), 'time'],
      ['9999-12-31', floating(9999, 11, 31), 'day'],
    ])('accepts %s (years the library alone misreads)', (input, value, precision) => {
      expect(parseDateInput(input)).toEqual({ ok: true, value: { value, precision } });
    });

    it.each([
      ['2026-01-00T10:00', '2026-01 has no day 00 (it has 31 days)'],
      ['0000-02-30', '0000-02 has no day 30 (it has 29 days)'],
      ['0100-02-29T10:00', '0100-02 has no day 29 (it has 28 days)'],
      ['2026-02-29T24:00', '2026-02 has no day 29'],
      ['2026-13-40T10:00', 'month 13 is out of range'],
    ])('rejects %s (%s)', (input, reason) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-date', value: input });
      expect(issue.message).toContain(reason);
    });
  });

  describe('FR-TIME-1: Date and epoch ms', () => {
    it('reads the local wall clock of a Date', () => {
      expect(parsed(new Date(2026, 2, 8))).toEqual({
        value: floating(2026, 2, 8),
        precision: 'day',
      });
      expect(parsed(new Date(2026, 2, 8, 14, 5, 6, 7))).toEqual({
        value: floating(2026, 2, 8, 14, 5, 6, 7),
        precision: 'time',
      });
      expect(parsed(new Date(2026, 2, 8, 0, 0, 0, 1)).precision).toBe('time');
    });

    it('reads epoch ms through the local wall clock', () => {
      expect(parsed(new Date(2026, 2, 8).getTime())).toEqual({
        value: floating(2026, 2, 8),
        precision: 'day',
      });
      expect(parsed(new Date(2026, 2, 8, 9, 15).getTime())).toEqual({
        value: floating(2026, 2, 8, 9, 15),
        precision: 'time',
      });
    });

    it('keeps years 0-99 of a Date', () => {
      const date = new Date(2000, 5, 15);
      date.setFullYear(50, 5, 15);
      expect(parsed(date)).toEqual({ value: utc(50, 5, 15), precision: 'day' });
    });

    it.each([
      [Number.NaN, 'must be finite'],
      [Number.POSITIVE_INFINITY, 'must be finite'],
      [Number.NEGATIVE_INFINITY, 'must be finite'],
      [8.64e15 + 1, 'outside the range'],
      [-8.64e15 - 1, 'outside the range'],
    ])('rejects epoch %d as invalid-date', (input, reason) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-date' });
      expect(issue.message).toContain(reason);
    });

    it('rejects an invalid Date', () => {
      const date = new Date(Number.NaN);
      expect(issueOf(date)).toMatchObject({ code: 'invalid-date', value: date });
    });

    it('accepts or rejects the edge of the Date range depending on the zone, never throws', () => {
      for (const edge of [8.64e15, -8.64e15]) {
        const result = parseDateInput(new Date(edge));
        if (result.ok) expect(Math.abs(result.value.value)).toBeLessThanOrEqual(8.64e15);
        else expect(result.issue.message).toContain('outside the range');
      }
    });

    it.each([
      [null, 'null'],
      [undefined, 'undefined'],
      [true, 'true'],
      [{}, 'an object'],
      [[], 'an array'],
      [Symbol('x'), 'a symbol'],
    ])('rejects %s from untyped callers without throwing', (input, described) => {
      const issue = issueOf(input);
      expect(issue.code).toBe('invalid-date');
      expect(issue.message).toContain(`Invalid date ${described}`);
    });
  });

  it('puts options.path into the issue', () => {
    const result = parseDateInput('2026-02-30', { path: 'start' });
    expect(result).toMatchObject({ ok: false, issue: { code: 'invalid-date', path: 'start' } });
    expect(parseDateInput('2026-02-28', { path: 'start' }).ok).toBe(true);
    expect(parseDateInput('nope')).not.toHaveProperty('issue.path');
  });

  describe('FR-TIME-8: output', () => {
    it.each([
      [floating(2026, 2, 8), '2026-03-08', '2026-03-08T00:00'],
      [floating(2026, 2, 8, 10, 30), '2026-03-08', '2026-03-08T10:30'],
      [floating(2026, 2, 8, 10, 30, 15), '2026-03-08', '2026-03-08T10:30:15'],
      [floating(2026, 2, 8, 10, 30, 0, 7), '2026-03-08', '2026-03-08T10:30:00.007'],
      [utc(50, 0, 2), '0050-01-02', '0050-01-02T00:00'],
      [utc(-1, 11, 31), '-000001-12-31', '-000001-12-31T00:00'],
      [utc(10000, 0, 1), '+010000-01-01', '+010000-01-01T00:00'],
    ])('toISODate / toISODateTime of %d', (t, date, dateTime) => {
      expect(toISODate(asDateTimeMs(t))).toBe(date);
      expect(toISODateTime(asDateTimeMs(t))).toBe(dateTime);
    });

    it('FR-TIME-2: toDate builds a local Date with the same wall clock', () => {
      const date = toDate(floating(2026, 2, 8, 14, 5, 6, 7));
      expect([
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds(),
      ]).toEqual([2026, 2, 8, 14, 5, 6, 7]);
    });

    it('toDate keeps years 0-99', () => {
      const date = toDate(asDateTimeMs(utc(50, 5, 15, 12)));
      expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
        50, 5, 15, 12,
      ]);
    });
  });

  describe('properties', () => {
    /** Minute-aligned and arbitrary floating date-times in years 0 … 9999. */
    const anyDateTime = fc
      .integer({ min: utc(0, 0, 1), max: utc(9999, 11, 31, 23, 59, 59, 999) })
      .map(asDateTimeMs);

    it('FR-TIME-1: toISODateTime → parseDateInput gives the same ms (precision time)', () => {
      fc.assert(
        fc.property(anyDateTime, (t) => {
          const result = parseDateInput(toISODateTime(t));
          return result.ok && result.value.value === t && result.value.precision === 'time';
        }),
      );
    });

    it('FR-TIME-1: toISODate → parseDateInput gives the start of the day (precision day)', () => {
      fc.assert(
        fc.property(anyDateTime, (t) => {
          const result = parseDateInput(toISODate(t));
          return (
            result.ok &&
            result.value.value === startOf(t, 'day') &&
            result.value.precision === 'day'
          );
        }),
      );
    });

    it('never throws, whatever the input', () => {
      fc.assert(
        fc.property(fc.anything(), fc.string(), (value, text) => {
          parseDateInput(value as DateInput);
          parseDateInput(text);
        }),
      );
    });
  });
});

/**
 * Run in several runtime time zones by `pnpm test:tz` (UTC, America/New_York, America/Santiago,
 * Europe/Kyiv, Asia/Kolkata, Pacific/Chatham). Every expectation is a fixed floating value, so
 * passing in all zones means the results are identical across zones.
 */
describe('FR-TIME-2: runtime time zone independence', () => {
  // US DST starts 2026-03-08, EU DST 2026-03-29; US ends 2026-11-01, EU 2026-10-25. Chile's DST
  // starts at midnight (Saturday 24:00): on 2026-09-06 Santiago's day begins at 01:00.
  const dstDays = [
    [2026, 2, 8],
    [2026, 2, 29],
    [2026, 8, 6],
    [2026, 9, 25],
    [2026, 10, 1],
  ] as const;

  it.each(dstDays)('date-only %i-%i-%i is the same floating day in every zone', (y, m, d) => {
    const expected = { value: floating(y, m, d), precision: 'day' };
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    expect(parsed(iso)).toEqual(expected);
    expect(parsed(new Date(y, m, d))).toEqual(expected);
    expect(parsed(new Date(y, m, d).getTime())).toEqual(expected);
  });

  it.each(dstDays)('noon of %i-%i-%i round-trips through Date in every zone', (y, m, d) => {
    const t = floating(y, m, d, 12);
    expect(parsed(new Date(y, m, d, 12))).toEqual({ value: t, precision: 'time' });
    expect(parsed(toDate(t))).toEqual({ value: t, precision: 'time' });
    expect(parsed(toDate(floating(y, m, d)))).toEqual({
      value: floating(y, m, d),
      precision: 'day',
    });
  });

  it('DST gap at midnight: the start of a day that begins at 01:00 is still date-only', () => {
    // In America/Santiago `new Date(2026, 8, 6)` is 01:00 local; in other zones it is 00:00.
    const dayStart = new Date(2026, 8, 6);
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Santiago') {
      expect(dayStart.getHours()).toBe(1);
    }
    const expected = { value: floating(2026, 8, 6), precision: 'day' };
    expect(parsed(dayStart)).toEqual(expected);
    expect(parsed(dayStart.getTime())).toEqual(expected);
    expect(parsed(toDate(floating(2026, 8, 6)))).toEqual(expected);
    // One millisecond later it carries a time of day (01:00:00.001 in Santiago).
    const later = parsed(new Date(dayStart.getTime() + 1));
    expect(later.precision).toBe('time');
    expect(later.value - floating(2026, 8, 6, dayStart.getHours())).toBe(1);
    // The day before ends normally.
    expect(parsed(new Date(2026, 8, 5, 23, 59))).toEqual({
      value: floating(2026, 8, 5, 23, 59),
      precision: 'time',
    });
  });

  it('a wall-clock time in a DST gap moves forward by at most the gap', () => {
    // 02:30 does not exist in New York on 2026-03-08; elsewhere it does.
    const t = floating(2026, 2, 8, 2, 30);
    const back = parsed(toDate(t)).value;
    expect(back - t).toBeGreaterThanOrEqual(0);
    expect(back - t).toBeLessThanOrEqual(HOUR);
  });

  it('property: toDate → parseDateInput round-trips for times outside DST-gap hours', () => {
    // 1970-2100 transitions in the tested zones happen between 00:00 and 04:00 local time.
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 5, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (year, month, day, hour, minute) => {
          const t = fromParts({ year, month, day, hour, minute });
          return parsed(toDate(t)).value === t;
        },
      ),
    );
  });

  it('property: date-only values round-trip through Date at midnight (2000-2100)', () => {
    // Before 1984 the USSR (and so Europe/Kyiv) switched DST at midnight.
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const midnight = fromParts({ year, month, day });
          const back = parseDateInput(toDate(midnight));
          return back.ok && back.value.value === midnight && back.value.precision === 'day';
        },
      ),
    );
  });

  it('property: toDate → parseDateInput never moves a value back or by more than an hour', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: utc(1970, 0, 1), max: utc(2100, 0, 1) }).map(asDateTimeMs),
        (t) => {
          const delta = parsed(toDate(t)).value - t;
          return delta >= 0 && delta <= HOUR;
        },
      ),
    );
  });
});

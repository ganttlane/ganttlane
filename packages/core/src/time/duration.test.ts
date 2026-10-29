import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, DAY, HOUR, MINUTE } from './datetime';
import {
  addDuration,
  compareFixed,
  type Duration,
  type DurationInput,
  durationToString,
  isZeroDuration,
  negate,
  parseDuration,
} from './duration';

function issueOf(input: unknown): { code: string; message: string; value?: unknown } {
  const result = parseDuration(input as DurationInput);
  if (result.ok) throw new Error(`expected ${String(input)} to be rejected`);
  return result.issue;
}

const at = (iso: string) => asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

describe('time/duration', () => {
  describe('FR-TIME-4: string form', () => {
    it.each([
      ['1y', 12, 0],
      ['1q', 3, 0],
      ['1mo', 1, 0],
      ['2w', 0, 14 * DAY],
      ['3d', 0, 3 * DAY],
      ['6h', 0, 6 * HOUR],
      ['30min', 0, 30 * MINUTE],
      ['1d 4h', 0, DAY + 4 * HOUR],
      ['4h 1d', 0, DAY + 4 * HOUR],
      ['1y 1q 1mo 1w 1d 1h 1min', 16, 8 * DAY + HOUR + MINUTE],
      ['1440min', 0, DAY],
      ['01d', 0, DAY],
      ['0d', 0, 0],
    ])('accepts %j', (input, months, ms) => {
      expect(parseDuration(input)).toEqual({ ok: true, value: { months, ms } });
    });

    it.each(['5m', '1d 5m'])('FR-TIME-4: rejects ambiguous "m" in %j with a hint', (input) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-duration', severity: 'error', value: input });
      expect(issue.message).toContain('"m" is ambiguous');
      expect(issue.message).toContain('"mo" for months or "min" for minutes');
    });

    it.each([
      ['', 'expected space-separated tokens'],
      [' ', 'separate tokens with single spaces'],
      ['1d  4h', 'separate tokens with single spaces'],
      [' 1d', 'separate tokens with single spaces'],
      ['1d ', 'separate tokens with single spaces'],
      ['30s', 'seconds are not supported'],
      ['1sec', 'seconds are not supported'],
      ['500ms', 'seconds are not supported'],
      ['1D', 'unknown unit "D"'],
      ['2days', 'unknown unit "days"'],
      ['1M', 'unknown unit "M"'],
      ['-1d', 'non-negative'],
      ['+1d', 'expected space-separated tokens'],
      ['1.5d', 'whole numbers'],
      ['1,5d', 'whole numbers'],
      ['1 d', 'expected space-separated tokens'],
      ['d', 'expected space-separated tokens'],
      ['12', 'expected space-separated tokens'],
      ['1d 1d', 'unit "d" appears more than once'],
      ['1d 2h 3d', 'unit "d" appears more than once'],
      ['99999999999999999999d', 'too large'],
    ])('FR-TIME-4: rejects %j (%s)', (input, hint) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-duration', value: input });
      expect(issue.message).toContain(hint);
    });
  });

  describe('FR-TIME-4: ISO 8601 form (ADR-018)', () => {
    it.each([
      ['P1DT4H', 0, DAY + 4 * HOUR],
      ['P2W', 0, 14 * DAY],
      ['P1M', 1, 0],
      ['PT1M', 0, MINUTE],
      ['PT90M', 0, 90 * MINUTE],
      ['PT36H', 0, 36 * HOUR],
      ['P1Y', 12, 0],
      ['P1Y2M3W4DT5H6M', 14, 25 * DAY + 5 * HOUR + 6 * MINUTE],
      ['P0D', 0, 0],
      ['P01D', 0, DAY],
    ])('accepts %j', (input, months, ms) => {
      expect(parseDuration(input)).toEqual({ ok: true, value: { months, ms } });
    });

    it('agrees with the short form', () => {
      expect(parseDuration('P1Y1M1W1DT1H1M')).toEqual(parseDuration('1y 1mo 1w 1d 1h 1min'));
    });

    it.each([
      ['P1DT30S', 'seconds are not supported'],
      ['PT0S', 'seconds are not supported'],
      ['PT1.5S', 'seconds are not supported'],
      ['PT1.5H', 'whole numbers'],
      ['PT0,5H', 'whole numbers'],
      ['P', 'expected an ISO 8601 duration'],
      ['PT', 'expected an ISO 8601 duration'],
      ['P1DT', 'expected an ISO 8601 duration'],
      ['PY1D', 'expected an ISO 8601 duration'],
      ['PT1HM', 'expected an ISO 8601 duration'],
      ['P1.5D', 'expected an ISO 8601 duration'],
      ['P1D4H', 'expected an ISO 8601 duration'],
      ['P1D 4h', 'expected an ISO 8601 duration'],
      ['P1H', 'expected an ISO 8601 duration'],
      ['p1d', 'expected space-separated tokens'],
      ['-P1D', 'non-negative'],
      ['+P1D', 'expected space-separated tokens'],
      ['P99999999999999999999D', 'too large'],
    ])('rejects %j (%s)', (input, hint) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-duration', severity: 'error', value: input });
      expect(issue.message).toContain(hint);
    });

    it('puts options.path into the issue', () => {
      expect(parseDuration('PT30S', { path: 'lag' })).toMatchObject({
        ok: false,
        issue: { code: 'invalid-duration', path: 'lag' },
      });
    });
  });

  describe('FR-TIME-4: object form', () => {
    it.each([
      [{ hours: 4 }, 0, 4 * HOUR],
      [{ years: 1, quarters: 1, months: 1 }, 16, 0],
      [{ weeks: 1, days: 1, hours: 1, minutes: 1 }, 0, 8 * DAY + HOUR + MINUTE],
      [{ days: 0 }, 0, 0],
      [{ days: 2, hours: undefined }, 0, 2 * DAY],
    ])('accepts %o', (input, months, ms) => {
      expect(parseDuration(input as DurationInput)).toEqual({ ok: true, value: { months, ms } });
    });

    it.each([
      [{}, 'sets no field'],
      [{ days: undefined }, 'sets no field'],
      [{ seconds: 5 }, 'unknown field "seconds"'],
      [{ day: 1 }, 'unknown field "day"'],
      [{ days: -1 }, '"days" must be a non-negative integer, got -1'],
      [{ days: 1.5 }, 'got 1.5'],
      [{ days: '1' }, 'got "1"'],
      [{ days: Number.NaN }, 'got NaN'],
      [{ days: Number.POSITIVE_INFINITY }, 'got Infinity'],
      [{ days: null }, 'got null'],
      [{ years: Number.MAX_SAFE_INTEGER }, 'too large'],
    ])('rejects %o (%s)', (input, hint) => {
      const issue = issueOf(input);
      expect(issue).toMatchObject({ code: 'invalid-duration', value: input });
      expect(issue.message).toContain(hint);
    });
  });

  it.each([
    [3, 'plain numbers are accepted only where they mean days'],
    [null, 'expected a string such as "1d 4h" or an object'],
    [undefined, 'expected a string'],
    [[], 'expected a string'],
    [true, 'expected a string'],
  ])('rejects %o from untyped callers without throwing', (input, hint) => {
    expect(issueOf(input).message).toContain(hint);
  });

  it('puts options.path into the issue', () => {
    expect(parseDuration('5m', { path: 'duration' })).toMatchObject({
      ok: false,
      issue: { code: 'invalid-duration', path: 'duration' },
    });
    expect(parseDuration('5min', { path: 'duration' }).ok).toBe(true);
  });

  describe('helpers', () => {
    const oneMonthOneDay: Duration = { months: 1, ms: DAY };

    it.each([
      ['2026-01-31', 1, '2026-03-01'],
      ['2026-01-31T10:00', 1, '2026-03-01T10:00'],
      ['2026-03-31', -1, '2026-02-27'],
    ] as const)('addDuration(%s, 1mo 1d, %i) applies months first', (from, sign, expected) => {
      expect(addDuration(at(from), oneMonthOneDay, sign)).toBe(at(expected));
    });

    it('addDuration adds by default', () => {
      expect(addDuration(at('2026-03-08'), { months: 0, ms: 6 * HOUR })).toBe(
        at('2026-03-08T06:00'),
      );
    });

    it('negate flips both parts and never yields -0', () => {
      expect(negate({ months: 2, ms: -HOUR })).toEqual({ months: -2, ms: HOUR });
      const zero = negate({ months: 0, ms: 0 });
      expect(Object.is(zero.months, 0) && Object.is(zero.ms, 0)).toBe(true);
    });

    it('isZeroDuration', () => {
      expect(isZeroDuration({ months: 0, ms: 0 })).toBe(true);
      expect(isZeroDuration({ months: 1, ms: 0 })).toBe(false);
      expect(isZeroDuration({ months: 0, ms: MINUTE })).toBe(false);
    });

    it('compareFixed orders by the fixed part', () => {
      expect(compareFixed({ months: 0, ms: HOUR }, { months: 0, ms: DAY })).toBe(-1);
      expect(compareFixed({ months: 0, ms: DAY }, { months: 0, ms: HOUR })).toBe(1);
      expect(compareFixed({ months: 0, ms: DAY }, { months: 0, ms: 24 * HOUR })).toBe(0);
    });

    it.each([
      [{ months: 14, ms: DAY + 4 * HOUR + 30 * MINUTE }, '1y 2mo 1d 4h 30min'],
      [{ months: 0, ms: 0 }, '0d'],
      [{ months: 3, ms: 0 }, '3mo'],
      [{ months: 12, ms: 0 }, '1y'],
      [{ months: 0, ms: 14 * DAY }, '14d'],
      [{ months: 0, ms: 90 * MINUTE }, '1h 30min'],
      [{ months: -14, ms: -DAY }, '-1y -2mo -1d'],
      [{ months: 1, ms: -HOUR }, '1mo -1h'],
      [{ months: 0, ms: 90_000 }, '1min'],
      [{ months: 0, ms: 30_000 }, '0d'],
    ])('durationToString(%o) = %j', (duration, text) => {
      expect(durationToString(duration)).toBe(text);
    });
  });

  describe('properties', () => {
    const duration = fc.record({
      months: fc.integer({ min: 0, max: 12_000 }),
      ms: fc.integer({ min: 0, max: 100_000_000 }).map((minutes) => minutes * MINUTE),
    });

    it('FR-TIME-4: durationToString → parseDuration round-trips', () => {
      fc.assert(
        fc.property(duration, (d) => {
          const result = parseDuration(durationToString(d));
          return result.ok && result.value.months === d.months && result.value.ms === d.ms;
        }),
      );
    });

    it('FR-TIME-4: tokens in any order and the object form agree', () => {
      const units = ['y', 'q', 'mo', 'w', 'd', 'h', 'min'] as const;
      const fields = ['years', 'quarters', 'months', 'weeks', 'days', 'hours', 'minutes'] as const;
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
          fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 7, maxLength: 7 }),
          (order, amounts) => {
            const text = order.map((i) => `${amounts[i]!}${units[i]!}`).join(' ');
            const object = Object.fromEntries(order.map((i) => [fields[i]!, amounts[i]!]));
            const fromText = parseDuration(text);
            const fromObject = parseDuration(object);
            return (
              fromText.ok &&
              fromObject.ok &&
              JSON.stringify(fromText) === JSON.stringify(fromObject)
            );
          },
        ),
      );
    });

    it('never throws, whatever the input', () => {
      fc.assert(
        fc.property(fc.anything(), fc.string(), (value, text) => {
          parseDuration(value as DurationInput);
          parseDuration(text);
        }),
      );
    });
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, DAY, HOUR, MINUTE } from './datetime';
import {
  alignCeil,
  alignDuration,
  alignDurationMs,
  alignFloor,
  alignNearest,
  alignToStep,
  DEFAULT_GRANULARITY,
  type Granularity,
  isAligned,
  isDurationAligned,
  parseGranularity,
} from './granularity';

const at = (iso: string): number => Date.parse(`${iso}Z`);
const time = (iso: string) => asDateTimeMs(at(iso));

function granularity(input: string): Granularity {
  const parsed = parseGranularity(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

/** Every allowed sub-day granularity in minutes: the divisors of 1440. */
const DIVISORS = Array.from({ length: 1440 }, (_, i) => i + 1).filter((m) => 1440 % m === 0);
const anyGranularity = fc.constantFrom(...DIVISORS).map((minutes) => granularity(`${minutes}min`));
/** Floating times from 1900 to 2100: whole minutes or fractional milliseconds. */
const MIN_T = at('1900-01-01T00:00');
const MAX_T = at('2100-01-01T00:00');
const anyTime = fc
  .oneof(
    fc.integer({ min: MIN_T / MINUTE, max: MAX_T / MINUTE }).map((minutes) => minutes * MINUTE),
    fc.double({ min: MIN_T, max: MAX_T, noNaN: true }),
  )
  .map(asDateTimeMs);

describe('time/granularity', () => {
  describe('parseGranularity', () => {
    it.each([
      ['1min', MINUTE],
      ['5min', 5 * MINUTE],
      ['15min', 15 * MINUTE],
      ['90min', 90 * MINUTE],
      ['1h', HOUR],
      ['6h', 6 * HOUR],
      ['12h', 12 * HOUR],
      ['1d', DAY],
      ['24h', DAY],
      ['PT30M', 30 * MINUTE],
      [{ hours: 2 }, 2 * HOUR],
    ])('FR-SNAP-12: accepts %o', (input, ms) => {
      const parsed = parseGranularity(input);
      expect(parsed).toEqual({ ok: true, value: { ms } });
      expect(parsed.ok && Object.isFrozen(parsed.value)).toBe(true);
    });

    it.each(['7min', '5h', '7h', '2d', '1d 1h', '1w', '1mo', '1q', '1y', '0min', { days: 0 }])(
      'FR-SNAP-12: rejects %o with invalid-granularity',
      (input) => {
        const parsed = parseGranularity(input, { path: 'scheduling.granularity' });
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.issue).toMatchObject({
          code: 'invalid-granularity',
          severity: 'error',
          path: 'scheduling.granularity',
          value: input,
        });
        expect(parsed.issue.message).toContain('divides 24 hours');
      },
    );

    it('reports malformed durations as invalid-duration', () => {
      const parsed = parseGranularity('5m', { path: 'scheduling.granularity' });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.issue.code).toBe('invalid-duration');
        expect(parsed.issue.path).toBe('scheduling.granularity');
      }
      const untyped = parseGranularity(15 as never);
      expect(!untyped.ok && untyped.issue.code).toBe('invalid-duration');
      const noPath = parseGranularity('7min');
      expect(!noPath.ok && 'path' in noPath.issue).toBe(false);
    });

    it('defaults to one frozen day', () => {
      expect(DEFAULT_GRANULARITY.ms).toBe(DAY);
      expect(Object.isFrozen(DEFAULT_GRANULARITY)).toBe(true);
    });
  });

  describe('alignment', () => {
    const hour = granularity('1h');
    const quarter = granularity('15min');

    it('FR-SNAP-12: aligns from the start of the day', () => {
      expect(alignFloor(time('2026-01-05T10:30'), hour)).toBe(at('2026-01-05T10:00'));
      expect(alignCeil(time('2026-01-05T10:30'), hour)).toBe(at('2026-01-05T11:00'));
      expect(alignCeil(time('2026-01-05T23:01'), hour)).toBe(at('2026-01-06T00:00'));
      expect(alignFloor(time('2026-01-05T10:07'), quarter)).toBe(at('2026-01-05T10:00'));
      expect(alignNearest(time('2026-01-05T10:08'), quarter)).toBe(at('2026-01-05T10:15'));
      expect(alignFloor(time('2026-01-05T10:30'), DEFAULT_GRANULARITY)).toBe(at('2026-01-05'));
      expect(alignFloor(time('1969-12-31T10:30'), hour)).toBe(at('1969-12-31T10:00'));
    });

    it('FR-SNAP-13: alignNearest breaks exact ties up or down', () => {
      const half = time('2026-01-05T10:30');
      expect(alignNearest(half, hour)).toBe(at('2026-01-05T11:00'));
      expect(alignNearest(half, hour, 'up')).toBe(at('2026-01-05T11:00'));
      expect(alignNearest(half, hour, 'down')).toBe(at('2026-01-05T10:00'));
      expect(alignNearest(time('2026-01-05T10:29'), hour, 'up')).toBe(at('2026-01-05T10:00'));
      expect(alignNearest(time('2026-01-05T10:31'), hour, 'down')).toBe(at('2026-01-05T11:00'));
    });

    it('isAligned works for dates and fixed durations', () => {
      expect(isAligned(time('2026-01-05T10:00'), hour)).toBe(true);
      expect(isAligned(time('2026-01-05T10:30'), hour)).toBe(false);
      expect(isAligned(time('1950-06-01T10:00'), hour)).toBe(true);
      expect(isAligned(-2 * HOUR, hour)).toBe(true);
      expect(isAligned(-30 * MINUTE, hour)).toBe(false);
    });

    it('FR-SNAP-13: aligns durations and lags', () => {
      expect(alignDurationMs(90 * MINUTE, hour, 'ceil')).toBe(2 * HOUR);
      expect(alignDurationMs(90 * MINUTE, hour, 'floor')).toBe(HOUR);
      expect(alignDurationMs(90 * MINUTE, hour, 'nearest')).toBe(2 * HOUR);
      expect(alignDurationMs(-90 * MINUTE, hour, 'nearest')).toBe(-HOUR);
      expect(alignDurationMs(-100 * MINUTE, hour, 'nearest')).toBe(-2 * HOUR);
      expect(alignDurationMs(2 * HOUR, hour, 'ceil')).toBe(2 * HOUR);
    });

    it('FR-SNAP-12: calendar parts of durations are always aligned', () => {
      const month = { months: 1, ms: 0 };
      expect(isDurationAligned(month, granularity('1min'))).toBe(true);
      expect(isDurationAligned(month, DEFAULT_GRANULARITY)).toBe(true);
      expect(alignDuration(month, hour, 'ceil')).toBe(month);
      expect(isDurationAligned({ months: 1, ms: 30 * MINUTE }, hour)).toBe(false);
      expect(alignDuration({ months: 1, ms: 30 * MINUTE }, hour, 'ceil')).toEqual({
        months: 1,
        ms: HOUR,
      });
    });

    it('rejects unknown align modes', () => {
      expect(() => alignToStep(5, 2, 'round' as never)).toThrow('Unknown align mode: round');
    });

    it('stays exact for fractional values and values just below zero', () => {
      const tiny = -5e-324;
      expect(alignToStep(tiny, MINUTE, 'floor')).toBe(-MINUTE);
      expect(alignToStep(tiny, MINUTE, 'ceil')).toBe(0);
      expect(alignToStep(tiny, MINUTE, 'nearest')).toBe(0);
      expect(isAligned(tiny, granularity('1min'))).toBe(false);
      expect(alignToStep(-0, MINUTE, 'floor')).toBe(0);
      expect(alignToStep(-1.5 * MINUTE, MINUTE, 'nearest', 'down')).toBe(-2 * MINUTE);
      const fraction = at('2026-01-05T10:00') - 0.001;
      expect(alignToStep(fraction, HOUR, 'floor')).toBe(at('2026-01-05T09:00'));
      expect(alignToStep(fraction, HOUR, 'nearest')).toBe(at('2026-01-05T10:00'));
    });

    it('FR-SNAP-12: day-precision values are aligned for every granularity', () => {
      fc.assert(
        fc.property(anyGranularity, fc.integer({ min: -50_000, max: 50_000 }), (g, day) =>
          isAligned(day * DAY, g),
        ),
      );
    });

    it('FR-SNAP-12: floor <= t <= ceil, all aligned and at most one step apart', () => {
      fc.assert(
        fc.property(anyGranularity, anyTime, (g, t) => {
          const floor = alignFloor(t, g);
          const ceil = alignCeil(t, g);
          const nearest = alignNearest(t, g);
          expect(floor).toBeLessThanOrEqual(t);
          expect(ceil).toBeGreaterThanOrEqual(t);
          expect(ceil - floor).toBe(isAligned(t, g) ? 0 : g.ms);
          expect([floor, ceil]).toContain(nearest);
          expect(Math.abs(nearest - t)).toBeLessThanOrEqual(g.ms / 2);
          for (const value of [floor, ceil, nearest]) expect(isAligned(value, g)).toBe(true);
          expect(alignFloor(floor, g)).toBe(floor);
          expect(alignNearest(nearest, g, 'down')).toBe(nearest);
        }),
      );
    });
  });
});

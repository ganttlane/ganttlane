import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, type DateTimeMs, DAY, fromParts, HOUR } from '../time';
import { createTimeScale, type ScaleDirection, type TimeScale } from './time-scale';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

/** About 100 years of floating time. */
const CENTURY = 36_525 * DAY;

/** Origins in 1900 … 2100, whole or fractional ms (`createTimeScale` accepts any finite origin). */
const anyOrigin = fc.oneof(
  fc.integer({
    min: fromParts({ year: 1900, month: 1, day: 1 }),
    max: fromParts({ year: 2100, month: 1, day: 1 }),
  }),
  fc.double({
    min: fromParts({ year: 1900, month: 1, day: 1 }),
    max: fromParts({ year: 2100, month: 1, day: 1 }),
    noNaN: true,
  }),
);
const anyPxPerDay = fc.double({ min: 0.01, max: 10_000, noNaN: true });
/** Offsets of up to ±100 years from the origin, in whole ms. */
const anyOffsetMs = fc.integer({ min: -CENTURY, max: CENTURY });
/** A position inside ±100 years, as a fraction of that range. */
const anyFraction = fc.double({ min: -1, max: 1, noNaN: true });

describe('scale/time-scale', () => {
  const origin = at('2026-03-01');
  const scale = createTimeScale({ origin, pxPerDay: 40 });

  describe('mapping', () => {
    it('FR-SCALE-1: maps dates linearly at pxPerDay', () => {
      expect(scale.dateToX(origin)).toBe(0);
      expect(scale.dateToX(at('2026-03-03'))).toBe(80);
      expect(scale.dateToX(at('2026-03-01T06:00'))).toBe(10);
      expect(scale.dateToX(at('2026-02-28'))).toBe(-40);
      expect(scale.xToDate(80)).toBe(at('2026-03-03'));
      expect(scale.xToDate(-10)).toBe(at('2026-02-28T18:00'));
    });

    it('FR-SCALE-1: months and years have their real length', () => {
      const month = createTimeScale({ origin: at('2024-01-01'), pxPerDay: 4 });
      const width = (a: string, b: string): number => month.dateToX(at(b)) - month.dateToX(at(a));
      expect(width('2024-02-01', '2024-03-01')).toBe(29 * 4);
      expect(width('2025-02-01', '2025-03-01')).toBe(28 * 4);
      expect(width('2024-01-01', '2025-01-01')).toBe(366 * 4);
      expect(width('2025-01-01', '2026-01-01')).toBe(365 * 4);
    });

    it('converts durations and pixel widths', () => {
      expect(scale.durationToPx(DAY)).toBe(40);
      expect(scale.durationToPx(6 * HOUR)).toBe(10);
      expect(scale.durationToPx(-DAY)).toBe(-40);
      expect(scale.pxToDuration(40)).toBe(DAY);
      expect(scale.pxToDuration(-10)).toBe(-6 * HOUR);
    });

    it('rounds dates and durations from pixels to whole ms, never -0', () => {
      const fine = createTimeScale({ origin: asDateTimeMs(0), pxPerDay: DAY });
      expect(fine.xToDate(1.4)).toBe(1);
      expect(fine.xToDate(1.6)).toBe(2);
      expect(Object.is(fine.xToDate(-0.2), 0)).toBe(true);
      expect(fine.pxToDuration(2.5)).toBe(3);
      expect(Object.is(fine.pxToDuration(-0.2), 0)).toBe(true);
    });

    it('is frozen and its members work unbound', () => {
      expect(Object.isFrozen(scale)).toBe(true);
      const { dateToX, xToDate } = scale;
      expect(xToDate(dateToX(at('2026-05-17T09:15')))).toBe(at('2026-05-17T09:15'));
    });
  });

  describe('round trips (property)', () => {
    it('FR-SCALE-1: date → x → date is exact to the ms (±100 years, 0.01 … 10 000 px/day)', () => {
      fc.assert(
        fc.property(anyOrigin, anyPxPerDay, anyOffsetMs, (o, pxPerDay, offset) => {
          const s = createTimeScale({ origin: asDateTimeMs(o), pxPerDay });
          const t = asDateTimeMs(Math.round(o) + offset);
          expect(s.xToDate(s.dateToX(t))).toBe(t);
        }),
      );
    });

    it('FR-SCALE-1: x → date → x is within 0.5 px (±100 years, 0.01 … 10 000 px/day)', () => {
      fc.assert(
        fc.property(anyOrigin, anyPxPerDay, anyFraction, (o, pxPerDay, fraction) => {
          const s = createTimeScale({ origin: asDateTimeMs(o), pxPerDay });
          const x = fraction * s.durationToPx(CENTURY);
          expect(Math.abs(s.dateToX(s.xToDate(x)) - x)).toBeLessThanOrEqual(0.5);
        }),
      );
    });

    it('FR-SCALE-1: durations round-trip through pixels exactly to the ms', () => {
      fc.assert(
        fc.property(anyPxPerDay, anyOffsetMs, (pxPerDay, ms) => {
          const s = createTimeScale({ origin, pxPerDay });
          expect(s.pxToDuration(s.durationToPx(ms))).toBe(ms);
        }),
      );
    });
  });

  describe('zoom', () => {
    it('FR-SCALE-1: keeps the date under the anchor at the same x', () => {
      const anchorDate = scale.xToDate(400);
      const zoomed = scale.zoom(80, { x: 400 });
      expect(zoomed.pxPerDay).toBe(80);
      expect(zoomed.xToDate(400)).toBe(anchorDate);
      expect(zoomed.dateToX(anchorDate)).toBeCloseTo(400, 9);
      expect(zoomed.origin).toBe(at('2026-03-06'));
      expect(zoomed.dateToX(at('2026-03-12'))).toBeCloseTo(480, 9);
    });

    it('returns a new frozen scale and leaves the original unchanged', () => {
      const zoomed = scale.zoom(10, { x: -120 });
      expect(zoomed).not.toBe(scale);
      expect(Object.isFrozen(zoomed)).toBe(true);
      expect(scale.pxPerDay).toBe(40);
      expect(scale.origin).toBe(origin);
    });

    it('property: the anchor date stays within ±1 ms and ±0.5 px; round trips stay exact', () => {
      fc.assert(
        fc.property(
          anyOrigin,
          anyPxPerDay,
          anyPxPerDay,
          anyFraction,
          anyOffsetMs,
          (o, before, after, fraction, offset) => {
            const s = createTimeScale({ origin: asDateTimeMs(o), pxPerDay: before });
            // The anchor is within ±100 years of the origin on both zoom levels.
            const x = fraction * Math.min(before, after) * (CENTURY / DAY);
            const zoomed = s.zoom(after, { x });
            const anchorDate = s.xToDate(x);
            expect(Math.abs(zoomed.xToDate(x) - anchorDate)).toBeLessThanOrEqual(1);
            expect(Math.abs(zoomed.dateToX(anchorDate) - x)).toBeLessThanOrEqual(0.5);
            const t = asDateTimeMs(anchorDate + offset);
            expect(zoomed.xToDate(zoomed.dateToX(t))).toBe(t);
          },
        ),
      );
    });

    it('fractional origin after zoom: the zoomed origin is always a whole millisecond', () => {
      fc.assert(
        fc.property(
          anyOrigin,
          anyPxPerDay,
          anyPxPerDay,
          fc.double({ min: -1e7, max: 1e7, noNaN: true }),
          (o, before, after, x) => {
            const zoomed = createTimeScale({ origin: asDateTimeMs(o), pxPerDay: before }).zoom(
              after,
              { x },
            );
            expect(Number.isInteger(zoomed.origin)).toBe(true);
            expect(Object.is(zoomed.origin, -0)).toBe(false);
            const again = zoomed.zoom(before, { x: -x / 3 });
            expect(Number.isInteger(again.origin)).toBe(true);
          },
        ),
      );
      // Near the epoch the rounded origin is 0, never -0.
      const nearEpoch = createTimeScale({ origin: asDateTimeMs(0), pxPerDay: 1 }).zoom(2, {
        x: 1e-9,
      });
      expect(Object.is(nearEpoch.origin, 0)).toBe(true);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects pxPerDay %o with a RangeError',
      (pxPerDay) => {
        expect(() => scale.zoom(pxPerDay, { x: 0 })).toThrow(RangeError);
      },
    );

    it.each([Number.NaN, Number.NEGATIVE_INFINITY, '10'])(
      'rejects anchor x %o with a RangeError',
      (x) => {
        expect(() => scale.zoom(80, { x: x as number })).toThrow(RangeError);
      },
    );
  });

  describe('options', () => {
    it.each([0, -40, Number.NaN, Number.POSITIVE_INFINITY, '40', undefined])(
      'rejects pxPerDay %o with a RangeError',
      (pxPerDay) => {
        expect(() => createTimeScale({ origin, pxPerDay: pxPerDay as number })).toThrow(RangeError);
      },
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, '2026-03-01', null])(
      'rejects origin %o with a RangeError',
      (value) => {
        expect(() => createTimeScale({ origin: value as DateTimeMs, pxPerDay: 40 })).toThrow(
          RangeError,
        );
      },
    );

    it('defaults to ltr and rejects unknown directions', () => {
      expect(scale.direction).toBe('ltr');
      expect(() =>
        createTimeScale({ origin, pxPerDay: 40, direction: 'up' as ScaleDirection }),
      ).toThrow(RangeError);
    });

    it('stores rtl (mirroring is P1) and keeps it through zoom; mapping stays ltr for now', () => {
      const rtl: TimeScale = createTimeScale({ origin, pxPerDay: 40, direction: 'rtl' });
      expect(rtl.direction).toBe('rtl');
      expect(rtl.dateToX(at('2026-03-03'))).toBe(80);
      expect(rtl.zoom(20, { x: 0 }).direction).toBe('rtl');
    });
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  asDateTimeMs,
  asDayKey,
  DAY,
  floorMod,
  fromDayKey,
  fromParts,
  getParts,
  HOUR,
  MINUTE,
  toDayKey,
  utc,
} from './datetime';

/** Floating date-times between years 1 and 9999, minute-aligned or not. */
const anyDateTime = fc
  .integer({ min: utc(1, 0, 1), max: utc(9999, 11, 31, 23, 59, 59, 999) })
  .map(asDateTimeMs);

describe('time/datetime', () => {
  it('ADR-003: unit constants', () => {
    expect(MINUTE).toBe(60_000);
    expect(HOUR).toBe(60 * MINUTE);
    expect(DAY).toBe(24 * HOUR);
  });

  it('ADR-003: floating ms is Date.UTC of the wall-clock components', () => {
    const t = fromParts({ year: 2026, month: 3, day: 8, hour: 10, minute: 30 });
    expect(t).toBe(Date.UTC(2026, 2, 8, 10, 30));
    expect(fromParts({ year: 2026, month: 3, day: 8 })).toBe(Date.UTC(2026, 2, 8));
    expect(fromParts({ year: 2026, month: 3, day: 8, second: 5, ms: 7 })).toBe(
      Date.UTC(2026, 2, 8, 0, 0, 5, 7),
    );
  });

  it.each([
    [{ year: 2026, month: 13, day: 1 }, Date.UTC(2027, 0, 1)],
    [{ year: 2026, month: 0, day: 1 }, Date.UTC(2025, 11, 1)],
    [{ year: 2026, month: 2, day: 30 }, Date.UTC(2026, 2, 2)],
    [{ year: 2026, month: 1, day: 1, hour: 24 }, Date.UTC(2026, 0, 2)],
  ])('fromParts overflows like Date.UTC: %o', (fields, expected) => {
    expect(fromParts(fields)).toBe(expected);
  });

  it.each([0, 1, 50, 99])('fromParts keeps real year %i (no 1900 mapping)', (year) => {
    const t = fromParts({ year, month: 2, day: 28, hour: 12 });
    expect(getParts(t)).toMatchObject({ year, month: 2, day: 28, hour: 12 });
  });

  it('fromParts handles years 99 → 100 overflow and negative years', () => {
    expect(getParts(fromParts({ year: 99, month: 13, day: 1 }))).toMatchObject({
      year: 100,
      month: 1,
    });
    expect(getParts(fromParts({ year: -1, month: 12, day: 31 }))).toMatchObject({
      year: -1,
      month: 12,
      day: 31,
    });
  });

  it('getParts returns all wall-clock components, month 1-12, weekday 0 = Sunday', () => {
    const t = asDateTimeMs(Date.UTC(2026, 2, 8, 23, 59, 58, 999));
    expect(getParts(t)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
      hour: 23,
      minute: 59,
      second: 58,
      ms: 999,
      weekday: 0,
    });
  });

  it('getParts of NaN is all NaN', () => {
    expect(getParts(asDateTimeMs(Number.NaN)).year).toBeNaN();
  });

  it.each([
    ['1970-01-01T00:00', Date.UTC(1970, 0, 1), 0],
    ['1970-01-01T23:59', Date.UTC(1970, 0, 1, 23, 59), 0],
    ['1970-01-02T00:00', Date.UTC(1970, 0, 2), 1],
    ['1969-12-31T23:59', Date.UTC(1969, 11, 31, 23, 59), -1],
    ['1969-12-31T00:00', Date.UTC(1969, 11, 31), -1],
    ['2026-03-08T12:00', Date.UTC(2026, 2, 8, 12), 20520],
  ])('ADR-003: toDayKey(%s) = floor(t / DAY)', (_label, t, key) => {
    expect(toDayKey(asDateTimeMs(t))).toBe(key);
  });

  it('fromDayKey gives midnight', () => {
    expect(fromDayKey(asDayKey(20520))).toBe(Date.UTC(2026, 2, 8));
    expect(fromDayKey(asDayKey(-1))).toBe(Date.UTC(1969, 11, 31));
  });

  it('floorMod is Euclidean', () => {
    expect(floorMod(7, 3)).toBe(1);
    expect(floorMod(-7, 3)).toBe(2);
    expect(floorMod(-6, 3)).toBe(0);
  });

  it('property: fromParts(getParts(t)) === t', () => {
    fc.assert(fc.property(anyDateTime, (t) => fromParts(getParts(t)) === t));
  });

  it('property: fromDayKey(toDayKey(t)) <= t < next day', () => {
    fc.assert(
      fc.property(anyDateTime, (t) => {
        const midnight = fromDayKey(toDayKey(t));
        return midnight <= t && t < midnight + DAY && getParts(midnight).hour === 0;
      }),
    );
  });
});

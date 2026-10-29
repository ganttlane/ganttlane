import { CalendarDate, CalendarDateTime, parseDate } from '@internationalized/date';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDateTimeMs, asDayKey, DAY, getParts, toDayKey, utc } from './datetime';
import {
  CYCLE_DAYS,
  CYCLE_MONTHS,
  CYCLE_MS,
  CYCLE_YEARS,
  dayCycles,
  fromCalendarDate,
  fromCalendarDateTime,
  GREGORIAN,
  mapCalendarDate,
  mapCalendarDateTime,
  toCalendarDate,
  toCalendarDateTime,
  windowDay,
  windowYear,
  yearCycles,
} from './engine';

/** Floating date-times in AD 1 … 9999, the library's own range. */
const libraryRange = fc
  .integer({ min: utc(1, 0, 1), max: utc(9999, 11, 31, 23, 59, 59, 999) })
  .map(asDateTimeMs);
/** Floating date-times across the whole `Date` range. */
const anyDateTime = fc.integer({ min: -8.64e15, max: 8.64e15 - 1 }).map(asDateTimeMs);

describe('time/engine', () => {
  it('ADR-018: a Gregorian cycle is 400 years = 4800 months = 146 097 days, whole weeks', () => {
    expect(CYCLE_MONTHS).toBe(CYCLE_YEARS * 12);
    expect(utc(2400, 0, 1) - utc(2000, 0, 1)).toBe(CYCLE_DAYS * DAY);
    expect(CYCLE_MS).toBe(CYCLE_DAYS * DAY);
    expect(CYCLE_DAYS % 7).toBe(0);
  });

  it.each([
    [2000, 0, 2000],
    [2399, 0, 2399],
    [2400, 1, 2000],
    [1999, -1, 2399],
    [0, -5, 2000],
    [-1, -6, 2399],
    [9999, 19, 2399],
    [10_000, 20, 2000],
  ])('yearCycles / windowYear(%i) = %i cycles, %i', (year, cycles, inWindow) => {
    expect(yearCycles(year)).toBe(cycles);
    expect(windowYear(year)).toBe(inWindow);
  });

  it('property: windowDay keeps the month, day and weekday and lands in 2000-2399', () => {
    fc.assert(
      fc.property(anyDateTime, (t) => {
        const key = toDayKey(t);
        const moved = windowDay(key);
        const before = getParts(t);
        const after = getParts(asDateTimeMs(moved * DAY));
        return (
          after.year >= 2000 &&
          after.year <= 2399 &&
          (moved - key) % CYCLE_DAYS === 0 &&
          dayCycles(moved) === 0 &&
          after.month === before.month &&
          after.day === before.day &&
          after.weekday === before.weekday
        );
      }),
    );
  });

  it('converts day keys and CalendarDate both ways', () => {
    expect(toCalendarDate(asDayKey(0))).toMatchObject({ era: 'AD', year: 1970, month: 1, day: 1 });
    expect(fromCalendarDate(new CalendarDate(GREGORIAN, 2026, 3, 8))).toBe(20520);
    expect(fromCalendarDate(new CalendarDateTime(2026, 3, 8, 23, 59))).toBe(20520);
    expect(toCalendarDate(asDayKey(20520)).calendar.identifier).toBe('gregory');
  });

  it('converts floating ms and CalendarDateTime both ways', () => {
    const t = asDateTimeMs(Date.UTC(2026, 2, 8, 14, 5, 6, 7));
    expect(toCalendarDateTime(t)).toMatchObject({
      era: 'AD',
      year: 2026,
      month: 3,
      day: 8,
      hour: 14,
      minute: 5,
      second: 6,
      millisecond: 7,
    });
    expect(fromCalendarDateTime(new CalendarDateTime(2026, 3, 8, 14, 5, 6, 7))).toBe(t);
  });

  it('property: converters round-trip in the library range (AD 1-9999)', () => {
    fc.assert(
      fc.property(libraryRange, (t) => {
        const date = toCalendarDateTime(t);
        const parts = getParts(t);
        return (
          fromCalendarDateTime(date) === t &&
          fromCalendarDate(toCalendarDate(toDayKey(t))) === toDayKey(t) &&
          date.year === parts.year &&
          date.month === parts.month &&
          date.day === parts.day &&
          date.hour === parts.hour &&
          date.minute === parts.minute &&
          date.second === parts.second &&
          date.millisecond === parts.ms
        );
      }),
    );
  });

  it('property: mapCalendarDate / mapCalendarDateTime with the identity change nothing', () => {
    fc.assert(
      fc.property(anyDateTime, (t) => {
        const key = toDayKey(t);
        return (
          mapCalendarDate(key, (date) => date) === key &&
          mapCalendarDateTime(t, (date) => date) === t &&
          mapCalendarDateTime(t, (date) => date, -2) === t - 2 * CYCLE_MS
        );
      }),
    );
  });

  it('works around the library range: years outside AD 1-9999 reach it shifted', () => {
    // The library alone clamps to AD 9999 and reads "0000" as year 1.
    expect(new CalendarDate(9999, 12, 31).add({ days: 1 }).toString()).toBe('9999-12-31');
    expect(parseDate('0000-01-01').year).toBe(1);

    const lastDay = asDayKey(Math.floor(utc(9999, 11, 31) / DAY));
    expect(mapCalendarDate(lastDay, (date) => date.add({ days: 1 }))).toBe(lastDay + 1);
    const leapDay = asDateTimeMs(utc(0, 1, 29, 12));
    expect(getParts(mapCalendarDateTime(leapDay, (date) => date.add({ years: 1 })))).toMatchObject({
      year: 1,
      month: 2,
      day: 28,
      hour: 12,
    });
  });
});

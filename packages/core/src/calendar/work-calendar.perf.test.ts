import { describe, expect, it } from 'vitest';

import { asDateTimeMs, asDayKey, DAY, HOUR } from '../time';
import { createWorkCalendar, type WorkCalendar } from './work-calendar';

/** 2026-01-01 and a 10-year range of days from it. */
const START = Date.UTC(2026, 0, 1) / DAY;
const SPAN = 3653;
const HOLIDAYS = 1000;
const QUERIES = 100_000;
/** Generous so that slow CI machines pass; locally the run takes a few milliseconds. */
const BUDGET_MS = 250;

/** Deterministic pseudo-random numbers in `[0, 1)` (a linear congruential generator). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function setup(): { calendar: WorkCalendar; createMs: number; a: Int32Array; b: Int32Array } {
  const random = lcg(42);
  const holidays = new Set<number>();
  while (holidays.size < HOLIDAYS) holidays.add(START + Math.floor(random() * SPAN));
  const isoHolidays = [...holidays].map((key) => new Date(key * DAY).toISOString().slice(0, 10));
  const createStart = Date.now();
  const { calendar, issues } = createWorkCalendar({ holidays: isoHolidays });
  const createMs = Date.now() - createStart;
  expect(issues).toEqual([]);
  const a = new Int32Array(QUERIES);
  const b = new Int32Array(QUERIES);
  for (let i = 0; i < QUERIES; i++) {
    a[i] = START + Math.floor(random() * SPAN);
    b[i] = START + Math.floor(random() * SPAN);
  }
  return { calendar, createMs, a, b };
}

describe('calendar/WorkCalendar performance', () => {
  it('FR-CAL-4: 100 000 countDays over 10 years with 1000 holidays stay within budget', async ({
    annotate,
  }) => {
    const { calendar, createMs, a, b } = setup();
    // Timed on a cold calendar: the first query fills the cache.
    const start = Date.now();
    let checksum = 0;
    for (let i = 0; i < QUERIES; i++) {
      checksum += calendar.countDays(asDayKey(a[i]!), asDayKey(b[i]!)).working;
    }
    const elapsed = Date.now() - start;
    await annotate(
      `countDays: ${QUERIES} queries in ${elapsed} ms (cold cache; createWorkCalendar with ` +
        `${HOLIDAYS} holidays: ${createMs} ms)`,
    );
    expect(Number.isFinite(checksum)).toBe(true);
    expect(elapsed, `${QUERIES} countDays took ${elapsed} ms`).toBeLessThan(BUDGET_MS);
  });

  it('FR-CAL-5/10: 100 000 addWorkingDays and countWorkingTime stay within budget', async ({
    annotate,
  }) => {
    const { calendar, a, b } = setup();
    calendar.countDays(asDayKey(START), asDayKey(START + SPAN));

    let start = Date.now();
    let checksum = 0;
    for (let i = 0; i < QUERIES; i++) {
      checksum += calendar.addWorkingDays(asDayKey(a[i]!), (b[i]! - a[i]!) >> 1) ?? 0;
    }
    const addMs = Date.now() - start;

    start = Date.now();
    for (let i = 0; i < QUERIES; i++) {
      checksum += calendar.countWorkingTime(
        asDateTimeMs(a[i]! * DAY + 7 * HOUR),
        asDateTimeMs(b[i]! * DAY + 15 * HOUR),
      );
    }
    const timeMs = Date.now() - start;

    await annotate(
      `addWorkingDays: ${QUERIES} in ${addMs} ms; countWorkingTime: ${QUERIES} in ${timeMs} ms`,
    );
    expect(Number.isFinite(checksum)).toBe(true);
    expect(addMs, `${QUERIES} addWorkingDays took ${addMs} ms`).toBeLessThan(BUDGET_MS);
    expect(timeMs, `${QUERIES} countWorkingTime took ${timeMs} ms`).toBeLessThan(BUDGET_MS);
  });
});

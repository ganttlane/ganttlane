import { describe, expect, it, vi } from 'vitest';

import type { Weekday } from '../time';
import {
  DAY_WEEKEND,
  DAY_WORKING,
  type DayCode,
  DayIndex,
  MAX_DAY_KEY,
  MAX_NON_WORKING_RUN,
  MIN_DAY_KEY,
} from './day-index';

/** Saturday and Sunday off. */
const weekdaysOnly = (_day: number, weekday: Weekday): DayCode =>
  weekday === 0 || weekday === 6 ? DAY_WEEKEND : DAY_WORKING;

/** 2026-03-02, a Monday. */
const MON = Date.UTC(2026, 2, 2) / 86_400_000;

describe('calendar/DayIndex', () => {
  it('FR-CAL-4: grows on demand, at least doubling, and classifies each day once', () => {
    const classify = vi.fn(weekdaysOnly);
    const index = new DayIndex(classify);
    expect(index.size).toBe(0);

    expect(index.count(MON, MON + 7)).toBe(5);
    const first = index.size;
    expect(first).toBeGreaterThanOrEqual(7 + 2 * 512);
    expect(classify).toHaveBeenCalledTimes(first);

    // Inside the window: no growth, no classification.
    expect(index.count(MON - 100, MON + 100)).toBe(142);
    expect(index.size).toBe(first);

    // Past the right edge: grows by at least the current size.
    index.count(MON, MON + first);
    expect(index.size).toBeGreaterThanOrEqual(2 * first);
    // Past the left edge.
    const before = index.size;
    index.count(MON - 5000, MON);
    expect(index.size).toBeGreaterThanOrEqual(before + 5000);
    expect(classify).toHaveBeenCalledTimes(index.size);
  });

  it('passes the right weekday to the classifier, also before 1970', () => {
    const seen = new Map<number, Weekday>();
    const index = new DayIndex((day, weekday) => {
      seen.set(day, weekday);
      return DAY_WORKING;
    });
    index.count(-3, 3);
    expect(seen.get(-1)).toBe(3); // 1969-12-31 was a Wednesday
    expect(seen.get(0)).toBe(4);
    expect(seen.get(2)).toBe(6);
    expect(seen.get(3)).toBe(0);
  });

  it('answers beyond its cap without caching (O(span) walk)', () => {
    const classify = vi.fn(weekdaysOnly);
    const index = new DayIndex(classify, 30);
    expect(index.count(MON, MON + 70)).toBe(50);
    expect(index.size).toBe(0);
    expect(index.codeAt(MON + 5)).toBe(DAY_WEEKEND);
    expect(index.size).toBe(1); // a single day still fits
    expect(index.codeAt(MON + 1000)).toBe(DAY_WEEKEND); // too far from the cached day: walked
    expect(index.size).toBe(1);
    expect(index.nthAfter(MON + 4, 1)).toBe(MON + 7);
    expect(index.nthBefore(MON + 7, 1)).toBe(MON + 4);
    expect(index.nthAfter(MON, 100)).toBe(MON + 140);
    expect(index.nthBefore(MON + 140, 100)).toBe(MON);
  });

  it('keeps its state when the classifier throws', () => {
    let fail = false;
    const index = new DayIndex((day, weekday) => {
      if (fail) throw new Error('boom');
      return weekdaysOnly(day, weekday);
    });
    index.count(MON, MON + 7);
    const size = index.size;
    fail = true;
    expect(() => index.count(MON, MON + 10 * size)).toThrow('boom');
    expect(index.size).toBe(size);
    fail = false;
    expect(index.count(MON, MON + 7)).toBe(5);
  });

  it('gives up after a run of MAX_NON_WORKING_RUN non-working days, cached or not', () => {
    for (const cap of [1 << 21, 100]) {
      const nothing = new DayIndex(() => DAY_WEEKEND, cap);
      expect(nothing.nthAfter(MON, 1)).toBeUndefined();
      expect(nothing.nthBefore(MON, 1)).toBeUndefined();

      // One working day right after a run one day shorter than the limit is still found.
      const gap = MAX_NON_WORKING_RUN - 1;
      const sparse = new DayIndex(
        (day) => (day === MON || day === MON + gap + 1 ? DAY_WORKING : DAY_WEEKEND),
        cap,
      );
      expect(sparse.nthAfter(MON, 1)).toBe(MON + gap + 1);
      expect(sparse.nthBefore(MON + gap + 1, 1)).toBe(MON);
    }
  });

  it('stays within the Date range', () => {
    const index = new DayIndex(() => DAY_WORKING);
    expect(index.nthAfter(MAX_DAY_KEY - 2, 2)).toBe(MAX_DAY_KEY);
    expect(index.nthAfter(MAX_DAY_KEY - 2, 3)).toBeUndefined();
    expect(index.nthBefore(MIN_DAY_KEY + 2, 2)).toBe(MIN_DAY_KEY);
    expect(index.nthBefore(MIN_DAY_KEY + 2, 3)).toBeUndefined();
    const sparse = new DayIndex((day) => (day === MAX_DAY_KEY - 10 ? DAY_WORKING : DAY_WEEKEND));
    expect(sparse.nthAfter(MAX_DAY_KEY - 100, 2)).toBeUndefined();
    const sparseLow = new DayIndex((day) => (day === MIN_DAY_KEY + 10 ? DAY_WORKING : DAY_WEEKEND));
    expect(sparseLow.nthBefore(MIN_DAY_KEY + 100, 2)).toBeUndefined();
  });
});

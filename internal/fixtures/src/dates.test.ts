import { describe, expect, it } from 'vitest';

import {
  addDays,
  countCalendarDays,
  countWorkingDays,
  formatDay,
  formatMinute,
  isWorkingDay,
  toDayNumber,
  toMinuteNumber,
  weekday,
} from './dates';
import { deepFreeze } from './freeze';
import { createRandom } from './random';

describe('fixture date helpers', () => {
  it('round-trips dates and date-times', () => {
    expect(formatDay(toDayNumber('2028-02-29'))).toBe('2028-02-29');
    expect(formatMinute(toMinuteNumber('2026-03-29T02:30'))).toBe('2026-03-29T02:30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-02', -1)).toBe('2026-03-01');
  });

  it('rejects malformed or impossible dates', () => {
    expect(() => toDayNumber('2026-02-30')).toThrow();
    expect(() => toDayNumber('2026-3-2')).toThrow();
    expect(() => toMinuteNumber('2026-03-02')).toThrow();
  });

  it('knows weekdays (2026-03-02 is a Monday, 1970-01-01 a Thursday)', () => {
    expect(weekday('2026-03-02')).toBe(1);
    expect(weekday('1970-01-01')).toBe(4);
    expect(weekday('1969-12-28')).toBe(0);
  });

  it('counts calendar and working days inclusively', () => {
    const calendar = {
      weekends: [0, 6],
      holidays: [{ date: '2026-04-03' }],
      workingDays: ['2026-04-04'],
    };
    expect(countCalendarDays('2026-03-30', '2026-04-05')).toBe(7);
    expect(countCalendarDays('2026-04-05', '2026-03-30')).toBe(0);
    // Mon–Thu, Good Friday off, Saturday worked as an exception, Sunday off.
    expect(countWorkingDays('2026-03-30', '2026-04-05', calendar)).toBe(5);
    expect(isWorkingDay('2026-04-03', calendar)).toBe(false);
    expect(isWorkingDay('2026-04-04', calendar)).toBe(true);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays but leaves dates alone', () => {
    const date = new Date(0);
    const value = deepFreeze({ list: [{ a: 1 }], date });
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(date)).toBe(false);
  });
});

describe('createRandom', () => {
  it('repeats its sequence for a seed and stays in range', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const values = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);

    const random = createRandom(1);
    for (let i = 0; i < 100; i++) expect(random.int(3, 5)).toBeGreaterThanOrEqual(3);
    expect(() => random.pick([])).toThrow();
  });
});

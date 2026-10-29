import { describe, expect, it } from 'vitest';

import { createFloatingAdapter, type DateAdapter } from './adapter';
import { asDateTimeMs, type DateTimeMs, HOUR, type Weekday } from './datetime';

const at = (iso: string): DateTimeMs =>
  asDateTimeMs(Date.parse(iso.includes('T') ? `${iso}Z` : iso));

// Wednesday.
const t = at('2026-08-19T14:37');

describe('time/adapter', () => {
  it('ADR-003: weeks start on Monday by default (ISO 8601)', () => {
    const dates = createFloatingAdapter();
    expect(dates.weekStartsOn).toBe(1);
    expect(dates.startOf(t, 'week')).toBe(at('2026-08-17'));
    expect(dates.endOf(t, 'week')).toBe(at('2026-08-24'));
  });

  it.each([
    [0, '2026-08-16'],
    [1, '2026-08-17'],
    [6, '2026-08-15'],
  ] as const)('weekStartsOn %i starts the week on %s', (weekStartsOn, start) => {
    const dates = createFloatingAdapter({ weekStartsOn });
    expect(dates.weekStartsOn).toBe(weekStartsOn);
    expect(dates.startOf(t, 'week')).toBe(at(start));
    expect(dates.endOf(t, 'week') - dates.startOf(t, 'week')).toBe(7 * 24 * HOUR);
  });

  it.each([7, -1, 1.5, Number.NaN, '1'])('rejects weekStartsOn %o with a RangeError', (value) => {
    expect(() => createFloatingAdapter({ weekStartsOn: value as Weekday })).toThrow(RangeError);
  });

  it('is frozen and its members work unbound', () => {
    const dates = createFloatingAdapter();
    expect(Object.isFrozen(dates)).toBe(true);
    const { startOf, add } = dates;
    expect(startOf(t, 'month')).toBe(at('2026-08-01'));
    expect(add(at('2026-01-31'), 1, 'month')).toBe(at('2026-02-28'));
  });

  it('delegates every calendar operation to the floating implementation', () => {
    const dates: DateAdapter = createFloatingAdapter();
    expect(dates.add(t, 90, 'minute')).toBe(at('2026-08-19T16:07'));
    expect(dates.addDuration(at('2026-01-31'), { months: 1, ms: HOUR })).toBe(
      at('2026-02-28T01:00'),
    );
    expect(dates.addDuration(at('2026-03-31'), { months: 1, ms: 0 }, -1)).toBe(at('2026-02-28'));
    expect(dates.startOf(t, 'quarter')).toBe(at('2026-07-01'));
    expect(dates.endOf(t, 'year')).toBe(at('2027-01-01'));
    expect(dates.getParts(t)).toMatchObject({ year: 2026, month: 8, day: 19, hour: 14 });
    expect(dates.fromParts({ year: 2026, month: 8, day: 19, hour: 14, minute: 37 })).toBe(t);
    expect(dates.dayOfWeek(t)).toBe(3);
    expect(dates.isoWeek(at('2027-01-01'))).toEqual({ year: 2026, week: 53 });
    expect(dates.diffDays(at('2026-08-17T23:00'), t)).toBe(2);
    expect(dates.diffMonths(at('2026-01-31'), at('2026-02-28'))).toBe(1);
    expect(dates.format(t, { month: 'short', day: 'numeric' }, 'en')).toBe('Aug 19');
  });

  it('FR-I18N-1: each adapter owns its formatter cache, one formatter per locale and options', () => {
    const first = createFloatingAdapter();
    const second = createFloatingAdapter();
    const month = { month: 'long', year: 'numeric' } as const;

    // One adapter shares a formatter per locale + options…
    expect(first.formatter(month, 'en')).toBe(
      first.formatter({ year: 'numeric', month: 'long' }, 'en'),
    );
    expect(first.formatter(month, 'uk')).not.toBe(first.formatter(month, 'en'));
    // …and nothing is shared between adapters (or the charts that own them).
    expect(second.formatter(month, 'en')).not.toBe(first.formatter(month, 'en'));
  });

  it('FR-I18N-1: the same date reads in each locale and calendar, as the wall clock', () => {
    const dates = createFloatingAdapter();
    const month = { month: 'long', year: 'numeric' } as const;

    expect(dates.format(t, month, 'en')).toBe('August 2026');
    expect(dates.format(t, month, 'uk')).toBe('серпень 2026 р.');
    expect(dates.format(t, month, 'de')).toBe('August 2026');
    expect(dates.format(t, { year: 'numeric' }, 'th-TH-u-ca-buddhist')).toContain('2569');
    expect(dates.format(t, { day: 'numeric' }, 'ar-EG')).toBe('١٩');
  });
});

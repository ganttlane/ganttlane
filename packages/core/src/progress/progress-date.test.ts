import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  asDateTimeMs,
  type DateTimeMs,
  DEFAULT_GRANULARITY,
  type Granularity,
  MINUTE,
  parseDateInput,
  parseGranularity,
  toISODateTime,
} from '../time';
import { dateToProgress, type ProgressSpan, progressToDate } from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });
const { calendar: allWorking } = createWorkCalendar({ weekends: [] });

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

function step(input: string): Granularity {
  const parsed = parseGranularity(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

function span(start: string, endExclusive: string, mode: 'calendar' | 'working'): ProgressSpan {
  return { start: at(start), endExclusive: at(endExclusive), mode, calendar };
}

/** Progress date as ISO text. */
function dateAt(base: ProgressSpan, progress: number, granularity = DEFAULT_GRANULARITY): string {
  return toISODateTime(progressToDate({ ...base, progress, granularity }));
}

// Monday 2026-03-02 → Saturday 2026-03-07 (exclusive): five days.
const week = span('2026-03-02', '2026-03-07', 'calendar');
// Monday 2026-03-02 → Monday 2026-03-09: seven days, five working (Saturday and Sunday off).
const fullWeek = span('2026-03-02', '2026-03-09', 'working');

describe('progress/progressToDate', () => {
  it('FR-PROG-1: 0 % is the start and 100 % the exclusive end (fork bugs D4, D5)', () => {
    expect(dateAt(week, 0)).toBe('2026-03-02T00:00');
    expect(dateAt(week, 100)).toBe('2026-03-07T00:00');
    expect(dateAt(fullWeek, 0)).toBe('2026-03-02T00:00');
    // Five working days end on Saturday 00:00, yet 100 % fills the whole bar.
    expect(dateAt(fullWeek, 100)).toBe('2026-03-09T00:00');
  });

  it('FR-PROG-1: out-of-range and NaN progress are clamped', () => {
    expect(dateAt(week, -10)).toBe('2026-03-02T00:00');
    expect(dateAt(week, Number.NaN)).toBe('2026-03-02T00:00');
    expect(dateAt(week, 150)).toBe('2026-03-07T00:00');
  });

  it('FR-SNAP-15: the boundary is aligned down to the granularity', () => {
    expect(dateAt(week, 60)).toBe('2026-03-05T00:00');
    // 50 % of 5 days is Wednesday 12:00: down to the day at '1d', exact at '1h'.
    expect(dateAt(week, 50)).toBe('2026-03-04T00:00');
    expect(dateAt(week, 50, step('1h'))).toBe('2026-03-04T12:00');
    // 30 % of 10:00–14:00 is 11:12.
    const hours = span('2026-03-02T10:00', '2026-03-02T14:00', 'calendar');
    expect(dateAt(hours, 30, step('1h'))).toBe('2026-03-02T11:00');
    expect(dateAt(hours, 30, step('15min'))).toBe('2026-03-02T11:00');
    expect(dateAt(hours, 30, step('1min'))).toBe('2026-03-02T11:12');
  });

  it('FR-PROG-1: working mode measures working time only', () => {
    // 2.5 of 5 working days: Wednesday 12:00 (calendar time would give Thursday 12:00).
    expect(dateAt(fullWeek, 50, step('1h'))).toBe('2026-03-04T12:00');
    expect(dateAt({ ...fullWeek, mode: 'calendar' }, 50, step('1h'))).toBe('2026-03-05T12:00');
    // 4 of 5 working days end on Friday 00:00, never inside the weekend.
    expect(dateAt(fullWeek, 80)).toBe('2026-03-06T00:00');
    // Monday 03-09 → Monday 03-16 with the Wednesday 03-11 holiday: 4 working days. 50 % ends
    // with Tuesday (the boundary stays before the holiday), 75 % with Thursday.
    const withHoliday = span('2026-03-09', '2026-03-16', 'working');
    expect(dateAt(withHoliday, 50)).toBe('2026-03-11T00:00');
    expect(dateAt(withHoliday, 75)).toBe('2026-03-13T00:00');
  });

  it('FR-PROG-1: a span without working time falls back to calendar time', () => {
    const weekend = span('2026-03-07', '2026-03-09', 'working');
    expect(dateAt(weekend, 50)).toBe('2026-03-08T00:00');
  });

  it('FR-PROG-1: a zero-length span has its date for every progress', () => {
    const point = span('2026-03-02T10:00', '2026-03-02T10:00', 'calendar');
    expect(dateAt(point, 0)).toBe('2026-03-02T10:00');
    expect(dateAt(point, 50)).toBe('2026-03-02T10:00');
    expect(dateAt(point, 100)).toBe('2026-03-02T10:00');
  });
});

describe('progress/dateToProgress', () => {
  it('FR-PROG-1: is the share of calendar time before the date, clamped to 0 … 100', () => {
    expect(dateToProgress({ ...week, date: at('2026-03-05') })).toBe(60);
    expect(dateToProgress({ ...week, date: at('2026-03-04T12:00') })).toBe(50);
    expect(dateToProgress({ ...week, date: at('2026-02-20') })).toBe(0);
    expect(dateToProgress({ ...week, date: at('2026-04-01') })).toBe(100);
  });

  it('FR-PROG-1: is the share of working time in working mode', () => {
    expect(dateToProgress({ ...fullWeek, date: at('2026-03-04T12:00') })).toBe(50);
    // Saturday and Sunday add no working time: Saturday is already 100 %.
    expect(dateToProgress({ ...fullWeek, date: at('2026-03-07T12:00') })).toBe(100);
    const weekend = span('2026-03-07', '2026-03-09', 'working');
    expect(dateToProgress({ ...weekend, date: at('2026-03-08') })).toBe(50);
  });

  it('FR-PROG-1: a zero-length span is 0 before its date and 100 from it on', () => {
    const point = span('2026-03-02', '2026-03-02', 'calendar');
    expect(dateToProgress({ ...point, date: at('2026-03-01') })).toBe(0);
    expect(dateToProgress({ ...point, date: at('2026-03-02') })).toBe(100);
  });

  it('FR-PROG-1, FR-SNAP-15: round trip with 1-minute granularity is exact to one minute', () => {
    const minute = step('1min');
    const base = Date.UTC(2026, 0, 5) / MINUTE;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 * 24 * 60 }),
        fc.integer({ min: 1, max: 60 * 24 * 30 }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.boolean(),
        (offset, length, progress, working) => {
          const start = asDateTimeMs((base + offset) * MINUTE);
          const input: ProgressSpan = {
            start,
            endExclusive: asDateTimeMs(start + length * MINUTE),
            mode: working ? 'working' : 'calendar',
            calendar: working ? calendar : allWorking,
          };
          const date = progressToDate({ ...input, progress, granularity: minute });
          expect(date % MINUTE).toBe(0);
          expect(date).toBeGreaterThanOrEqual(input.start);
          expect(date).toBeLessThanOrEqual(input.endExclusive);
          // A span without working time is measured in calendar time.
          const total =
            (working ? calendar.countWorkingTime(input.start, input.endExclusive) : 0) ||
            length * MINUTE;
          const back = dateToProgress({ ...input, date });
          // Aligning down loses less than one minute of the (working) time; rounding the amount
          // to whole milliseconds adds at most half a millisecond.
          expect(progress - back).toBeLessThan((MINUTE / total) * 100 + 1e-9);
          expect(back).toBeLessThanOrEqual(progress + (0.5 / total) * 100 + 1e-9);
        },
      ),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  type DateTimeMs,
  DEFAULT_GRANULARITY,
  type Granularity,
  parseDateInput,
  parseGranularity,
  toISODateTime,
} from '../time';
import {
  type ProgressAnchor,
  type ProgressBounds,
  progressToDate,
  rebaseProgress,
  type RebaseProgressInput,
} from './index';

// March 2026: Monday 02, Saturday 07, Monday 09, Wednesday 11 (a holiday). February 26 is a Thursday.
const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });

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

function bounds(start: string, endExclusive: string): ProgressBounds {
  return { start: at(start), endExclusive: at(endExclusive) };
}

interface RebaseOptions {
  readonly anchor?: ProgressAnchor;
  readonly mode?: 'calendar' | 'working';
  readonly granularity?: Granularity;
}

/** Rebases `progress` from `from` onto `to`; the result's date as ISO text. */
function rebase(
  progress: number,
  from: ProgressBounds,
  to: ProgressBounds,
  options: RebaseOptions = {},
): { progress: number; date: string } {
  const input: RebaseProgressInput = {
    progress,
    from,
    to,
    anchor: options.anchor,
    mode: options.mode ?? 'calendar',
    calendar,
    granularity: options.granularity ?? DEFAULT_GRANULARITY,
  };
  const result = rebaseProgress(input);
  // The date is always what a record with the new progress shows on the new span.
  expect(progressToDate({ ...input, ...to, progress: result.progress })).toBe(result.progressDate);
  return { progress: result.progress, date: toISODateTime(result.progressDate) };
}

// Monday → Saturday: 5 days, all working.
const week = bounds('2026-03-02', '2026-03-07');
const end = { anchor: 'end' } as const;

describe("progress/rebaseProgress: anchor 'start' keeps the completed amount", () => {
  // 40 % of 5 days: 2 days done.
  it('FR-PROG-2: grow and shrink at the end, the boundary stays put', () => {
    expect(rebase(40, week, bounds('2026-03-02', '2026-03-09'))).toEqual({
      progress: (40 * 5) / 7,
      date: '2026-03-04T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-02', '2026-03-05'))).toEqual({
      progress: (40 * 5) / 3,
      date: '2026-03-04T00:00',
    });
  });

  it('FR-PROG-2: grow and shrink at the start, the boundary moves with the start', () => {
    expect(rebase(40, week, bounds('2026-02-26', '2026-03-07'))).toEqual({
      progress: (40 * 5) / 9,
      date: '2026-02-28T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-04', '2026-03-07'))).toEqual({
      progress: (40 * 5) / 3,
      date: '2026-03-06T00:00',
    });
  });

  it('FR-PROG-2: the anchor defaults to start', () => {
    const to = bounds('2026-03-02', '2026-03-09');
    expect(rebase(40, week, to)).toEqual(rebase(40, week, to, { anchor: 'start' }));
  });

  it('FR-PROG-2: shrinking below the completed amount completes the task', () => {
    expect(rebase(40, week, bounds('2026-03-02', '2026-03-03'))).toEqual({
      progress: 100,
      date: '2026-03-03T00:00',
    });
    expect(rebase(0, week, bounds('2026-03-02', '2026-03-03'))).toEqual({
      progress: 0,
      date: '2026-03-02T00:00',
    });
  });
});

describe("progress/rebaseProgress: anchor 'end' keeps the unfinished remainder", () => {
  // 40 % of 5 days: 3 days left.
  it('FR-PROG-2: grow and shrink at the end, the boundary moves with the end', () => {
    expect(rebase(40, week, bounds('2026-03-02', '2026-03-09'), end)).toEqual({
      progress: 100 - (60 * 5) / 7,
      date: '2026-03-06T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-02', '2026-03-06'), end)).toEqual({
      progress: 25,
      date: '2026-03-03T00:00',
    });
  });

  it('FR-PROG-2: grow and shrink at the start, the boundary stays put', () => {
    expect(rebase(40, week, bounds('2026-02-26', '2026-03-07'), end)).toEqual({
      progress: 100 - (60 * 5) / 9,
      date: '2026-03-04T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-04', '2026-03-07'), end)).toEqual({
      progress: 0,
      date: '2026-03-04T00:00',
    });
  });

  it('FR-PROG-2: stretched past the plan, the overrun shows as done work; shrunk below the remainder, nothing is done', () => {
    expect(rebase(0, week, bounds('2026-03-02', '2026-03-12'), end)).toEqual({
      progress: 50,
      date: '2026-03-07T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-05', '2026-03-07'), end)).toEqual({
      progress: 0,
      date: '2026-03-05T00:00',
    });
    expect(rebase(100, week, bounds('2026-03-02', '2026-03-12'), end)).toEqual({
      progress: 100,
      date: '2026-03-12T00:00',
    });
  });
});

describe('progress/rebaseProgress: working and calendar time', () => {
  // 60 % of Monday → Saturday: 3 days done, 2 left; the new end Tuesday 03-10 adds a weekend
  // and one working day (5 → 6 working days, 5 → 8 calendar days).
  const longer = bounds('2026-03-02', '2026-03-10');

  it("FR-PROG-2: anchor 'start' with a weekend inside", () => {
    expect(rebase(60, week, longer, { mode: 'working' })).toEqual({
      progress: 50,
      date: '2026-03-05T00:00',
    });
    expect(rebase(60, week, longer)).toEqual({ progress: 37.5, date: '2026-03-05T00:00' });
  });

  it("FR-PROG-2: anchor 'end' with a weekend inside", () => {
    // Working: 2 working days left (Friday, Monday), so 4 of 6 are done: Friday 00:00.
    expect(rebase(60, week, longer, { ...end, mode: 'working' })).toEqual({
      progress: 100 - (40 * 5) / 6,
      date: '2026-03-06T00:00',
    });
    // Calendar: 2 days left (Sunday, Monday), so 6 of 8 are done: Sunday 00:00.
    expect(rebase(60, week, longer, end)).toEqual({ progress: 75, date: '2026-03-08T00:00' });
  });

  it('FR-PROG-2: growing at the start over a weekend in working mode', () => {
    // Thursday 02-26 → Saturday 03-07: 7 working days.
    const earlier = bounds('2026-02-26', '2026-03-07');
    expect(rebase(60, week, earlier, { mode: 'working' })).toEqual({
      progress: (60 * 5) / 7,
      date: '2026-03-03T00:00',
    });
    expect(rebase(60, week, earlier, { ...end, mode: 'working' })).toEqual({
      progress: 100 - (40 * 5) / 7,
      date: '2026-03-05T00:00',
    });
  });

  it('FR-PROG-2: a resize that adds only non-working time keeps the percentage in working mode', () => {
    const withWeekend = bounds('2026-03-02', '2026-03-09');
    expect(rebase(60, week, withWeekend, { mode: 'working' })).toEqual({
      progress: 60,
      date: '2026-03-05T00:00',
    });
    expect(rebase(60, week, withWeekend, { ...end, mode: 'working' })).toEqual({
      progress: 60,
      date: '2026-03-05T00:00',
    });
  });

  it('FR-PROG-1: when a span has no working time, both are measured in calendar time', () => {
    const weekend = bounds('2026-03-07', '2026-03-09');
    // 20 % of 5 days is 1 day: half of the 2-day weekend.
    expect(rebase(20, week, weekend, { mode: 'working' })).toEqual({
      progress: 50,
      date: '2026-03-08T00:00',
    });
    expect(rebase(50, weekend, week, { mode: 'working' })).toEqual({
      progress: 20,
      date: '2026-03-03T00:00',
    });
  });
});

describe('progress/rebaseProgress: moves, identity and edge cases', () => {
  it('FR-PROG-2: a pure move keeps the percentage', () => {
    expect(rebase(40, week, bounds('2026-03-03', '2026-03-08'))).toEqual({
      progress: 40,
      date: '2026-03-05T00:00',
    });
    expect(rebase(40, week, bounds('2026-03-03', '2026-03-08'), end)).toEqual({
      progress: 40,
      date: '2026-03-05T00:00',
    });
    // Working mode: Wednesday → next Wednesday (exclusive) also holds 5 working days.
    expect(rebase(60, week, bounds('2026-03-04', '2026-03-11'), { mode: 'working' })).toEqual({
      progress: 60,
      date: '2026-03-07T00:00',
    });
  });

  it('FR-PROG-2: identical spans are the identity, for fractional percentages too', () => {
    for (const anchor of ['start', 'end'] as const) {
      expect(rebase(100 / 3, week, week, { anchor }).progress).toBe(100 / 3);
      expect(rebase(12.345, week, week, { anchor, mode: 'working' }).progress).toBe(12.345);
    }
  });

  it('FR-PROG-2: the percentage is not quantized, so a resize and its undo do not drift', () => {
    const longer = bounds('2026-03-02', '2026-03-09');
    const there = rebase(50, week, longer, { granularity: step('1h') });
    // 2.5 days done: aligned down only in the date.
    expect(there).toEqual({ progress: (50 * 5) / 7, date: '2026-03-04T12:00' });
    expect(rebase(50, week, longer).date).toBe('2026-03-04T00:00');
    expect(rebase(there.progress, longer, week).progress).toBeCloseTo(50, 12);
    const back = rebase(rebase(50, week, longer, end).progress, longer, week, end);
    expect(back.progress).toBeCloseTo(50, 12);
  });

  it('FR-PROG-1: out-of-range and NaN progress are clamped first', () => {
    const longer = bounds('2026-03-02', '2026-03-09');
    expect(rebase(Number.NaN, week, longer)).toEqual({ progress: 0, date: '2026-03-02T00:00' });
    expect(rebase(-5, week, longer, end).progress).toBe(100 - (100 * 5) / 7);
    expect(rebase(150, week, week)).toEqual({ progress: 100, date: '2026-03-07T00:00' });
  });

  it('FR-PROG-2: to a zero-length span (a milestone) progress becomes 0 or 100', () => {
    const point = bounds('2026-03-04', '2026-03-04');
    for (const anchor of ['start', 'end'] as const) {
      expect(rebase(40, week, point, { anchor })).toEqual({
        progress: 0,
        date: '2026-03-04T00:00',
      });
      expect(rebase(0, week, point, { anchor })).toEqual({ progress: 0, date: '2026-03-04T00:00' });
      expect(rebase(100, week, point, { anchor })).toEqual({
        progress: 100,
        date: '2026-03-04T00:00',
      });
    }
  });

  it('FR-PROG-2: from a zero-length span the percentage is kept', () => {
    const point = bounds('2026-03-02', '2026-03-02');
    expect(rebase(100, point, week, end)).toEqual({ progress: 100, date: '2026-03-07T00:00' });
    expect(rebase(0, point, week, end)).toEqual({ progress: 0, date: '2026-03-02T00:00' });
    expect(rebase(40, point, week)).toEqual({ progress: 40, date: '2026-03-04T00:00' });
    // A moved milestone keeps its percentage as well.
    expect(rebase(40, point, bounds('2026-03-05', '2026-03-05'))).toEqual({
      progress: 40,
      date: '2026-03-05T00:00',
    });
  });
});

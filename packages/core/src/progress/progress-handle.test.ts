import { describe, expect, it } from 'vitest';

import { createWorkCalendar, type WorkCalendar } from '../calendar';
import {
  asDateTimeMs,
  type DateTimeMs,
  DEFAULT_GRANULARITY,
  type Granularity,
  parseDateInput,
  parseGranularity,
  toISODateTime,
} from '../time';
import {
  progressFromDate,
  type ProgressFromDateInput,
  type ProgressSpan,
  progressToDate,
} from './index';

// March 2026: Monday 02, Saturday 07, Sunday 08, Monday 09, Wednesday 11 (a holiday), Monday 16.
const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });
const HOUR = step('1h');

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

function span(
  start: string,
  endExclusive: string,
  mode: 'calendar' | 'working' = 'calendar',
  workCalendar: WorkCalendar = calendar,
): ProgressSpan {
  return { start: at(start), endExclusive: at(endExclusive), mode, calendar: workCalendar };
}

type DragOptions = Partial<
  Pick<ProgressFromDateInput, 'direction' | 'skipNonWorking' | 'granularity'>
>;

/** Drags the handle of `base` to `t`; the result's date as ISO text. */
function drag(
  base: ProgressSpan,
  t: string | DateTimeMs,
  options: DragOptions = {},
): { progress: number; date: string } {
  const granularity = options.granularity ?? DEFAULT_GRANULARITY;
  const result = progressFromDate({
    ...base,
    ...options,
    t: typeof t === 'string' ? at(t) : t,
    granularity,
  });
  // The date is always what a record with this progress shows.
  expect(progressToDate({ ...base, progress: result.progress, granularity })).toBe(
    result.progressDate,
  );
  return { progress: result.progress, date: toISODateTime(result.progressDate) };
}

const percent = (part: number, whole: number): number => (part / whole) * 100;

// Monday 03-02 → Monday 03-16: 14 calendar days; 9 working days (the 11th is a holiday).
const twoWeeks = span('2026-03-02', '2026-03-16');
const twoWeeksWorking = span('2026-03-02', '2026-03-16', 'working');
const skip = { skipNonWorking: true } as const;

describe('progress/progressFromDate: skipping non-working days', () => {
  it('FR-PROG-3, FR-SCH-4: dragged forward into the weekend, the boundary jumps to Monday (Fri → Mon)', () => {
    const monday = { progress: 50, date: '2026-03-09T00:00' };
    expect(drag(twoWeeks, '2026-03-08', { ...skip, direction: 1 })).toEqual(monday);
    expect(
      drag(twoWeeks, '2026-03-07T12:00', { ...skip, direction: 1, granularity: HOUR }),
    ).toEqual(monday);
    expect(
      drag(twoWeeks, '2026-03-08T23:00', { ...skip, direction: 1, granularity: HOUR }),
    ).toEqual(monday);
  });

  it('FR-PROG-3, FR-SCH-4: direction 0 counts as forward', () => {
    expect(drag(twoWeeks, '2026-03-08', { ...skip, direction: 0 })).toEqual({
      progress: 50,
      date: '2026-03-09T00:00',
    });
    expect(drag(twoWeeks, '2026-03-08', skip)).toEqual({ progress: 50, date: '2026-03-09T00:00' });
  });

  it('FR-PROG-3, FR-SCH-4: dragged backward into the weekend, the boundary jumps to the end of Friday', () => {
    const friday = { progress: percent(5, 14), date: '2026-03-07T00:00' };
    expect(drag(twoWeeks, '2026-03-08', { ...skip, direction: -1 })).toEqual(friday);
    expect(
      drag(twoWeeks, '2026-03-07T12:00', { ...skip, direction: -1, granularity: HOUR }),
    ).toEqual(friday);
  });

  it('FR-PROG-3, FR-SCH-4: the edges of a non-working stretch are not inside it and never move', () => {
    // Saturday 00:00 is the end of Friday, Monday 00:00 the start of Monday.
    expect(drag(twoWeeks, '2026-03-07', { ...skip, direction: 1 })).toEqual({
      progress: percent(5, 14),
      date: '2026-03-07T00:00',
    });
    expect(drag(twoWeeks, '2026-03-09', { ...skip, direction: -1 })).toEqual({
      progress: 50,
      date: '2026-03-09T00:00',
    });
  });

  it('FR-PROG-3: skipping is the default, as for `scheduling.skipNonWorkingDays.progress`', () => {
    expect(drag(twoWeeks, '2026-03-08', { direction: 1 })).toEqual({
      progress: 50,
      date: '2026-03-09T00:00',
    });
  });

  it('FR-PROG-3: without skipping the boundary may rest inside the weekend', () => {
    expect(drag(twoWeeks, '2026-03-08', { skipNonWorking: false })).toEqual({
      progress: percent(6, 14),
      date: '2026-03-08T00:00',
    });
    expect(drag(twoWeeks, '2026-03-08', { direction: 1, skipNonWorking: false })).toEqual({
      progress: percent(6, 14),
      date: '2026-03-08T00:00',
    });
  });

  it('FR-PROG-3, FR-SCH-4: a holiday is skipped like a weekend', () => {
    expect(
      drag(twoWeeks, '2026-03-11T12:00', { ...skip, direction: 1, granularity: HOUR }),
    ).toEqual({ progress: percent(10, 14), date: '2026-03-12T00:00' });
    expect(
      drag(twoWeeks, '2026-03-11T12:00', { ...skip, direction: -1, granularity: HOUR }),
    ).toEqual({ progress: percent(9, 14), date: '2026-03-11T00:00' });
  });

  it('FR-PROG-3, FR-SCH-4: a holiday next to the weekend makes one stretch', () => {
    const { calendar: longWeekend } = createWorkCalendar({ holidays: ['2026-03-09'] });
    const base = span('2026-03-02', '2026-03-16', 'calendar', longWeekend);
    expect(drag(base, '2026-03-08', { ...skip, direction: 1 })).toEqual({
      progress: percent(8, 14),
      date: '2026-03-10T00:00',
    });
    // Monday 00:00 follows a non-working Sunday, so it is inside the stretch.
    expect(drag(base, '2026-03-09', { ...skip, direction: -1 })).toEqual({
      progress: percent(5, 14),
      date: '2026-03-07T00:00',
    });
  });

  it('FR-PROG-3, FR-SCH-4: in working mode the boundary rests at the start of the stretch either way', () => {
    // The weekend holds no work: Friday 24:00, Sunday and Monday 00:00 are the same 5 of 9 days.
    const friday = { progress: percent(5, 9), date: '2026-03-07T00:00' };
    expect(drag(twoWeeksWorking, '2026-03-08', { ...skip, direction: 1 })).toEqual(friday);
    expect(drag(twoWeeksWorking, '2026-03-08', { ...skip, direction: -1 })).toEqual(friday);
    expect(drag(twoWeeksWorking, '2026-03-08')).toEqual(friday);
    expect(drag(twoWeeksWorking, '2026-03-09', { ...skip, direction: 1 })).toEqual(friday);
    expect(drag(twoWeeksWorking, '2026-03-09T12:00', { granularity: HOUR })).toEqual({
      progress: percent(5.5, 9),
      date: '2026-03-09T12:00',
    });
    // The holiday: Tuesday done is 7 of 9 days, Wednesday 00:00 … Thursday 00:00.
    expect(drag(twoWeeksWorking, '2026-03-12', { ...skip, direction: 1 })).toEqual({
      progress: percent(7, 9),
      date: '2026-03-11T00:00',
    });
  });

  it('FR-PROG-1: a span without working time is measured in calendar time and can be skipped over', () => {
    const weekend = span('2026-03-07', '2026-03-09', 'working');
    expect(drag(weekend, '2026-03-08', { skipNonWorking: false })).toEqual({
      progress: 50,
      date: '2026-03-08T00:00',
    });
    expect(drag(weekend, '2026-03-08', { ...skip, direction: 1 })).toEqual({
      progress: 100,
      date: '2026-03-09T00:00',
    });
    expect(drag(weekend, '2026-03-08', { ...skip, direction: -1 })).toEqual({
      progress: 0,
      date: '2026-03-07T00:00',
    });
  });

  it('FR-PROG-3, FR-SCH-4: without any working day to skip to, the boundary goes to the end of the span', () => {
    const { calendar: never } = createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] });
    const base = span('2026-03-02', '2026-03-16', 'working', never);
    expect(drag(base, '2026-03-08', { ...skip, direction: 1 })).toEqual({
      progress: 100,
      date: '2026-03-16T00:00',
    });
    expect(drag(base, '2026-03-08', { ...skip, direction: -1 })).toEqual({
      progress: 0,
      date: '2026-03-02T00:00',
    });
  });
});

describe('progress/progressFromDate: clamping, alignment, edge cases', () => {
  it('FR-PROG-1, FR-PROG-3: beyond either end the boundary is clamped to exactly 0 % or 100 %', () => {
    expect(drag(twoWeeks, '2026-02-20')).toEqual({ progress: 0, date: '2026-03-02T00:00' });
    expect(drag(twoWeeks, '2026-03-02')).toEqual({ progress: 0, date: '2026-03-02T00:00' });
    expect(drag(twoWeeks, '2026-03-16')).toEqual({ progress: 100, date: '2026-03-16T00:00' });
    expect(drag(twoWeeks, '2026-04-20', { ...skip, direction: -1 })).toEqual({
      progress: 100,
      date: '2026-03-16T00:00',
    });
    expect(drag(twoWeeks, asDateTimeMs(Number.POSITIVE_INFINITY))).toEqual({
      progress: 100,
      date: '2026-03-16T00:00',
    });
    expect(drag(twoWeeks, asDateTimeMs(Number.NEGATIVE_INFINITY))).toEqual({
      progress: 0,
      date: '2026-03-02T00:00',
    });
    expect(drag(twoWeeks, asDateTimeMs(Number.NaN))).toEqual({
      progress: 0,
      date: '2026-03-02T00:00',
    });
  });

  it('FR-PROG-3, FR-SCH-4: a skip past either end is clamped to the span', () => {
    // Starts on Sunday noon: backward the stretch starts on Saturday, before the span.
    const fromSunday = span('2026-03-08T12:00', '2026-03-13', 'calendar');
    expect(
      drag(fromSunday, '2026-03-08T18:00', { ...skip, direction: -1, granularity: HOUR }),
    ).toEqual({ progress: 0, date: '2026-03-08T12:00' });
    // Ends on Sunday noon: forward the stretch ends on Monday, after the span.
    const toSunday = span('2026-03-05', '2026-03-08T12:00', 'calendar');
    expect(
      drag(toSunday, '2026-03-07T12:00', { ...skip, direction: 1, granularity: HOUR }),
    ).toEqual({ progress: 100, date: '2026-03-08T12:00' });
  });

  it('FR-PROG-1: 100 % is exactly the end, also when working mode ends with a weekend', () => {
    const fullWeek = span('2026-03-02', '2026-03-09', 'working');
    // Friday done is all the work: the boundary fills the bar up to Monday.
    expect(drag(fullWeek, '2026-03-07')).toEqual({ progress: 100, date: '2026-03-09T00:00' });
    expect(drag(fullWeek, '2026-03-06')).toEqual({ progress: 80, date: '2026-03-06T00:00' });
    // A start on a non-working day: no work before Monday is 0 %, drawn at the start.
    const fromSaturday = span('2026-03-07', '2026-03-12', 'working');
    expect(drag(fromSaturday, '2026-03-09')).toEqual({ progress: 0, date: '2026-03-07T00:00' });
  });

  it("FR-SNAP-15: the boundary is aligned down to the granularity, '1h' vs '1d'", () => {
    const week = span('2026-03-02', '2026-03-07');
    expect(drag(week, '2026-03-04T13:30', { granularity: HOUR })).toEqual({
      progress: percent(48 + 13, 120),
      date: '2026-03-04T13:00',
    });
    expect(drag(week, '2026-03-04T13:30')).toEqual({ progress: 40, date: '2026-03-04T00:00' });
    expect(drag(week, '2026-03-04T13:30', { granularity: step('15min') })).toEqual({
      progress: percent(48 * 60 + 13 * 60 + 30, 120 * 60),
      date: '2026-03-04T13:30',
    });
  });

  it('FR-PROG-1: fractional percentages are kept and map back to their date', () => {
    const threeDays = span('2026-03-02', '2026-03-05');
    expect(drag(threeDays, '2026-03-03')).toEqual({
      progress: percent(1, 3),
      date: '2026-03-03T00:00',
    });
    expect(drag(threeDays, '2026-03-04')).toEqual({
      progress: percent(2, 3),
      date: '2026-03-04T00:00',
    });
    // 1/3 of 3 days is 86 399 999.99… ms in floating point: rounded to whole milliseconds, it
    // stays one day instead of aligning down to the start.
    const granularity = DEFAULT_GRANULARITY;
    expect(
      toISODateTime(progressToDate({ ...threeDays, progress: percent(1, 3), granularity })),
    ).toBe('2026-03-03T00:00');
    const elevenDays = span('2026-03-02', '2026-03-13');
    expect(toISODateTime(progressToDate({ ...elevenDays, progress: 300 / 11, granularity }))).toBe(
      '2026-03-05T00:00',
    );
  });

  it('FR-PROG-1: a zero-length span (a milestone) is 0 % before its date and 100 % from it on', () => {
    const point = span('2026-03-02T10:00', '2026-03-02T10:00');
    expect(drag(point, '2026-03-02T09:00', { granularity: HOUR })).toEqual({
      progress: 0,
      date: '2026-03-02T10:00',
    });
    expect(drag(point, '2026-03-02T10:00', { granularity: HOUR })).toEqual({
      progress: 100,
      date: '2026-03-02T10:00',
    });
    expect(drag(point, '2026-03-05', { ...skip, direction: -1, granularity: HOUR })).toEqual({
      progress: 100,
      date: '2026-03-02T10:00',
    });
  });
});

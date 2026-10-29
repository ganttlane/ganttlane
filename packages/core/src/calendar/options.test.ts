import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asDayKey, DAY, type DayKey } from '../time';
import type { WorkCalendarOptions } from './options';
import { createWorkCalendar } from './work-calendar';

function day(iso: string): DayKey {
  return asDayKey(Date.parse(iso) / DAY);
}

/** Creates a calendar from untyped options and returns its issues without messages. */
function issuesOf(
  options: unknown,
): { code: string; severity: string; path?: string | undefined }[] {
  const { issues } = createWorkCalendar(options as WorkCalendarOptions);
  for (const issue of issues) expect(issue.message.length).toBeGreaterThan(20);
  return issues.map(({ code, severity, path }) => ({ code, severity, path }));
}

describe('calendar/options: invalid input becomes issues (never throws)', () => {
  it.each<[string, unknown, { code: string; severity: string; path?: string }[]]>([
    [
      'weekends not an array',
      { weekends: 'sat' },
      [{ code: 'invalid-weekend', severity: 'error', path: 'calendar.weekends' }],
    ],
    [
      'weekends with bad entries',
      { weekends: [7, -1, 1.5, '6', null, 6] },
      [0, 1, 2, 3, 4].map((i) => ({
        code: 'invalid-weekend',
        severity: 'error',
        path: `calendar.weekends[${i}]`,
      })),
    ],
    [
      'holidays not an array',
      { holidays: '2026-03-04' },
      [{ code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays' }],
    ],
    [
      'invalid holiday dates and shapes',
      {
        holidays: [
          '2026-02-30',
          '2026-03-04T10:00Z',
          '04.03.2026',
          Number.NaN,
          new Date(Number.NaN),
          {},
          { date: 'x' },
          null,
          true,
        ],
      },
      [
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[0]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[1]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[2]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[3]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[4]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[5]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[6].date' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[7]' },
        { code: 'invalid-holiday', severity: 'error', path: 'calendar.holidays[8]' },
      ],
    ],
    [
      'a holiday name that is not a string',
      { holidays: [{ date: '2026-03-04', name: 42 }] },
      [{ code: 'invalid-holiday', severity: 'warning', path: 'calendar.holidays[0].name' }],
    ],
    [
      'holiday and working-day dates with a time of day',
      {
        holidays: ['2026-03-04T10:00', '2026-03-05T00:00', { date: '2026-03-06T23:59' }],
        workingDays: ['2026-03-07T12:00'],
      },
      [
        { code: 'time-ignored', severity: 'warning', path: 'calendar.holidays[0]' },
        { code: 'time-ignored', severity: 'warning', path: 'calendar.holidays[2].date' },
        { code: 'time-ignored', severity: 'warning', path: 'calendar.workingDays[0]' },
      ],
    ],
    [
      'workingDays not an array',
      { workingDays: 5 },
      [{ code: 'invalid-working-day', severity: 'error', path: 'calendar.workingDays' }],
    ],
    [
      'invalid working days',
      { workingDays: ['2026-13-01', { date: '2026-03-07' }] },
      [
        { code: 'invalid-working-day', severity: 'error', path: 'calendar.workingDays[0]' },
        { code: 'invalid-working-day', severity: 'error', path: 'calendar.workingDays[1]' },
      ],
    ],
    [
      'isWorkingDay not a function',
      { isWorkingDay: 'weekdays' },
      [{ code: 'invalid-rule', severity: 'error', path: 'calendar.isWorkingDay' }],
    ],
    [
      'a full-week weekend',
      { weekends: [0, 1, 2, 3, 4, 5, 6] },
      [{ code: 'no-working-days', severity: 'warning', path: 'calendar.weekends' }],
    ],
    [
      'a full-week weekend with an exception',
      { weekends: [0, 1, 2, 3, 4, 5, 6], workingDays: ['2026-03-07'] },
      [],
    ],
    [
      'a full-week weekend with a rule',
      { weekends: [0, 1, 2, 3, 4, 5, 6], isWorkingDay: () => true },
      [],
    ],
    ['null options', null, []],
    [
      'explicit undefined fields',
      { weekends: undefined, holidays: undefined, isWorkingDay: undefined },
      [],
    ],
  ])('%s', (_name, options, expected) => {
    expect(issuesOf(options)).toEqual(expected);
  });

  it('skips invalid entries and keeps the valid ones', () => {
    const { calendar } = createWorkCalendar({
      weekends: [6, 9],
      holidays: ['2026-02-30', '2026-03-04', { date: '2026-03-05', name: 42 as unknown as string }],
      workingDays: ['bad', '2026-03-07'],
      isWorkingDay: 'x' as unknown as () => undefined,
    });
    expect(calendar.isWorkingDay(day('2026-03-01'))).toBe(true); // Sunday: only Saturday is off
    expect(calendar.explain(day('2026-03-04'))).toEqual({ working: false, reason: 'holiday' });
    expect(calendar.explain(day('2026-03-05'))).toEqual({ working: false, reason: 'holiday' });
    expect(calendar.explain(day('2026-03-07'))).toEqual({ working: true, reason: 'exception' });
  });

  it('falls back to the default weekends when weekends is not an array', () => {
    const { calendar } = createWorkCalendar({ weekends: {} as number[] });
    expect(calendar.isWorkingDay(day('2026-03-07'))).toBe(false);
    expect(calendar.isWorkingDay(day('2026-03-08'))).toBe(false);
    expect(calendar.isWorkingDay(day('2026-03-09'))).toBe(true);
  });

  it('quotes the offending value and the reason in the message', () => {
    const { issues } = createWorkCalendar({ holidays: ['2026-02-30'] });
    expect(issues[0]).toMatchObject({
      value: '2026-02-30',
      message: expect.stringContaining('has no day 30') as unknown,
    });
  });

  it('never throws, whatever the options', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.anything(),
        fc.anything(),
        fc.array(fc.oneof(fc.anything(), fc.date(), fc.record({ date: fc.anything() }))),
        (options, weekends, workingDays, holidays) => {
          const all = [
            options,
            { weekends, workingDays, holidays },
            { weekends: [weekends], workingDays: [workingDays], holidays },
          ];
          for (const input of all) {
            const { calendar, issues } = createWorkCalendar(input as WorkCalendarOptions);
            expect(Array.isArray(issues)).toBe(true);
            calendar.countDays(day('2026-01-01'), day('2026-02-01'));
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

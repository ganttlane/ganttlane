import { deepFreeze, workingDayScenarios } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar, type WorkCalendar } from '../calendar';
import { DAY, DEFAULT_GRANULARITY, HOUR, MINUTE, toISODateTime } from '../time';
import {
  type Link,
  type ModelIssue,
  type NormalizedModel,
  normalizeLink,
  normalizeModel,
  type NormalizeModelOptions,
  type Task,
  type TaskModel,
  type TaskSpan,
} from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6] });

type Options = Omit<NormalizeModelOptions, 'calendar'> & { readonly calendar?: WorkCalendar };

function normalize(
  tasks: readonly Task[],
  options: Options = {},
  links?: readonly Link[],
): NormalizedModel {
  return normalizeModel({ tasks, links }, { calendar, ...options });
}

/** Normalizes one task (id 1 unless given) and returns its model. */
function one(task: Partial<Task>, options?: Options): TaskModel {
  const model = normalize([{ id: 1, name: 'Task', ...task }], options);
  return model.tasks[0]!;
}

/** The span as readable ISO date-times. */
function times(span: TaskSpan | undefined): Record<string, string> | undefined {
  return (
    span && {
      start: toISODateTime(span.start),
      end: toISODateTime(span.end),
      endExclusive: toISODateTime(span.endExclusive),
    }
  );
}

/** Issues as `code@path` (severity only for warnings). */
function codes(issues: readonly ModelIssue[]): string[] {
  return issues.map(
    (issue) => `${issue.code}${issue.severity === 'warning' ? '?' : ''}@${issue.path ?? ''}`,
  );
}

describe('model/normalizeModel: dates (FR-DATA-2, FR-TIME-3, FR-TIME-8)', () => {
  it('FR-DATA-8: builds a task model with an inclusive date-only end and day counts', () => {
    const task: Task = { id: 'a', name: 'Week', start: '2026-03-02', end: '2026-03-06' };
    const model = normalize([task]);
    const record = model.tasks[0]!;
    expect(record).toEqual({
      id: 'a',
      index: 0,
      task,
      name: 'Week',
      type: 'task',
      valid: true,
      precision: 'day',
      durationMode: 'calendar',
      progress: 0,
      parentId: undefined,
      span: {
        start: Date.UTC(2026, 2, 2),
        endExclusive: Date.UTC(2026, 2, 7),
        end: Date.UTC(2026, 2, 6),
        duration: {
          calendarDays: 5,
          workingDays: 5,
          nonWorkingDays: 0,
          ms: 5 * DAY,
          workingMs: 5 * DAY,
        },
        progressDate: Date.UTC(2026, 2, 2),
      },
      issues: [],
    });
    expect(record.task).toBe(task);
    expect(model.taskById.get('a')).toBe(record);
    expect(model.issues).toEqual([]);
  });

  it('FR-DATA-2: end wins over duration', () => {
    const record = one({ start: '2026-03-02', end: '2026-03-03', duration: 10 });
    expect(times(record.span)?.endExclusive).toBe('2026-03-04T00:00');
    expect(record.issues).toEqual([]);
  });

  it('FR-DATA-2: start + duration in days, as a duration string or object', () => {
    expect(times(one({ start: '2026-03-02', duration: 3 }).span)).toEqual({
      start: '2026-03-02T00:00',
      end: '2026-03-04T00:00',
      endExclusive: '2026-03-05T00:00',
    });
    expect(times(one({ start: '2026-03-02', duration: '2w' }).span)?.end).toBe('2026-03-15T00:00');
    expect(times(one({ start: '2026-03-02', duration: { weeks: 1 } }).span)?.end).toBe(
      '2026-03-08T00:00',
    );
    expect(times(one({ start: '2026-01-31', duration: '1mo' }).span)?.endExclusive).toBe(
      '2026-02-28T00:00',
    );
  });

  it('FR-TIME-6: a sub-day duration makes a time-precision task', () => {
    const hourly = { granularity: '1h' };
    const record = one({ start: '2026-03-02', duration: '1d 4h' }, hourly);
    expect(record.precision).toBe('time');
    expect(times(record.span)).toEqual({
      start: '2026-03-02T00:00',
      end: '2026-03-03T04:00',
      endExclusive: '2026-03-03T04:00',
    });
    expect(record.span?.duration.calendarDays).toBeCloseTo(28 / 24, 12);
    const half = one({ start: '2026-03-02', duration: 0.5 }, hourly);
    expect([half.precision, times(half.span)?.end]).toEqual(['time', '2026-03-02T12:00']);
  });

  it('FR-TIME-3: endInclusive: false makes a date-only end exclusive', () => {
    const record = one({ start: '2026-03-02', end: '2026-03-06' }, { endInclusive: false });
    expect(times(record.span)).toEqual({
      start: '2026-03-02T00:00',
      end: '2026-03-06T00:00',
      endExclusive: '2026-03-06T00:00',
    });
    expect(record.span?.duration.calendarDays).toBe(4);
  });

  it('FR-TIME-3: a date-only end after a start with time still covers its whole day', () => {
    const record = one({ start: '2026-03-02T10:00', end: '2026-03-03' }, { granularity: '1h' });
    expect(record.precision).toBe('time');
    expect(times(record.span)).toEqual({
      start: '2026-03-02T10:00',
      end: '2026-03-04T00:00',
      endExclusive: '2026-03-04T00:00',
    });
  });

  it('FR-TIME-8: precision "time" treats Dates at midnight as exact moments', () => {
    const dates = { start: new Date(2026, 2, 2), end: new Date(2026, 2, 4) };
    const byDay = one(dates);
    expect([byDay.precision, times(byDay.span)?.endExclusive]).toEqual(['day', '2026-03-05T00:00']);
    const byTime = one({ ...dates, precision: 'time' });
    expect([byTime.precision, times(byTime.span)?.endExclusive]).toEqual([
      'time',
      '2026-03-04T00:00',
    ]);
    expect(byTime.span?.duration.calendarDays).toBe(2);
  });

  it('FR-TIME-8: precision "day" puts times on day boundaries (misaligned)', () => {
    const record = one(
      { start: '2026-03-02T10:00', end: '2026-03-04T15:00', precision: 'day' },
      { granularity: '1h' },
    );
    expect(record.precision).toBe('day');
    expect(times(record.span)).toEqual({
      start: '2026-03-02T00:00',
      end: '2026-03-04T00:00',
      endExclusive: '2026-03-05T00:00',
    });
    expect(record.issues.map((issue) => [issue.path, issue.value, issue.suggested])).toEqual([
      ['tasks[0].start', '2026-03-02T10:00', '2026-03-02'],
      ['tasks[0].end', '2026-03-04T15:00', '2026-03-04'],
    ]);
  });

  it('FR-DATA-2: zero-length tasks are valid', () => {
    const point = one(
      { start: '2026-03-02T10:00', end: '2026-03-02T10:00' },
      { granularity: '1h' },
    );
    expect([point.valid, point.span?.duration.ms, times(point.span)?.end]).toEqual([
      true,
      0,
      '2026-03-02T10:00',
    ]);
    const empty = one({ start: '2026-03-02', duration: 0 });
    expect(times(empty.span)).toEqual({
      start: '2026-03-02T00:00',
      end: '2026-03-02T00:00',
      endExclusive: '2026-03-02T00:00',
    });
  });

  it('FR-DATA-2: a milestone is zero-length at its start; end and duration are ignored', () => {
    const milestone = one({
      type: 'milestone',
      start: '2026-03-04',
      end: '2026-03-10',
      duration: 3,
    });
    expect(milestone.type).toBe('milestone');
    expect(times(milestone.span)).toEqual({
      start: '2026-03-04T00:00',
      end: '2026-03-04T00:00',
      endExclusive: '2026-03-04T00:00',
    });
    expect(milestone.span?.duration.calendarDays).toBe(0);
    expect(milestone.issues).toEqual([]);
    expect(codes(one({ type: 'milestone', end: '2026-03-04' }).issues)).toEqual([
      'incomplete-dates@tasks[0]',
    ]);
  });
});

describe('model/normalizeModel: issues (FR-DATA-3, FR-DATA-4)', () => {
  it('FR-DATA-3: a task without dates is a placeholder row with a warning', () => {
    const record = one({});
    expect([record.type, record.valid, record.span]).toEqual(['placeholder', true, undefined]);
    expect(record.issues).toEqual([
      {
        code: 'no-dates',
        severity: 'warning',
        path: 'tasks[0]',
        taskId: 1,
        message: 'tasks[0]: no dates, shown as a row without a bar',
      },
    ]);
    expect(codes(one({ type: 'milestone' }).issues)).toEqual(['no-dates?@tasks[0]']);
  });

  it('FR-DATA-3: an explicit placeholder ignores its dates and gets no issue', () => {
    const record = one({ type: 'placeholder', start: 'garbage', progress: 50 });
    expect([record.type, record.valid, record.span, record.issues]).toEqual([
      'placeholder',
      true,
      undefined,
      [],
    ]);
    expect(record.progress).toBe(50);
  });

  it('FR-DATA-4: incomplete dates make the task invalid', () => {
    expect(codes(one({ start: '2026-03-02' }).issues)).toEqual(['incomplete-dates@tasks[0]']);
    expect(codes(one({ end: '2026-03-02' }).issues)).toEqual(['incomplete-dates@tasks[0]']);
    expect(codes(one({ duration: 2 }).issues)).toEqual(['incomplete-dates@tasks[0]']);
    expect(codes(one({ end: '2026-03-04', duration: 2 }).issues)).toEqual([
      'incomplete-dates@tasks[0]',
    ]);
    expect(one({ start: '2026-03-02' })).toMatchObject({ valid: false, span: undefined });
  });

  it('FR-DATA-4: invalid dates and durations come with the time module codes', () => {
    const record = one({ start: '2026-02-30', end: '2026-03-02T10:00Z' });
    expect(codes(record.issues)).toEqual([
      'invalid-date@tasks[0].start',
      'unsupported-offset@tasks[0].end',
    ]);
    expect(record.issues[0]).toMatchObject({ taskId: 1, value: '2026-02-30' });
    expect(record.issues[0]?.message).toMatch(/^tasks\[0\]\.start: Invalid date "2026-02-30"/);
    expect(codes(one({ start: '2026-03-02', duration: '3m' }).issues)).toEqual([
      'invalid-duration@tasks[0].duration',
    ]);
    expect(codes(one({ start: '2026-03-02', duration: -1 }).issues)).toEqual([
      'invalid-duration@tasks[0].duration',
    ]);
    expect(codes(one({ start: '2026-03-02', duration: Infinity }).issues)).toEqual([
      'invalid-duration@tasks[0].duration',
    ]);
    expect(one({ start: Number.NaN, end: '2026-03-02' }).valid).toBe(false);
  });

  it('FR-DATA-4: end before start is an error, the same day is fine (bug D3)', () => {
    const record = one({ start: '2026-03-20', end: '2026-03-10' });
    expect(record).toMatchObject({ valid: false, span: undefined });
    expect(record.issues).toEqual([
      expect.objectContaining({
        code: 'end-before-start',
        severity: 'error',
        path: 'tasks[0].end',
        value: '2026-03-10',
      }),
    ]);
    expect(one({ start: '2026-03-10', end: '2026-03-10' }).valid).toBe(true);
    expect(codes(one({ start: '2026-03-10T15:00', end: '2026-03-10T09:00' }).issues)).toEqual([
      'end-before-start@tasks[0].end',
    ]);
    // A date-only end covers its day, so a start later that day is fine; the day before is not.
    expect(one({ start: '2026-03-10T15:00', end: '2026-03-10' }, { granularity: '1h' }).valid).toBe(
      true,
    );
    expect(one({ start: '2026-03-10T15:00', end: '2026-03-09' }).valid).toBe(false);
    expect(one({ start: '2026-03-10', end: '2026-03-10' }, { endInclusive: false }).valid).toBe(
      true,
    );
  });

  it('FR-DATA-4: tasks longer than maxSpan (default 10 years) are too long', () => {
    expect(codes(one({ start: '2026-01-01', end: '2036-01-01' }).issues)).toEqual([
      'too-long@tasks[0].end',
    ]);
    expect(one({ start: '2026-01-01', end: '2035-12-31' }).valid).toBe(true);
    const week = { maxSpan: '1w' };
    expect(one({ start: '2026-03-02', duration: 7 }, week).valid).toBe(true);
    expect(codes(one({ start: '2026-03-02', duration: 8 }, week).issues)).toEqual([
      'too-long@tasks[0].duration',
    ]);
    // An end beyond the range of dates is too long as well.
    expect(codes(one({ start: '2026-01-01', duration: 1e12 }).issues)).toEqual([
      'too-long@tasks[0].duration',
    ]);
  });

  it('FR-PROG-1: progress is clamped to 0 … 100 with a warning; missing progress is 0', () => {
    expect(one({ start: '2026-03-02', duration: 1, progress: 150 })).toMatchObject({
      progress: 100,
      issues: [
        {
          code: 'progress-out-of-range',
          severity: 'warning',
          path: 'tasks[0].progress',
          value: 150,
          suggested: 100,
        },
      ],
    });
    expect(one({ start: '2026-03-02', duration: 1, progress: -Infinity }).progress).toBe(0);
    expect(one({ start: '2026-03-02', duration: 1 }).progress).toBe(0);
  });

  it('FR-PROG-1, FR-SNAP-15: the progress date follows the duration mode', () => {
    // Monday 2026-04-20 → Sunday 04-26: 7 days, 5 working; 80 % of the working time ends on
    // Friday, 80 % of all days (5.6) is Saturday after aligning down.
    const task = { start: '2026-04-20', end: '2026-04-26', progress: 80 };
    const working = one({ ...task, durationMode: 'working' });
    expect(toISODateTime(working.span!.progressDate)).toBe('2026-04-24T00:00');
    expect(toISODateTime(one(task).span!.progressDate)).toBe('2026-04-25T00:00');
    const hourly = one({ ...task, progress: 50 }, { granularity: '1h' });
    expect(toISODateTime(hourly.span!.progressDate)).toBe('2026-04-23T12:00');
  });

  it('FR-DATA-11: malformed tasks are dropped without an id, invalid rows otherwise', () => {
    const model = normalize([
      null,
      { name: 'No id' },
      { id: {}, name: 'Object id' },
      { id: 1, name: 2, parentId: 'p', start: '2026-03-02', end: '2026-03-03' },
      { id: 2, name: 'Bad parent', parentId: {}, start: '2026-03-02', duration: 1 },
      { id: 3, name: 'Bad dependency', start: '2026-03-02', duration: 1, dependencies: [{}] },
    ] as unknown as Task[]);
    expect(model.tasks.map((task) => [task.id, task.name, task.valid, task.parentId])).toEqual([
      [1, '', false, 'p'],
      [2, 'Bad parent', false, undefined],
      [3, 'Bad dependency', false, undefined],
    ]);
    expect(model.tasks.every((task) => task.span === undefined)).toBe(true);
    expect(codes(model.issues)).toEqual([
      'invalid-shape@tasks[0]',
      'invalid-shape@tasks[1].id',
      'invalid-shape@tasks[2].id',
      'invalid-shape@tasks[3].name',
      'invalid-shape@tasks[4].parentId',
      'invalid-shape@tasks[5].dependencies[0]',
    ]);
    expect(model.issues[1]?.message).toBe(
      'tasks[1].id: dropped: a task needs an id (a string or a number)',
    );
    expect(model.issues[3]).toMatchObject({ taskId: 1, value: 2 });
    expect(model.links).toEqual([]);
  });

  it('FR-DATA-11: tasks and links that are not arrays are reported', () => {
    const model = normalizeModel(
      { tasks: 'nope', links: {} } as unknown as { tasks: Task[]; links: Link[] },
      { calendar },
    );
    expect(codes(model.issues)).toEqual(['invalid-shape@tasks', 'invalid-shape@links']);
    expect([model.tasks, model.links]).toEqual([[], []]);
  });

  it('FR-DATA-4: a repeated task id is reported and the later task dropped', () => {
    const model = normalize([
      { id: 'd', name: 'First' },
      { id: 'd', name: 'Second', start: 'garbage' },
    ]);
    expect(model.tasks.map((task) => task.name)).toEqual(['First']);
    expect(model.taskById.get('d')?.name).toBe('First');
    expect(model.issues.at(-1)).toMatchObject({
      code: 'duplicate-id',
      severity: 'error',
      path: 'tasks[1].id',
      taskId: 'd',
    });
    expect(codes(model.issues)).toEqual(['no-dates?@tasks[0]', 'duplicate-id@tasks[1].id']);
  });

  it('FR-DATA-1: ids are compared with ===, so 5 and "5" are different tasks', () => {
    const model = normalize([
      { id: 5, name: 'Number' },
      { id: '5', name: 'String' },
      { id: 0, name: 'Zero' },
    ]);
    expect(model.tasks.map((task) => task.id)).toEqual([5, '5', 0]);
    expect(model.taskById.get(5)?.name).toBe('Number');
    expect(model.taskById.get('5')?.name).toBe('String');
    expect(model.taskById.get(0)?.name).toBe('Zero');
    expect(model.issues.every((issue) => issue.code === 'no-dates')).toBe(true);
  });

  it('FR-DATA-4: reports invalid options at their option paths and falls back to their defaults', () => {
    const model = normalize([{ id: 1, name: 'x', start: '2026-03-02', duration: 4000 }], {
      granularity: '5h',
      maxSpan: 'ten years',
    });
    expect(codes(model.issues)).toEqual([
      'invalid-granularity@scheduling.granularity',
      'invalid-duration@maxSpan',
      'too-long@tasks[0].duration',
    ]);
    expect(model.options.granularity).toBe(DEFAULT_GRANULARITY);
    expect(model.options.maxSpan).toEqual({ months: 120, ms: 0 });
    expect(codes(normalize([], { granularity: '5m' }).issues)).toEqual([
      'invalid-duration@scheduling.granularity',
    ]);
  });

  it('resolves the defaults of every option', () => {
    expect(normalize([]).options).toEqual({
      calendar,
      granularity: DEFAULT_GRANULARITY,
      alignInput: 'expand',
      endInclusive: true,
      durationMode: 'calendar',
      defaultLinkType: 'FS',
      maxSpan: { months: 120, ms: 0 },
    });
  });
});

describe('model/normalizeModel: granularity (FR-SNAP-12, FR-SNAP-13, ADR-017)', () => {
  const misaligned = { start: '2026-01-05T10:30', end: '2026-01-05T11:30' };

  it("FR-SNAP-13: '1h' expands 10:30–11:30 to 10:00–12:00 with two warnings", () => {
    const record = one(misaligned, { granularity: '1h' });
    expect(times(record.span)).toEqual({
      start: '2026-01-05T10:00',
      end: '2026-01-05T12:00',
      endExclusive: '2026-01-05T12:00',
    });
    expect(record.issues).toEqual([
      {
        code: 'misaligned',
        severity: 'warning',
        path: 'tasks[0].start',
        taskId: 1,
        value: '2026-01-05T10:30',
        suggested: '2026-01-05T10:00',
        message:
          'tasks[0].start: not a multiple of the granularity 1h, aligned to "2026-01-05T10:00"',
      },
      expect.objectContaining({
        path: 'tasks[0].end',
        value: '2026-01-05T11:30',
        suggested: '2026-01-05T12:00',
      }),
    ]);
  });

  it("FR-SNAP-13: 'nearest' rounds, exact ties widen the task", () => {
    const nearest = { granularity: '1h', alignInput: 'nearest' } as const;
    expect(times(one(misaligned, nearest).span)?.start).toBe('2026-01-05T10:00');
    expect(times(one(misaligned, nearest).span)?.end).toBe('2026-01-05T12:00');
    const inner = one({ start: '2026-01-05T10:20', end: '2026-01-05T11:40' }, nearest);
    expect([times(inner.span)?.start, times(inner.span)?.end]).toEqual([
      '2026-01-05T10:00',
      '2026-01-05T12:00',
    ]);
    // Both edges round to 11:00: the task keeps one step instead of collapsing.
    const collapsed = one({ start: '2026-01-05T10:40', end: '2026-01-05T11:20' }, nearest);
    expect([times(collapsed.span)?.start, collapsed.span?.duration.ms]).toEqual([
      '2026-01-05T11:00',
      HOUR,
    ]);
    expect(codes(collapsed.issues)).toEqual([
      'misaligned?@tasks[0].start',
      'misaligned?@tasks[0].end',
    ]);
  });

  describe("FR-SNAP-13: 'nearest' alignment never collapses a non-milestone task", () => {
    const nearest = { granularity: '1h', alignInput: 'nearest' } as const;

    it('widens an end that rounds onto the start to one step', () => {
      // 10:40 → 11:00 and 10:50 → 11:00: the end is widened to 12:00 and reported.
      const record = one({ start: '2026-01-05T10:40', end: '2026-01-05T10:50' }, nearest);
      expect(record.valid).toBe(true);
      expect(times(record.span)).toEqual({
        start: '2026-01-05T11:00',
        end: '2026-01-05T12:00',
        endExclusive: '2026-01-05T12:00',
      });
      expect(record.issues).toEqual([
        expect.objectContaining({ path: 'tasks[0].start', suggested: '2026-01-05T11:00' }),
        {
          code: 'misaligned',
          severity: 'warning',
          path: 'tasks[0].end',
          taskId: 1,
          value: '2026-01-05T10:50',
          suggested: '2026-01-05T12:00',
          message:
            'tasks[0].end: not a multiple of the granularity 1h, aligned to "2026-01-05T12:00"',
        },
      ]);
      // An aligned end that the rounded start reaches is widened too.
      const reached = one({ start: '2026-01-05T10:40', end: '2026-01-05T11:00' }, nearest);
      expect(times(reached.span)?.endExclusive).toBe('2026-01-05T12:00');
      expect(codes(reached.issues)).toEqual([
        'misaligned?@tasks[0].start',
        'misaligned?@tasks[0].end',
      ]);
    });

    it('widens a duration that rounds to zero to one step', () => {
      const record = one({ start: '2026-01-05T10:00', duration: '20min' }, nearest);
      expect(times(record.span)?.endExclusive).toBe('2026-01-05T11:00');
      expect(record.issues).toEqual([
        expect.objectContaining({
          code: 'misaligned',
          severity: 'warning',
          path: 'tasks[0].duration',
          value: '20min',
          suggested: '1h',
          message: 'tasks[0].duration: not a multiple of the granularity 1h, aligned to "1h"',
        }),
      ]);
      // In working mode the step is working time: Friday 23:00 + 1h ends with Friday (2026-01-09).
      const working = one(
        { start: '2026-01-09T23:00', duration: '10min', durationMode: 'working' },
        nearest,
      );
      expect(times(working.span)?.endExclusive).toBe('2026-01-10T00:00');
      // A number of days is suggested as days.
      const days = one({ start: '2026-01-05T10:00', duration: 0.01 }, nearest);
      expect([days.span?.duration.ms, days.issues[0]?.suggested]).toEqual([HOUR, 1 / 24]);
    });

    it("keeps zero-length input, milestones and 'reject' as they were", () => {
      const zero = one({ start: '2026-01-05T10:40', end: '2026-01-05T10:40' }, nearest);
      expect([times(zero.span)?.start, zero.span?.duration.ms]).toEqual(['2026-01-05T11:00', 0]);
      expect(codes(zero.issues)).toEqual([
        'misaligned?@tasks[0].start',
        'misaligned?@tasks[0].end',
      ]);
      const milestone = one({ type: 'milestone', start: '2026-01-05T10:40' }, nearest);
      expect(milestone.span?.duration.ms).toBe(0);
      const rejected = one(
        { start: '2026-01-05T10:40', end: '2026-01-05T10:50' },
        { granularity: '1h', alignInput: 'reject' },
      );
      expect([rejected.valid, rejected.span]).toEqual([false, undefined]);
      expect(rejected.issues.map((issue) => [issue.severity, issue.suggested])).toEqual([
        ['error', '2026-01-05T10:00'],
        ['error', '2026-01-05T11:00'],
      ]);
    });
  });

  it("FR-SNAP-13: 'reject' makes the task invalid and suggests the expanded value", () => {
    const record = one(misaligned, { granularity: '1h', alignInput: 'reject' });
    expect([record.valid, record.span]).toEqual([false, undefined]);
    expect(record.issues.map((issue) => [issue.severity, issue.path, issue.suggested])).toEqual([
      ['error', 'tasks[0].start', '2026-01-05T10:00'],
      ['error', 'tasks[0].end', '2026-01-05T12:00'],
    ]);
    expect(record.issues[0]?.message).toContain('rejected, suggested "2026-01-05T10:00"');
  });

  it("FR-SNAP-13: duration '90min' becomes 2h; 'nearest' rounds 80min down", () => {
    const record = one({ start: '2026-01-05', duration: '90min' }, { granularity: '1h' });
    expect(times(record.span)?.end).toBe('2026-01-05T02:00');
    expect(record.issues).toEqual([
      expect.objectContaining({
        code: 'misaligned',
        path: 'tasks[0].duration',
        value: '90min',
        suggested: '2h',
      }),
    ]);
    const nearest = { granularity: '1h', alignInput: 'nearest' } as const;
    expect(times(one({ start: '2026-01-05', duration: '90min' }, nearest).span)?.end).toBe(
      '2026-01-05T02:00',
    );
    expect(times(one({ start: '2026-01-05', duration: '80min' }, nearest).span)?.end).toBe(
      '2026-01-05T01:00',
    );
    expect(
      one({ start: '2026-01-05', duration: '90min' }, { granularity: '1h', alignInput: 'reject' })
        .valid,
    ).toBe(false);
    // A number of days is suggested as days.
    const days = one({ start: '2026-01-05', duration: 0.03 }, { granularity: '1h' });
    expect(days.issues[0]?.suggested).toBe(1 / 24);
  });

  it('FR-SNAP-12: date-only tasks are always aligned', () => {
    for (const granularity of ['1min', '15min', '1h', '6h', '12h', '1d']) {
      const record = one({ start: '2026-03-02', end: '2026-03-04' }, { granularity });
      expect([granularity, record.issues]).toEqual([granularity, []]);
      expect(record.precision).toBe('day');
    }
  });

  it("FR-SNAP-12: with granularity '1d' times expand to whole days and keep precision 'time'", () => {
    const record = one(misaligned);
    expect(record.precision).toBe('time');
    expect(times(record.span)).toEqual({
      start: '2026-01-05T00:00',
      end: '2026-01-06T00:00',
      endExclusive: '2026-01-06T00:00',
    });
    expect(codes(record.issues)).toEqual([
      'misaligned?@tasks[0].start',
      'misaligned?@tasks[0].end',
    ]);
  });

  it("FR-SNAP-13: link lag '30min' goes to the nearest hour, ties up; 'reject' drops it", () => {
    const tasks: Task[] = [
      { id: 1, name: 'A', start: '2026-01-05', duration: 1 },
      { id: 2, name: 'B', start: '2026-01-06', duration: 1 },
    ];
    const links: Link[] = [
      { source: 1, target: 2, lag: '30min' },
      { source: 1, target: 2, type: 'SS', lag: '20min' },
      { source: 1, target: 2, type: 'FF', lag: -0.5 },
      { source: 1, target: 2, type: 'SF', lag: 0.01 },
    ];
    const model = normalize(tasks, { granularity: '1h' }, links);
    expect(model.links.map((link) => link.lag)).toEqual([HOUR, 0, -12 * HOUR, 0]);
    expect(model.issues.map((issue) => [issue.path, issue.value, issue.suggested])).toEqual([
      ['links[0].lag', '30min', '1h'],
      ['links[1].lag', '20min', '0d'],
      ['links[3].lag', 0.01, 0],
    ]);
    expect(model.links[0]?.issues).toEqual([model.issues[0]]);
    expect(model.issues[0]).toMatchObject({ severity: 'warning', linkId: '1:FS:2' });
    const rejected = normalize(tasks, { granularity: '1h', alignInput: 'reject' }, links);
    expect(rejected.links.map((link) => link.id)).toEqual(['1:FF:2']);
    expect(codes(rejected.issues)).toEqual([
      'misaligned@links[0].lag',
      'misaligned@links[1].lag',
      'misaligned@links[3].lag',
    ]);
  });
});

describe('model/normalizeModel: working time (FR-DATA-2, FR-SCH-7, FR-CAL-10)', () => {
  const working = { durationMode: 'working' } as const;

  it('FR-SCH-7: the Mon–Fri scenario task has 5 working days', () => {
    const { task } = workingDayScenarios[0]!.given;
    const record = normalize([task]).tasks[0]!;
    expect(record.durationMode).toBe('working');
    expect(times(record.span)?.end).toBe('2026-04-24T00:00');
    expect(record.span?.duration).toMatchObject({
      calendarDays: 5,
      workingDays: 5,
      nonWorkingDays: 0,
    });
  });

  it('FR-DATA-2: day precision counts working days, the start counts if it is one', () => {
    expect(times(one({ start: '2026-04-20', duration: 5, ...working }).span)?.end).toBe(
      '2026-04-24T00:00',
    );
    const friday = one({ start: '2026-04-24', duration: 2, ...working });
    expect(times(friday.span)?.end).toBe('2026-04-27T00:00');
    expect(friday.span?.duration).toMatchObject({ calendarDays: 4, workingDays: 2 });
    // Legacy rule: a Saturday start counts 0, the one working day is Monday.
    const saturday = one({ start: '2026-04-25', duration: 1, ...working });
    expect(times(saturday.span)?.end).toBe('2026-04-27T00:00');
    expect(saturday.span?.duration).toMatchObject({ calendarDays: 3, workingDays: 1 });
  });

  it('FR-CAL-2: holidays inside a span are skipped and counted as non-working days', () => {
    const { calendar: withHoliday } = createWorkCalendar({ holidays: ['2026-04-22'] });
    const record = one({ start: '2026-04-20', duration: 5, ...working }, { calendar: withHoliday });
    expect(times(record.span)?.end).toBe('2026-04-27T00:00');
    expect(record.span?.duration).toEqual({
      calendarDays: 8,
      workingDays: 5,
      nonWorkingDays: 3,
      ms: 8 * DAY,
      workingMs: 5 * DAY,
    });
  });

  it('FR-CAL-10: time precision adds working time over the weekend', () => {
    const record = one(
      { start: '2026-04-24T18:00', duration: '12h', ...working },
      { granularity: '1h' },
    );
    expect(times(record.span)?.end).toBe('2026-04-27T06:00');
    expect(record.span?.duration.ms).toBe(60 * HOUR);
    expect(record.span?.duration.workingMs).toBe(12 * HOUR);
    expect(record.span?.duration.workingDays).toBe(0.5);
    expect(record.span?.duration.nonWorkingDays).toBe(2);
  });

  it('FR-DATA-2: months are calendar months in working mode too', () => {
    expect(times(one({ start: '2026-04-20', duration: '1mo', ...working }).span)?.end).toBe(
      '2026-05-19T00:00',
    );
    expect(
      times(one({ start: '2026-04-20', duration: '1mo 2d', ...working }).span)?.endExclusive,
    ).toBe('2026-05-22T00:00');
  });

  it('takes the default duration mode from the options; the task overrides it', () => {
    const tasks: Task[] = [
      { id: 1, name: 'Default', start: '2026-04-24', duration: 2 },
      { id: 2, name: 'Calendar', start: '2026-04-24', duration: 2, durationMode: 'calendar' },
    ];
    const model = normalize(tasks, working);
    expect(model.tasks.map((task) => [task.durationMode, times(task.span)?.end])).toEqual([
      ['working', '2026-04-27T00:00'],
      ['calendar', '2026-04-25T00:00'],
    ]);
  });

  it('FR-DATA-4: a calendar without working days cannot place a working duration', () => {
    const { calendar: never } = createWorkCalendar({ weekends: [0, 1, 2, 3, 4, 5, 6] });
    const record = one({ start: '2026-04-20', duration: 2, ...working }, { calendar: never });
    expect(record.valid).toBe(false);
    expect(codes(record.issues)).toEqual(['no-working-time@tasks[0].duration']);
    const hourly = one(
      { start: '2026-04-20T10:00', duration: '2h', ...working },
      { calendar: never, granularity: '1h' },
    );
    expect(codes(hourly.issues)).toEqual(['no-working-time@tasks[0].duration']);
  });
});

describe('model/normalizeModel: links (FR-DATA-5, FR-LINK-1, ADR-007)', () => {
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', duration: 2 },
    { id: 'b', name: 'B', start: '2026-03-04', duration: 2 },
    {
      id: 'c',
      name: 'C',
      start: '2026-03-06',
      duration: 2,
      dependencies: ['a', { id: 'b', type: 'FF', lag: '1d' }],
    },
  ];

  it('FR-DATA-5: merges links and the dependencies shorthand with ids, types and defaults', () => {
    const links: Link[] = [
      { source: 'a', target: 'b' },
      { id: 'x', source: 'b', target: 'c', type: 'SS', lag: 2, editable: false },
    ];
    const model = normalize(tasks, {}, links);
    expect(model.links).toEqual([
      {
        id: 'a:FS:b',
        source: 'a',
        target: 'b',
        type: 'FS',
        lag: undefined,
        editable: true,
        link: links[0],
        path: 'links[0]',
        issues: [],
      },
      expect.objectContaining({ id: 'x', type: 'SS', lag: 2 * DAY, editable: false }),
      expect.objectContaining({
        id: 'a:FS:c',
        source: 'a',
        target: 'c',
        link: undefined,
        path: 'tasks[2].dependencies[0]',
      }),
      expect.objectContaining({ id: 'b:FF:c', type: 'FF', lag: DAY }),
    ]);
    expect(model.links[0]?.link).toBe(links[0]);
    expect(model.linkById.get('x')).toBe(model.links[1]);
    expect(model.issues).toEqual([]);
  });

  it('FR-LINK-1: the default link type comes from the options', () => {
    const model = normalize(tasks.slice(0, 2), { defaultLinkType: 'SS' }, [
      { source: 'a', target: 'b' },
    ]);
    expect(model.links.map((link) => [link.id, link.type])).toEqual([['a:SS:b', 'SS']]);
  });

  it('FR-DATA-4: repeated link ids are dropped, also between links and the shorthand', () => {
    const model = normalize(tasks, {}, [
      { source: 'a', target: 'c' },
      { id: 'a:FS:c', source: 'b', target: 'a' },
    ]);
    expect(model.links.map((link) => link.path)).toEqual(['links[0]', 'tasks[2].dependencies[1]']);
    expect(model.issues).toEqual([
      expect.objectContaining({ code: 'duplicate-id', path: 'links[1]', linkId: 'a:FS:c' }),
      expect.objectContaining({
        code: 'duplicate-id',
        path: 'tasks[2].dependencies[0]',
        linkId: 'a:FS:c',
        taskId: 'c',
      }),
    ]);
  });

  it('FR-LINK-1: lags are days or fixed durations; invalid ones drop the link', () => {
    const model = normalize(tasks.slice(0, 2), {}, [
      { source: 'a', target: 'b', lag: -1 },
      { source: 'a', target: 'b', type: 'SS', lag: { days: 1, hours: 0 } },
      { source: 'a', target: 'b', type: 'FF', lag: '3m' },
      { source: 'a', target: 'b', type: 'SF', lag: '1mo' },
      { id: 'nan', source: 'a', target: 'b', lag: Number.NaN },
    ]);
    expect(model.links.map((link) => [link.id, link.lag])).toEqual([
      ['a:FS:b', -DAY],
      ['a:SS:b', DAY],
    ]);
    expect(codes(model.issues)).toEqual([
      'invalid-duration@links[2].lag',
      'invalid-duration@links[3].lag',
      'invalid-duration@links[4].lag',
    ]);
    expect(model.issues.map((issue) => issue.linkId)).toEqual(['a:FF:b', 'a:SF:b', 'nan']);
  });

  it('FR-DATA-11: malformed links are dropped with their paths', () => {
    const model = normalize(tasks.slice(0, 2), {}, [
      { source: 'a' },
      { id: 'k', source: 'a', target: 'b', type: 'XX' },
      null,
    ] as unknown as Link[]);
    expect(model.links).toEqual([]);
    expect(codes(model.issues)).toEqual([
      'invalid-shape@links[0].target',
      'invalid-shape@links[1].type',
      'invalid-shape@links[2]',
    ]);
    expect(model.issues[1]?.linkId).toBe('k');
  });

  it('FR-DATA-11, FR-LINK-6: normalizeLink reports a malformed link exactly as normalizeModel does', () => {
    const malformed = [
      { source: 'a' },
      { id: 'k', source: 'a', target: 'b', type: 'XX', lag: [] },
      { id: 7, source: 'a', target: 'b' },
      null,
    ] as unknown as Link[];
    const model = normalize(tasks.slice(0, 2), {}, malformed);
    malformed.forEach((link, i) => {
      const alone = normalizeLink(link, model.options, `links[${i}]`);
      const path = `links[${i}]`;
      const own = model.issues.filter((found) => found.path?.startsWith(path) === true);
      expect(alone).toEqual({ ok: false, issue: own });
      expect(own.length).toBeGreaterThan(0);
    });
  });

  it('FR-LINK-8: references are not checked here (plan step 2.3)', () => {
    const model = normalize(tasks.slice(0, 1), {}, [{ source: 'a', target: 'ghost' }]);
    expect(model.links.map((link) => link.id)).toEqual(['a:FS:ghost']);
    expect(model.issues).toEqual([]);
  });
});

describe('model/normalizeModel: immutability (FR-DATA-1)', () => {
  it('FR-DATA-1: deep-frozen input is neither mutated nor a problem', () => {
    const input = {
      tasks: [
        {
          id: 'a',
          name: 'A',
          start: '2026-01-05T10:30',
          duration: { hours: 1, minutes: 30 },
          progress: 140,
          parentAnchor: ['SS', 'FF'],
          editable: { move: false },
          dependencies: ['b', { id: 'c', type: 'SS', lag: { minutes: 30 } }],
          data: { nested: { list: [1, 2] } },
        },
        { id: 'b', name: 'B', start: '2026-01-05', end: '2026-01-06' },
        { id: 'c', name: 'C' },
        { id: 'b', name: 'Duplicate' },
      ],
      links: [{ source: 'b', target: 'c', lag: '30min' }],
    } satisfies { tasks: Task[]; links: Link[] };
    const options = { calendar, granularity: { hours: 1 }, alignInput: 'expand' as const };
    const snapshot = JSON.stringify({ input, options: { ...options, calendar: undefined } });
    deepFreeze(input);
    Object.freeze(options);
    const model = normalizeModel(input, options);
    expect(JSON.stringify({ input, options: { ...options, calendar: undefined } })).toBe(snapshot);
    expect(model.tasks[0]?.task).toBe(input.tasks[0]);
    expect(codes(model.issues)).toEqual([
      'misaligned?@tasks[0].start',
      'misaligned?@tasks[0].duration',
      'progress-out-of-range?@tasks[0].progress',
      'no-dates?@tasks[2]',
      'duplicate-id@tasks[3].id',
      'misaligned?@links[0].lag',
      'misaligned?@tasks[0].dependencies[1].lag',
    ]);
  });

  it('FR-DATA-8: every model, span, count, issue and list is frozen', () => {
    const model = normalize(
      [
        { id: 1, name: 'A', start: '2026-03-02', duration: 2, progress: 120 },
        { id: 2, name: 'B', dependencies: [1] },
      ],
      {},
      [{ source: 1, target: 2, lag: 1 }],
    );
    const frozen = [
      model,
      model.tasks,
      model.links,
      model.issues,
      model.options,
      ...model.tasks,
      ...model.tasks.map((task) => task.issues),
      ...model.tasks.flatMap((task) => (task.span ? [task.span, task.span.duration] : [])),
      ...model.links,
      ...model.links.map((link) => link.issues),
      ...model.issues,
    ];
    expect(frozen.length).toBeGreaterThan(12);
    for (const value of frozen) expect(Object.isFrozen(value)).toBe(true);
  });

  it('every date and duration of the result is a multiple of the granularity', () => {
    const model = normalize(
      [
        { id: 1, name: 'A', start: '2026-03-02T10:07', end: '2026-03-02T17:53' },
        { id: 2, name: 'B', start: '2026-03-02T10:07', duration: '7h 7min', progress: 33 },
        { id: 3, name: 'C', start: '2026-03-02', duration: 2.3, durationMode: 'working' },
      ],
      { granularity: '15min' },
    );
    for (const task of model.tasks) {
      const span = task.span!;
      for (const value of [span.start, span.endExclusive, span.progressDate]) {
        expect(value % (15 * MINUTE)).toBe(0);
      }
    }
  });
});

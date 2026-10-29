import { deepFreeze } from '@ganttlane/fixtures';
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import {
  asDateTimeMs,
  type DateTimeMs,
  DAY,
  durationToString,
  HOUR,
  MINUTE,
  parseDateInput,
  toDate,
  toISODate,
  toISODateTime,
} from '../time';
import {
  normalizeModel,
  type NormalizeModelOptions,
  patchTask,
  patchTasks,
  type PatchValues,
  type Task,
} from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-18'] });

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

function values(start: string, endExclusive: string, progress = 0): PatchValues {
  return { start: at(start), endExclusive: at(endExclusive), progress };
}

type Options = Omit<NormalizeModelOptions, 'calendar'>;

/** Patches a frozen task against its own model; returns the result and its re-normalized model. */
function patch(task: Task, patchValues: PatchValues, options: Options = {}) {
  const frozen = deepFreeze(task);
  const settings = { calendar, ...options };
  const model = normalizeModel({ tasks: [frozen] }, settings);
  const patched = patchTask(frozen, patchValues, model);
  const again = normalizeModel({ tasks: [patched] }, settings);
  return { patched, model: again.tasks[0]!, issues: again.issues };
}

describe('patchTask', () => {
  it('FR-TX-3, FR-TIME-8: keeps date-only ISO strings and writes the inclusive last day', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 20 };
    const { patched, model, issues } = patch(task, values('2026-03-09', '2026-03-14', 20));
    expect(patched).toEqual({ ...task, start: '2026-03-09', end: '2026-03-13' });
    expect(patched).not.toBe(task);
    expect(issues).toEqual([]);
    expect([model.span?.start, model.span?.endExclusive]).toEqual([
      at('2026-03-09'),
      at('2026-03-14'),
    ]);
  });

  it('FR-TX-3: keeps Date objects and epoch numbers', () => {
    const dates = patch(
      { id: 1, name: 'A', start: new Date(2026, 2, 2), end: new Date(2026, 2, 6) },
      values('2026-03-09', '2026-03-14'),
    ).patched;
    expect(dates.start).toBeInstanceOf(Date);
    expect([dates.start, dates.end]).toEqual([new Date(2026, 2, 9), new Date(2026, 2, 13)]);
    // An unchanged edge keeps its object.
    const start = new Date(2026, 2, 2);
    const resized = patch(
      { id: 1, name: 'A', start, end: new Date(2026, 2, 6) },
      values('2026-03-02', '2026-03-10'),
    );
    expect(resized.patched.start).toBe(start);
    expect(resized.patched.end).toEqual(new Date(2026, 2, 9));

    const epoch = patch(
      { id: 1, name: 'A', start: new Date(2026, 2, 2).getTime(), duration: 5 },
      values('2026-03-09', '2026-03-16'),
    ).patched;
    expect(epoch).toMatchObject({ start: new Date(2026, 2, 9).getTime(), duration: 7 });
  });

  it('FR-TIME-6: keeps the separator and the fields of date-time strings', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02 10:00:00', end: '2026-03-02T12:00' };
    const { patched, model } = patch(task, values('2026-03-02T11:00', '2026-03-02T14:30'), {
      granularity: '30min',
    });
    expect(patched).toMatchObject({ start: '2026-03-02 11:00:00', end: '2026-03-02T14:30' });
    expect(model.precision).toBe('time');

    const fraction = patch(
      { id: 1, name: 'A', start: '2026-03-02T10:00:00.000', end: '2026-03-02T12:00' },
      values('2026-03-03T00:00', '2026-03-03T02:00'),
      { granularity: '1h' },
    ).patched;
    expect(fraction.start).toBe('2026-03-03T00:00:00.000');
  });

  it('FR-TIME-6: a date-only string of a time task becomes a date-time off midnight', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-02T12:00' };
    const { patched, model } = patch(task, values('2026-03-02T06:00', '2026-03-02T12:00'), {
      granularity: '1h',
    });
    expect(patched).toMatchObject({ start: '2026-03-02T06:00', end: '2026-03-02T12:00' });
    expect(patched.end).toBe(task.end);
    expect(model.span?.start).toBe(at('2026-03-02T06:00'));
  });

  it('FR-TIME-3: writes an exclusive end without endInclusive', () => {
    const { patched } = patch(
      { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-07' },
      values('2026-03-09', '2026-03-14'),
      { endInclusive: false },
    );
    expect(patched).toMatchObject({ start: '2026-03-09', end: '2026-03-14' });
  });

  it.each<[string, Task['duration'], Task['duration']]>([
    ['days', 5, 7],
    ['a string', '5d', '7d'],
    ['an object', { weeks: 2 }, { days: 7 }],
    ['an ISO 8601 string', 'P5D', 'P7D'],
  ])('FR-DATA-2: rewrites a duration given as %s in the same form', (_, given, expected) => {
    const { patched, model } = patch(
      { id: 1, name: 'A', start: '2026-03-02', duration: given },
      values('2026-03-02', '2026-03-09'),
    );
    expect(patched.duration).toEqual(expected);
    expect(patched.end).toBeUndefined();
    expect(model.span?.endExclusive).toBe(at('2026-03-09'));
  });

  it.each<[Task['duration'], string, Task['duration']]>([
    ['1d 4h', '2026-03-03T14:30', '1d 6h 30min'],
    [{ hours: 28 }, '2026-03-03T14:30', { days: 1, hours: 6, minutes: 30 }],
    ['PT28H', '2026-03-03T14:30', 'P1DT6H30M'],
    [{ hours: 2 }, '2026-03-02T10:30', { hours: 2, minutes: 30 }],
    ['PT2H', '2026-03-02T10:30', 'PT2H30M'],
    // 13 minutes are no exact number of days: the canonical string instead.
    [0.5, '2026-03-02T08:13', '13min'],
  ])('FR-TIME-4: rewrites the sub-day duration %j ending at %s', (given, end, expected) => {
    const { patched, model, issues } = patch(
      { id: 1, name: 'A', start: '2026-03-02T08:00', duration: given },
      values('2026-03-02T08:00', end),
      { granularity: '1min' },
    );
    expect(patched.duration).toEqual(expected);
    expect(issues).toEqual([]);
    expect(model.span?.endExclusive).toBe(at(end));
  });

  it('FR-DATA-2: writes a zero-length duration', () => {
    for (const [given, expected] of [
      [3, 0],
      ['3d', '0d'],
      [{ days: 3 }, { days: 0 }],
      ['P3D', 'P0D'],
    ] as const) {
      const { patched, model, issues } = patch(
        { id: 1, name: 'A', start: '2026-03-02', duration: given },
        values('2026-03-04', '2026-03-04'),
      );
      expect(patched.duration).toEqual(expected);
      expect(issues).toEqual([]);
      expect(model.span?.endExclusive).toBe(at('2026-03-04'));
    }
  });

  it('FR-SCH-7: keeps a working-time duration that still fits and counts working days', () => {
    const task: Task = {
      id: 1,
      name: 'A',
      start: '2026-03-02',
      duration: 5,
      durationMode: 'working',
    };
    // Wednesday + 5 working days ends on Tuesday.
    const moved = patch(task, values('2026-03-04', '2026-03-11'));
    expect(moved.patched.duration).toBe(5);
    expect(moved.patched.start).toBe('2026-03-04');
    // Over the holiday on 2026-03-18: Monday … Friday has 4 working days.
    const resized = patch(task, values('2026-03-16', '2026-03-21'));
    expect(resized.patched.duration).toBe(4);
    expect(resized.model.span?.endExclusive).toBe(at('2026-03-21'));
  });

  it('FR-SCH-7: a working-time duration that cannot express the end becomes an end', () => {
    const task: Task = {
      id: 1,
      name: 'A',
      start: '2026-03-02',
      duration: '5d',
      durationMode: 'working',
    };
    // The last day is a Saturday: no working-day count ends there.
    const { patched, model } = patch(task, values('2026-03-02', '2026-03-08'));
    expect(patched).toEqual({
      id: 1,
      name: 'A',
      start: '2026-03-02',
      end: '2026-03-07',
      durationMode: 'working',
    });
    expect(model.span?.endExclusive).toBe(at('2026-03-08'));

    const timed = patch(
      {
        id: 2,
        name: 'B',
        start: new Date(2026, 2, 6, 10),
        duration: '6h',
        durationMode: 'working',
      },
      values('2026-03-06T10:00', '2026-03-07T10:00'),
      { granularity: '1h' },
    );
    expect(timed.patched).toMatchObject({ end: new Date(2026, 2, 7, 10) });
    expect(timed.patched).not.toHaveProperty('duration');
    expect(timed.model.span?.endExclusive).toBe(at('2026-03-07T10:00'));
  });

  it('ADR-015: keeps the precision of a time task whose values all land on midnight', () => {
    const task: Task = {
      id: 1,
      name: 'A',
      start: new Date(2026, 2, 2, 10),
      end: new Date(2026, 2, 3, 15),
    };
    const { patched, model, issues } = patch(task, values('2026-03-02', '2026-03-04'), {
      granularity: '1h',
    });
    expect(patched).toEqual({
      ...task,
      precision: 'time',
      start: new Date(2026, 2, 2),
      end: new Date(2026, 2, 4),
    });
    expect(issues).toEqual([]);
    expect(model.precision).toBe('time');
    expect(model.span?.endExclusive).toBe(at('2026-03-04'));

    const duration = patch(
      { id: 2, name: 'B', start: '2026-03-02', duration: '36h' },
      values('2026-03-02', '2026-03-04'),
      { granularity: '1h' },
    );
    expect(duration.patched).toMatchObject({ precision: 'time', duration: '2d' });
    expect(duration.model.precision).toBe('time');
  });

  it('FR-PROG-1: sets progress only when it changed', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 150 };
    // 150 is clamped to 100: patching 100 changes nothing.
    expect(patch(task, values('2026-03-02', '2026-03-07', 100)).patched).toBe(task);
    expect(patch(task, values('2026-03-02', '2026-03-07', 40)).patched).toEqual({
      ...task,
      progress: 40,
    });
  });

  it('FR-DATA-3: milestones only get a start; tasks without a bar stay as they are', () => {
    const milestone: Task = {
      id: 1,
      name: 'M',
      type: 'milestone',
      start: '2026-03-02',
      end: '2026-03-05',
    };
    expect(patch(milestone, values('2026-03-04', '2026-03-04')).patched).toEqual({
      ...milestone,
      start: '2026-03-04',
    });
    const placeholder: Task = { id: 2, name: 'P' };
    expect(patch(placeholder, values('2026-03-04', '2026-03-05')).patched).toBe(placeholder);
    const invalid: Task = { id: 3, name: 'I', start: 'soon', end: '2026-03-05' };
    expect(patch(invalid, values('2026-03-04', '2026-03-05')).patched).toBe(invalid);
    const model = normalizeModel({ tasks: [] }, { calendar });
    expect(patchTask(milestone, values('2026-03-04', '2026-03-04'), model)).toBe(milestone);
  });
});

describe('patchTask: a precision change (FR-SNAP-7)', () => {
  const hourly = { granularity: '1h' } as const;
  const timed = (start: string, endExclusive: string): PatchValues => ({
    ...values(start, endExclusive),
    precision: 'time',
  });

  it('turns a date-only ISO task into a timed one', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const { patched, model, issues } = patch(
      task,
      timed('2026-03-02T10:00', '2026-03-07T10:00'),
      hourly,
    );
    expect(patched).toEqual({ ...task, start: '2026-03-02T10:00', end: '2026-03-07T10:00' });
    expect(issues).toEqual([]);
    expect(model.precision).toBe('time');
    expect([model.span?.start, model.span?.endExclusive]).toEqual([
      at('2026-03-02T10:00'),
      at('2026-03-07T10:00'),
    ]);
  });

  it('keeps a date-only end, which still reads as the inclusive last day', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const { patched, model } = patch(task, timed('2026-03-02T10:00', '2026-03-07'), hourly);
    expect(patched).toEqual({ ...task, start: '2026-03-02T10:00' });
    expect(patched.end).toBe(task.end);
    expect(model.precision).toBe('time');
    expect(model.span?.endExclusive).toBe(at('2026-03-07'));
  });

  it('writes precision: time when every value lands on midnight', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const { patched, model } = patch(task, timed('2026-03-03', '2026-03-08'), hourly);
    expect(patched).toEqual({ ...task, precision: 'time', start: '2026-03-03', end: '2026-03-08' });
    expect(model.precision).toBe('time');
    expect(model.span?.endExclusive).toBe(at('2026-03-08'));
    // Nothing but the precision changes.
    const only = patch(task, timed('2026-03-02', '2026-03-07'), hourly);
    expect(only.patched).toEqual({ ...task, precision: 'time', end: '2026-03-07' });
    expect(only.model.precision).toBe('time');
    expect(only.model.span?.endExclusive).toBe(at('2026-03-07'));
  });

  it('turns Date and epoch tasks into timed ones', () => {
    const dates = patch(
      { id: 1, name: 'A', start: new Date(2026, 2, 2), end: new Date(2026, 2, 6) },
      timed('2026-03-02T10:00', '2026-03-07'),
      hourly,
    );
    expect([dates.patched.start, dates.patched.end]).toEqual([
      new Date(2026, 2, 2, 10),
      new Date(2026, 2, 6),
    ]);
    expect(dates.model.precision).toBe('time');
    expect(dates.model.span?.endExclusive).toBe(at('2026-03-07'));
    const epoch = patch(
      { id: 1, name: 'A', start: new Date(2026, 2, 2).getTime(), duration: 5 },
      timed('2026-03-02T10:00', '2026-03-07T10:00'),
      hourly,
    );
    expect(epoch.patched).toMatchObject({ start: new Date(2026, 2, 2, 10).getTime(), duration: 5 });
    expect(epoch.model.precision).toBe('time');
    expect(epoch.model.span?.endExclusive).toBe(at('2026-03-07T10:00'));
  });

  it('replaces an explicit day precision', () => {
    const task: Task = {
      id: 1,
      name: 'A',
      precision: 'day',
      start: '2026-03-02',
      end: '2026-03-06',
    };
    const { patched, model } = patch(task, timed('2026-03-02T10:00', '2026-03-07T10:00'), hourly);
    expect(patched).toEqual({
      ...task,
      precision: 'time',
      start: '2026-03-02T10:00',
      end: '2026-03-07T10:00',
    });
    expect(model.precision).toBe('time');
  });

  it('rewrites a working-time duration with time precision', () => {
    const task: Task = {
      id: 1,
      name: 'A',
      start: '2026-03-02',
      duration: '5d',
      durationMode: 'working',
    };
    // Monday 10:00 + 5 working days ends on the next Monday 10:00.
    const { patched, model } = patch(task, timed('2026-03-02T10:00', '2026-03-09T10:00'), hourly);
    expect(patched).toEqual({ ...task, start: '2026-03-02T10:00' });
    expect(model.precision).toBe('time');
    expect(model.span?.endExclusive).toBe(at('2026-03-09T10:00'));
  });

  it('brings a timed task back to day precision (an undo)', () => {
    const task: Task = { id: 1, name: 'A', start: '2026-03-02', end: '2026-03-06' };
    const settings = { calendar, ...hourly };
    const model = normalizeModel({ tasks: [task] }, settings);
    const forward = patchTask(task, timed('2026-03-02T10:00', '2026-03-07T10:00'), model);
    const timedModel = normalizeModel({ tasks: [forward] }, settings);
    const back = patchTask(
      forward,
      { ...values('2026-03-02', '2026-03-07'), precision: 'day' },
      timedModel,
    );
    expect(back).toEqual(task);
    // An explicit time precision is dropped; values that still read as times get 'day'.
    const explicit = patch(
      { id: 2, name: 'B', precision: 'time', start: '2026-03-02T10:00', end: '2026-03-03T10:00' },
      { ...values('2026-03-02', '2026-03-04'), precision: 'day' },
      hourly,
    );
    expect(explicit.patched).toEqual({ id: 2, name: 'B', start: '2026-03-02', end: '2026-03-03' });
    expect(explicit.model.precision).toBe('day');
    const dates = patch(
      { id: 3, name: 'C', start: new Date(2026, 2, 2, 10), duration: '1d' },
      { ...values('2026-03-02', '2026-03-03'), precision: 'day' },
      hourly,
    );
    expect(dates.patched).toEqual({
      id: 3,
      name: 'C',
      start: new Date(2026, 2, 2),
      duration: '1d',
    });
    expect(dates.model.precision).toBe('day');
  });
});

/** Midnight of 2026-01-05 (a Monday). */
const BASE = at('2026-01-05');
const GRANULARITY_MS = { '1d': DAY, '1h': HOUR, '15min': 15 * MINUTE } as const;

/** Whether a `Date` can hold the wall-clock time (not in a DST gap of the runtime zone). */
function roundTrips(t: number): boolean {
  const parsed = parseDateInput(toDate(asDateTimeMs(t)));
  return parsed.ok && parsed.value.value === t;
}

function dateIn(form: 'date' | 'iso' | 'epoch', t: DateTimeMs, timed: boolean): Task['start'] {
  if (form === 'iso') return timed ? toISODateTime(t) : toISODate(t);
  return form === 'date' ? toDate(t) : toDate(t).getTime();
}

function durationIn(form: 'days' | 'string' | 'object' | 'iso', ms: number): Task['duration'] {
  const minutes = ms / MINUTE;
  if (form === 'days') return ms / DAY;
  if (form === 'object') return { minutes };
  if (form === 'iso') return `PT${minutes}M`;
  return durationToString({ months: 0, ms });
}

describe('patchTask precision change round trip (property)', () => {
  it('FR-SNAP-7, FR-TX-3: a patch that changes the precision normalizes to it and to the patched span', () => {
    const form = fc.constantFrom('date', 'iso', 'epoch');
    const timeOfDay = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 95 }));
    fc.assert(
      fc.property(
        fc.record({
          granularity: fc.constantFrom('1h', '15min'),
          timed: fc.boolean(),
          precision: fc.constantFrom(undefined, 'day', 'time'),
          startForm: form,
          endForm: form,
          definition: fc.constantFrom('end', 'days', 'string', 'object', 'iso'),
          durationMode: fc.constantFrom('calendar', 'working'),
          endInclusive: fc.boolean(),
          start: fc.tuple(fc.integer({ min: 0, max: 120 }), timeOfDay),
          length: fc.integer({ min: 1, max: 400 }),
          next: fc.tuple(fc.integer({ min: 0, max: 120 }), timeOfDay),
          nextLength: fc.oneof(fc.integer({ min: 1, max: 400 }), fc.constantFrom('1d', '3d')),
        }),
        (c) => {
          const step = GRANULARITY_MS[c.granularity];
          const ownStep = c.timed ? step : DAY;
          const s0 = asDateTimeMs(BASE + c.start[0] * DAY + ((c.start[1] * ownStep) % DAY));
          const e0 = asDateTimeMs(s0 + c.length * ownStep);
          const task: Task = {
            id: 1,
            name: 'T',
            start: dateIn(c.startForm, s0, c.timed),
            ...(c.definition === 'end'
              ? { end: dateIn(c.endForm, e0, c.timed) }
              : { duration: durationIn(c.definition, e0 - s0) }),
            durationMode: c.durationMode,
            ...(c.precision === undefined ? {} : { precision: c.precision }),
          };
          const options = { calendar, granularity: c.granularity, endInclusive: c.endInclusive };
          const before = normalizeModel({ tasks: [task] }, options);
          const original = before.tasks[0]!;
          fc.pre(before.issues.length === 0 && original.span !== undefined);

          // The other precision, with values of its step.
          const precision = original.precision === 'day' ? 'time' : 'day';
          const patchStep = precision === 'day' ? DAY : step;
          const start = asDateTimeMs(BASE + c.next[0] * DAY + ((c.next[1] * patchStep) % DAY));
          const length =
            typeof c.nextLength === 'number'
              ? c.nextLength * patchStep
              : Number.parseInt(c.nextLength, 10) * DAY;
          const endExclusive = asDateTimeMs(start + Math.max(length, patchStep));
          const usesDates =
            c.startForm !== 'iso' || (c.definition === 'end' && c.endForm !== 'iso');
          fc.pre(!usesDates || [start, endExclusive, endExclusive - DAY].every(roundTrips));

          const progress = original.progress;
          const patched = patchTask(task, { start, endExclusive, progress, precision }, before);
          const after = normalizeModel({ tasks: [patched] }, options);
          const model = after.tasks[0]!;
          expect(after.issues).toEqual([]);
          expect(model.precision).toBe(precision);
          expect(model.span?.start).toBe(start);
          expect(model.span?.endExclusive).toBe(endExclusive);
          expect(typeof patched.start).toBe(typeof task.start);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('patchTasks', () => {
  const settings = { calendar };
  const a: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' };
  const b: Task = { id: 'b', name: 'B', start: new Date(2026, 2, 9), duration: 3 };
  const c: Task = { id: 'c', name: 'C', start: '2026-03-16', end: '2026-03-17' };

  it('FR-TX-3: writes each change back in the task’s own format and keeps the rest', () => {
    const tasks = deepFreeze([a, b, c]);
    const model = normalizeModel({ tasks }, settings);
    const next = patchTasks(
      tasks,
      {
        changes: [
          { id: 'a', after: values('2026-03-03', '2026-03-10') },
          { id: 'b', after: values('2026-03-10', '2026-03-13', 50) },
        ],
      },
      model,
    );
    expect(next).not.toBe(tasks);
    expect(next).toEqual([
      { ...a, start: '2026-03-03', end: '2026-03-09' },
      { ...b, start: new Date(2026, 2, 10), progress: 50 },
      c,
    ]);
    expect(next[2]).toBe(c);
  });

  it('FR-TX-3: returns the same array when nothing changes', () => {
    const tasks = [a, b];
    const model = normalizeModel({ tasks }, settings);
    expect(patchTasks(tasks, { changes: [] }, model)).toBe(tasks);
    const same = { id: 'a', after: values('2026-03-02', '2026-03-07') };
    const unknown = { id: 'x', after: values('2026-03-02', '2026-03-07') };
    expect(patchTasks(tasks, { changes: [same, unknown] }, model)).toBe(tasks);
  });

  it('FR-TX-3: patches copies of the tasks, the first of a repeated id, and the last change', () => {
    const model = normalizeModel({ tasks: [a, b] }, settings);
    const copies = [{ ...a }, { ...a, name: 'Duplicate' }, { ...b }];
    const next = patchTasks(
      copies,
      {
        changes: [
          { id: 'a', after: values('2026-03-03', '2026-03-10') },
          { id: 'a', after: values('2026-03-04', '2026-03-11') },
        ],
      },
      model,
    );
    expect(next.map((task) => [task.name, task.start])).toEqual([
      ['A', '2026-03-04'],
      ['Duplicate', '2026-03-02'],
      ['B', b.start],
    ]);
    expect(next[1]).toBe(copies[1]);
    expectTypeOf(next).toEqualTypeOf<Task[]>();
    const frozen: readonly Task[] = deepFreeze([a]);
    expectTypeOf(patchTasks(frozen, { changes: [] }, model)).toEqualTypeOf<readonly Task[]>();
  });
});

describe('patchTask round trip (property)', () => {
  it('FR-TX-3, FR-TIME-8: the patched task normalizes to exactly the patched span', () => {
    const form = fc.constantFrom('date', 'iso', 'epoch');
    // Steps into the day; midnight often, as it changes how values read.
    const timeOfDay = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 95 }));
    fc.assert(
      fc.property(
        fc.record({
          granularity: fc.constantFrom('1d', '1h', '15min'),
          timed: fc.boolean(),
          precision: fc.constantFrom(undefined, 'day', 'time'),
          startForm: form,
          endForm: form,
          definition: fc.constantFrom('end', 'days', 'string', 'object', 'iso'),
          durationMode: fc.constantFrom('calendar', 'working'),
          endInclusive: fc.boolean(),
          start: fc.tuple(fc.integer({ min: 0, max: 120 }), timeOfDay),
          length: fc.integer({ min: 1, max: 400 }),
          next: fc.tuple(fc.integer({ min: 0, max: 120 }), timeOfDay),
          // Steps, whole days (all values on midnight) or the original length (a plain move).
          nextLength: fc.oneof(
            fc.integer({ min: 1, max: 400 }),
            fc.constantFrom('1d', '3d', 'same'),
          ),
          progress: fc.integer({ min: 0, max: 100 }),
        }),
        (c) => {
          const step = GRANULARITY_MS[c.granularity];
          const ownStep = c.timed ? step : DAY;
          const s0 = asDateTimeMs(BASE + c.start[0] * DAY + ((c.start[1] * ownStep) % DAY));
          const e0 = asDateTimeMs(s0 + c.length * ownStep);
          const task: Task = {
            id: 1,
            name: 'T',
            start: dateIn(c.startForm, s0, c.timed),
            ...(c.definition === 'end'
              ? { end: dateIn(c.endForm, e0, c.timed) }
              : { duration: durationIn(c.definition, e0 - s0) }),
            durationMode: c.durationMode,
            ...(c.precision === undefined ? {} : { precision: c.precision }),
          };
          const options = { calendar, granularity: c.granularity, endInclusive: c.endInclusive };
          const before = normalizeModel({ tasks: [task] }, options);
          const original = before.tasks[0]!;
          fc.pre(before.issues.length === 0 && original.span !== undefined);

          const patchStep = original.precision === 'day' ? DAY : step;
          const start = asDateTimeMs(BASE + c.next[0] * DAY + ((c.next[1] * patchStep) % DAY));
          const length =
            typeof c.nextLength === 'number'
              ? c.nextLength * patchStep
              : c.nextLength === 'same'
                ? original.span.endExclusive - original.span.start
                : Number.parseInt(c.nextLength, 10) * DAY;
          const endExclusive = asDateTimeMs(start + Math.max(length, patchStep));
          const usesDates =
            c.startForm !== 'iso' || (c.definition === 'end' && c.endForm !== 'iso');
          fc.pre(!usesDates || [start, endExclusive, endExclusive - DAY].every(roundTrips));

          const patched = patchTask(task, { start, endExclusive, progress: c.progress }, before);
          const after = normalizeModel({ tasks: [patched] }, options);
          const model = after.tasks[0]!;
          expect(after.issues).toEqual([]);
          expect(model.span?.start).toBe(start);
          expect(model.span?.endExclusive).toBe(endExclusive);
          expect(model.progress).toBe(c.progress);
          expect(model.precision).toBe(original.precision);
          // Representation: value types are kept, `end` stays `end`.
          expect(typeof patched.start).toBe(typeof task.start);
          if (task.end !== undefined) {
            expect(typeof patched.end).toBe(typeof task.end);
            expect(patched.duration).toBe(task.duration);
          } else if (patched.duration === undefined) {
            // Only working time can fail to express a span.
            expect(c.durationMode).toBe('working');
            expect(typeof patched.end).toBe(typeof task.start);
          } else {
            expect(patched.end).toBeUndefined();
            if (typeof task.duration !== 'number')
              expect(typeof patched.duration).toBe(typeof task.duration);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

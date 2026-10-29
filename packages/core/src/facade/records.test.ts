import { describe, expect, it } from 'vitest';

import type { Task } from '../model';
import { type DateTimeMs, parseDateInput, toDate } from '../time';
import { createGanttCore } from './index';
import { taskDates } from './records';

function date(iso: string): Date {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return toDate(parsed.value.value);
}

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

describe('TaskRecord (docs/api.md §4)', () => {
  it('FR-TIME-8: `end` follows the input semantics of each task', () => {
    const gantt = createGanttCore({
      tasks: [
        { id: 'day', name: 'Day', start: '2026-03-02', end: '2026-03-06' },
        { id: 'time', name: 'Time', start: '2026-03-02T09:00', end: '2026-03-02T17:30' },
        { id: 'milestone', name: 'Milestone', type: 'milestone', start: '2026-03-09' },
        { id: 'orphan', name: 'Orphan', parentId: 'ghost', start: '2026-03-02', duration: 2 },
      ],
      scheduling: { granularity: '30min' },
    });
    expect(gantt.getTask('day')).toMatchObject({
      precision: 'day',
      end: date('2026-03-06'),
      endExclusive: date('2026-03-07'),
    });
    expect(gantt.getTask('time')).toMatchObject({
      precision: 'time',
      start: date('2026-03-02T09:00'),
      end: date('2026-03-02T17:30'),
      endExclusive: date('2026-03-02T17:30'),
      duration: { ms: 8.5 * 3_600_000 },
    });
    expect(gantt.getTask('milestone')).toMatchObject({
      type: 'milestone',
      start: date('2026-03-09'),
      end: date('2026-03-09'),
    });
    // Hierarchy issues are part of the record, next to the model's.
    expect(gantt.getTask('orphan')?.issues.map((found) => found.code)).toEqual(['unknown-parent']);
  });

  it('FR-TIME-8: with endInclusive off, a date-only end is the exclusive end', () => {
    const gantt = createGanttCore({
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }],
      dates: { endInclusive: false },
    });
    expect(gantt.getTask('a')).toMatchObject({
      end: date('2026-03-06'),
      endExclusive: date('2026-03-06'),
      duration: { calendarDays: 4 },
    });
  });

  it('keeps a record while its inputs are unchanged and rebuilds it when the rows change', () => {
    const gantt = createGanttCore({
      tasks: [
        { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-06' },
        { id: 'c', name: 'C', parentId: 'p', start: '2026-03-02', end: '2026-03-03' },
      ],
    });
    const child = gantt.getTask('c');
    expect(gantt.getTask('c')).toBe(child);
    gantt.select(['c']);
    expect(gantt.getTask('c')).toBe(child);
    gantt.collapse('p');
    expect(gantt.getTask('c')).not.toBe(child);
    expect(gantt.getTask('c')?.rowIndex).toBeUndefined();
    expect(Object.isFrozen(gantt.getTask('c'))).toBe(true);
  });

  it('FR-API-5, FR-DATA-7: a record keeps its identity until something it shows changes', () => {
    const b: Task = { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' };
    const a = (name: string, end: string): Task => ({ id: 'a', name, start: '2026-03-02', end });
    const gantt = createGanttCore({
      tasks: [a('A', '2026-03-06'), b],
      links: [{ source: 'a', target: 'b', lag: 0 }],
    });
    const record = gantt.getTask('b');
    // Another task renamed: a new model and new conflicts, with the same content for `b`.
    gantt.setTasks([a('A 2', '2026-03-06'), b]);
    expect(gantt.getTask('b')).toBe(record);
    // Every task normalized again, `b` to the same values.
    gantt.setOptions({ calendar: { weekends: [0] } });
    expect(gantt.getTask('b')).toBe(record);
    // `a` now ends after `b` starts: the violated link is a conflict of `b`.
    gantt.setTasks([a('A 2', '2026-03-10'), b]);
    const conflicted = gantt.getTask('b');
    expect(conflicted).not.toBe(record);
    expect(conflicted?.conflicts.map((conflict) => conflict.type)).toEqual(['link-violated']);
    // Another row.
    gantt.setTasks([b, a('A 2', '2026-03-10')]);
    expect(gantt.getTask('b')).not.toBe(conflicted);
    expect(gantt.getTask('b')?.rowIndex).toBe(0);
    // Gone, and back as a new record.
    gantt.setTasks([a('A 2', '2026-03-06')]);
    expect(gantt.getTask('b')).toBeUndefined();
    gantt.setTasks([a('A 2', '2026-03-06'), b]);
    expect(gantt.getTask('b')).toEqual(record);
  });

  it('builds the public dates of a change', () => {
    const options = { options: { endInclusive: true } } as const;
    expect(taskDates({ precision: 'day' }, options, at('2026-03-02'), at('2026-03-07'))).toEqual({
      start: date('2026-03-02'),
      end: date('2026-03-06'),
      endExclusive: date('2026-03-07'),
    });
    expect(
      taskDates({ precision: 'time' }, options, at('2026-03-02'), at('2026-03-07')).end,
    ).toEqual(date('2026-03-07'));
  });
});

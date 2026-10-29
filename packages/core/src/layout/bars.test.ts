import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type Task, type TaskModel } from '../model';
import { createTimeScale } from '../scale';
import { asDateTimeMs, type DateTimeMs, parseDateInput } from '../time';
import { barGeometry, type BarSource } from './bars';
import type { RowMetrics } from './rows';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

const { calendar } = createWorkCalendar({ weekends: [0, 6] });
const origin = at('2026-03-01');
/** Day view: 40 px per day. */
const day = createTimeScale({ origin, pxPerDay: 40 });
/** Hour view: 960 px per day, 40 px per hour. */
const hour = createTimeScale({ origin, pxPerDay: 960 });
const row: RowMetrics = Object.freeze({ id: 'a', index: 2, y: 96, height: 48 });

function model(task: Omit<Task, 'id' | 'name'>, granularity = '1d'): TaskModel {
  const tasks: Task[] = [{ id: 'a', name: 'A', ...task }];
  return normalizeModel({ tasks }, { calendar, granularity }).tasks[0]!;
}

describe('layout/bars', () => {
  it('FR-BAR-1, FR-ROW-5: a day-precision bar spans its days, centred in its row', () => {
    // Mon 2 … Fri 6 March: five whole days from x = 40.
    const bar = barGeometry(model({ start: '2026-03-02', end: '2026-03-06' }), row, day);
    expect(bar).toEqual({
      id: 'a',
      rowIndex: 2,
      kind: 'bar',
      x: 40,
      y: 96 + 9,
      width: 200,
      height: 30,
      radius: 3,
      progressWidth: 0,
    });
    expect(Object.isFrozen(bar)).toBe(true);
  });

  it('FR-BAR-1: a time-precision bar starts and ends at its moments', () => {
    const task = model({ start: '2026-03-01T10:00', end: '2026-03-01T16:30' }, '30min');
    expect(task.precision).toBe('time');
    const bar = barGeometry(task, row, hour)!;
    expect(bar.x).toBe(400);
    expect(bar.width).toBe(260);
    // The same task in the day view is a quarter of a day wide.
    const narrow = barGeometry(task, row, day)!;
    expect(narrow.x).toBeCloseTo(16.6667, 4);
    expect(narrow.width).toBeCloseTo(10.8333, 4);
  });

  it('FR-ROW-5: bar height and radius follow the options; the bar never outgrows its row', () => {
    const task = model({ start: '2026-03-02', end: '2026-03-06' });
    expect(barGeometry(task, row, day, { barHeight: 20, barRadius: 6 })).toMatchObject({
      y: 96 + 14,
      height: 20,
      radius: 6,
    });
    const low: RowMetrics = { id: 'a', index: 0, y: 0, height: 24 };
    expect(barGeometry(task, low, day, { barHeight: 30 })).toMatchObject({ y: 0, height: 24 });
  });

  it('FR-BAR-2: the radius is clamped to half the height and half the width', () => {
    const wide = model({ start: '2026-03-02', end: '2026-03-06' });
    expect(barGeometry(wide, row, day, { barRadius: 40 })!.radius).toBe(15);
    // Two hours in the day view: 3.33 px wide.
    const narrow = model({ start: '2026-03-02T08:00', end: '2026-03-02T10:00' }, '1h');
    const bar = barGeometry(narrow, row, day, { barRadius: 3 })!;
    expect(bar.radius).toBeCloseTo(bar.width / 2, 10);
    expect(bar.radius).toBeLessThan(3);
    expect(barGeometry(wide, row, day, { barRadius: -2 })!.radius).toBe(0);
  });

  it('FR-BAR-1: progress widths at 0, 50 and 100 %', () => {
    const width = (progress: number): number =>
      barGeometry(model({ start: '2026-03-02', end: '2026-03-05', progress: progress }), row, day)!
        .progressWidth;
    // Four days: 50 % is two days, aligned down to whole days.
    expect(width(0)).toBe(0);
    expect(width(50)).toBe(80);
    expect(width(100)).toBe(160);
    expect(width(60)).toBe(80);
  });

  it('FR-BAR-1: working-mode progress counts working days only', () => {
    // Fri 6 … Tue 10 March, 3 working days; 2/3 done ends after Monday (the weekend is skipped).
    const task = model({
      start: '2026-03-06',
      end: '2026-03-10',
      durationMode: 'working',
      progress: 66.67,
    });
    expect(barGeometry(task, row, day)!.progressWidth).toBe(4 * 40);
  });

  it('FR-BAR-1: a progress date outside the bar is clamped to it', () => {
    const span = { start: at('2026-03-02'), endExclusive: at('2026-03-04') };
    const draft = (progressDate: DateTimeMs): BarSource => ({
      type: 'task',
      span: { ...span, progressDate },
    });
    expect(barGeometry(draft(at('2026-03-01')), row, day)!.progressWidth).toBe(0);
    expect(barGeometry(draft(at('2026-03-09')), row, day)!.progressWidth).toBe(80);
  });

  it('FR-BAR-6: a milestone is a diamond of bar height centred on its start', () => {
    const milestone = model({ type: 'milestone', start: '2026-03-04', progress: 100 });
    expect(milestone.span!.endExclusive).toBe(milestone.span!.start);
    expect(barGeometry(milestone, row, day)).toEqual({
      id: 'a',
      rowIndex: 2,
      kind: 'milestone',
      x: 120 - 15,
      y: 96 + 9,
      width: 30,
      height: 30,
      radius: 3,
      progressWidth: 0,
    });
    expect(barGeometry(milestone, row, day, { barRadius: 99 })!.radius).toBe(15);
  });

  it('FR-BAR-1: a zero-length task is a bar of width 0', () => {
    const task = model({ start: '2026-03-02T10:00', end: '2026-03-02T10:00' }, '1h');
    expect(task.span!.duration.ms).toBe(0);
    expect(barGeometry(task, row, hour)).toMatchObject({
      kind: 'bar',
      x: 1360,
      width: 0,
      radius: 0,
      progressWidth: 0,
    });
    // A draft with its edges crossed is not drawn backwards.
    const crossed: BarSource = {
      type: 'task',
      span: {
        start: at('2026-03-03'),
        endExclusive: at('2026-03-02'),
        progressDate: at('2026-03-03'),
      },
    };
    expect(barGeometry(crossed, row, day)).toMatchObject({ x: 80, width: 0, progressWidth: 0 });
  });

  it('FR-ROW-3: placeholders and invalid tasks have no bar', () => {
    expect(
      barGeometry(model({ type: 'placeholder', start: '2026-03-02' }), row, day),
    ).toBeUndefined();
    expect(barGeometry(model({}), row, day)).toBeUndefined();
    expect(
      barGeometry(model({ start: '2026-03-06', end: '2026-03-02' }), row, day),
    ).toBeUndefined();
    const span = {
      start: asDateTimeMs(0),
      endExclusive: asDateTimeMs(0),
      progressDate: asDateTimeMs(0),
    };
    expect(barGeometry({ type: 'placeholder', span }, row, day)).toBeUndefined();
  });

  it('never mutates its input', () => {
    const task = Object.freeze(model({ start: '2026-03-02', end: '2026-03-06' }));
    const options = Object.freeze({ barHeight: 20 });
    expect(barGeometry(task, row, day, options)!.height).toBe(20);
  });
});

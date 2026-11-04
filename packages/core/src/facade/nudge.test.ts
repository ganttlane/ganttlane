import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { Link, Task } from '../model';
import { parseDateInput, toDate } from '../time';
import { createGanttCore, type GanttCore, type GanttCoreOptions } from './index';

/** A local `Date` with the wall clock of an ISO string. */
function date(iso: string): Date {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return toDate(parsed.value.value);
}

// 2026-03-02 is a Monday.
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'short', name: 'Short', start: '2026-03-16', end: '2026-03-17' },
  { id: 'frozen', name: 'Frozen', start: '2026-03-16', end: '2026-03-20', locked: true },
  { id: 'stub', name: 'Stub', type: 'placeholder' },
]);
const LINKS: readonly Link[] = deepFreeze([
  { id: 'design-build', source: 'design', target: 'build' },
]);

function chart(options: Partial<GanttCoreOptions> = {}): GanttCore {
  const gantt = createGanttCore({
    tasks: TASKS,
    links: LINKS,
    calendar: { weekends: [0, 6] },
    now: () => '2026-03-04',
    scroll: { initial: 'start', autoScroll: false },
    ...options,
  });
  gantt.setViewport({ width: 2000, height: 600 });
  return gantt;
}

/** The start and the inclusive end of a task, as ISO dates. */
function span(gantt: GanttCore, id: string): string {
  const task = gantt.getTask(id);
  const iso = (d: Date | undefined): string =>
    d === undefined ? '' : d.toLocaleDateString('en-CA');
  return `${iso(task?.start)}/${iso(task?.end)}`;
}

describe('core.nudge: one snap step, the rules of the same drag (FR-EDIT-9)', () => {
  it('FR-EDIT-9: move shifts both edges one step later and successors follow', async () => {
    const reasons: unknown[] = [];
    const gantt = chart({
      onBeforeTaskChange: ({ reason }) => {
        reasons.push(reason);
      },
    });
    const seen: string[] = [];
    gantt.on('tasksChange', (changeSet) => seen.push(changeSet.reason));
    expect(await gantt.nudge('design', 'move', 1)).toMatchObject({ status: 'committed' });
    expect(span(gantt, 'design')).toBe('2026-03-03/2026-03-07');
    expect(gantt.getTask('build')?.start).toEqual(date('2026-03-10'));
    expect(reasons).toEqual(['move']);
    expect(seen).toEqual(['move']);
  });

  it('FR-EDIT-9, FR-SNAP-8: move earlier skips the weekend like a drag does', async () => {
    const gantt = chart();
    await gantt.nudge('design', 'move', -1);
    expect(gantt.getTask('design')?.start).toEqual(date('2026-02-27'));
  });

  it('FR-EDIT-9: the end and the start move on their own, the task keeps one step at least', async () => {
    const gantt = chart();
    await gantt.nudge('design', 'resize-end', 1);
    expect(span(gantt, 'design')).toBe('2026-03-02/2026-03-07');
    await gantt.nudge('design', 'resize-start', 1);
    expect(span(gantt, 'design')).toBe('2026-03-03/2026-03-07');
    // `short` is two days; the end goes back to one, and no further.
    expect(await gantt.nudge('short', 'resize-end', -1)).toMatchObject({ status: 'committed' });
    expect(span(gantt, 'short')).toBe('2026-03-16/2026-03-16');
    expect(await gantt.nudge('short', 'resize-end', -1)).toMatchObject({ status: 'unchanged' });
    expect(await gantt.nudge('short', 'resize-start', 1)).toMatchObject({ status: 'unchanged' });
  });

  it('FR-SNAP-2, FR-EDIT-9: a calendar step goes to the next boundary, also from between two', async () => {
    const gantt = chart({
      scheduling: { snap: '1mo', skipNonWorkingDays: { move: false } },
    });
    await gantt.nudge('design', 'move', 1);
    expect(gantt.getTask('design')?.start).toEqual(date('2026-04-01'));
    await gantt.nudge('design', 'move', -1);
    expect(gantt.getTask('design')?.start).toEqual(date('2026-03-01'));
    // From the 9th the next boundary is the 1st, not a month later.
    await gantt.nudge('build', 'move', -1);
    expect(gantt.getTask('build')?.start).toEqual(date('2026-03-01'));
  });

  it('FR-SNAP-4, FR-EDIT-9: a step follows the interaction its gesture belongs to', async () => {
    const gantt = chart({
      scheduling: { snap: { move: '2d', resize: '1d' }, skipNonWorkingDays: { move: false } },
    });
    // The 9th lies between two boundaries of the two-day grid: the next one is the 10th.
    await gantt.nudge('build', 'move', 1);
    expect(span(gantt, 'build')).toBe('2026-03-10/2026-03-14');
    await gantt.nudge('build', 'move', 1);
    expect(span(gantt, 'build')).toBe('2026-03-12/2026-03-16');
    await gantt.nudge('build', 'resize-end', 1);
    expect(span(gantt, 'build')).toBe('2026-03-12/2026-03-17');
  });

  it('FR-EDIT-7, FR-EDIT-9: a locked task, editing off and a missing bar are refused with editRefused', async () => {
    const gantt = chart();
    const refusals: unknown[] = [];
    gantt.on('editRefused', (payload) => refusals.push(payload));
    expect(await gantt.nudge('frozen', 'move', 1)).toEqual({
      status: 'refused',
      reason: 'permission',
    });
    expect(await gantt.nudge('ghost', 'move', 1)).toEqual({
      status: 'refused',
      reason: 'unknown-task',
    });
    expect(await gantt.nudge('stub', 'move', 1)).toEqual({
      status: 'refused',
      reason: 'unknown-task',
    });
    gantt.setOptions({ editing: { move: false } });
    expect(await gantt.nudge('design', 'move', 1)).toMatchObject({ reason: 'permission' });
    expect(await gantt.nudge('design', 'resize-end', 1)).toMatchObject({ status: 'committed' });
    expect(refusals).toEqual([
      expect.objectContaining({ gesture: 'move', id: 'frozen', reason: 'permission' }),
      expect.objectContaining({ gesture: 'move', id: 'ghost', reason: 'unknown-task' }),
      expect.objectContaining({ gesture: 'move', id: 'stub', reason: 'unknown-task' }),
      expect.objectContaining({ gesture: 'move', id: 'design', reason: 'permission' }),
    ]);
    expect(span(gantt, 'frozen')).toBe('2026-03-16/2026-03-20');
  });

  it('FR-TX-2, FR-EDIT-9: a before-hook cancels a nudge like it cancels a drag', async () => {
    const gantt = chart({ onBeforeTaskChange: () => false });
    expect(await gantt.nudge('design', 'move', 1)).toMatchObject({ status: 'cancelled' });
    expect(span(gantt, 'design')).toBe('2026-03-02/2026-03-06');
  });

  it('FR-TX-1, FR-EDIT-9: a nudge waits for a pending operation, and a destroyed chart refuses', async () => {
    let release: () => void = () => undefined;
    const gantt = chart({
      onBeforeTaskChange: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const first = gantt.nudge('design', 'move', 1);
    expect(await gantt.nudge('build', 'move', 1)).toEqual({ status: 'busy' });
    release();
    expect(await first).toMatchObject({ status: 'committed' });
    gantt.destroy();
    expect(await gantt.nudge('design', 'move', 1)).toMatchObject({ status: 'cancelled' });
  });

  it('FR-EDIT-9, FR-SNAP-12: in the hour view a step is 15 minutes', async () => {
    const gantt = chart({
      tasks: [{ id: 'timed', name: 'Timed', start: '2026-03-02T09:00', end: '2026-03-02T11:00' }],
      links: [],
      scheduling: { granularity: '15min' },
      viewMode: 'hour',
    });
    await gantt.nudge('timed', 'move', 1);
    expect(gantt.getTask('timed')?.start).toEqual(date('2026-03-02T09:15'));
  });

  it('FR-TX-2, FR-EDIT-9: a throwing before-hook is in the result, and not reported to the unhandled-rejection channel as well', async () => {
    // What the core hands to the host's unhandled-rejection channel (a drag's hook error goes there).
    const reports: unknown[] = [];
    vi.spyOn(Promise, 'reject').mockImplementation((reason) => {
      reports.push(reason);
      return new Promise<never>(() => undefined);
    });
    const veto = new Error('veto');
    const gantt = chart({
      onBeforeTaskChange: () => {
        throw veto;
      },
    });
    expect(await gantt.nudge('design', 'move', 1)).toMatchObject({
      status: 'cancelled',
      reason: 'error',
      error: veto,
    });
    expect(reports).toEqual([]);
    vi.restoreAllMocks();
  });

  it('FR-EDIT-9: a gesture or a direction that is none of the three leaves the task alone', async () => {
    const gantt = chart();
    const call = gantt.nudge as (
      id: string,
      gesture: unknown,
      direction: unknown,
    ) => Promise<unknown>;
    for (const [gesture, direction] of [
      ['progress', 1],
      ['link-create', 1],
      ['foo', 1],
      ['move', 2],
      ['move', -3],
      ['move', 0],
      ['move', Number.NaN],
      ['move', undefined],
    ] as const) {
      expect(
        await call('design', gesture, direction),
        `${gesture} ${String(direction)}`,
      ).toMatchObject({
        status: 'unchanged',
      });
    }
    expect(span(gantt, 'design')).toBe('2026-03-02/2026-03-06');
  });

  it('FR-SNAP-3, FR-EDIT-9: relative snapping steps from the edge itself, and snap off steps by the data step', async () => {
    const relative = chart({
      tasks: [{ id: 't', name: 'T', start: '2026-03-02T10:00', end: '2026-03-04T10:00' }],
      links: [],
      scheduling: { granularity: '1h', snap: { step: '1d', mode: 'relative' } },
    });
    await relative.nudge('t', 'move', 1);
    expect(relative.getTask('t')?.start).toEqual(date('2026-03-03T10:00'));
    await relative.nudge('t', 'resize-end', -1);
    expect(relative.getTask('t')?.end).toEqual(date('2026-03-04T10:00'));
    const off = chart({
      tasks: [{ id: 't', name: 'T', start: '2026-03-02T10:00', end: '2026-03-04T10:00' }],
      links: [],
      scheduling: { granularity: '1h', snap: false },
    });
    await off.nudge('t', 'move', 1);
    expect(off.getTask('t')?.start).toEqual(date('2026-03-02T11:00'));
  });

  it('FR-SNAP-7, FR-EDIT-9: a day task nudged by an hour becomes a timed one only with keepDayPrecision off', async () => {
    const options = {
      tasks: [{ id: 't', name: 'T', start: '2026-03-02', end: '2026-03-04' }],
      links: [],
      viewMode: 'hour',
    } as const;
    const kept = chart({ ...options, scheduling: { granularity: '1h' } });
    await kept.nudge('t', 'move', 1);
    expect(kept.getTask('t')).toMatchObject({ precision: 'day', start: date('2026-03-03') });
    const free = chart({ ...options, scheduling: { granularity: '1h', keepDayPrecision: false } });
    await free.nudge('t', 'move', 1);
    expect(free.getTask('t')).toMatchObject({ precision: 'time', start: date('2026-03-02T01:00') });
  });
});

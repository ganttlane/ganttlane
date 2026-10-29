import { deepFreeze } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  barHandles,
  INTERACTION_DEFAULTS,
  resolveEditing,
  resolveHandles,
  resolvePermissions,
} from '../interaction';
import type { Task } from '../model';
import { type DateTimeMs, parseDateInput } from '../time';
import { createGanttCore, type GanttCore, type GanttCoreOptions } from './index';

const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
]);

function chart(options: Partial<GanttCoreOptions> = {}): GanttCore {
  const gantt = createGanttCore({ tasks: TASKS, now: () => '2026-03-04', ...options });
  gantt.setViewport({ width: 800, height: 400 });
  return gantt;
}

/** A floating wall-clock time, as the snapshot carries it. */
function floating(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

/** The parts of a snapshot that `setOptions` made new objects. */
function changed(gantt: GanttCore, patch: Partial<GanttCoreOptions>): readonly string[] {
  const before = gantt.getSnapshot();
  gantt.setOptions(patch);
  const after = gantt.getSnapshot();
  return (Object.keys(after) as (keyof typeof after)[]).filter(
    (key) => !Object.is(before[key], after[key]),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GanttSnapshot.editing and .handles: the options a renderer needs (plan step 4.5)', () => {
  it('FR-EDIT-7: carry every editing flag and every handle size, defaults applied', () => {
    const snapshot = chart().getSnapshot();
    expect(snapshot.editing).toEqual({ move: true, resize: true, progress: true, links: true });
    expect(snapshot.handles).toEqual(INTERACTION_DEFAULTS.handles);
    expect(Object.isFrozen(snapshot.editing)).toBe(true);
    expect(Object.isFrozen(snapshot.handles)).toBe(true);

    const custom = chart({
      editing: { resize: false, links: false },
      interaction: { handles: { link: 8 } },
    }).getSnapshot();
    expect(custom.editing).toEqual({ move: true, resize: false, progress: true, links: false });
    expect(custom.handles).toEqual({ ...INTERACTION_DEFAULTS.handles, link: 8 });
    expect(chart({ editing: false }).getSnapshot().editing).toEqual({
      move: false,
      resize: false,
      progress: false,
      links: false,
    });
  });

  it('FR-EDIT-7: resolving is the same as the option: permissions and handles agree', () => {
    const options = [undefined, true, false, { move: false }, { resize: false, links: false }];
    const model = chart().getSnapshot().state.derived.model;
    for (const editing of options) {
      expect(resolveEditing(editing)).toEqual(resolveEditing(resolveEditing(editing)));
      for (const task of model.tasks) {
        expect(resolvePermissions(task, resolveEditing(editing))).toEqual(
          resolvePermissions(task, editing),
        );
      }
    }
    const bar = chart().getBarRect('design')!;
    const sizes = { resize: 4, link: 3 };
    expect(barHandles(bar, resolveHandles(sizes))).toEqual(barHandles(bar, sizes));
  });

  it('FR-API-2: `editing` changes the snapshot and its `editing` part, nothing else', () => {
    const gantt = chart();
    expect(changed(gantt, { editing: false })).toEqual(['editing']);
    expect(gantt.getSnapshot().editing.move).toBe(false);
    expect(changed(gantt, { editing: { move: true, resize: false } })).toEqual(['editing']);
    expect(gantt.getSnapshot().editing).toEqual({
      move: true,
      resize: false,
      progress: true,
      links: true,
    });
  });

  it('FR-API-2: the same flags spelled another way publish nothing', () => {
    const gantt = chart();
    const snapshot = gantt.getSnapshot();
    expect(changed(gantt, { editing: true })).toEqual([]);
    expect(changed(gantt, { editing: { move: true } })).toEqual([]);
    expect(changed(gantt, { editing: undefined })).toEqual([]);
    expect(gantt.getSnapshot()).toBe(snapshot);
  });

  it('FR-API-2: `interaction.handles` changes the `handles` part, nothing else', () => {
    const gantt = chart();
    expect(changed(gantt, { interaction: { handles: { link: 9, linkOffset: 14 } } })).toEqual([
      'handles',
    ]);
    expect(gantt.getSnapshot().handles).toEqual({
      resize: 8,
      progress: 6,
      link: 9,
      linkOffset: 14,
    });
    // A threshold is not a handle size: the machine is recreated and no part changes.
    const before = gantt.getSnapshot();
    expect(changed(gantt, { interaction: { dragThreshold: 5 } })).toEqual([]);
    expect(gantt.getSnapshot()).toBe(before);
  });

  it('FR-API-2: a size that is unusable falls back to its default in `handles`, with an issue', () => {
    const gantt = chart({ interaction: { handles: { link: 9 } } });
    const issues = gantt.setOptions({ interaction: { handles: { link: Number.NaN } } });
    expect(issues.map((found) => found.path)).toContain('interaction.handles.link');
    expect(gantt.getSnapshot().handles.link).toBe(INTERACTION_DEFAULTS.handles.link);
  });

  it('FR-EDIT-7: the machine and the snapshot use the same handle sizes', () => {
    const gantt = chart({ interaction: { handles: { link: 12, linkOffset: 30 } } });
    const { handles } = gantt.getSnapshot();
    const bar = gantt.getBarRect('design')!;
    const box = barHandles(bar, handles).linkEnd;
    gantt.send({
      type: 'down',
      pointerId: 1,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      time: 1,
    });
    expect(gantt.getSnapshot().feedback.hover).toMatchObject({ part: 'link-end', id: 'design' });
  });
});

describe('GanttSnapshot.now and refreshNow: "today" from the core (plan step 4.5, FR-UI-1)', () => {
  it('FR-UI-1: is the `now` option truncated to the minute, as floating wall-clock time', () => {
    const gantt = chart({ now: () => new Date(2026, 2, 4, 10, 30, 45, 123) });
    expect(gantt.getSnapshot().now).toBe(floating('2026-03-04T10:30'));
    expect(chart({ now: () => '2026-03-04' }).getSnapshot().now).toBe(floating('2026-03-04'));
    expect(chart({ now: () => '2026-03-04T23:59' }).getSnapshot().now).toBe(
      floating('2026-03-04T23:59'),
    );
  });

  it('FR-UI-1: is the system clock without a `now` option', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8, 5, 59));
    const gantt = createGanttCore({ tasks: TASKS });
    expect(gantt.getSnapshot().now).toBe(floating('2026-06-15T08:05'));
  });

  it('FR-UI-1: an unusable `now` falls back to the system clock and is reported', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8, 5));
    const gantt = chart({
      now: () => {
        throw new Error('no clock');
      },
    });
    expect(gantt.getSnapshot().now).toBe(floating('2026-06-15T08:05'));
    expect(gantt.getIssues().options.map((found) => found.path)).toContain('now');
  });

  it('FR-UI-1: refreshNow publishes a new snapshot when the minute changed', () => {
    let clock = new Date(2026, 2, 4, 10, 30, 10);
    const gantt = chart({ now: () => clock });
    const listener = vi.fn();
    gantt.subscribe(listener);
    const first = gantt.getSnapshot();

    clock = new Date(2026, 2, 4, 10, 31, 0);
    gantt.refreshNow();
    const next = gantt.getSnapshot();
    expect(next.now).toBe(floating('2026-03-04T10:31'));
    expect(next).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    // Only the clock moved: every other part keeps its identity.
    for (const key of Object.keys(first) as (keyof typeof first)[]) {
      if (key !== 'now') expect(next[key], key).toBe(first[key]);
    }
  });

  it('FR-UI-1: refreshNow within the same minute publishes nothing', () => {
    let clock = new Date(2026, 2, 4, 10, 30, 10);
    const gantt = chart({ now: () => clock });
    const listener = vi.fn();
    gantt.subscribe(listener);
    const first = gantt.getSnapshot();

    clock = new Date(2026, 2, 4, 10, 30, 59, 999);
    gantt.refreshNow();
    gantt.refreshNow();
    expect(gantt.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
  });

  it('FR-UI-1: refreshNow crosses midnight, so the today line cannot go stale overnight', () => {
    let clock = new Date(2026, 2, 4, 23, 59, 30);
    const gantt = chart({ now: () => clock });
    expect(gantt.getSnapshot().now).toBe(floating('2026-03-04T23:59'));
    clock = new Date(2026, 2, 5, 0, 0, 5);
    gantt.refreshNow();
    expect(gantt.getSnapshot().now).toBe(floating('2026-03-05T00:00'));
  });

  it('FR-API-2: setting `now` updates the snapshot in the same operation', () => {
    const gantt = chart({ now: () => '2026-03-04' });
    gantt.setOptions({ now: () => '2026-03-10T12:00' });
    expect(gantt.getSnapshot().now).toBe(floating('2026-03-10T12:00'));
  });

  it('FR-API-4: refreshNow after destroy is inert', () => {
    let clock = new Date(2026, 2, 4, 10, 30);
    const gantt = chart({ now: () => clock });
    const listener = vi.fn();
    gantt.subscribe(listener);
    gantt.destroy();
    clock = new Date(2026, 2, 4, 10, 45);
    expect(() => {
      gantt.refreshNow();
    }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

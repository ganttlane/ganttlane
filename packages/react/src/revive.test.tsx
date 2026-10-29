import { patchTasks } from '@ganttlane/core';
import type { Task } from '@ganttlane/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Controller } from './controller';
import { createController } from './controller';
import type { ListenerTracker } from './testing';
import { cleanUpDocument, createManualFrames, stubScrollerSize, trackListeners } from './testing';
import { chartOf, forgetCharts } from './testing/charts';
import type { GanttReactOptions } from './types';

/**
 * The chart that is made again after its core was destroyed: what React does to a chart in a
 * hidden `<Activity>` (React 19.2), driven by hand so that both React projects run it. Hiding
 * is the ref going `null`, the cleanup of the effects (`release`) and a microtask later; showing
 * is the ref coming back and the effects set up again (`retain`, then `update` of a commit).
 */

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
  { id: 'p', name: 'P', start: '2026-03-16', end: '2026-03-27' },
  { id: 'c', name: 'C', parentId: 'p', start: '2026-03-17', end: '2026-03-20' },
];
const LINKS = [{ source: 'a', target: 'b' }];
const NOW = (): string => '2026-03-04';

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  forgetCharts();
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

function options(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return {
    defaultTasks: TASKS,
    defaultLinks: LINKS,
    now: NOW,
    renderer: { frames: createManualFrames() },
    ...extra,
  };
}

/** A chart as `useGantt` would commit it for the first time. */
function commit(props: GanttReactOptions): {
  readonly controller: Controller<unknown>;
  readonly container: HTMLElement;
  /** What the commit of the props does. */
  readonly rerender: (next: GanttReactOptions) => void;
  readonly hide: () => Promise<void>;
  readonly show: (next?: GanttReactOptions) => void;
} {
  let latest = props;
  const controller = createController(props, () => undefined);
  const container = document.createElement('div');
  document.body.append(container);
  controller.instance.setContainer(container);
  controller.update(props);
  controller.settle();
  controller.retain();
  return {
    controller,
    container,
    rerender: (next) => {
      latest = next;
      controller.update(next);
      controller.settle();
    },
    hide: async () => {
      controller.instance.setContainer(null);
      controller.release();
      await Promise.resolve();
    },
    show: (next = latest) => {
      latest = next;
      controller.instance.setContainer(container);
      controller.retain();
      controller.update(next);
      controller.settle();
    },
  };
}

describe('a chart made again after it was hidden: what it carries', () => {
  it('FR-REACT-5: the zoom (pxPerDay) and the date at the left edge come back', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    instance.zoomTo(80);
    instance.core.scroll({ left: 400, top: 0 });
    const zoom = instance.getSnapshot().timeline.scale.pxPerDay;
    const edge = instance.getVisibleRange().start.getTime();
    expect(zoom).toBe(80);
    const first = chartOf(instance.core);

    await chart.hide();
    chart.show();

    expect(chartOf(instance.core)).not.toBe(first);
    expect(instance.getSnapshot().timeline.scale.pxPerDay).toBe(80);
    expect(instance.getVisibleRange().start.getTime()).toBe(edge);
  });

  it('FR-REACT-5: a chart that was never zoomed keeps the zoom of its view mode', async () => {
    const chart = commit(options({ defaultViewMode: 'week' }));
    const { instance } = chart.controller;
    const zoom = instance.getSnapshot().timeline.scale.pxPerDay;

    await chart.hide();
    chart.show();

    expect(instance.getSnapshot().viewMode.id).toBe('week');
    expect(instance.getSnapshot().timeline.scale.pxPerDay).toBe(zoom);
    expect(instance.getSnapshot().viewMode.pxPerDay).toBe(zoom);
  });

  it('FR-REACT-5: the selected link comes back, quietly, with the selected tasks', async () => {
    const onSelectionChange = vi.fn();
    const chart = commit(options({ onSelectionChange }));
    const { instance } = chart.controller;
    instance.select(['b']);
    instance.selectLink('a:FS:b');
    onSelectionChange.mockClear();

    await chart.hide();
    chart.show();

    expect(instance.getSnapshot().selection.tasks).toEqual(['b']);
    expect(instance.getSnapshot().selection.link).toBe('a:FS:b');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('FR-REACT-5: a selected link that is gone from the data is not selected', async () => {
    const chart = commit(options({ defaultLinks: undefined, links: LINKS }));
    const { instance } = chart.controller;
    instance.selectLink('a:FS:b');

    await chart.hide();
    chart.show(options({ defaultLinks: undefined, links: [] }));

    expect(instance.getSnapshot().selection.link).toBeUndefined();
  });
});

describe('a chart made again after it was hidden, with an edit session open', () => {
  const edited = async (
    extra: Partial<GanttReactOptions> = {},
  ): Promise<ReturnType<typeof commit>> => {
    const chart = commit(options({ editing: true, history: true, ...extra }));
    const { instance } = chart.controller;
    expect(instance.edit.begin()).toMatchObject({ status: 'begun' });
    await instance.updateTask('a', { start: '2026-03-03' });
    expect(instance.edit.isDirty).toBe(true);
    return chart;
  };

  it('FR-REACT-5: the session ends as a rollback: the data is the base, the application hears dirtyChange, then editRollback with the inverse', async () => {
    const calls: [string, unknown][] = [];
    const chart = await edited({
      onDirtyChange: (payload) => calls.push(['dirty', payload]),
      onEditRollback: (changes) => calls.push(['rollback', changes]),
      onHistoryChange: (payload) => calls.push(['history', payload]),
    });
    const { instance } = chart.controller;
    calls.length = 0;
    expect(instance.getTask('a')?.start?.getDate()).toBe(3);

    await chart.hide();
    // Nothing is said while it is hidden: the application may have gone with it.
    expect(calls).toEqual([]);
    chart.show();

    expect(instance.edit.isOpen).toBe(false);
    expect(instance.edit.isDirty).toBe(false);
    expect(instance.getTask('a')?.start?.getDate()).toBe(2);
    expect(calls.map(([kind]) => kind)).toEqual(['history', 'dirty', 'rollback']);
    expect(calls[0]?.[1]).toEqual({ canUndo: false, canRedo: false });
    expect(calls[1]?.[1]).toEqual({ isDirty: false });
    const inverse = calls[2]?.[1] as { reason: string; changes: { id: string }[] };
    expect(inverse.reason).toBe('rollback');
    // `a` and what its link moved with it (`b`).
    expect(inverse.changes.map((change) => change.id)).toEqual(['a', 'b']);
  });

  it('FR-REACT-5: with controlled tasks the application writes the inverse into its tasks, as it does for a Cancel', async () => {
    let tasks: readonly Task[] = TASKS;
    const controller: { current?: Controller<unknown> } = {};
    const props = (): GanttReactOptions =>
      options({
        defaultTasks: undefined,
        tasks,
        editing: true,
        onTasksChange: (changes) => {
          tasks = patchTasks(
            tasks,
            changes,
            controller.current!.instance.getSnapshot().state.derived.model,
          );
        },
        onEditRollback: (changes) => {
          tasks = patchTasks(
            tasks,
            changes,
            controller.current!.instance.getSnapshot().state.derived.model,
          );
        },
      });
    const chart = commit(props());
    controller.current = chart.controller;
    const { instance } = chart.controller;
    expect(instance.edit.begin()).toMatchObject({ status: 'begun' });
    await instance.updateTask('a', { start: '2026-03-03' });
    chart.rerender(props());
    expect(tasks[0]?.start).toBe('2026-03-03');

    await chart.hide();
    chart.show(props());
    // The handler wrote the inverse; the commit that follows takes the tasks to the chart.
    chart.rerender(props());

    expect(tasks[0]?.start).toBe('2026-03-02');
    expect(instance.getTask('a')?.start?.getDate()).toBe(2);
    expect(instance.edit.isOpen).toBe(false);
  });

  it('FR-REACT-5: a session that is open and clean ends with editRollback only', async () => {
    const calls: string[] = [];
    const chart = commit(
      options({
        onDirtyChange: () => calls.push('dirty'),
        onEditRollback: () => calls.push('rollback'),
      }),
    );
    chart.controller.instance.edit.begin();

    await chart.hide();
    chart.show();

    expect(calls).toEqual(['rollback']);
    expect(chart.controller.instance.edit.isOpen).toBe(false);
  });

  it('FR-REACT-5: with no session open the application hears nothing', async () => {
    const onDirtyChange = vi.fn();
    const onEditRollback = vi.fn();
    const onHistoryChange = vi.fn();
    const chart = commit(options({ onDirtyChange, onEditRollback, onHistoryChange }));

    await chart.hide();
    chart.show();

    expect(onDirtyChange).not.toHaveBeenCalled();
    expect(onEditRollback).not.toHaveBeenCalled();
    expect(onHistoryChange).not.toHaveBeenCalled();
  });

  it('FR-REACT-5: the undo history that is not carried over is reported to the application, once', async () => {
    const onHistoryChange = vi.fn();
    const chart = commit(options({ history: true, onHistoryChange }));
    await chart.controller.instance.updateTask('a', { start: '2026-03-03' });
    expect(chart.controller.instance.canUndo).toBe(true);
    onHistoryChange.mockClear();

    await chart.hide();
    chart.show();
    chart.rerender(options({ history: true, onHistoryChange }));

    expect(chart.controller.instance.canUndo).toBe(false);
    expect(onHistoryChange).toHaveBeenCalledTimes(1);
    expect(onHistoryChange).toHaveBeenCalledWith({ canUndo: false, canRedo: false });
  });

  it('FR-REACT-5: a real unmount (nothing sets the effects up again) says nothing to anyone', async () => {
    const onDirtyChange = vi.fn();
    const onEditRollback = vi.fn();
    const heard = vi.fn();
    const chart = await edited({ onDirtyChange, onEditRollback });
    chart.controller.instance.on('editRollback', heard);
    onDirtyChange.mockClear();

    await chart.hide();

    expect(onDirtyChange).not.toHaveBeenCalled();
    expect(onEditRollback).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('a chart made again after it was hidden: what a hidden chart does', () => {
  it('FR-REACT-5: its commands do nothing and its queries answer from the state it had', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    instance.select(['a']);

    await chart.hide();
    instance.select(['b']);
    instance.collapse('p');

    expect(instance.getSnapshot().selection.tasks).toEqual(['a']);
    expect(instance.getTask('p')?.isExpanded).toBe(true);
    expect(instance.getTask('a')?.name).toBe('A');
    chart.show();
    // Nothing that was asked of it meanwhile was queued.
    expect(instance.getSnapshot().selection.tasks).toEqual(['a']);
    expect(instance.getTask('p')?.isExpanded).toBe(true);
  });
});

describe('the core of an instance that was hidden and shown', () => {
  it('FR-REACT-5: instance.core is the same object, and the same snapshot as the instance’s', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    const core = instance.core;
    const before = instance.getSnapshot();
    expect(core.getSnapshot()).toBe(before);

    await chart.hide();
    chart.show();

    expect(instance.core).toBe(core);
    expect(core.getSnapshot()).toBe(instance.getSnapshot());
    expect(core.getSnapshot()).not.toBe(before);
    core.select(['b']);
    expect(instance.getSnapshot().selection.tasks).toEqual(['b']);
    expect(core.getTask('b')?.name).toBe('B');
  });

  it('FR-REACT-5: a subscription to instance.core follows the chart to its new core', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    const seen: unknown[] = [];
    const stop = instance.core.subscribe(() => seen.push(instance.core.getSnapshot()));
    instance.select(['a']);
    expect(seen).toHaveLength(1);

    await chart.hide();
    chart.show();
    seen.length = 0;
    instance.select(['b']);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(instance.getSnapshot());
    stop();
    instance.select(['a']);
    expect(seen).toHaveLength(1);
  });

  it('FR-REACT-5: a listener added with instance.core.on follows it too, and can be removed', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    const heard = vi.fn();
    const off = instance.core.on('selectionChange', heard);

    await chart.hide();
    chart.show();
    instance.select(['a']);

    expect(heard).toHaveBeenCalledTimes(1);
    off();
    instance.select(['b']);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('FR-REACT-5: the nested objects of the core (edit) are the new core’s as well', async () => {
    const chart = commit(options());
    const { instance } = chart.controller;
    const { edit } = instance.core;

    await chart.hide();
    chart.show();

    expect(edit.begin()).toMatchObject({ status: 'begun' });
    expect(instance.edit.isOpen).toBe(true);
    expect(instance.core.edit.isOpen).toBe(true);
    expect(instance.core.canUndo).toBe(false);
  });
});

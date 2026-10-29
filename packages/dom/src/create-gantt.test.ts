import type { GanttCore, LinkRecord, TaskRecord } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Gantt } from './create-gantt';
import { createGantt } from './create-gantt';
import type { ListenerTracker, ManualFrames } from './testing';
import {
  countNodes,
  createContainer,
  createManualFrames,
  stubScrollerSize,
  trackListeners,
} from './testing';

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
  { id: 'p', name: 'P', start: '2026-04-06', end: '2026-04-17' },
  { id: 'c', name: 'C', parentId: 'p', start: '2026-04-13', end: '2026-04-17' },
];
const LINKS = [{ source: 'a', target: 'b' }];

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A chart with manual frames over the test tasks, in a fresh container. */
function create(
  options: Partial<Parameters<typeof createGantt>[1]> = {},
  container: HTMLElement = createContainer(),
): { gantt: Gantt; frames: ManualFrames; container: HTMLElement } {
  const frames = createManualFrames();
  const gantt = createGantt(container, {
    tasks: TASKS,
    links: LINKS,
    now: () => '2026-03-04',
    renderer: { frames },
    ...options,
  });
  return { gantt, frames, container };
}

describe('createGantt', () => {
  it('FR-API-1: creates a core from the options and mounts the renderer on it', () => {
    const container = createContainer();

    const { gantt } = create(
      { renderer: { frames: createManualFrames(), idPrefix: 'demo' } },
      container,
    );

    expect(container.querySelector('.gantt')?.id).toBe('demo');
    expect(gantt.core.getTask('a')?.name).toBe('A');
    expect(gantt.core.getSnapshot().timeline.viewportWidth).toBe(800);
    gantt.destroy();
  });

  it('FR-API-1: the caller’s options, tasks and links are never mutated', () => {
    const tasks = Object.freeze(TASKS.map((task) => Object.freeze({ ...task })));
    const links = Object.freeze(LINKS.map((link) => Object.freeze({ ...link })));
    const options = Object.freeze({
      tasks,
      links,
      layout: Object.freeze({ rowHeight: 30, height: 300 }),
      display: Object.freeze({ today: false }),
      tooltip: Object.freeze({ delay: 0 }),
      highlights: Object.freeze([Object.freeze({ id: 'h', dates: ['2026-03-04'] })]),
      strings: Object.freeze({ chartLabel: 'Plan' }),
      renderer: Object.freeze({ frames: createManualFrames() }),
    });
    const before = JSON.stringify({ ...options, renderer: undefined });

    // Everything is frozen: a write to the caller's objects would throw.
    const gantt = createGantt(createContainer(), options);
    gantt.setOptions(
      Object.freeze({ layout: Object.freeze({ height: 200 }), tooltip: Object.freeze({}) }),
    );
    gantt.setTasks(tasks);
    gantt.destroy();

    expect(JSON.stringify({ ...options, renderer: undefined })).toBe(before);
  });

  it('FR-API-4: destroy removes the chart, then destroys the core it created; twice is fine', () => {
    const container = createContainer();
    const initial = countNodes(container);
    const { gantt } = create({}, container);
    const listener = vi.fn();
    gantt.core.subscribe(listener);

    gantt.destroy();
    gantt.destroy();

    expect(countNodes(container)).toBe(initial);
    expect(tracker.alive()).toEqual([]);
    // The core is destroyed: it is inert and no longer notifies.
    gantt.core.setTasks([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('FR-API-4: destroy leaves no node, no listener and no timer, and the methods are inert', () => {
    const container = createContainer();
    const initial = countNodes(container);
    const timers = vi.getTimerCount();
    const { gantt, frames } = create({ onIssues: vi.fn() }, container);
    gantt.on('issues', vi.fn());
    expect(vi.getTimerCount()).toBeGreaterThan(timers);

    gantt.destroy();

    expect(countNodes(container)).toBe(initial);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    expect(frames.queued).toBe(0);
    const requested = frames.requested;
    expect(
      gantt.setOptions({ theme: 'dark', tooltip: { trigger: 'x' as never }, locale: 'uk' }),
    ).toEqual([]);
    gantt.setTasks([]);
    gantt.scrollToToday();
    gantt.hideTooltip();
    const off = gantt.on('issues', vi.fn());
    off();
    expect(frames.requested).toBe(requested);
    expect(countNodes(container)).toBe(initial);
  });

  it('FR-API-4: after destroy the queries answer from the state the chart had, and the commands do nothing', async () => {
    const { gantt } = create({ tooltip: { trigger: 'x' as never } });
    const rect = gantt.getBarRect('a');
    const issues = gantt.getIssues();
    expect(rect).toBeDefined();
    expect(issues.options).not.toEqual([]);

    gantt.destroy();
    gantt.setTasks([]);
    gantt.select(['a']);
    await gantt.updateTask('a', { progress: 90 });

    // The queries read what is left; nothing the commands asked for happened.
    expect(gantt.getTask('a')?.name).toBe('A');
    expect(gantt.getTask('a')?.progress).toBe(10);
    expect(gantt.getLink(gantt.core.getSnapshot().state.derived.graph.links[0]!.id)).toBeDefined();
    expect(gantt.getBarRect('a')).toEqual(rect);
    expect(gantt.getIssues()).toEqual(issues);
    expect(gantt.getVisibleRange()).toBeDefined();
    expect(gantt.core.getSnapshot().selection.tasks).toEqual([]);
    expect(gantt.canUndo).toBe(false);
    expect(gantt.canRedo).toBe(false);
  });

  it('destroys the core it created when mounting fails', () => {
    const container = createContainer();
    const failure = new Error('cannot mount');

    expect(() =>
      createGantt(container, {
        tasks: TASKS,
        renderer: {
          frames: createManualFrames(),
          layers: {
            header: () => ({
              mount() {
                throw failure;
              },
              update: () => undefined,
              destroy: () => undefined,
            }),
          },
        },
      }),
    ).toThrow(failure);

    expect(container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tears the chart down when an issues listener throws while it is created', () => {
    const container = createContainer();
    const failure = new Error('listener');

    expect(() =>
      createGantt(container, {
        tasks: TASKS,
        tooltip: { trigger: 'x' as never },
        renderer: { frames: createManualFrames() },
        onIssues: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);

    expect(container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-API-4: two charts on a page share nothing', () => {
    const first = create({ renderer: { frames: createManualFrames() } });
    const second = create({
      tasks: [{ id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-04' }],
    });
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    first.gantt.on('selectionChange', onFirst);
    second.gantt.on('selectionChange', onSecond);

    expect(first.gantt.core).not.toBe(second.gantt.core);
    expect(first.container.querySelector('.gantt')?.id).not.toBe(
      second.container.querySelector('.gantt')?.id,
    );
    first.gantt.select(['a']);
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onSecond).not.toHaveBeenCalled();
    expect(second.gantt.getTask('a')).toBeUndefined();

    first.gantt.setOptions({ theme: 'dark', locale: 'uk' });
    expect(first.container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('dark');
    expect(second.container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('auto');
    expect(second.gantt.core.getSnapshot().header.locale).toBe('en');

    // Destroying one leaves the other alone.
    first.gantt.destroy();
    expect(first.container.querySelector('.gantt')).toBeNull();
    expect(second.container.querySelector('.gantt')).not.toBeNull();
    second.gantt.select(['x']);
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(second.gantt.core.getSnapshot().selection.tasks).toEqual(['x']);
    second.gantt.destroy();
  });
});

describe('createGantt: methods', () => {
  it('FR-API-3: the data, rows, selection, query, edit and history methods are the core’s own', () => {
    const { gantt } = create();
    const same = [
      'setTasks',
      'setLinks',
      'updateTask',
      'addLink',
      'removeLink',
      'expand',
      'collapse',
      'expandAll',
      'collapseAll',
      'select',
      'selectLink',
      'clearSelection',
      'getTask',
      'getLink',
      'getVisibleRange',
      'getRowMetrics',
      'getBarRect',
      'undo',
      'redo',
    ] as const;

    for (const name of same) expect(gantt[name]).toBe(gantt.core[name]);
    expect(gantt.edit).toBe(gantt.core.edit);
  });

  it('FR-API-3: queries read the chart as drawn', () => {
    const { gantt } = create();

    expect(gantt.getTask('a')).toMatchObject({ id: 'a', name: 'A', progress: 10 });
    expect(gantt.getTask('nope')).toBeUndefined();
    expect(gantt.getLink('a:FS:b')).toMatchObject({ source: 'a', target: 'b' });
    expect(gantt.getRowMetrics('b')).toMatchObject({ height: expect.any(Number) as number });
    expect(gantt.getBarRect('a')?.width).toBeGreaterThan(0);
    expect(gantt.getVisibleRange().start).toBeInstanceOf(Date);
  });

  it('FR-API-3: the data methods change the chart', () => {
    const { gantt } = create();

    gantt.setTasks([{ id: 'z', name: 'Z', start: '2026-03-02', end: '2026-03-03' }]);
    expect(gantt.getTask('a')).toBeUndefined();
    expect(gantt.getTask('z')?.name).toBe('Z');
    gantt.setLinks([]);
    expect(gantt.getLink('a:FS:b')).toBeUndefined();
  });

  it('FR-API-3: updateTask, addLink and removeLink resolve with the core’s results', async () => {
    const { gantt } = create();

    await expect(gantt.updateTask('a', { progress: 60 })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(gantt.getTask('a')?.progress).toBe(60);
    await expect(gantt.addLink({ source: 'b', target: 'p' })).resolves.toMatchObject({
      status: 'created',
    });
    expect(gantt.getLink('b:FS:p')).toBeDefined();
    await expect(gantt.removeLink('b:FS:p')).resolves.toMatchObject({ status: 'deleted' });
    expect(gantt.getLink('b:FS:p')).toBeUndefined();
  });

  it('FR-ROW-2: expand, collapse and their "all" forms change the rows', () => {
    const { gantt } = create({ hierarchy: { expandedKeys: [] } });

    expect(gantt.getTask('c')?.rowIndex).toBeUndefined();
    gantt.expand('p');
    expect(gantt.getTask('c')?.rowIndex).toBeDefined();
    gantt.collapse('p');
    expect(gantt.getTask('c')?.rowIndex).toBeUndefined();
    gantt.expandAll();
    expect(gantt.getTask('c')?.rowIndex).toBeDefined();
    gantt.collapseAll();
    expect(gantt.getTask('c')?.rowIndex).toBeUndefined();
  });

  it('FR-SEL-1, FR-SEL-2: select, selectLink and clearSelection change the selection', () => {
    const { gantt } = create();

    gantt.select(['a', 'b']);
    gantt.selectLink('a:FS:b');
    expect(gantt.core.getSnapshot().selection).toEqual({ tasks: ['a', 'b'], link: 'a:FS:b' });
    gantt.clearSelection();
    expect(gantt.core.getSnapshot().selection).toEqual({ tasks: [], link: undefined });
  });

  it('FR-SCALE-3, FR-SCROLL-2: the view methods act on the chart and return nothing', () => {
    const { gantt } = create();
    const requests = (): number => gantt.core.getSnapshot().scrollRequest?.id ?? 0;

    // Called through `unknown`: what a caller who ignores the types would get back.
    const returned = (call: () => unknown): unknown => call();

    expect(returned(() => gantt.setViewMode('week', { keepScroll: false }))).toBeUndefined();
    expect(gantt.core.getSnapshot().viewMode.id).toBe('week');

    const zoomed = requests();
    expect(returned(() => gantt.zoomTo(25))).toBeUndefined();
    expect(gantt.core.getSnapshot().timeline.scale.pxPerDay).toBe(25);
    expect(requests()).toBeGreaterThan(zoomed);

    for (const call of [
      () => gantt.scrollToDate('2026-03-30', { behavior: 'instant' }),
      () => gantt.scrollToToday({ behavior: 'instant', align: 'start' }),
      () => gantt.scrollToTask('b', { behavior: 'instant' }),
    ]) {
      const before = requests();
      expect(returned(call)).toBeUndefined();
      expect(requests()).toBeGreaterThan(before);
    }
  });

  it('FR-SCROLL-2: scrollToTask expands the ancestors of a hidden row', () => {
    const { gantt } = create({ hierarchy: { expandedKeys: [] } });

    gantt.scrollToTask('c', { behavior: 'instant' });

    expect(gantt.getTask('c')?.rowIndex).toBeDefined();
  });

  it('FR-TX-4, FR-TX-6: the edit session is begun, read and committed or rolled back', async () => {
    const { gantt } = create();
    expect(gantt.edit.isOpen).toBe(false);

    expect(gantt.edit.begin()).toEqual({ status: 'begun' });
    expect(gantt.edit.isOpen).toBe(true);
    expect(gantt.edit.isDirty).toBe(false);
    await gantt.updateTask('a', { progress: 70 });
    expect(gantt.edit.isDirty).toBe(true);
    expect(gantt.edit.getChanges()).toMatchObject({ changes: [{ id: 'a' }] });
    expect(gantt.edit.rollback()).toMatchObject({ status: 'rolled-back' });
    expect(gantt.getTask('a')?.progress).toBe(10);

    gantt.edit.begin();
    await gantt.updateTask('a', { progress: 80 });
    expect(gantt.edit.commit()).toMatchObject({ status: 'committed' });
    expect(gantt.getTask('a')?.progress).toBe(80);
    expect(gantt.edit.isOpen).toBe(false);
  });

  it('FR-TX-5: undo and redo follow the history, canUndo and canRedo are live', async () => {
    const { gantt } = create({ history: true });
    expect([gantt.canUndo, gantt.canRedo]).toEqual([false, false]);

    await gantt.updateTask('a', { progress: 50 });
    expect([gantt.canUndo, gantt.canRedo]).toEqual([true, false]);
    gantt.undo();
    expect(gantt.getTask('a')?.progress).toBe(10);
    expect([gantt.canUndo, gantt.canRedo]).toEqual([false, true]);
    gantt.redo();
    expect(gantt.getTask('a')?.progress).toBe(50);
  });

  it('FR-API-5: the escape hatch is the chart’s core', () => {
    const { gantt } = create();

    expect(gantt.core.getSnapshot().state.tasks).toHaveLength(TASKS.length);
    expectTypeOf(gantt.core).toEqualTypeOf<GanttCore>();
  });
});

describe('createGantt: events', () => {
  it('FR-EVT-2, FR-EVT-3: on<Event> options and on(name) get the same payload', async () => {
    const asOption = vi.fn();
    const asListener = vi.fn();
    const { gantt } = create({ onTasksChange: asOption });
    gantt.on('tasksChange', asListener);

    await gantt.updateTask('a', { progress: 40 });

    expect(asOption).toHaveBeenCalledTimes(1);
    expect(asListener).toHaveBeenCalledTimes(1);
    expect(asListener.mock.calls[0]?.[0]).toBe(asOption.mock.calls[0]?.[0]);
    expect(asOption.mock.calls[0]?.[0]).toMatchObject({ reason: 'api', changes: [{ id: 'a' }] });
  });

  it('FR-EVT-1: the events carry the core’s public payloads', async () => {
    const selection = vi.fn();
    const dates = vi.fn();
    const viewMode = vi.fn();
    const { gantt } = create({ onSelectionChange: selection });
    gantt.on('taskDatesChange', dates);
    gantt.on('viewModeChange', viewMode);

    gantt.select(['b']);
    await gantt.updateTask('b', { start: '2026-03-10', end: '2026-03-13' });
    gantt.setViewMode('week');

    expect(selection).toHaveBeenCalledWith(['b'], undefined);
    expect(dates).toHaveBeenCalledTimes(1);
    const [record, range] = dates.mock.calls[0] as [TaskRecord, { start: Date }];
    expect(record.id).toBe('b');
    expect(range.start).toBeInstanceOf(Date);
    expect(viewMode.mock.calls[0]?.[0]).toMatchObject({ id: 'week' });
  });

  it('FR-EVT-3: on returns an unsubscribe function, safe to call twice', () => {
    const { gantt } = create();
    const listener = vi.fn();
    const off = gantt.on('selectionChange', listener);

    gantt.select(['a']);
    off();
    off();
    gantt.select(['b']);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('FR-EVT-2: setOptions swaps a handler without recreating or leaking it', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { gantt, container } = create({ onSelectionChange: first });
    const root = container.querySelector('.gantt');
    const core = gantt.core;

    gantt.select(['a']);
    gantt.setOptions({ onSelectionChange: second });
    gantt.select(['b']);
    gantt.setOptions({ onSelectionChange: undefined });
    gantt.select(['a']);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(['b'], undefined);
    expect(container.querySelector('.gantt')).toBe(root);
    expect(gantt.core).toBe(core);
  });

  it('FR-EVT-2: a handler swapped in keeps its place among the listeners', () => {
    const order: string[] = [];
    const { gantt } = create({ onSelectionChange: () => order.push('option') });
    gantt.on('selectionChange', () => order.push('listener'));

    gantt.setOptions({ onSelectionChange: () => order.push('swapped') });
    gantt.select(['a']);

    expect(order).toEqual(['swapped', 'listener']);
  });

  it('FR-EVT-1: an issues handler swapped in through setOptions takes the place of the old one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { gantt } = create({ onIssues: first });

    gantt.setOptions({ onIssues: second });
    gantt.setOptions({ tooltip: { trigger: 'x' as never } });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('createGantt: TData', () => {
  interface Meta {
    readonly status: 'ok' | 'late';
  }

  it('FR-API-6: the data type flows through options, records, events, handlers and render functions', () => {
    const gantt = createGantt<Meta>(createContainer(), {
      tasks: [
        { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', data: { status: 'ok' } },
      ],
      renderer: { frames: createManualFrames() },
      tooltip: {
        render: (context) => {
          expectTypeOf(context.task).toEqualTypeOf<TaskRecord<Meta>>();
          expectTypeOf(context.task.task.data).toEqualTypeOf<Meta | undefined>();
          expectTypeOf(context.api.getTask('a')).toEqualTypeOf<TaskRecord<Meta> | undefined>();
          return context.task.task.data?.status ?? null;
        },
      },
      linkMenu: {
        render: (context) => {
          expectTypeOf(context.source).toEqualTypeOf<TaskRecord<Meta> | undefined>();
          expectTypeOf(context.link).toEqualTypeOf<LinkRecord>();
          return null;
        },
      },
      display: {
        renderBarLabel: (context) => {
          expectTypeOf(context.task.data).toEqualTypeOf<Meta | undefined>();
          return context.task.data?.status;
        },
      },
      onTaskClick: (record) => {
        expectTypeOf(record).toEqualTypeOf<TaskRecord<Meta>>();
      },
    });

    expectTypeOf(gantt).toEqualTypeOf<Gantt<Meta>>();
    expectTypeOf(gantt.core).toEqualTypeOf<GanttCore<Meta>>();
    expectTypeOf(gantt.getTask('a')).toEqualTypeOf<TaskRecord<Meta> | undefined>();
    gantt.on('taskClick', (record) => {
      expectTypeOf(record.task.data).toEqualTypeOf<Meta | undefined>();
    });
    gantt.on('taskDatesChange', (record) => {
      expectTypeOf(record).toEqualTypeOf<TaskRecord<Meta>>();
    });
    gantt.setOptions({
      onTaskClick: (record) => {
        expectTypeOf(record.task.data?.status).toEqualTypeOf<'ok' | 'late' | undefined>();
      },
      tooltip: { render: (context) => context.task.task.data?.status ?? null },
    });
    // The data is what the type says: `late` and `ok` only.
    expect(gantt.getTask('a')?.task.data?.status).toBe('ok');
    gantt.destroy();
  });

  it('FR-API-6: a task, an option or a handler of the wrong data type does not compile', () => {
    const gantt = createGantt<Meta>(createContainer(), {
      tasks: [],
      renderer: { frames: createManualFrames() },
    });

    // @ts-expect-error -- a status `Meta` does not have
    gantt.setTasks([{ id: 'a', name: 'A', data: { status: 'gone' } }]);
    gantt.setOptions({
      // @ts-expect-error -- the record carries `Meta`, not a string
      onTaskClick: (record: TaskRecord<string>) => record.task.data,
    });
    // @ts-expect-error -- the payload of taskClick is a TaskRecord
    gantt.on('taskClick', (payload: string) => payload);
    // @ts-expect-error -- not an event
    gantt.on('nothing', () => undefined);
    // The view methods return nothing: the scroll request is the renderer's business.
    expectTypeOf(gantt.scrollToTask).returns.toBeVoid();
    expectTypeOf(gantt.setViewMode).returns.toBeVoid();
    gantt.destroy();
  });

  it('FR-API-6: without a type argument the data type is inferred from the tasks, else unknown', () => {
    const typed = createGantt(createContainer(), {
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', data: { any: 1 } }],
      renderer: { frames: createManualFrames() },
    });
    const plain = createGantt(createContainer(), {
      tasks: [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }],
      renderer: { frames: createManualFrames() },
    });

    expectTypeOf(typed.getTask('a')?.task.data).toEqualTypeOf<{ any: number } | undefined>();
    expectTypeOf(plain.getTask('a')?.task.data).toBeUnknown();
    expect(typed.getTask('a')?.task.data).toEqual({ any: 1 });
    typed.destroy();
    plain.destroy();
  });
});

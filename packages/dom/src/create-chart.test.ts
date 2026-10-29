import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GanttChart } from './create-gantt';
import { createChart } from './create-gantt';
import { MERGED_OPTION_GROUPS } from './facade';
import type { ListenerTracker } from './testing';
import {
  countNodes,
  createContainer,
  createManualFrames,
  stubScrollerSize,
  trackListeners,
} from './testing';

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];

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

function create(options: Partial<Parameters<typeof createChart>[0]> = {}): GanttChart {
  return createChart({
    tasks: TASKS,
    now: () => '2026-03-04',
    renderer: { frames: createManualFrames() },
    ...options,
  });
}

describe('createChart', () => {
  it('FR-API-1: without a container it is a core only, and nothing touches the DOM', () => {
    const timers = vi.getTimerCount();

    const chart = create();

    expect(tracker.all).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    expect(document.body.childNodes).toHaveLength(0);
    expect(chart.gantt.core.getSnapshot().state.tasks).toHaveLength(2);
    expect(chart.gantt.getTask('a')?.name).toBe('A');
    chart.gantt.destroy();
  });

  it('FR-API-1: mount draws the chart, unmount removes it, and the state outlives both', () => {
    const container = createContainer();
    const initial = countNodes(container);
    const timers = vi.getTimerCount();
    const chart = create();

    chart.mount(container);
    expect(container.querySelector('.gantt')).not.toBeNull();
    expect(chart.gantt.core.getSnapshot().timeline.viewportWidth).toBe(800);
    chart.gantt.select(['a']);

    chart.unmount();
    expect(countNodes(container)).toBe(initial);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    // Headless again: the state is the core's, and the chart answers.
    expect(chart.gantt.core.getSnapshot().selection.tasks).toEqual(['a']);
    chart.gantt.select(['b']);
    expect(chart.gantt.core.getSnapshot().selection.tasks).toEqual(['b']);

    chart.mount(container);
    expect(container.querySelectorAll('.gantt')).toHaveLength(1);
    expect(chart.gantt.core.getSnapshot().selection.tasks).toEqual(['b']);
    chart.unmount();
    chart.unmount();
    chart.gantt.destroy();
    expect(tracker.alive()).toEqual([]);
  });

  it('FR-API-1: mounting again replaces the renderer, in the same or another container', () => {
    const first = createContainer();
    const second = createContainer();
    const chart = create();

    chart.mount(first);
    chart.mount(first);
    expect(first.querySelectorAll('.gantt')).toHaveLength(1);
    chart.mount(second);

    expect(first.querySelector('.gantt')).toBeNull();
    expect(second.querySelectorAll('.gantt')).toHaveLength(1);
    chart.gantt.destroy();
    expect(second.querySelector('.gantt')).toBeNull();
    expect(tracker.alive()).toEqual([]);
  });

  it('FR-API-2: the renderer options set while nothing is mounted are drawn by the next mount', () => {
    const container = createContainer();
    const chart = create({ theme: 'light', strings: { chartLabel: 'Plan' } });
    chart.mount(container);
    chart.unmount();

    chart.gantt.setOptions({
      theme: 'dark',
      strings: { removeLink: 'Drop' },
      layout: { height: 240 },
      display: { today: false },
      tooltip: { delay: 7 },
    });
    chart.mount(container);

    const root = container.querySelector('.gantt');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    // `strings` merge over the earlier ones, as on a mounted chart.
    expect(root?.querySelector('.gantt__scroller')?.getAttribute('aria-label')).toBe('Plan');
    expect(root?.getAttribute('data-height')).toBeNull();
    expect(root?.getAttribute('style')).toContain('240');
    expect(root?.querySelector('.gantt__today-marker')).toBeNull();

    // And the other way round: a change while mounted is kept for the next mount.
    chart.gantt.setOptions({ theme: 'light', layout: undefined, display: { today: true } });
    chart.unmount();
    chart.mount(container);
    const again = container.querySelector('.gantt');
    expect(again?.getAttribute('data-theme')).toBe('light');
    expect(again?.getAttribute('style') ?? '').not.toContain('240');
    chart.gantt.destroy();
  });

  it('FR-API-1: given a container, it mounts at creation, as createGantt does', () => {
    const container = createContainer();
    const chart = createChart(
      { tasks: TASKS, now: () => '2026-03-04', renderer: { frames: createManualFrames() } },
      container,
    );

    expect(container.querySelectorAll('.gantt')).toHaveLength(1);
    chart.gantt.destroy();
    expect(container.querySelector('.gantt')).toBeNull();
  });

  it('FR-API-4: mount after destroy does nothing, and a mount that throws leaves a usable chart', () => {
    const container = createContainer();
    const failure = new Error('cannot mount');
    const broken = create({
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
    });

    expect(() => {
      broken.mount(container);
    }).toThrow(failure);
    expect(container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    broken.gantt.select(['a']);
    expect(broken.gantt.core.getSnapshot().selection.tasks).toEqual(['a']);

    const chart = create();
    chart.gantt.destroy();
    chart.mount(container);
    expect(container.childNodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-API-4: destroy of a mounted chart removes the renderer and then the core', () => {
    const container = createContainer();
    const chart = create();
    chart.mount(container);
    const listener = vi.fn();
    chart.gantt.core.subscribe(listener);

    chart.gantt.destroy();

    expect(container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    chart.gantt.core.setTasks([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('FR-API-2: the issues of the renderer options are reported once, mounted or not', () => {
    const onIssues = vi.fn();

    const chart = create({ tooltip: { trigger: 'nope' as never }, onIssues });

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(chart.gantt.getIssues().options.map((issue) => issue.path)).toContain('tooltip.trigger');
    chart.mount(createContainer());
    chart.unmount();
    chart.mount(createContainer());
    expect(onIssues).toHaveBeenCalledTimes(1);
    chart.gantt.destroy();
  });

  it('FR-API-2: MERGED_OPTION_GROUPS are the groups setOptions merges field by field', () => {
    // A field of a group left out of the next patch keeps its value: the second patch adds to
    // the first instead of replacing the group.
    expect([...MERGED_OPTION_GROUPS].sort()).toEqual([
      'calendar',
      'dates',
      'display',
      'hierarchy',
      'interaction',
      'layout',
      'scheduling',
      'scroll',
      'strings',
      'timeline',
    ]);
    const chart = create();
    chart.gantt.setOptions({ scheduling: { granularity: '1h' } });
    chart.gantt.setOptions({ scheduling: { propagation: 'none' } });
    const { options } = chart.gantt.core.getSnapshot().state;
    expect(options.scheduling).toEqual({ granularity: '1h', propagation: 'none' });
    chart.gantt.destroy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { ListenerTracker } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import { chartOf, charts, forgetCharts } from './testing/charts';
import { collect, Harness } from './testing/harness';
import type { GanttReactOptions } from './types';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
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
    now: NOW,
    renderer: { frames: createManualFrames() },
    ...extra,
  };
}

describe('StrictMode', () => {
  it('FR-REACT-5: mount, unmount and mount again leaves exactly one chart, as one mount does', async () => {
    const single = await renderInto(<Harness options={options()} />);
    const listeners = tracker.alive().length;
    const timers = vi.getTimerCount();
    await single.unmount();
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    forgetCharts();

    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />, {
      strict: true,
    });

    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);
    expect(view.container.querySelectorAll('.gantt__bar')).toHaveLength(2);
    expect(tracker.alive()).toHaveLength(listeners);
    expect(vi.getTimerCount()).toBe(timers);
    // The effects ran twice and the chart is still the one chart.
    expect(latest().core.getSnapshot().timeline.viewportWidth).toBe(800);
    const live = chartOf(latest().core);
    expect(live.destroy).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-5: the core survives the simulated unmount: it is still the one the instance has, and it works', async () => {
    const { capture, latest } = collect();
    // The core of every render, the first one (before any effect) included.
    const cores = new Set<unknown>();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={options({ onSelectionChange })}
        capture={(instance) => {
          cores.add(instance.core);
          capture(instance);
        }}
      />,
      { strict: true },
    );
    const instance = latest();
    const { core } = instance;
    // React 18 renders a component twice on its first render under StrictMode and keeps the
    // second pass's state, so a core of the first pass may be among them (it was never committed,
    // and nothing holds it); React 19 reuses the first pass's. What must hold is below: after the
    // mount no core is made, and the one the instance has is the one it started with.
    expect(cores.has(core)).toBe(true);
    const made = cores.size;

    // Let every microtask run: a destroy that was to happen, would have.
    await view.render(
      <Harness
        options={options({ onSelectionChange })}
        capture={(each) => {
          cores.add(each.core);
        }}
      />,
    );

    expect(cores.size).toBe(made);
    expect(instance.core).toBe(core);
    instance.select(['a']);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(instance.getTask('a')?.name).toBe('A');
    await view.unmount();
  });

  it('FR-REACT-5: the real unmount ends the core, once, and leaves no node, listener or timer', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const frames = createManualFrames();
    const view = await renderInto(
      <Harness options={options({ onSelectionChange, renderer: { frames } })} capture={capture} />,
      { strict: true },
    );
    const instance = latest();
    const live = chartOf(instance.core);

    await view.unmount();

    expect(live.destroy).toHaveBeenCalledTimes(1);
    expect(view.container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.queued).toBe(0);
    instance.select(['a']);
    expect(onSelectionChange).not.toHaveBeenCalled();
    // A chart StrictMode made and threw away was never mounted: it holds nothing to release.
    for (const chart of charts) {
      if (chart !== live) expect(chart.destroy).not.toHaveBeenCalled();
    }
  });

  it('FR-REACT-5: the handlers are attached once, the events of the mount arrive once, nothing is sent twice', async () => {
    const { capture, latest } = collect();
    const onRangeChange = vi.fn();
    const onIssues = vi.fn();
    const view = await renderInto(
      <Harness
        options={options({
          onRangeChange,
          onIssues,
          tooltip: { trigger: 'nope' as never },
        })}
        capture={capture}
      />,
      { strict: true },
    );

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(chartOf(latest().core).setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-5: <Gantt> under StrictMode draws one chart in its container and removes it on unmount', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames: createManualFrames() }}
        className="holder"
      />,
      { strict: true },
    );

    expect(view.container.querySelectorAll('div.holder > .gantt')).toHaveLength(1);
    await view.render(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames: createManualFrames() }}
        className="holder"
        locale="uk"
      />,
    );
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);

    await view.unmount();
    expect(view.container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-REACT-5: controlled values are not applied twice by the second set of effects', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={options({
          defaultTasks: undefined,
          tasks: TASKS,
          selectedKeys: ['a'],
          viewMode: 'week',
          expandedKeys: 'all',
        })}
        capture={capture}
      />,
      { strict: true },
    );
    const chart = chartOf(latest().core);

    expect(latest().getSnapshot().selection.tasks).toEqual(['a']);
    expect(latest().getSnapshot().viewMode.id).toBe('week');
    expect(chart.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });
});

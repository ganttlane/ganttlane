import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListenerTracker, ManualFrames } from './testing';
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

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
  { id: 'p', name: 'P', start: '2026-04-06', end: '2026-04-17' },
  { id: 'c', name: 'C', parentId: 'p', start: '2026-04-13', end: '2026-04-17' },
];

const NOW = (): string => '2026-03-04';

let tracker: ListenerTracker;
let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  forgetCharts();
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanUpDocument();
});

/** Options with deterministic frames and clock, over the test tasks. */
function options(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return {
    defaultTasks: TASKS,
    now: NOW,
    renderer: { frames },
    ...extra,
  };
}

describe('useGantt: the instance', () => {
  it('FR-REACT-5: it is one object for the life of the component, whatever the props do', async () => {
    const { seen, capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const first = latest();
    const { core, select, getTask } = first;

    await view.render(<Harness options={options({ locale: 'uk' })} capture={capture} />);
    await view.render(
      <Harness options={options({ scheduling: { granularity: '1h' } })} capture={capture} />,
    );

    expect(new Set(seen).size).toBe(1);
    expect(latest()).toBe(first);
    expect(first.core).toBe(core);
    expect(first.select).toBe(select);
    expect(first.getTask).toBe(getTask);
    expect(charts.length).toBeGreaterThan(0);
    await view.unmount();
  });

  it('FR-REACT-5: it creates the core while rendering, before any container exists', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options()} capture={capture} container={false} />,
    );

    expect(latest().core.getTask('a')?.name).toBe('A');
    expect(latest().getSnapshot().state.tasks).toHaveLength(4);
    expect(view.container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await view.unmount();
  });

  it('FR-REACT-5: the chart is drawn in the container, and is removed when it goes', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);

    expect(view.container.querySelectorAll('[data-testid="harness"] > .gantt')).toHaveLength(1);
    // Only the bars in the 800 px viewport are drawn: the chart is virtualized.
    expect(view.container.querySelectorAll('.gantt__bar')).toHaveLength(2);
    expect(latest().core.getSnapshot().timeline.viewportWidth).toBe(800);

    await view.render(<Harness options={options()} capture={capture} container={false} />);
    expect(view.container.querySelector('.gantt')).toBeNull();
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // The state is still there, and the chart is drawn again where the next container is.
    latest().select(['a']);
    await view.render(<Harness options={options()} capture={capture} />);
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);
    expect(latest().core.getSnapshot().selection.tasks).toEqual(['a']);
    await view.unmount();
  });

  it('FR-REACT-5: unmounting leaves no node, listener, timer or subscription, and ends the core', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <Harness options={options({ onSelectionChange })} capture={capture} />,
    );
    const instance = latest();
    const { core } = instance;
    const watcher = vi.fn();
    instance.subscribe(watcher);
    const listener = vi.fn();
    instance.on('selectionChange', listener);
    expect(tracker.alive().length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await view.unmount();

    expect(view.container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.queued).toBe(0);
    const chart = chartOf(core);
    expect(chart.destroy).toHaveBeenCalledTimes(1);
    // The core is destroyed: it is inert and tells nobody anything.
    watcher.mockClear();
    instance.select(['a']);
    core.setTasks([]);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(watcher).not.toHaveBeenCalled();
  });

  it('FR-API-3: the instance has the methods of the vanilla chart, but destroy, and what React needs', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    const vanilla = chartOf(instance.core).gantt;

    const own = Object.keys(instance).sort();
    expect(own).toEqual(
      [
        ...Object.keys(vanilla).filter((key) => key !== 'destroy'),
        'setContainer',
        'slots',
        'subscribe',
        'getSnapshot',
      ].sort(),
    );
    expect('destroy' in instance).toBe(false);
    // Getters stay getters, nested method objects work, and the queries answer.
    expect(instance.canUndo).toBe(false);
    expect(instance.edit.isOpen).toBe(false);
    expect(instance.edit.begin()).toMatchObject({ status: 'begun' });
    expect(instance.edit.isOpen).toBe(true);
    expect(instance.getTask('a')?.name).toBe('A');
    expect(instance.getSnapshot()).toBe(instance.core.getSnapshot());
    await view.unmount();
  });

  it('FR-EVT-3: on adds a listener to the chart, and what it returns removes it, once or twice', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    const listener = vi.fn();

    const off = instance.on('selectionChange', listener);
    instance.select(['a']);
    off();
    off();
    instance.select(['b']);

    expect(listener).toHaveBeenCalledTimes(1);
    await view.unmount();
    // After the chart is gone a listener goes nowhere, and removing it is still fine.
    const late = instance.on('selectionChange', listener);
    late();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('FR-REACT-5: two charts on a page share nothing', async () => {
    const one = collect();
    const two = collect();
    const view = await renderInto(
      <>
        <Harness options={options()} capture={one.capture} />
        <Harness options={options({ defaultTasks: [TASKS[0]!] })} capture={two.capture} />
      </>,
    );

    expect(one.latest().core).not.toBe(two.latest().core);
    one.latest().select(['b']);
    expect(two.latest().core.getSnapshot().selection.tasks).toEqual([]);
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(2);
    await view.unmount();
  });
});

describe('useGantt: handlers', () => {
  it('FR-REACT-2: a handler that is new on every render is no setOptions, and the latest one is called', async () => {
    const { capture, latest } = collect();
    const calls: string[] = [];
    const render = (name: string) => (
      <Harness
        options={options({
          onSelectionChange: () => {
            calls.push(name);
          },
        })}
        capture={capture}
      />
    );
    const view = await renderInto(render('first'));
    const chart = chartOf(latest().core);

    for (const name of ['second', 'third', 'fourth', 'fifth']) await view.render(render(name));
    latest().select(['a']);

    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(calls).toEqual(['fifth']);
    await view.unmount();
  });

  it('FR-REACT-2: a handler that closes over state sees the state of the latest render', async () => {
    const { capture, latest } = collect();
    const seen: number[] = [];
    function Counter({ count }: { count: number }) {
      return (
        <Harness
          options={options({
            onTaskDatesChange: () => {
              seen.push(count);
            },
          })}
          capture={capture}
        />
      );
    }
    const view = await renderInto(<Counter count={1} />);
    await view.render(<Counter count={2} />);
    await view.render(<Counter count={3} />);

    await latest().updateTask('a', { start: '2026-03-03' });

    expect(seen).toEqual([3]);
    await view.unmount();
  });

  it('FR-REACT-2: giving a handler for the first time attaches one function, removing it detaches it', async () => {
    const { capture, latest } = collect();
    const handler = vi.fn();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const chart = chartOf(latest().core);

    latest().select(['a']);
    expect(handler).not.toHaveBeenCalled();

    await view.render(
      <Harness options={options({ onSelectionChange: handler })} capture={capture} />,
    );
    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      onSelectionChange: expect.any(Function) as unknown,
    });
    latest().select(['b']);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(['b'], undefined);

    await view.render(
      <Harness options={options({ onSelectionChange: vi.fn() })} capture={capture} />,
    );
    expect(chart.setOptions).toHaveBeenCalledTimes(1);

    await view.render(<Harness options={options()} capture={capture} />);
    expect(chart.setOptions).toHaveBeenCalledTimes(2);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ onSelectionChange: undefined });
    latest().select(['a']);
    expect(handler).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-2: the application gets the same arguments the vanilla handler gets', async () => {
    const { capture, latest } = collect();
    const onTasksChange = vi.fn();
    const onTaskDatesChange = vi.fn();
    const view = await renderInto(
      <Harness options={options({ onTasksChange, onTaskDatesChange })} capture={capture} />,
    );

    await latest().updateTask('a', { start: '2026-03-03' });

    expect(onTasksChange).toHaveBeenCalledTimes(1);
    expect(onTasksChange.mock.calls[0]?.[0]).toMatchObject({
      reason: 'api',
      changes: [{ id: 'a' }],
    });
    expect(onTaskDatesChange).toHaveBeenCalledTimes(1);
    expect(onTaskDatesChange.mock.calls[0]?.[0]).toMatchObject({ id: 'a' });
    await view.unmount();
  });

  it('FR-REACT-2: a before-hook is a handler too, and its answer is the core’s', async () => {
    const { capture, latest } = collect();
    const onBeforeTaskChange = vi.fn(() => false);
    const view = await renderInto(
      <Harness options={options({ onBeforeTaskChange })} capture={capture} />,
    );

    const result = await latest().updateTask('a', { start: '2026-03-03' });

    expect(onBeforeTaskChange).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'cancelled' });
    expect(latest().getTask('a')?.start?.getDate()).toBe(2);
    await view.unmount();
  });

  it('FR-REACT-2: what the chart emitted while it was made reaches the handlers after the first commit, never during a render', async () => {
    const { capture } = collect();
    const calls: string[] = [];
    const onIssues = vi.fn(() => {
      calls.push('onIssues');
    });
    const onRangeChange = vi.fn(() => {
      calls.push('onRangeChange');
    });
    const view = await renderInto(
      <Harness
        options={options({
          tooltip: { trigger: 'nope' as never },
          onIssues,
          onRangeChange,
        })}
        capture={() => {
          calls.push('render');
          capture(undefined as never);
        }}
      />,
    );

    // The renderer asked the core for its viewport when it was mounted: the first range.
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange.mock.calls[0]).toMatchObject([{ reason: 'initial' }]);
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe('render');
    expect(calls.indexOf('onIssues')).toBeGreaterThan(calls.indexOf('render'));
    await view.unmount();
  });
});

describe('useGantt: props reach the chart', () => {
  it('FR-REACT-1: nothing is sent to the chart on the first commit, nor when the props are the same', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const chart = chartOf(latest().core);

    expect(chart.setOptions).not.toHaveBeenCalled();
    await view.render(<Harness options={options()} capture={capture} />);
    await view.render(<Harness options={options()} capture={capture} />);

    expect(chart.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: only the keys that changed reach setOptions', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options({ locale: 'en', theme: 'light' })} capture={capture} />,
    );
    const chart = chartOf(latest().core);

    await view.render(
      <Harness options={options({ locale: 'uk', theme: 'light' })} capture={capture} />,
    );

    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ locale: 'uk' });
    expect(latest().core.getSnapshot().header.locale).toBe('uk');
    await view.unmount();
  });

  it('FR-REACT-1: options written inline cost nothing while their data is the same', async () => {
    const { capture, latest } = collect();
    const inline = (): Partial<GanttReactOptions> => ({
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Day' }] },
      scheduling: { granularity: '1d', skipNonWorkingDays: { move: true } },
      tooltip: { delay: 10 },
      display: { today: true },
      highlights: [{ id: 'h', dates: ['2026-03-05'] }],
      layout: { rowHeight: 30 },
    });
    const view = await renderInto(<Harness options={options(inline())} capture={capture} />);
    const chart = chartOf(latest().core);

    await view.render(<Harness options={options(inline())} capture={capture} />);
    await view.render(<Harness options={options(inline())} capture={capture} />);

    expect(chart.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a field of a group that changes is sent alone, the way setOptions merges', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={options({ scheduling: { granularity: '1d', propagation: 'none' } })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    const state = () => latest().core.getSnapshot().state.options.scheduling;
    expect(state()).toEqual({ granularity: '1d', propagation: 'none' });

    await view.render(
      <Harness
        options={options({ scheduling: { granularity: '1d', propagation: 'preserve-lag' } })}
        capture={capture}
      />,
    );
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      scheduling: { propagation: 'preserve-lag' },
    });

    // A field that the new props leave out is back to its default: setOptions alone would keep it.
    await view.render(
      <Harness options={options({ scheduling: { granularity: '1d' } })} capture={capture} />,
    );
    expect(chart.setOptions).toHaveBeenLastCalledWith({ scheduling: { propagation: undefined } });
    expect(state()?.propagation).toBeUndefined();
    expect(state()?.granularity).toBe('1d');
    await view.unmount();
  });

  it('FR-REACT-1: an option that is removed goes back to its default', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options({ locale: 'uk', layout: { rowHeight: 50 } })} capture={capture} />,
    );
    const chart = chartOf(latest().core);
    expect(latest().core.getSnapshot().header.locale).toBe('uk');
    expect(latest().core.getSnapshot().layoutOptions.rowHeight).toBe(50);

    await view.render(<Harness options={options()} capture={capture} />);

    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    // A group that goes is sent by field, which is the same for the chart (the group `undefined`).
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      locale: undefined,
      layout: { rowHeight: undefined },
    });
    expect(latest().core.getSnapshot().header.locale).toBe('en');
    expect(latest().core.getSnapshot().layoutOptions.rowHeight).not.toBe(50);
    await view.unmount();
  });

  it('FR-REACT-1: the options of the renderer reach the renderer', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options({ theme: 'light', layout: { height: 300 } })} capture={capture} />,
    );
    const root = () => view.container.querySelector('.gantt');
    expect(root()?.getAttribute('data-theme')).toBe('light');

    await view.render(
      <Harness
        options={options({
          theme: 'dark',
          layout: { height: 'auto' },
          strings: { chartLabel: 'Plan' },
          display: { today: false },
        })}
        capture={capture}
      />,
    );

    frames.step();
    expect(root()?.getAttribute('data-theme')).toBe('dark');
    expect(root()?.getAttribute('data-height')).toBe('auto');
    expect(view.container.querySelector('.gantt__scroller')?.getAttribute('aria-label')).toBe(
      'Plan',
    );
    expect(view.container.querySelector('.gantt__today-marker')).toBeNull();
    expect(latest().getIssues().options).toEqual([]);
    await view.unmount();
  });

  it('FR-REACT-1: the issues of the options are one list, as in the vanilla facade', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={options({ locale: 'xx-bad-tag', tooltip: { trigger: 'nope' as never } })}
        capture={capture}
      />,
    );

    expect(
      latest()
        .getIssues()
        .options.map((issue) => issue.path),
    ).toEqual(['locale', 'tooltip.trigger']);
    await view.unmount();
  });

  it('FR-REACT-1: setOptions on the instance is the escape hatch; a prop that changes later wins', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options({ locale: 'en' })} capture={capture} />,
    );

    latest().setOptions({ locale: 'de' });
    expect(latest().core.getSnapshot().header.locale).toBe('de');
    await view.render(<Harness options={options({ locale: 'en' })} capture={capture} />);
    // Same prop as before: nothing to apply, the escape hatch stays.
    expect(latest().core.getSnapshot().header.locale).toBe('de');
    await view.render(<Harness options={options({ locale: 'fr' })} capture={capture} />);
    expect(latest().core.getSnapshot().header.locale).toBe('fr');
    await view.unmount();
  });

  it('FR-REACT-1: `renderer` is read once; a new one later is ignored', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const chart = chartOf(latest().core);

    await view.render(
      <Harness
        options={options({ renderer: { frames: createManualFrames() } })}
        capture={capture}
      />,
    );

    expect(chart.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: hierarchy options are a group of their own, without the expanded parents', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={options({ hierarchy: { moveChildren: 'all' } })} capture={capture} />,
    );
    const chart = chartOf(latest().core);

    await view.render(
      <Harness options={options({ hierarchy: { moveChildren: 'none' } })} capture={capture} />,
    );

    expect(chart.setOptions).toHaveBeenLastCalledWith({ hierarchy: { moveChildren: 'none' } });
    await view.unmount();
  });
});

import type { Task } from '@ganttlane/dom';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import type { ListenerTracker, ManualFrames } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import { charts, forgetCharts } from './testing/charts';
import type { GanttProps } from './types';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const LINKS = [{ source: 'a', target: 'b' }];
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
  cleanUpDocument();
});

describe('<Gantt>', () => {
  it('FR-REACT-1: it renders a container div with the className and the style, and the chart in it', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        className="chart"
        style={{ height: 320 }}
      />,
    );

    const container = view.container.firstElementChild as HTMLElement;
    expect(container.tagName).toBe('DIV');
    expect(container.className).toBe('chart');
    expect(container.style.height).toBe('320px');
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.classList.contains('gantt')).toBe(true);
    expect(container.querySelectorAll('.gantt__bar')).toHaveLength(2);
    await view.unmount();
  });

  it('FR-REACT-1: id, aria-* and data-* go to the container, and are no options', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        id="plan"
        aria-label="Release plan"
        aria-describedby="plan-help"
        data-testid="plan-chart"
        data-owner="team-a"
      />,
    );

    const container = view.container.firstElementChild as HTMLElement;
    expect(container.id).toBe('plan');
    expect(container.getAttribute('aria-label')).toBe('Release plan');
    expect(container.getAttribute('aria-describedby')).toBe('plan-help');
    expect(container.getAttribute('data-testid')).toBe('plan-chart');
    expect(container.getAttribute('data-owner')).toBe('team-a');
    // They are for the element: the chart is not given them as options (nothing to set).
    expect(charts[0]?.setOptions).not.toHaveBeenCalled();
    expect(charts[0]?.gantt.getIssues().options).toEqual([]);

    await view.render(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        id="plan"
        aria-label="Another plan"
        data-testid="plan-chart"
      />,
    );
    expect(container.getAttribute('aria-label')).toBe('Another plan');
    expect(container.hasAttribute('aria-describedby')).toBe(false);
    expect(container.hasAttribute('data-owner')).toBe(false);
    expect(charts[0]?.setOptions).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-API-6: the container props are typed: aria-* by React’s attributes, data-* as text, numbers or flags', () => {
    expectTypeOf<GanttProps>().toHaveProperty('id');
    expectTypeOf<GanttProps['id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<GanttProps['aria-label']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<GanttProps['aria-busy']>().toEqualTypeOf<boolean | 'true' | 'false' | undefined>();
    const element = <Gantt aria-label="Plan" aria-hidden data-testid="a" data-count={3} data-on />;
    expect(element).toBeDefined();
    // @ts-expect-error an aria attribute takes the type React gives it
    // eslint-disable-next-line jsx-a11y-x/aria-proptypes -- the wrong type is the point
    const wrong = <Gantt aria-label={3} />;
    expect(wrong).toBeDefined();
    // @ts-expect-error `id` is a string
    const wrongId = <Gantt id={3} />;
    expect(wrongId).toBeDefined();
  });

  it('FR-REACT-1: the props are the options: data, view mode, calendar, display, theme, strings', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        links={LINKS}
        viewMode="week"
        now={NOW}
        renderer={{ frames }}
        theme="dark"
        locale="uk"
        strings={{ chartLabel: 'Plan' }}
        display={{ gridLines: 'none', today: false }}
        calendar={{ weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Day' }] }}
        layout={{ rowHeight: 36, height: 300 }}
        tooltip={{ delay: 5 }}
      />,
    );
    const { core } = charts[0]!.gantt;

    expect(core.getSnapshot().viewMode.id).toBe('week');
    expect(core.getSnapshot().header.locale).toBe('uk');
    expect(core.getSnapshot().layoutOptions.rowHeight).toBe(36);
    expect(core.getLink('a:FS:b')).toBeDefined();
    const root = view.container.querySelector('.gantt');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    expect(view.container.querySelector('.gantt__scroller')?.getAttribute('aria-label')).toBe(
      'Plan',
    );
    expect(view.container.querySelector('.gantt__today-marker')).toBeNull();
    expect(charts[0]?.gantt.getIssues()).toEqual({ data: [], options: [] });
    await view.unmount();
  });

  it('FR-REACT-1: props that are not options (className, style) never reach setOptions', async () => {
    const view = await renderInto(
      <Gantt defaultTasks={TASKS} now={NOW} renderer={{ frames }} className="one" />,
    );
    const chart = charts[0]!;

    await view.render(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        className="two"
        style={{ height: 100 }}
      />,
    );

    expect(chart.setOptions).not.toHaveBeenCalled();
    expect((view.container.firstElementChild as HTMLElement).className).toBe('two');
    await view.unmount();
  });

  it('FR-REACT-1: a prop that changes reaches the chart alone, and a prop that goes comes back to its default', async () => {
    const view = await renderInto(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        theme="light"
        display={{ today: false }}
      />,
    );
    const chart = charts[0]!;

    await view.render(
      <Gantt
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        theme="dark"
        display={{ today: false }}
      />,
    );
    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ theme: 'dark' });

    await view.render(<Gantt defaultTasks={TASKS} now={NOW} renderer={{ frames }} />);
    frames.step();
    expect(chart.setOptions).toHaveBeenCalledTimes(2);
    // The group that goes is sent by field, `display: { today: undefined }`: the same as the group
    // `undefined` for the chart, but nothing of the group that the props never had is touched.
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      theme: undefined,
      display: { today: undefined },
    });
    expect(view.container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('auto');
    expect(view.container.querySelector('.gantt__today-marker')).not.toBeNull();
    await view.unmount();
  });

  it('FR-REACT-1: the container can be replaced (a new key) and the chart goes with it', async () => {
    const view = await renderInto(
      <Gantt key="one" defaultTasks={TASKS} now={NOW} renderer={{ frames }} className="one" />,
    );
    expect(view.container.querySelectorAll('.one > .gantt')).toHaveLength(1);

    await view.render(
      <Gantt
        key="two"
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames: createManualFrames() }}
        className="two"
      />,
    );

    expect(view.container.querySelector('.one')).toBeNull();
    expect(view.container.querySelectorAll('.two > .gantt')).toHaveLength(1);
    expect(tracker.alive().length).toBeGreaterThan(0);
    await view.unmount();
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FR-REACT-5: unmounting removes the chart, its listeners, its timer and its frame', async () => {
    const view = await renderInto(
      <Gantt defaultTasks={TASKS} now={NOW} renderer={{ frames }} className="chart" />,
    );
    expect(tracker.alive().length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await view.unmount();

    expect(view.container.childNodes).toHaveLength(0);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.queued).toBe(0);
    expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('FR-REACT-1: several charts on a page are independent', async () => {
    const view = await renderInto(
      <>
        <Gantt defaultTasks={TASKS} now={NOW} renderer={{ frames }} className="first" />
        <Gantt
          defaultTasks={[TASKS[0]!]}
          now={NOW}
          renderer={{ frames: createManualFrames() }}
          className="second"
        />
      </>,
    );

    expect(view.container.querySelectorAll('.first .gantt__bar')).toHaveLength(2);
    expect(view.container.querySelectorAll('.second .gantt__bar')).toHaveLength(1);
    expect(view.container.querySelector('.first .gantt')?.id).not.toBe(
      view.container.querySelector('.second .gantt')?.id,
    );
    await view.unmount();
  });

  it('FR-API-6: the props are typed from the data: TData flows into the handlers', () => {
    interface Row {
      readonly team: string;
    }
    const tasks = [
      { id: 1, name: 'x', start: '2026-03-02', end: '2026-03-03', data: { team: 'a' } },
    ];

    expectTypeOf<GanttProps<Row>['defaultTasks']>().toEqualTypeOf<
      readonly Task<Row>[] | undefined
    >();
    // A JSX expression, checked by the compiler: `record.task.data` is a `Row`.
    const element = (
      <Gantt
        defaultTasks={tasks}
        onTaskClick={(record) => {
          expectTypeOf(record.task.data).toEqualTypeOf<{ team: string } | undefined>();
        }}
      />
    );
    expect(element).toBeDefined();
  });
});

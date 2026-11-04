import { barHandles } from '@ganttlane/core';
import { act, type ReactElement, type ReactNode, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { useGanttContext } from './context';
import { Gantt } from './Gantt';
import { GanttChart, GanttRoot, type GanttRootProps } from './GanttRoot';
import { TaskList } from './TaskList';
import type { ManualFrames } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import type { GanttInstance, GanttReactOptions } from './types';
import { useGantt } from './use-gantt';
import { type GanttBar, useGanttBar } from './use-gantt-bar';
import { useGanttState } from './use-gantt-state';

const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'g', name: 'Group', start: '2026-03-09', end: '2026-03-20' },
  { id: 'g1', name: 'Child one', parentId: 'g', start: '2026-03-09', end: '2026-03-11' },
  { id: 'p', name: 'Plan', type: 'placeholder' as const },
];

let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  stubScrollerSize(600, 200);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

const options = (more: Partial<GanttReactOptions> = {}): GanttRootProps => ({
  defaultTasks: TASKS,
  calendar: { weekends: [] },
  scroll: { initial: 'start', behavior: 'instant' },
  layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25 },
  renderer: { frames },
  ...more,
});

/** Runs what the browser or the application would, and what React then does. */
const run = (work: () => void): Promise<void> =>
  act(() => {
    work();
    return Promise.resolve();
  });

/** Renders the elements below a root with a chart; lets the first frame draw. */
async function below(
  ui: ReactNode,
  props: Partial<GanttRootProps> = {},
  strict = false,
): Promise<{ view: Awaited<ReturnType<typeof renderInto>>; gantt: () => GanttInstance }> {
  const grabbed: { gantt?: GanttInstance } = {};
  const grab = (gantt: GanttInstance): void => {
    grabbed.gantt = gantt;
  };
  function Grab(): null {
    grab(useGanttContext());
    return null;
  }
  const view = await renderInto(
    <GanttRoot {...options()} {...props}>
      <Grab />
      <GanttChart />
      {ui}
    </GanttRoot>,
    { strict },
  );
  await run(() => {
    frames.step();
  });
  return { view, gantt: () => grabbed.gantt! };
}

/** What a {@link Probe} saw: the bar a hook last returned, and how many times it rendered. */
interface Into {
  bar: GanttBar | undefined;
  renders: number;
  record(bar: GanttBar | undefined): void;
}

/** Makes an `Into`. */
const seenBar = (): Into => {
  const seen: Into = {
    bar: undefined,
    renders: 0,
    record(bar) {
      seen.bar = bar;
      seen.renders += 1;
    },
  };
  return seen;
};

/** A component that is only `useGanttBar`. */
function Probe({ id, into }: { id: string | undefined; into: Into }): null {
  const bar = useGanttBar(id);
  into.record(bar);
  return null;
}

describe('<GanttRoot> and <GanttChart>', () => {
  it('FR-REACT-6: the chart is drawn into the one element of the chart, the root draws none', async () => {
    const { view } = await below(null, {}, false);
    expect(view.container.children).toHaveLength(1);
    expect(view.container.firstElementChild?.querySelector('.gantt')).not.toBeNull();
    expect(document.querySelectorAll('.gantt__bar')).toHaveLength(3);
  });

  it('FR-REACT-6: the container takes id, className, style, aria and data attributes', async () => {
    await renderInto(
      <GanttRoot {...options()}>
        <GanttChart
          id="plan"
          className="wide"
          style={{ height: 300 }}
          aria-label="Plan"
          data-x="1"
        />
      </GanttRoot>,
    );
    const container = document.getElementById('plan')!;
    expect(container.className).toBe('wide');
    expect(container.style.height).toBe('300px');
    expect(container.getAttribute('aria-label')).toBe('Plan');
    expect(container.dataset.x).toBe('1');
  });

  it('FR-REACT-6: useGanttContext is the same chart for the life of the root, with its methods', async () => {
    const { gantt, view } = await below(null);
    const first = gantt();
    await view.render(
      <GanttRoot {...options({ defaultViewMode: 'month' })}>
        <GanttChart />
      </GanttRoot>,
    );
    expect(gantt()).toBe(first);
    expect(typeof first.select).toBe('function');
    expect(first.getTask('a')?.name).toBe('Alpha');
  });

  it('FR-REACT-6: a hook or component that needs a chart says so outside a root', () => {
    function Lonely(): ReactElement {
      useGanttContext();
      return <i />;
    }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderToString(<Lonely />)).toThrow(/useGanttContext needs a chart/);
    expect(() => renderToString(<GanttChart />)).toThrow(
      /GanttChart needs a chart: render it inside <GanttRoot>\./,
    );
    expect(() => renderToString(<Lonely />)).not.toThrow(/or pass the chart/);
    expect(() => renderToString(<TaskList />)).toThrow(/TaskList needs a chart.*or pass the chart/);
    function Reads(): null {
      useGanttState((s) => s.viewMode.id);
      return null;
    }
    expect(() => renderToString(<Reads />)).toThrow(/useGanttState needs a chart/);
    function Follows(): null {
      useGanttBar('a');
      return null;
    }
    expect(() => renderToString(<Follows />)).toThrow(/useGanttBar needs a chart/);
    quiet.mockRestore();
  });

  it('FR-REACT-6: props of the root reach the chart as they do for <Gantt>', async () => {
    const { gantt, view } = await below(null, { defaultViewMode: 'month' });
    expect(gantt().getSnapshot().viewMode.id).toBe('month');
    await view.render(
      <GanttRoot {...options({ defaultViewMode: 'month', layout: { rowHeight: 50 } })}>
        <GanttChart />
      </GanttRoot>,
    );
    await run(() => {
      frames.step();
    });
    expect(gantt().getLayoutMetrics().rowHeight).toBe(50);
  });

  it('FR-REACT-6: a second <GanttChart> in a root is reported in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderInto(
      <GanttRoot {...options()}>
        <GanttChart />
        <GanttChart />
      </GanttRoot>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/has one chart/);
  });

  it('FR-REACT-6: the second <GanttChart> is reported once under StrictMode, which runs effects twice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderInto(
      <StrictMode>
        <GanttRoot {...options()}>
          <GanttChart />
          <GanttChart />
        </GanttRoot>
      </StrictMode>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('FR-REACT-6: StrictMode mounts the chart once and leaves nothing behind', async () => {
    const tracker = trackListeners();
    try {
      const { view } = await below(null, {}, true);
      expect(document.querySelectorAll('.gantt')).toHaveLength(1);
      expect(document.querySelectorAll('.gantt__bar')).toHaveLength(3);
      await view.unmount();
      await act(() => Promise.resolve());
      expect(tracker.alive()).toEqual([]);
      expect(document.querySelectorAll('.gantt')).toHaveLength(0);
    } finally {
      tracker.restore();
    }
  });

  it('FR-REACT-6: the content of a slot sees the context of the root', async () => {
    const seen: (GanttInstance | undefined)[] = [];
    function Label({ id }: { id: string | number }): ReactElement {
      const gantt = useGanttContext();
      seen.push(gantt);
      return <b>{gantt.getTask(id)?.name}</b>;
    }
    const { gantt } = await below(null, {
      renderBarLabel: ({ task }) => <Label id={task.id} />,
    });
    await run(() => {
      frames.step();
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((one) => one === gantt())).toBe(true);
    expect(document.querySelector('.gantt b')?.textContent).toBe('Alpha');
  });

  it('FR-REACT-6: a <Gantt> below a root is a chart of its own, which the hooks do not see', async () => {
    const mine: Into = seenBar();
    await renderInto(
      <GanttRoot {...options({ defaultTasks: [TASKS[0]!] })}>
        <GanttChart />
        <Gantt {...options({ defaultTasks: [TASKS[1]!] })} />
        <Probe id="g" into={mine} />
      </GanttRoot>,
    );
    expect(mine.bar).toBeUndefined();
  });

  it('FR-REACT-6: a server renders the container and the children, and the hooks answer', () => {
    const seen: Into = seenBar();
    function Mode(): ReactElement {
      return <p>{useGanttState((s) => s.viewMode.id)}</p>;
    }
    const html = renderToString(
      <GanttRoot {...options({ defaultViewMode: 'month' })}>
        <GanttChart id="plan" />
        <Mode />
        <Probe id="a" into={seen} />
      </GanttRoot>,
    );
    expect(html).toContain('<div id="plan"></div>');
    expect(html).toContain('<p>month</p>');
    expect(seen.bar?.task.name).toBe('Alpha');
    // Nothing is measured on a server: no place to put a panel.
    expect(seen.bar?.box).toBeUndefined();
  });
});

describe('useGanttState(selector)', () => {
  it('FR-REACT-6: it reads the chart of the root and renders again only when its slice changes', async () => {
    const seen: number[] = [];
    function Count(): null {
      seen.push(useGanttState((s) => s.selection.tasks.length));
      return null;
    }
    const { gantt } = await below(<Count />);
    expect(seen.at(-1)).toBe(0);
    const renders = seen.length;
    await run(() => {
      gantt().setViewMode('month');
    });
    expect(seen).toHaveLength(renders);
    await run(() => {
      gantt().select(['a', 'g']);
    });
    expect(seen.at(-1)).toBe(2);
  });

  it('FR-REACT-6: it takes an isEqual, and the form with a chart still works inside a root', async () => {
    const seen: string[] = [];
    function Names(): null {
      const gantt = useGanttContext();
      const named = useGanttState(
        (s) => s.selection.tasks.map(String),
        (a, b) => a.join() === b.join(),
      );
      const mode = useGanttState(gantt, (s) => s.viewMode.id);
      seen.push(`${named.join()}|${mode}`);
      return null;
    }
    const { gantt } = await below(<Names />);
    await run(() => {
      gantt().select(['a']);
    });
    expect(seen.at(-1)).toBe('a|day');
  });
});

describe('<TaskList> in a root', () => {
  it('FR-REACT-6: it takes the chart of the root when it is given none', async () => {
    await below(<TaskList />);
    expect(
      [...document.querySelectorAll<HTMLElement>('.gantt-task-list__row')].map(
        (node) => node.dataset.taskId,
      ),
    ).toEqual(['a', 'g', 'g1', 'p']);
  });

  it('FR-REACT-6: the chart it is given wins over the root', async () => {
    function Own(): ReactElement {
      const mine = useGantt({ ...options({ defaultTasks: [TASKS[0]!] }) });
      return <TaskList gantt={mine} />;
    }
    await below(<Own />);
    expect(
      [...document.querySelectorAll<HTMLElement>('.gantt-task-list__row')].map(
        (node) => node.dataset.taskId,
      ),
    ).toEqual(['a']);
  });
});

describe('useGanttBar', () => {
  it('FR-REACT-6: no id, or an id the chart does not have, gives undefined', async () => {
    const none: Into = seenBar();
    const unknown: Into = seenBar();
    await below(
      <>
        <Probe id={undefined} into={none} />
        <Probe id="nope" into={unknown} />
      </>,
    );
    expect(none.bar).toBeUndefined();
    expect(unknown.bar).toBeUndefined();
  });

  it('FR-REACT-6: it gives the record, the selection and the focus of the task', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="a" into={seen} />, {
      keyboard: { barFocus: true },
    });
    expect(seen.bar?.task.name).toBe('Alpha');
    expect(seen.bar).toMatchObject({ isSelected: false, isFocused: false, isDragging: false });
    expect(seen.bar?.draft).toBeUndefined();
    await run(() => {
      gantt().select(['a']);
      gantt().focusTask('a');
    });
    expect(seen.bar).toMatchObject({ isSelected: true, isFocused: true });
  });

  it('FR-REACT-6: the box is where the bar is drawn, in the container, and follows the scroll', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="g" into={seen} />, {
      scroll: { initial: 'start', behavior: 'instant' },
    });
    const rect = gantt().getBarRect('g')!;
    const header = gantt().getLayoutMetrics().headerHeight;
    const box = seen.bar?.box;
    expect(box).toEqual({
      left: rect.x - gantt().getSnapshot().timeline.scrollLeft,
      top: rect.y + header - gantt().getSnapshot().scrollTop,
      width: rect.width,
      height: rect.height,
    });
    const left = box!.left;
    await run(() => {
      gantt().scrollTo({
        left: gantt().getSnapshot().timeline.scrollLeft + 30,
        behavior: 'instant',
      });
      frames.step();
    });
    expect(seen.bar?.box?.left).toBe(left - 30);
    expect(seen.bar?.box?.top).toBe(box!.top);
  });

  it('FR-REACT-6: a task without a bar, or under a collapsed parent, has no box', async () => {
    const placeholder: Into = seenBar();
    const child: Into = seenBar();
    const { gantt } = await below(
      <>
        <Probe id="p" into={placeholder} />
        <Probe id="g1" into={child} />
      </>,
      { defaultExpandedKeys: ['g'] },
    );
    expect(placeholder.bar?.task.id).toBe('p');
    expect(placeholder.bar?.box).toBeUndefined();
    expect(child.bar?.box).toBeDefined();
    await run(() => {
      gantt().toggle('g');
    });
    expect(child.bar?.task.id).toBe('g1');
    expect(child.bar?.box).toBeUndefined();
  });

  it('FR-REACT-6: it renders again for its own task and not for the changes of others', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="a" into={seen} />);
    const before = seen.renders;
    const bar = seen.bar;
    await run(() => {
      gantt().select(['g']);
    });
    await run(() => {
      gantt().setHoveredRow('g1');
    });
    expect(seen.renders).toBe(before);
    expect(seen.bar).toBe(bar);
    await run(() => {
      gantt().select(['a']);
    });
    expect(seen.renders).toBe(before + 1);
  });

  it('FR-REACT-6: it follows its bar while it is dragged, with the draft values', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="a" into={seen} />);
    const rect = gantt().getBarRect('a')!;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const left = seen.bar!.box!.left;
    await run(() => {
      gantt().core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
      gantt().core.send({ type: 'move', pointerId: 1, x: x + 90, y, time: 10 });
      frames.step();
    });
    expect(seen.bar?.isDragging).toBe(true);
    expect(seen.bar?.draft?.start.getTime()).toBeGreaterThan(seen.bar!.task.start!.getTime());
    expect(seen.bar!.box!.left).toBeGreaterThan(left);
    await run(() => {
      gantt().core.send({ type: 'up', pointerId: 1, x: x + 90, y, time: 20 });
      frames.step();
    });
    expect(seen.bar?.isDragging).toBe(false);
    expect(seen.bar?.draft).toBeUndefined();
    expect(seen.bar?.task.start?.getTime()).toBeGreaterThan(new Date(2026, 2, 2).getTime());
  });

  it('FR-REACT-6: a change that controlled data has not applied yet stays as the draft', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="a" into={seen} />, {
      defaultTasks: undefined,
      tasks: TASKS,
      links: [],
      onTasksChange: () => undefined,
    });
    const rect = gantt().getBarRect('a')!;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const start = seen.bar!.task.start!.getTime();
    await run(() => {
      gantt().core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
      gantt().core.send({ type: 'move', pointerId: 1, x: x + 90, y, time: 10 });
      gantt().core.send({ type: 'up', pointerId: 1, x: x + 90, y, time: 20 });
      frames.step();
    });
    expect(seen.bar?.isDragging).toBe(false);
    expect(seen.bar?.task.start?.getTime()).toBe(start);
    expect(seen.bar?.draft?.start.getTime()).toBeGreaterThan(start);
  });

  it('FR-REACT-6: the end of the draft has the meaning of TaskRecord.end, inclusive or not', async () => {
    for (const endInclusive of [true, false]) {
      const seen: Into = seenBar();
      const { gantt, view } = await below(<Probe id="a" into={seen} />, {
        defaultTasks: undefined,
        tasks: TASKS,
        links: [],
        onTasksChange: () => undefined,
        dates: { endInclusive },
      });
      const rect = gantt().getBarRect('a')!;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      await run(() => {
        gantt().core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
        gantt().core.send({ type: 'move', pointerId: 1, x: x + 90, y, time: 10 });
        gantt().core.send({ type: 'up', pointerId: 1, x: x + 90, y, time: 20 });
        frames.step();
      });
      const { draft } = seen.bar!;
      expect(draft).toBeDefined();
      const last = new Date(draft!.endExclusive);
      last.setDate(last.getDate() - 1);
      expect(draft!.end.getTime()).toBe(
        endInclusive ? last.getTime() : draft!.endExclusive.getTime(),
      );
      await view.unmount();
      cleanUpDocument();
    }
  });

  it('FR-REACT-6: drawing a link from the bar is not dragging the bar', async () => {
    const seen: Into = seenBar();
    const { gantt } = await below(<Probe id="a" into={seen} />);
    const rect = gantt().getBarRect('a')!;
    const handle = barHandles(rect, gantt().getSnapshot().handles).linkEnd;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await run(() => {
      gantt().core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
      gantt().core.send({ type: 'move', pointerId: 1, x: x + 60, y: y + 80, time: 10 });
      frames.step();
    });
    expect(gantt().getSnapshot().feedback.phase).toBe('linking');
    expect(seen.bar?.isDragging).toBe(false);
    expect(seen.bar?.draft).toBeUndefined();
  });

  it('FR-REACT-6: it follows the id it is given, and an id that goes away gives undefined', async () => {
    const seen: Into = seenBar();
    function Which({ id }: { id: string | undefined }): ReactElement {
      return <Probe id={id} into={seen} />;
    }
    const { view } = await below(<Which id="a" />);
    expect(seen.bar?.task.id).toBe('a');
    await view.render(
      <GanttRoot {...options()}>
        <GanttChart />
        <Which id="g" />
      </GanttRoot>,
    );
    expect(seen.bar?.task.id).toBe('g');
    await view.render(
      <GanttRoot {...options()}>
        <GanttChart />
        <Which id={undefined} />
      </GanttRoot>,
    );
    expect(seen.bar).toBeUndefined();
    await view.render(
      <GanttRoot {...options()}>
        <GanttChart />
        <Which id="a" />
      </GanttRoot>,
    );
    expect(seen.bar?.task.id).toBe('a');
  });

  describe('with layout.height: auto, where the page scrolls the chart', () => {
    const auto = {
      layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25, height: 'auto' as const },
    };

    it('FR-REACT-6: the offset the page scrolls the chart by does not move the box, and costs no render', async () => {
      const seen: Into = seenBar();
      const { gantt } = await below(<Probe id="g1" into={seen} />, auto);
      const top = seen.bar!.box!.top;
      const renders = seen.renders;
      await run(() => {
        gantt().core.scroll({ left: gantt().getSnapshot().timeline.scrollLeft, top: 120 });
        frames.step();
      });
      expect(gantt().getSnapshot().scrollTop).toBe(120);
      expect(seen.bar?.box?.top).toBe(top);
      expect(seen.renders).toBe(renders);
    });

    it('FR-REACT-6: in a fixed height the same offset moves it, so the two are told apart', async () => {
      const seen: Into = seenBar();
      const { gantt } = await below(<Probe id="g1" into={seen} />, {
        layout: { rowHeight: 40, barHeight: 24, headerRowHeight: 25, height: 100 },
      });
      const top = seen.bar!.box!.top;
      await run(() => {
        gantt().core.scroll({ left: gantt().getSnapshot().timeline.scrollLeft, top: 40 });
        frames.step();
      });
      expect(gantt().getSnapshot().scrollTop).toBe(40);
      expect(seen.bar?.box?.top).toBe(top - 40);
    });
  });

  it('FR-REACT-6: it takes a chart from useGantt instead of the context', async () => {
    const seen: Into = seenBar();
    function Alone(): ReactElement {
      const mine = useGantt(options({ defaultTasks: [TASKS[1]!] }));
      const bar = useGanttBar('g', mine);
      seen.record(bar);
      const { setContainer } = mine;
      return <div ref={setContainer} />;
    }
    await renderInto(<Alone />);
    expect(seen.bar?.task.name).toBe('Group');
  });
});

describe('types of the compound API', () => {
  it('FR-REACT-6: TData is inferred from the props of the root and typed in the hooks', () => {
    interface Row {
      readonly team: string;
    }
    const tasks = [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03', data: { team: 'x' } },
    ];
    // Only a type check: the function is never called.
    const check = (): ReactElement => (
      <GanttRoot
        defaultTasks={tasks}
        renderBarLabel={({ task }) => {
          expectTypeOf(task.data).toEqualTypeOf<{ team: string } | undefined>();
          return null;
        }}
      />
    );
    expect(check).toBeTypeOf('function');

    function Typed(): null {
      const bar = useGanttBar<Row>('a');
      expectTypeOf(bar).toEqualTypeOf<GanttBar<Row> | undefined>();
      expectTypeOf(bar?.task.task.data).toEqualTypeOf<Row | undefined>();
      const gantt = useGanttContext<Row>();
      expectTypeOf(gantt).toEqualTypeOf<GanttInstance<Row>>();
      const team = useGanttState<Row, string | undefined>(
        (s) => s.state.derived.model.taskById.get('a')?.id as string,
      );
      expectTypeOf(team).toEqualTypeOf<string | undefined>();
      const mine = useGantt<Row>({});
      expectTypeOf(useGanttBar('a', mine)).toEqualTypeOf<GanttBar<Row> | undefined>();
      return null;
    }
    expect(Typed).toBeTypeOf('function');
    expectTypeOf<GanttBar['box']>().toEqualTypeOf<
      | {
          readonly left: number;
          readonly top: number;
          readonly width: number;
          readonly height: number;
        }
      | undefined
    >();
  });
});

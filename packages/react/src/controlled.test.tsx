import { patchTasks } from '@ganttlane/core';
import type { Task } from '@ganttlane/dom';
import type { ReactElement } from 'react';
import { act, useState } from 'react';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListenerTracker } from './testing';
import {
  cleanUpDocument,
  createManualFrames,
  renderInto,
  stubScrollerSize,
  trackListeners,
} from './testing';
import { chartOf, forgetCharts } from './testing/charts';
import { collect, Harness } from './testing/harness';
import type { ExpandedKeys, GanttInstance, GanttReactOptions } from './types';
import { useGantt } from './use-gantt';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
  { id: 'p', name: 'P', start: '2026-03-16', end: '2026-03-27' },
  { id: 'c', name: 'C', parentId: 'p', start: '2026-03-17', end: '2026-03-20' },
];
const LINKS = [{ source: 'a', target: 'b' }];
const NOW = (): string => '2026-03-04';

let tracker: ListenerTracker;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  forgetCharts();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanUpDocument();
});

/** Options with deterministic frames and clock; the data is up to the test. */
function base(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return { now: NOW, renderer: { frames: createManualFrames() }, ...extra };
}

const startDay = (gantt: GanttInstance, id: string): number | undefined =>
  gantt.getTask(id)?.start?.getDate();

describe('controlled and uncontrolled tasks', () => {
  /** The pattern of the README: the owner keeps the tasks and applies each change set. */
  function TasksOwner({
    apply = true,
    onChange,
    capture,
  }: {
    apply?: boolean;
    onChange?: (changes: unknown) => void;
    capture: (gantt: GanttInstance) => void;
  }): ReactElement {
    const [tasks, setTasks] = useState<readonly Task[]>(TASKS);
    const gantt = useGantt({
      ...base(),
      tasks,
      onTasksChange: (changes) => {
        onChange?.(changes);
        if (apply) {
          setTasks((current) =>
            patchTasks(current, changes, gantt.core.getSnapshot().state.derived.model),
          );
        }
      },
    });
    capture(gantt);
    const { setContainer } = gantt;
    return <div ref={setContainer} />;
  }

  it('FR-REACT-1: controlled tasks run the core in controlled mode, and the owner applies the change set with patchTasks', async () => {
    const { capture, latest } = collect();
    const onChange = vi.fn();
    const view = await renderInto(<TasksOwner onChange={onChange} capture={capture} />);
    const gantt = latest();
    expect(gantt.core.getSnapshot().state.options.dataMode).toBe('controlled');
    expect(startDay(gantt, 'a')).toBe(2);

    await act(async () => {
      await gantt.updateTask('a', { start: '2026-03-03' });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(startDay(gantt, 'a')).toBe(3);
    // The owner passed the new tasks back: nothing is waiting any more.
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
    expect(gantt.getSnapshot().busy).toBe(false);
    expect(gantt.getSnapshot().state.tasks.find((task) => task.id === 'a')?.start).toBe(
      '2026-03-03',
    );
    await view.unmount();
  });

  it('FR-REACT-1: until the owner applies a change it shows as a draft, and a chart is not set back meanwhile', async () => {
    const { capture, latest } = collect();
    const onChange = vi.fn();
    const view = await renderInto(
      <TasksOwner apply={false} onChange={onChange} capture={capture} />,
    );
    const gantt = latest();

    await act(async () => {
      await gantt.updateTask('a', { start: '2026-03-03' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(gantt.getSnapshot().state.draft?.committed).toBe(true);
    expect(gantt.getSnapshot().busy).toBe(true);
    expect(gantt.getSnapshot().state.tasks.find((task) => task.id === 'a')?.start).toBe(
      '2026-03-02',
    );
    await view.unmount();
  });

  it('FR-REACT-1: the same tasks array again is nothing; a new array is given to the core once', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, links: LINKS })} capture={capture} />,
    );
    const chart = chartOf(latest().core);

    await view.render(<Harness options={base({ tasks: TASKS, links: LINKS })} capture={capture} />);
    await view.render(<Harness options={base({ tasks: TASKS, links: LINKS })} capture={capture} />);
    expect(chart.setOptions).not.toHaveBeenCalled();

    const next = [...TASKS, { id: 'z', name: 'Z', start: '2026-03-10', end: '2026-03-12' }];
    await view.render(<Harness options={base({ tasks: next, links: LINKS })} capture={capture} />);
    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ tasks: next });
    expect(latest().getTask('z')?.name).toBe('Z');
    await view.unmount();
  });

  it('FR-REACT-1: controlled tasks are the owner’s: the chart never changes them', async () => {
    const { capture, latest } = collect();
    const frozen = Object.freeze(TASKS.map((task) => Object.freeze({ ...task })));
    const view = await renderInto(<Harness options={base({ tasks: frozen })} capture={capture} />);

    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });

    expect(latest().getSnapshot().state.tasks).toBe(frozen);
    await view.unmount();
  });

  it('FR-REACT-1: uncontrolled tasks start from defaultTasks and then belong to the chart; onTasksChange only tells', async () => {
    const { capture, latest } = collect();
    const onTasksChange = vi.fn();
    const view = await renderInto(
      <Harness options={base({ defaultTasks: TASKS, onTasksChange })} capture={capture} />,
    );
    const chart = chartOf(latest().core);
    expect(latest().core.getSnapshot().state.options.dataMode).toBe('uncontrolled');

    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });
    expect(onTasksChange).toHaveBeenCalledTimes(1);
    expect(startDay(latest(), 'a')).toBe(3);

    // A different `defaultTasks` later is not a change: the chart keeps what it has.
    await view.render(
      <Harness options={base({ defaultTasks: [TASKS[1]!], onTasksChange })} capture={capture} />,
    );
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(startDay(latest(), 'a')).toBe(3);
    expect(latest().getTask('b')?.name).toBe('B');
    await view.unmount();
  });

  it('FR-REACT-1: with neither tasks nor defaultTasks the chart starts empty', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={base()} capture={capture} />);

    expect(latest().getSnapshot().state.tasks).toEqual([]);
    expect(latest().getIssues().options).toEqual([]);
    await view.unmount();
  });

  it('FR-REACT-1: the options do not mutate the tasks the application gave', async () => {
    const { capture, latest } = collect();
    const tasks = Object.freeze(TASKS.map((task) => Object.freeze({ ...task })));
    const before = JSON.stringify(tasks);
    const view = await renderInto(
      <Harness options={base({ defaultTasks: tasks, links: undefined })} capture={capture} />,
    );

    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });

    expect(JSON.stringify(tasks)).toBe(before);
    await view.unmount();
  });
});

describe('a switch between controlled and uncontrolled', () => {
  it('FR-REACT-5: controlled to uncontrolled warns once in development, and the chart stays controlled', async () => {
    const { capture, latest } = collect();
    // Read-only: a chart whose controlled tasks can be edited would also say it has no `onTasksChange`.
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, editing: false })} capture={capture} />,
    );
    const chart = chartOf(latest().core);

    await view.render(
      <Harness options={base({ defaultTasks: [TASKS[0]!], editing: false })} capture={capture} />,
    );
    await view.render(
      <Harness options={base({ defaultTasks: [TASKS[1]!], editing: false })} capture={capture} />,
    );
    await view.render(<Harness options={base({ editing: false })} capture={capture} />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('`tasks`');
    expect(warn.mock.calls[0]?.[0]).toContain('controlled to uncontrolled');
    expect(warn.mock.calls[0]?.[0]).toContain('defaultTasks');
    // Still controlled, still the tasks it had: nothing was sent.
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(latest().getSnapshot().state.tasks).toBe(TASKS);
    expect(latest().core.getSnapshot().state.options.dataMode).toBe('controlled');
    await view.unmount();
  });

  it('FR-REACT-5: uncontrolled to controlled warns once in development, and the chart stays uncontrolled', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week' })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);

    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week', viewMode: 'month' })}
        capture={capture}
      />,
    );
    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week', viewMode: 'day' })}
        capture={capture}
      />,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('`viewMode`');
    expect(warn.mock.calls[0]?.[0]).toContain('uncontrolled to controlled');
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(latest().getSnapshot().viewMode.id).toBe('week');
    await view.unmount();
  });

  it('FR-REACT-5: each group warns on its own, and a group that never switches never warns', async () => {
    const { capture } = collect();
    const view = await renderInto(
      <Harness
        options={base({
          tasks: TASKS,
          editing: false,
          viewMode: 'day',
          selectedKeys: [],
          expandedKeys: 'all',
        })}
        capture={capture}
      />,
    );

    await view.render(
      <Harness
        options={base({ tasks: TASKS, editing: false, viewMode: 'day', expandedKeys: 'all' })}
        capture={capture}
      />,
    );
    await view.render(
      <Harness
        options={base({ tasks: TASKS, editing: false, expandedKeys: 'all' })}
        capture={capture}
      />,
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([text]) => /`(\w+)`/.exec(String(text))?.[1])).toEqual([
      'selectedKeys',
      'viewMode',
    ]);
    await view.unmount();
  });

  it('FR-REACT-5: a production build says nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { capture } = collect();
    const view = await renderInto(<Harness options={base({ tasks: TASKS })} capture={capture} />);

    await view.render(<Harness options={base({ defaultTasks: TASKS })} capture={capture} />);

    expect(warn).not.toHaveBeenCalled();
    await view.unmount();
  });
});

describe('controlled and uncontrolled links', () => {
  /** The owner of `tasks` and `links`, applying what the chart reports. */
  function LinksOwner({
    apply = true,
    capture,
    onLinksChange,
    onLinkCreate,
    onLinkDelete,
  }: {
    apply?: boolean;
    capture: (gantt: GanttInstance) => void;
    onLinksChange?: (links: readonly unknown[]) => void;
    onLinkCreate?: (...args: unknown[]) => void;
    onLinkDelete?: (...args: unknown[]) => void;
  }): ReactElement {
    const [links, setLinks] = useState<readonly { source: string; target: string }[]>(LINKS);
    const gantt = useGantt({
      ...base(),
      tasks: TASKS,
      links,
      onLinkCreate,
      onLinkDelete,
      onLinksChange: (next) => {
        onLinksChange?.(next);
        if (apply) setLinks(next as typeof links);
      },
    });
    capture(gantt);
    const { setContainer } = gantt;
    return <div ref={setContainer} />;
  }

  it('FR-REACT-1: with controlled tasks and links, a link that is drawn is reported with the links to pass back', async () => {
    const { capture, latest } = collect();
    const onLinksChange = vi.fn<(links: readonly unknown[]) => void>();
    const onLinkCreate = vi.fn();
    const view = await renderInto(
      <LinksOwner capture={capture} onLinksChange={onLinksChange} onLinkCreate={onLinkCreate} />,
    );
    expect(latest().getLink('a:FS:b')).toBeDefined();

    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c', type: 'SS' });
    });

    expect(onLinkCreate).toHaveBeenCalledTimes(1);
    expect(onLinkCreate.mock.calls[0]?.[0]).toMatchObject({ source: 'b', target: 'c' });
    expect(onLinksChange).toHaveBeenCalledTimes(1);
    expect(onLinksChange.mock.calls[0]?.[0]).toEqual([
      ...LINKS,
      { source: 'b', target: 'c', type: 'SS' },
    ]);
    // The owner passed them back, so the link is in the graph now.
    expect(latest().getLink('b:SS:c')).toBeDefined();
    await view.unmount();
  });

  it('FR-REACT-1: a link that is removed is reported without it', async () => {
    const { capture, latest } = collect();
    const onLinksChange = vi.fn<(links: readonly unknown[]) => void>();
    const onLinkDelete = vi.fn();
    const view = await renderInto(
      <LinksOwner capture={capture} onLinksChange={onLinksChange} onLinkDelete={onLinkDelete} />,
    );

    await act(async () => {
      await latest().removeLink('a:FS:b');
    });

    expect(onLinkDelete).toHaveBeenCalledTimes(1);
    expect(onLinksChange).toHaveBeenCalledTimes(1);
    expect(onLinksChange.mock.calls[0]?.[0]).toEqual([]);
    expect(latest().getLink('a:FS:b')).toBeUndefined();
    await view.unmount();
  });

  it('FR-REACT-1: controlled data does not apply a link the owner does not pass back', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<LinksOwner apply={false} capture={capture} />);

    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c' });
    });
    await act(async () => {
      await latest().removeLink('a:FS:b');
    });

    expect(latest().getLink('b:FS:c')).toBeUndefined();
    expect(latest().getLink('a:FS:b')).toBeDefined();
    await view.unmount();
  });

  it('FR-REACT-1: links with an id of their own, and a default link type, are matched when one is removed', async () => {
    const { capture, latest } = collect();
    const onLinksChange = vi.fn<(links: readonly unknown[]) => void>();
    const view = await renderInto(
      <Harness
        options={base({
          tasks: TASKS,
          links: [
            { id: 'mine', source: 'a', target: 'b', type: 'SS' },
            { source: 'b', target: 'c' },
          ],
          scheduling: { defaultLinkType: 'FF' },
          onLinksChange,
        })}
        capture={capture}
      />,
    );

    await act(async () => {
      await latest().removeLink('mine');
    });
    await act(async () => {
      await latest().removeLink('b:FF:c');
    });

    expect(onLinksChange.mock.calls.map(([links]) => links)).toEqual([
      [{ source: 'b', target: 'c' }],
      [{ id: 'mine', source: 'a', target: 'b', type: 'SS' }],
    ]);
    await view.unmount();
  });

  it('FR-REACT-1: uncontrolled links start from defaultLinks, and onLinksChange gives the chart’s own', async () => {
    const { capture, latest } = collect();
    const onLinksChange = vi.fn<(links: readonly unknown[]) => void>();
    const view = await renderInto(
      <Harness
        options={base({ defaultTasks: TASKS, defaultLinks: LINKS, onLinksChange })}
        capture={capture}
      />,
    );
    expect(latest().getLink('a:FS:b')).toBeDefined();

    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c' });
    });
    expect(latest().getLink('b:FS:c')).toBeDefined();
    expect(onLinksChange.mock.calls[0]?.[0]).toEqual([...LINKS, { source: 'b', target: 'c' }]);

    await act(async () => {
      await latest().removeLink('a:FS:b');
    });
    expect(onLinksChange.mock.calls[1]?.[0]).toEqual([{ source: 'b', target: 'c' }]);
    expect(latest().getLink('a:FS:b')).toBeUndefined();
    await view.unmount();
  });

  it('FR-REACT-1: controlled links over uncontrolled tasks are set back when the owner does not take the change', async () => {
    const { capture, latest } = collect();
    const links = [...LINKS];
    const view = await renderInto(
      <Harness options={base({ defaultTasks: TASKS, links })} capture={capture} />,
    );

    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c' });
    });

    expect(latest().getLink('b:FS:c')).toBeUndefined();
    expect(latest().getLink('a:FS:b')).toBeDefined();
    await view.unmount();
  });
});

describe('controlled and uncontrolled viewMode', () => {
  function ViewModeOwner({
    follow,
    onViewModeChange,
    capture,
  }: {
    follow: boolean;
    onViewModeChange: (mode: { id: string }) => void;
    capture: (gantt: GanttInstance) => void;
  }): ReactElement {
    const [viewMode, setViewMode] = useState('day');
    const gantt = useGantt({
      ...base({ defaultTasks: TASKS }),
      defaultTasks: undefined,
      tasks: TASKS,
      viewMode,
      onViewModeChange: (mode) => {
        onViewModeChange(mode);
        if (follow) setViewMode(mode.id);
      },
    });
    capture(gantt);
    const { setContainer } = gantt;
    return <div ref={setContainer} />;
  }

  it('FR-REACT-1: a controlled viewMode follows its prop, and the handler is not called for what the prop caused', async () => {
    const { capture, latest } = collect();
    const onViewModeChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, viewMode: 'day', onViewModeChange })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    expect(latest().getSnapshot().viewMode.id).toBe('day');

    await view.render(
      <Harness
        options={base({ tasks: TASKS, viewMode: 'week', onViewModeChange })}
        capture={capture}
      />,
    );

    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ viewMode: 'week' });
    expect(latest().getSnapshot().viewMode.id).toBe('week');
    expect(onViewModeChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a change the chart makes by itself goes to the handler, and the owner’s state decides', async () => {
    const { capture, latest } = collect();
    const onViewModeChange = vi.fn();
    const view = await renderInto(
      <ViewModeOwner follow={false} onViewModeChange={onViewModeChange} capture={capture} />,
    );

    act(() => {
      latest().setViewMode('month');
    });

    expect(onViewModeChange).toHaveBeenCalledTimes(1);
    expect(onViewModeChange.mock.calls[0]?.[0]).toMatchObject({ id: 'month' });
    // The owner kept 'day': so does the chart.
    expect(latest().getSnapshot().viewMode.id).toBe('day');
    await view.unmount();

    const followed = collect();
    const second = vi.fn();
    const again = await renderInto(
      <ViewModeOwner follow onViewModeChange={second} capture={followed.capture} />,
    );
    act(() => {
      followed.latest().setViewMode('month');
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(followed.latest().getSnapshot().viewMode.id).toBe('month');
    await again.unmount();
  });

  it('FR-REACT-1: an uncontrolled viewMode starts at defaultViewMode and then belongs to the chart', async () => {
    const { capture, latest } = collect();
    const onViewModeChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week', onViewModeChange })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    expect(latest().getSnapshot().viewMode.id).toBe('week');
    expect(onViewModeChange).not.toHaveBeenCalled();

    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'month', onViewModeChange })}
        capture={capture}
      />,
    );
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(latest().getSnapshot().viewMode.id).toBe('week');

    act(() => {
      latest().setViewMode('day');
    });
    expect(latest().getSnapshot().viewMode.id).toBe('day');
    expect(onViewModeChange).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe('controlled and uncontrolled expandedKeys', () => {
  const expandedOf = (gantt: GanttInstance): ExpandedKeys => gantt.getSnapshot().state.expandedKeys;

  function ExpandedOwner({
    initial,
    follow,
    onExpandedChange,
    capture,
  }: {
    initial: ExpandedKeys;
    follow: boolean;
    onExpandedChange: (keys: ExpandedKeys) => void;
    capture: (gantt: GanttInstance) => void;
  }): ReactElement {
    const [keys, setKeys] = useState(initial);
    const gantt = useGantt({
      ...base({ tasks: TASKS }),
      expandedKeys: keys,
      onExpandedChange: (next) => {
        onExpandedChange(next);
        if (follow) setKeys(next);
      },
    });
    capture(gantt);
    const { setContainer } = gantt;
    return <div ref={setContainer} />;
  }

  it('FR-REACT-1: controlled expandedKeys start as given and follow their prop, with no echo to the handler', async () => {
    const { capture, latest } = collect();
    const onExpandedChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: [], onExpandedChange })}
        capture={capture}
      />,
    );
    expect(expandedOf(latest())).toEqual([]);
    expect(latest().getTask('c')?.rowIndex).toBeUndefined();

    await view.render(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: ['p'], onExpandedChange })}
        capture={capture}
      />,
    );

    expect(expandedOf(latest())).toEqual(['p']);
    expect(latest().getTask('c')?.rowIndex).toBeDefined();
    await view.render(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: 'all', onExpandedChange })}
        capture={capture}
      />,
    );
    expect(expandedOf(latest())).toBe('all');
    expect(onExpandedChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a list of parents the chart changes by itself goes to the handler; the owner’s state decides', async () => {
    const { capture, latest } = collect();
    const onExpandedChange = vi.fn();
    const view = await renderInto(
      <ExpandedOwner
        initial={['p']}
        follow={false}
        onExpandedChange={onExpandedChange}
        capture={capture}
      />,
    );

    act(() => {
      latest().collapse('p');
    });

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    expect(expandedOf(latest())).toEqual(['p']);
    expect(latest().getTask('c')?.rowIndex).toBeDefined();
    await view.unmount();

    const followed = collect();
    const second = vi.fn();
    const again = await renderInto(
      <ExpandedOwner initial={['p']} follow onExpandedChange={second} capture={followed.capture} />,
    );
    act(() => {
      followed.latest().collapse('p');
    });
    expect(expandedOf(followed.latest())).toEqual([]);
    expect(followed.latest().getTask('c')?.rowIndex).toBeUndefined();
    await again.unmount();
  });

  it('FR-REACT-1: "all" the chart changes by itself is set back to "all"', async () => {
    const { capture, latest } = collect();
    const onExpandedChange = vi.fn();
    const view = await renderInto(
      <ExpandedOwner
        initial="all"
        follow={false}
        onExpandedChange={onExpandedChange}
        capture={capture}
      />,
    );

    act(() => {
      latest().collapseAll();
    });

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    // Every parent is expanded again (the core spells that out as the list of parents).
    expect(latest().getTask('c')?.rowIndex).toBeDefined();
    act(() => {
      latest().collapse('p');
    });
    expect(onExpandedChange).toHaveBeenCalledTimes(2);
    expect(latest().getTask('c')?.rowIndex).toBeDefined();
    expect(latest().getTask('p')?.isExpanded).toBe(true);
    await view.unmount();
  });

  it('FR-REACT-1: uncontrolled expandedKeys start at defaultExpandedKeys and then belong to the chart', async () => {
    const { capture, latest } = collect();
    const onExpandedChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({
          defaultTasks: TASKS,
          defaultExpandedKeys: [],
          hierarchy: { moveChildren: 'all' },
          onExpandedChange,
        })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    expect(expandedOf(latest())).toEqual([]);

    act(() => {
      latest().expand('p');
    });
    expect(expandedOf(latest())).toEqual(['p']);
    expect(onExpandedChange).toHaveBeenCalledTimes(1);

    await view.render(
      <Harness
        options={base({
          defaultTasks: TASKS,
          defaultExpandedKeys: 'all',
          hierarchy: { moveChildren: 'all' },
          onExpandedChange,
        })}
        capture={capture}
      />,
    );
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(expandedOf(latest())).toEqual(['p']);
    await view.unmount();
  });

  it('FR-REACT-1: other hierarchy options change on their own while the expanded parents stay', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: ['p'], hierarchy: { moveChildren: 'all' } })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);

    await view.render(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: ['p'], hierarchy: { moveChildren: 'none' } })}
        capture={capture}
      />,
    );

    expect(chart.setOptions).toHaveBeenCalledTimes(1);
    expect(chart.setOptions).toHaveBeenLastCalledWith({ hierarchy: { moveChildren: 'none' } });
    expect(expandedOf(latest())).toEqual(['p']);
    await view.unmount();
  });
});

describe('controlled and uncontrolled selectedKeys', () => {
  const selectedOf = (gantt: GanttInstance): readonly (string | number)[] =>
    gantt.getSnapshot().selection.tasks;

  function SelectionOwner({
    follow,
    onSelectionChange,
    capture,
  }: {
    follow: boolean;
    onSelectionChange: (keys: readonly (string | number)[], link: string | undefined) => void;
    capture: (gantt: GanttInstance) => void;
  }): ReactElement {
    const [keys, setKeys] = useState<readonly (string | number)[]>(['a']);
    const gantt = useGantt({
      ...base({ tasks: TASKS, links: LINKS }),
      selectedKeys: keys,
      onSelectionChange: (next, link) => {
        onSelectionChange(next, link);
        if (follow) setKeys(next);
      },
    });
    capture(gantt);
    const { setContainer } = gantt;
    return <div ref={setContainer} />;
  }

  it('FR-REACT-1: controlled selectedKeys start as given and follow their prop, with no echo to the handler', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, selectedKeys: ['a'], onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual(['a']);

    await view.render(
      <Harness
        options={base({ tasks: TASKS, selectedKeys: ['b', 'c'], onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual(['b', 'c']);

    await view.render(
      <Harness
        options={base({ tasks: TASKS, selectedKeys: [], onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual([]);
    expect(onSelectionChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a selection the chart makes by itself goes to the handler; the owner’s state decides', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <SelectionOwner follow={false} onSelectionChange={onSelectionChange} capture={capture} />,
    );

    act(() => {
      latest().select(['b']);
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b'], undefined);
    expect(selectedOf(latest())).toEqual(['a']);
    await view.unmount();

    const followed = collect();
    const second = vi.fn();
    const again = await renderInto(
      <SelectionOwner follow onSelectionChange={second} capture={followed.capture} />,
    );
    act(() => {
      followed.latest().select(['b']);
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(selectedOf(followed.latest())).toEqual(['b']);
    await again.unmount();
  });

  it('FR-REACT-1: the selected link is the chart’s own, and selecting one leaves the selected tasks alone', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <SelectionOwner follow={false} onSelectionChange={onSelectionChange} capture={capture} />,
    );

    act(() => {
      latest().selectLink('a:FS:b');
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(['a'], 'a:FS:b');
    expect(selectedOf(latest())).toEqual(['a']);
    expect(latest().getSnapshot().selection.link).toBe('a:FS:b');
    await view.unmount();
  });

  it('FR-REACT-1: uncontrolled selectedKeys start at defaultSelectedKeys without telling the handler, and then belong to the chart', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const view = await renderInto(
      <Harness
        options={base({
          defaultTasks: TASKS,
          defaultSelectedKeys: ['a', 'nope'],
          onSelectionChange,
        })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    expect(selectedOf(latest())).toEqual(['a']);
    expect(onSelectionChange).not.toHaveBeenCalled();

    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultSelectedKeys: ['b'], onSelectionChange })}
        capture={capture}
      />,
    );
    expect(chart.setOptions).not.toHaveBeenCalled();
    expect(selectedOf(latest())).toEqual(['a']);

    act(() => {
      latest().select(['b']);
    });
    expect(selectedOf(latest())).toEqual(['b']);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-1: the same selectedKeys again, or an equal array, select nothing twice', async () => {
    const { capture, latest } = collect();
    const keys = ['a'];
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );
    const select = vi.spyOn(chartOf(latest().core).gantt, 'select');

    await view.render(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );
    await view.render(
      <Harness options={base({ tasks: TASKS, selectedKeys: ['a'] })} capture={capture} />,
    );

    expect(select).not.toHaveBeenCalled();
    await view.unmount();
  });
});

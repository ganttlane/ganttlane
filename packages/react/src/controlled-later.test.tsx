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
import type { GanttInstance, GanttReactOptions } from './types';
import { useGantt } from './use-gantt';

/**
 * Controlled groups and what arrives later than the first render: tasks that load (the selection
 * naming them, `tasks={data?.tasks}`), links the owner takes back, a prop that goes away, and the
 * draft that a new array of tasks ends. The basic semantics are in `controlled.test.tsx`.
 */

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
const LATE = { id: 'late', name: 'Late', start: '2026-03-30', end: '2026-04-02' };
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
const selectedOf = (gantt: GanttInstance): readonly (string | number)[] =>
  gantt.getSnapshot().selection.tasks;

describe('selectedKeys and tasks that arrive later', () => {
  it('FR-REACT-1: controlled selectedKeys that name tasks not there yet are selected when the tasks arrive', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const keys = ['a', 'b'];
    const view = await renderInto(
      <Harness
        options={base({ tasks: [], selectedKeys: keys, onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual([]);

    // The same array of keys: it is the tasks that changed.
    await view.render(
      <Harness
        options={base({ tasks: TASKS, selectedKeys: keys, onSelectionChange })}
        capture={capture}
      />,
    );

    expect(selectedOf(latest())).toEqual(['a', 'b']);
    expect(onSelectionChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a key that names no task is not selected again and again', async () => {
    const { capture, latest } = collect();
    const keys = ['a', 'ghost'];
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );
    expect(selectedOf(latest())).toEqual(['a']);
    const select = vi.spyOn(chartOf(latest().core).gantt, 'select');

    await view.render(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );
    await view.render(
      <Harness
        options={base({ tasks: [...TASKS], selectedKeys: ['a', 'ghost'] })}
        capture={capture}
      />,
    );

    expect(select).not.toHaveBeenCalled();
    expect(selectedOf(latest())).toEqual(['a']);
    await view.unmount();
  });

  it('FR-REACT-1: a selection the chart lost with its tasks comes back with the tasks that return', async () => {
    const { capture, latest } = collect();
    const keys = ['a'];
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );
    expect(selectedOf(latest())).toEqual(['a']);

    await view.render(
      <Harness options={base({ tasks: [], selectedKeys: keys })} capture={capture} />,
    );
    expect(selectedOf(latest())).toEqual([]);
    await view.render(
      <Harness options={base({ tasks: TASKS, selectedKeys: keys })} capture={capture} />,
    );

    expect(selectedOf(latest())).toEqual(['a']);
    await view.unmount();
  });

  it('FR-REACT-1: defaultSelectedKeys that name tasks not there yet are selected when the tasks arrive', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const defaults = ['a', 'late'];
    const view = await renderInto(
      <Harness
        options={base({ tasks: [], defaultSelectedKeys: defaults, onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual([]);

    await view.render(
      <Harness
        options={base({ tasks: TASKS, defaultSelectedKeys: defaults, onSelectionChange })}
        capture={capture}
      />,
    );
    expect(selectedOf(latest())).toEqual(['a']);

    // The task it still waits for arrives later.
    await view.render(
      <Harness
        options={base({
          tasks: [...TASKS, LATE],
          defaultSelectedKeys: defaults,
          onSelectionChange,
        })}
        capture={capture}
      />,
    );

    expect(selectedOf(latest())).toEqual(['a', 'late']);
    expect(onSelectionChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('FR-REACT-1: a default selection never overrides what the user selected meanwhile', async () => {
    const { capture, latest } = collect();
    const defaults = ['a', 'late'];
    const view = await renderInto(
      <Harness options={base({ tasks: [], defaultSelectedKeys: defaults })} capture={capture} />,
    );
    await view.render(
      <Harness options={base({ tasks: TASKS, defaultSelectedKeys: defaults })} capture={capture} />,
    );
    expect(selectedOf(latest())).toEqual(['a']);

    act(() => {
      latest().select(['b']);
    });
    await view.render(
      <Harness
        options={base({ tasks: [...TASKS, LATE], defaultSelectedKeys: defaults })}
        capture={capture}
      />,
    );

    expect(selectedOf(latest())).toEqual(['b']);
    await view.unmount();
  });
});

describe('data that arrives later: tasks={data?.tasks}', () => {
  it('FR-REACT-5: tasks that go from undefined to a value make the chart controlled, apply them, and warn once', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={base({ tasks: undefined, editing: false })} capture={capture} />,
    );
    expect(latest().core.getSnapshot().state.options.dataMode).toBe('uncontrolled');
    expect(latest().getSnapshot().state.tasks).toEqual([]);

    await view.render(
      <Harness options={base({ tasks: TASKS, editing: false })} capture={capture} />,
    );

    expect(latest().core.getSnapshot().state.options.dataMode).toBe('controlled');
    expect(latest().getSnapshot().state.tasks).toBe(TASKS);
    expect(latest().getTask('a')?.name).toBe('A');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('`tasks`');
    expect(warn.mock.calls[0]?.[0]).toContain('undefined to');
    expect(warn.mock.calls[0]?.[0]).toContain('controlled from now on');

    // From now on it follows the prop like any controlled chart, and says nothing more.
    const next = [TASKS[1]!];
    await view.render(
      <Harness options={base({ tasks: next, editing: false })} capture={capture} />,
    );
    expect(latest().getSnapshot().state.tasks).toBe(next);
    expect(latest().getTask('a')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('FR-REACT-5: the upgrade is the same under StrictMode, and a production build says nothing', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={base({ editing: false })} capture={capture} />,
      {
        strict: true,
      },
    );
    await view.render(
      <Harness options={base({ tasks: TASKS, editing: false })} capture={capture} />,
    );

    expect(latest().core.getSnapshot().state.options.dataMode).toBe('controlled');
    expect(warn).toHaveBeenCalledTimes(1);
    await view.unmount();

    warn.mockClear();
    vi.stubEnv('NODE_ENV', 'production');
    const quiet = collect();
    const second = await renderInto(
      <Harness options={base({ editing: false })} capture={quiet.capture} />,
    );
    await second.render(
      <Harness options={base({ tasks: TASKS, editing: false })} capture={quiet.capture} />,
    );
    expect(quiet.latest().getTask('a')?.name).toBe('A');
    expect(warn).not.toHaveBeenCalled();
    await second.unmount();
  });

  it('FR-REACT-5: tasks that appear replace defaultTasks', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness options={base({ defaultTasks: [TASKS[0]!], editing: false })} capture={capture} />,
    );

    await view.render(
      <Harness
        options={base({ defaultTasks: [TASKS[0]!], tasks: [TASKS[1]!], editing: false })}
        capture={capture}
      />,
    );

    expect(latest().getTask('a')).toBeUndefined();
    expect(latest().getTask('b')?.name).toBe('B');
    await view.unmount();
  });

  it('FR-REACT-5: links that go from undefined to a list are applied the same way', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, links: undefined, editing: false })}
        capture={capture}
      />,
    );
    expect(latest().getLink('a:FS:b')).toBeUndefined();

    await view.render(
      <Harness options={base({ tasks: TASKS, links: LINKS, editing: false })} capture={capture} />,
    );

    expect(latest().getLink('a:FS:b')).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('`links`');
    await view.unmount();
  });

  it('FR-REACT-5: the other groups are not upgraded: a viewMode that appears later is still ignored', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week' })}
        capture={capture}
      />,
    );

    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultViewMode: 'week', viewMode: 'month' })}
        capture={capture}
      />,
    );

    expect(latest().getSnapshot().viewMode.id).toBe('week');
    expect(warn.mock.calls[0]?.[0]).toContain('stays uncontrolled');
    await view.unmount();
  });
});

describe('controlled tasks without a way to take a change', () => {
  it('FR-REACT-5: controlled tasks with editing on and no onTasksChange warn once in development', async () => {
    const { capture } = collect();
    const view = await renderInto(<Harness options={base({ tasks: TASKS })} capture={capture} />);

    await view.render(<Harness options={base({ tasks: [...TASKS] })} capture={capture} />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('onTasksChange');
    expect(warn.mock.calls[0]?.[0]).toContain('editing');
    await view.unmount();
  });

  it('FR-REACT-5: no warning when the handler is there, when editing cannot change a task, or when the tasks are the chart’s', async () => {
    const { capture } = collect();
    const onTasksChange = vi.fn();
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, onTasksChange })} capture={capture} />,
    );
    await view.render(
      <Harness options={base({ tasks: TASKS, editing: false })} capture={capture} />,
    );
    await view.render(
      <Harness
        options={base({ tasks: TASKS, editing: { move: false, resize: false, progress: false } })}
        capture={capture}
      />,
    );
    await view.unmount();
    const second = await renderInto(
      <Harness options={base({ defaultTasks: TASKS })} capture={capture} />,
    );

    expect(warn).not.toHaveBeenCalled();
    await second.unmount();
  });

  it('FR-REACT-5: a handler that goes away brings the warning back', async () => {
    const { capture } = collect();
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, onTasksChange: vi.fn() })} capture={capture} />,
    );
    expect(warn).not.toHaveBeenCalled();

    await view.render(<Harness options={base({ tasks: TASKS })} capture={capture} />);

    expect(warn).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe('controlled links over uncontrolled tasks', () => {
  it('FR-REACT-1: links the owner takes back do not wipe the undo history', async () => {
    function Owner({ capture }: { capture: (gantt: GanttInstance) => void }): ReactElement {
      const [links, setLinks] = useState<readonly { source: string; target: string }[]>(LINKS);
      const gantt = useGantt({
        ...base({ defaultTasks: TASKS, history: true }),
        links,
        onLinksChange: (next) => {
          setLinks(next as typeof links);
        },
      });
      capture(gantt);
      const { setContainer } = gantt;
      return <div ref={setContainer} />;
    }
    const { capture, latest } = collect();
    const view = await renderInto(<Owner capture={capture} />);
    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });
    expect(latest().canUndo).toBe(true);

    // The user draws a link, the owner keeps it: the core has it already, the prop agrees.
    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c' });
    });

    expect(latest().getLink('b:FS:c')).toBeDefined();
    expect(latest().canUndo).toBe(true);
    // Both entries are there: the link, then the move.
    act(() => {
      expect(latest().undo()).toMatchObject({ status: 'undone' });
    });
    expect(latest().getLink('b:FS:c')).toBeUndefined();
    expect(latest().canUndo).toBe(true);
    act(() => {
      expect(latest().undo()).toMatchObject({ status: 'undone' });
    });
    expect(startDay(latest(), 'a')).toBe(2);
    await view.unmount();
  });

  it('FR-REACT-1: links the owner does not take back are set back, which is a change', async () => {
    const { capture, latest } = collect();
    const links = [...LINKS];
    const view = await renderInto(
      <Harness options={base({ defaultTasks: TASKS, links, history: true })} capture={capture} />,
    );
    const chart = chartOf(latest().core);

    await act(async () => {
      await latest().addLink({ source: 'b', target: 'c' });
    });

    expect(latest().getLink('b:FS:c')).toBeUndefined();
    expect(chart.setOptions).toHaveBeenCalledWith({ links });
    await view.unmount();
  });

  it('FR-REACT-1: a link that comes from task.dependencies and is deleted sends the links nothing', async () => {
    const withDependency = [TASKS[0]!, { ...TASKS[1]!, dependencies: ['a'] }, TASKS[2]!, TASKS[3]!];
    const { capture, latest } = collect();
    const links = [{ source: 'b', target: 'c' }];
    const view = await renderInto(
      <Harness
        options={base({ defaultTasks: withDependency, links, history: true })}
        capture={capture}
      />,
    );
    const chart = chartOf(latest().core);
    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });
    expect(latest().canUndo).toBe(true);
    const dependency = latest()
      .getSnapshot()
      .state.derived.graph.links.find((link) => link.target === 'b');
    expect(dependency).toBeDefined();

    await act(async () => {
      await latest().removeLink(dependency!.id);
    });

    // The links the core has are the links the owner gave: there is nothing to put back.
    expect(chart.setOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ links: expect.anything() as unknown }),
    );
    expect(latest().canUndo).toBe(true);
    await view.unmount();
  });
});

describe('dropping the hierarchy prop', () => {
  it('FR-REACT-1: the parents the user collapsed stay collapsed', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({
          defaultTasks: TASKS,
          defaultExpandedKeys: ['p'],
          hierarchy: { moveChildren: 'none' },
        })}
        capture={capture}
      />,
    );
    expect(latest().getTask('p')?.isExpanded).toBe(true);
    act(() => {
      latest().collapse('p');
    });
    expect(latest().getTask('p')?.isExpanded).toBe(false);

    await view.render(
      <Harness
        options={base({ defaultTasks: TASKS, defaultExpandedKeys: ['p'] })}
        capture={capture}
      />,
    );

    expect(latest().getTask('p')?.isExpanded).toBe(false);
    // The option that was the prop's own is back to its default.
    expect(latest().core.getSnapshot().state.options.hierarchy?.moveChildren).toBeUndefined();
    await view.unmount();
  });

  it('FR-REACT-1: the parents a controlled expandedKeys holds stay as well', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(
      <Harness
        options={base({ tasks: TASKS, expandedKeys: [], hierarchy: { moveChildren: 'none' } })}
        capture={capture}
      />,
    );
    expect(latest().getTask('p')?.isExpanded).toBe(false);

    await view.render(
      <Harness options={base({ tasks: TASKS, expandedKeys: [] })} capture={capture} />,
    );

    expect(latest().getTask('p')?.isExpanded).toBe(false);
    await view.unmount();
  });
});

describe('tasks that change identity while a change waits for the owner', () => {
  /** A controlled chart whose owner has not taken the change yet. */
  async function withDraft(): Promise<{
    readonly view: Awaited<ReturnType<typeof renderInto>>;
    readonly latest: () => GanttInstance;
    readonly capture: (gantt: GanttInstance) => void;
    readonly onTasksChange: () => void;
  }> {
    const { capture, latest } = collect();
    const onTasksChange = vi.fn();
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, onTasksChange })} capture={capture} />,
    );
    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest().getSnapshot().state.draft?.committed).toBe(true);
    warn.mockClear();
    return { view, latest, capture, onTasksChange };
  }

  it('FR-REACT-1: the same array again keeps the draft, a new array (the owner’s answer) ends it', async () => {
    const { view, latest, capture, onTasksChange } = await withDraft();

    await view.render(
      <Harness options={base({ tasks: TASKS, onTasksChange })} capture={capture} />,
    );
    expect(latest().getSnapshot().state.draft).toBeDefined();

    // A failed save: the owner passes the tasks it has again, as a new array.
    await view.render(
      <Harness options={base({ tasks: [...TASKS], onTasksChange })} capture={capture} />,
    );
    expect(latest().getSnapshot().state.draft).toBeUndefined();
    expect(startDay(latest(), 'a')).toBe(2);
    await view.unmount();
  });

  it('FR-REACT-5: an array that is new but equal is reported once in development, since it ends the draft', async () => {
    const { view, capture, onTasksChange } = await withDraft();

    await view.render(
      <Harness options={base({ tasks: [...TASKS], onTasksChange })} capture={capture} />,
    );
    await view.render(
      <Harness options={base({ tasks: [...TASKS], onTasksChange })} capture={capture} />,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('draft');
    expect(warn.mock.calls[0]?.[0]).toMatch(/memoize/i);
    await view.unmount();
  });

  it('FR-REACT-5: no report while no change waits, or when the content is new', async () => {
    const { capture, latest } = collect();
    const onTasksChange = vi.fn();
    const view = await renderInto(
      <Harness options={base({ tasks: TASKS, onTasksChange })} capture={capture} />,
    );

    await view.render(
      <Harness options={base({ tasks: [...TASKS], onTasksChange })} capture={capture} />,
    );
    expect(warn).not.toHaveBeenCalled();

    await act(async () => {
      await latest().updateTask('a', { start: '2026-03-03' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest().getSnapshot().state.draft).toBeDefined();
    // The owner saved it and passes the tasks with the change: new content, the draft is theirs.
    const saved: readonly Task[] = TASKS.map((task) =>
      task.id === 'a' ? { ...task, start: '2026-03-03', end: '2026-03-07' } : task,
    );
    await view.render(
      <Harness options={base({ tasks: saved, onTasksChange })} capture={capture} />,
    );

    expect(warn).not.toHaveBeenCalled();
    await view.unmount();
  });
});

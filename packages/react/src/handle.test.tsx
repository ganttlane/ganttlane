import type { Task } from '@ganttlane/dom';
import type { ReactElement, Ref } from 'react';
import { act, createRef, StrictMode, useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import {
  cleanUpDocument,
  createManualFrames,
  type ManualFrames,
  renderInto,
  stubScrollerSize,
} from './testing';
import { chartOf, charts, forgetCharts } from './testing/charts';
import type { GanttHandle, GanttInstance } from './types';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const NOW = (): string => '2026-03-04';

let frames: ManualFrames;

beforeEach(() => {
  frames = createManualFrames();
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
  forgetCharts();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

describe('<Gantt ref> (FR-REACT-3)', () => {
  it('FR-REACT-3: the ref is the handle of the chart: the methods of docs/api.md §6', async () => {
    const ref = createRef<GanttHandle>();
    const view = await renderInto(
      <Gantt ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames }} />,
    );
    const handle = ref.current!;

    for (const method of [
      'setTasks',
      'setLinks',
      'updateTask',
      'addLink',
      'removeLink',
      'setOptions',
      'setViewMode',
      'zoomTo',
      'scrollToDate',
      'scrollToToday',
      'scrollToTask',
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
      'getIssues',
      'hideTooltip',
      'undo',
      'redo',
      'on',
      'getSnapshot',
      'subscribe',
    ] as const) {
      expect(typeof handle[method], method).toBe('function');
    }
    expect(typeof handle.edit.begin).toBe('function');
    expect(handle.canUndo).toBe(false);
    expect(handle.core.getSnapshot()).toBe(handle.getSnapshot());
    // Not the chart's to end: React does.
    expect('destroy' in handle).toBe(false);
    await view.unmount();
  });

  it('FR-REACT-3: the methods act on the chart that is drawn', async () => {
    const ref = createRef<GanttHandle>();
    const onSelectionChange = vi.fn();
    const onTasksChange = vi.fn();
    const view = await renderInto(
      <Gantt
        ref={ref}
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        editing
        onSelectionChange={onSelectionChange}
        onTasksChange={onTasksChange}
      />,
    );
    const handle = ref.current!;
    expect(handle.getTask('a')?.name).toBe('A');

    handle.select(['b']);
    frames.step();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector('.gantt__bar[data-task-id="b"]')?.hasAttribute('data-selected'),
    ).toBe(true);

    // The hooks of the core may be asynchronous: the answer is a promise.
    const updated = await act(async () =>
      handle.updateTask('a', { end: new Date(Date.UTC(2026, 2, 12)) }),
    );
    expect(updated).toMatchObject({ status: 'committed' });
    expect(onTasksChange).toHaveBeenCalledTimes(1);
    frames.step();
    expect(handle.getTask('a')?.endExclusive?.getTime()).toBeGreaterThan(Date.UTC(2026, 2, 7));

    handle.setViewMode('week');
    frames.step();
    expect(handle.getSnapshot().viewMode.id).toBe('week');

    expect(handle.edit.begin()).toMatchObject({ status: 'begun' });
    expect(handle.edit.isOpen).toBe(true);
    expect(handle.edit.rollback()).toMatchObject({ status: 'rolled-back' });
    await view.unmount();
  });

  it('FR-REACT-3: it is the same object every render, and the instance useGantt makes', async () => {
    const seen: GanttHandle[] = [];
    function Plan({ count }: { count: number }): ReactElement {
      const ref = useRef<GanttHandle>(null);
      useLayoutEffect(() => {
        if (ref.current) seen.push(ref.current);
      });
      return (
        <Gantt
          ref={ref}
          defaultTasks={TASKS}
          now={NOW}
          renderer={{ frames }}
          theme={count > 1 ? 'dark' : 'light'}
        />
      );
    }
    const view = await renderInto(<Plan count={0} />);
    await view.render(<Plan count={1} />);
    await view.render(<Plan count={2} />);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
    // Its core is the chart's, not a copy: the one `instance.core` is, which stands for it.
    expect(seen[0]?.core.getSnapshot()).toBe(charts[0]?.gantt.core.getSnapshot());
    await view.unmount();
  });

  it('FR-REACT-3: ref.current is the handle inside the handlers of the first events, which are let through after the commit', async () => {
    const ref = createRef<GanttHandle>();
    const seen: [string, GanttHandle | null][] = [];
    const view = await renderInto(
      <Gantt
        ref={ref}
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
        tooltip={{ trigger: 'nope' as never }}
        onIssues={() => {
          seen.push(['issues', ref.current]);
        }}
        onRangeChange={() => {
          seen.push(['range', ref.current]);
        }}
      />,
    );

    expect(seen.map(([name]) => name)).toEqual(['issues', 'range']);
    for (const [, handle] of seen) {
      expect(handle).not.toBeNull();
      expect(handle).toBe(ref.current);
    }
    // And the handle works from inside them: the chart is in its first state.
    expect(ref.current?.getTask('a')?.name).toBe('A');
    await view.unmount();
  });

  it('FR-REACT-3: the same under StrictMode, where the effects run twice', async () => {
    const ref = createRef<GanttHandle>();
    const seen: (GanttHandle | null)[] = [];
    const view = await renderInto(
      <StrictMode>
        <Gantt
          ref={ref}
          defaultTasks={TASKS}
          now={NOW}
          renderer={{ frames }}
          onRangeChange={() => {
            seen.push(ref.current);
          }}
        />
      </StrictMode>,
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const handle of seen) expect(handle).toBe(ref.current);
    await view.unmount();
  });

  it('FR-REACT-3: what is for React is not on the handle at run time either, and the handle is frozen', async () => {
    const ref = createRef<GanttHandle>();
    const view = await renderInto(
      <Gantt ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames }} />,
    );
    const handle = ref.current!;

    expect('setContainer' in handle).toBe(false);
    expect('slots' in handle).toBe(false);
    expect('destroy' in handle).toBe(false);
    expect(Object.keys(handle)).not.toContain('setContainer');
    expect(Object.isFrozen(handle)).toBe(true);
    // The rest is the instance's, working.
    expect(handle.getTask('b')?.name).toBe('B');
    expect(handle.canUndo).toBe(false);
    expect(handle.core.getSnapshot()).toBe(handle.getSnapshot());
    handle.select(['a']);
    expect(handle.getSnapshot().selection.tasks).toEqual(['a']);
    expect(handle.edit.begin()).toMatchObject({ status: 'begun' });
    expect(handle.edit.isOpen).toBe(true);
    await view.unmount();
  });

  it('FR-REACT-3: it is set before the layout effects of the parent, which may use it at once, and is null once the chart is gone', async () => {
    const ref = createRef<GanttHandle>();
    const atLayout: (GanttHandle | null)[] = [];
    function Plan(): ReactElement {
      useLayoutEffect(() => {
        atLayout.push(ref.current);
        // The chart can be asked at once, for example to scroll it.
        ref.current?.scrollToTask('b');
      }, []);
      return <Gantt ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames }} />;
    }
    const view = await renderInto(<Plan />);
    expect(atLayout).toHaveLength(1);
    expect(atLayout[0]).not.toBeNull();
    expect(atLayout[0]).toBe(ref.current);

    await view.unmount();

    expect(ref.current).toBeNull();
  });

  it('FR-REACT-3: a callback ref gets the handle, and null when the chart goes', async () => {
    const calls: (GanttHandle | null)[] = [];
    const view = await renderInto(
      <Gantt
        ref={(handle) => {
          calls.push(handle);
        }}
        defaultTasks={TASKS}
        now={NOW}
        renderer={{ frames }}
      />,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toBeNull();

    await view.unmount();

    expect(calls.at(-1)).toBeNull();
  });

  it('FR-REACT-3, FR-REACT-5: under StrictMode the handle is still the one chart, and it works', async () => {
    const ref = createRef<GanttHandle>();
    const view = await renderInto(
      <StrictMode>
        <Gantt ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames }} />
      </StrictMode>,
    );

    expect(ref.current).not.toBeNull();
    expect(chartOf(ref.current?.core).gantt.core.getSnapshot()).toBe(ref.current?.getSnapshot());
    expect(ref.current?.getTask('b')?.name).toBe('B');
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);
    await view.unmount();
    expect(ref.current).toBeNull();
  });

  it('FR-REACT-3: the handle of a chart that was made again (a new key) is the new chart’s', async () => {
    const ref = createRef<GanttHandle>();
    const view = await renderInto(
      <Gantt key="one" ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames }} />,
    );
    const first = ref.current;

    await view.render(
      <Gantt
        key="two"
        ref={ref}
        defaultTasks={[TASKS[1]!]}
        now={NOW}
        renderer={{ frames: createManualFrames() }}
      />,
    );

    expect(ref.current).not.toBe(first);
    expect(ref.current?.getTask('a')).toBeUndefined();
    expect(ref.current?.getTask('b')?.name).toBe('B');
    await view.unmount();
  });

  it('FR-API-6: the handle is typed with TData, and its type is not the instance of the hook', () => {
    interface Row {
      readonly team: string;
    }
    const tasks: readonly Task<Row>[] = [
      { id: 1, name: 'x', start: '2026-03-02', end: '2026-03-03', data: { team: 'a' } },
    ];
    const typed = createRef<GanttHandle<Row>>();

    // A JSX expression, checked by the compiler: the handle's `getTask` answers with a `Row`.
    const element = <Gantt ref={typed} defaultTasks={tasks} />;
    expect(element).toBeDefined();
    expectTypeOf<
      NonNullable<ReturnType<GanttHandle<Row>['getTask']>>['task']['data']
    >().toEqualTypeOf<Row | undefined>();
    // A handle of another `TData` is refused by the compiler.
    const wrong = createRef<GanttHandle<{ other: number }>>();
    // @ts-expect-error the handle's `TData` is `{ other: number }`, the chart's is `Row`
    const bad = <Gantt ref={wrong} defaultTasks={tasks} />;
    expect(bad).toBeDefined();
    // What is for React stays out of the handle.
    expectTypeOf<GanttHandle>().not.toHaveProperty('setContainer');
    expectTypeOf<GanttHandle>().not.toHaveProperty('slots');
    expectTypeOf<GanttHandle>().not.toHaveProperty('destroy');
    expectTypeOf<GanttInstance>().toHaveProperty('setContainer');
    expectTypeOf<Ref<GanttHandle<Row>>>().not.toEqualTypeOf<Ref<GanttHandle>>();
  });
});

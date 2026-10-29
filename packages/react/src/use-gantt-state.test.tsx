import { createGanttCore } from '@ganttlane/core';
import type { ReactElement } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';
import { collect, Harness } from './testing/harness';
import type { GanttInstance, GanttReactOptions, SnapshotSource } from './types';
import { useGanttState } from './use-gantt-state';

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
];
const NOW = (): string => '2026-03-04';

beforeEach(() => {
  vi.useFakeTimers();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

function options(extra: Partial<GanttReactOptions> = {}): GanttReactOptions {
  return { defaultTasks: TASKS, now: NOW, renderer: { frames: createManualFrames() }, ...extra };
}

/** What a {@link Reader} rendered with: every selection it got, in order. */
interface Probe<T> {
  readonly seen: T[];
  readonly onRender: (value: T) => void;
  /** How many times the reader rendered. */
  readonly renders: number;
  /** The selection of its latest render. */
  readonly value: T | undefined;
}

function probe<T>(): Probe<T> {
  const seen: T[] = [];
  return {
    seen,
    onRender: (value) => {
      seen.push(value);
    },
    get renders() {
      return seen.length;
    },
    get value() {
      return seen.at(-1);
    },
  };
}

/** A component that reads a slice of the chart and reports what it rendered with. */
function Reader<T>({
  instance,
  selector,
  isEqual,
  probe: reported,
}: {
  instance: SnapshotSource;
  selector: Parameters<typeof useGanttState<unknown, T>>[1];
  isEqual?: (a: T, b: T) => boolean;
  probe: Probe<T>;
}): ReactElement {
  const value = useGanttState(instance, selector, isEqual);
  reported.onRender(value);
  return <span>{String(value)}</span>;
}

describe('useGanttState', () => {
  it('FR-REACT-6: it reads a slice of the snapshot and follows it', async () => {
    const { capture, latest } = collect();
    const tasks = probe<readonly (string | number)[]>();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    await view.render(
      <>
        <Harness options={options()} capture={capture} />
        <Reader instance={instance} selector={(s) => s.selection.tasks} probe={tasks} />
      </>,
    );
    expect(tasks.value).toEqual([]);

    act(() => {
      instance.select(['a']);
    });
    expect(tasks.value).toEqual(['a']);
    act(() => {
      instance.select(['a', 'b']);
    });
    expect(tasks.value).toEqual(['a', 'b']);
    await view.unmount();
  });

  it('FR-REACT-6: a component re-renders only when the slice it selects changes', async () => {
    const { capture, latest } = collect();
    const mode = probe<string>();
    const selected = probe<readonly (string | number)[]>();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    await view.render(
      <>
        <Harness options={options()} capture={capture} />
        <Reader instance={instance} selector={(s) => s.viewMode.id} probe={mode} />
        <Reader instance={instance} selector={(s) => s.selection.tasks} probe={selected} />
      </>,
    );
    const modeBefore = mode.renders;
    const selectedBefore = selected.renders;

    act(() => {
      instance.select(['a']);
    });
    expect(selected.renders).toBe(selectedBefore + 1);
    expect(mode.renders).toBe(modeBefore);

    // The snapshot changes (a scroll, a layout option) and these slices do not.
    act(() => {
      instance.core.scroll({ left: 120, top: 0 });
      instance.setOptions({ layout: { rowHeight: 44 } });
    });
    expect(mode.renders).toBe(modeBefore);
    expect(selected.renders).toBe(selectedBefore + 1);

    act(() => {
      instance.setViewMode('week');
    });
    expect(mode.value).toBe('week');
    expect(mode.renders).toBe(modeBefore + 1);
    expect(selected.renders).toBe(selectedBefore + 1);
    await view.unmount();
  });

  it('FR-REACT-6: a selector written inline is no reason to render, and neither is an equal selection', async () => {
    const { capture, latest } = collect();
    const counted = probe<{ count: number }>();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    // A new object every time, equal by its content: `isEqual` keeps the last one.
    const tree = (
      <>
        <Harness options={options()} capture={capture} />
        <Reader
          instance={instance}
          selector={(snapshot) => ({ count: snapshot.selection.tasks.length })}
          isEqual={(a, b) => a.count === b.count}
          probe={counted}
        />
      </>
    );
    await view.render(tree);
    const first = counted.value;
    const before = counted.renders;

    act(() => {
      instance.select(['a']);
    });
    expect(counted.value).toEqual({ count: 1 });
    expect(counted.value).not.toBe(first);
    const afterSelect = counted.renders;
    expect(afterSelect).toBe(before + 1);

    // The selection changes, the count does not: the same object, no render.
    const same = counted.value;
    act(() => {
      instance.select(['b']);
    });
    expect(counted.value).toBe(same);
    expect(counted.renders).toBe(afterSelect);
    await view.unmount();
  });

  it('FR-REACT-6: the default isEqual is Object.is: parts of the snapshot keep their identity until they change', async () => {
    const { capture, latest } = collect();
    const tasks = probe<unknown>();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance = latest();
    await view.render(
      <>
        <Harness options={options()} capture={capture} />
        <Reader instance={instance} selector={(s) => s.state.tasks} probe={tasks} />
      </>,
    );
    const first = tasks.value;
    const before = tasks.renders;

    act(() => {
      instance.select(['a']);
      instance.core.scroll({ left: 80, top: 0 });
    });

    expect(tasks.value).toBe(first);
    expect(tasks.renders).toBe(before);
    await view.unmount();
  });

  it('FR-REACT-6: it reads from a core made with createGanttCore as well', async () => {
    const core = createGanttCore({ tasks: TASKS, now: NOW });
    const count = probe<number>();
    const view = await renderInto(
      <Reader instance={core} selector={(s) => s.state.tasks.length} probe={count} />,
    );
    expect(count.value).toBe(2);

    act(() => {
      core.setTasks([...TASKS, { id: 'c', name: 'C', start: '2026-03-10', end: '2026-03-12' }]);
    });

    expect(count.value).toBe(3);
    await view.unmount();
    core.destroy();
  });

  it('FR-REACT-6: it subscribes once per component while mounted, and stops when it goes', async () => {
    const { capture, latest } = collect();
    const view = await renderInto(<Harness options={options()} capture={capture} />);
    const instance: GanttInstance = latest();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: () => void) => {
      const stop = instance.subscribe(listener);
      return () => {
        unsubscribe();
        stop();
      };
    });
    const source: SnapshotSource = { getSnapshot: instance.getSnapshot, subscribe };
    const length = probe<number>();

    await view.render(
      <>
        <Harness options={options()} capture={capture} />
        <Reader instance={source} selector={(s) => s.selection.tasks.length} probe={length} />
      </>,
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    await view.render(<Harness options={options()} capture={capture} />);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const before = length.renders;
    act(() => {
      instance.select(['a']);
    });
    expect(length.renders).toBe(before);
    await view.unmount();
  });
});

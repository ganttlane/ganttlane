import type { ReactElement } from 'react';
import * as React from 'react';
import { act, createRef } from 'react';
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
import type { GanttHandle, GanttInstance, GanttReactOptions } from './types';
import { useGanttState } from './use-gantt-state';

vi.mock('@ganttlane/dom/facade', async (importOriginal) => {
  const { wrapFacade } = await import('./testing/charts');
  return wrapFacade(await importOriginal());
});

/** `<Activity>` is React 19.2+; the package itself needs nothing of it. */
const Activity = (
  React as unknown as {
    Activity?: (props: { mode: 'visible' | 'hidden'; children: React.ReactNode }) => ReactElement;
  }
).Activity;

const TASKS = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 10 },
  { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
  { id: 'p', name: 'P', start: '2026-03-16', end: '2026-03-27' },
  { id: 'c', name: 'C', parentId: 'p', start: '2026-03-17', end: '2026-03-20' },
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

describe.skipIf(Activity === undefined)('a chart in a hidden <Activity>', () => {
  const page = (mode: 'visible' | 'hidden', node: ReactElement): ReactElement => {
    const Wrapper = Activity!;
    return <Wrapper mode={mode}>{node}</Wrapper>;
  };

  it('FR-REACT-5: hiding removes the chart and ends its core; showing makes it again with its state', async () => {
    const { capture, latest } = collect();
    const harness = (extra: Partial<GanttReactOptions> = {}): ReactElement => (
      <Harness options={options(extra)} capture={capture} />
    );
    const view = await renderInto(page('visible', harness()));
    const instance = latest();
    const first = chartOf(instance.core);
    await act(async () => {
      await instance.updateTask('a', { start: '2026-03-03' });
    });
    act(() => {
      instance.select(['b']);
      instance.setViewMode('week');
      instance.collapse('p');
    });
    // Scrolled away from where the chart opens: the left edge date is what comes back.
    act(() => {
      instance.core.scroll({ left: 400, top: 0 });
    });
    const edge = instance.getVisibleRange().start.getTime();
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);

    await view.render(page('hidden', harness()));

    expect(view.container.querySelector('.gantt')).toBeNull();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    await view.render(page('visible', harness()));

    // The same instance, a new core, the state of the old one.
    expect(latest()).toBe(instance);
    expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);
    const second = chartOf(instance.core);
    expect(second).not.toBe(first);
    expect(second.destroy).not.toHaveBeenCalled();
    expect(instance.getSnapshot().selection.tasks).toEqual(['b']);
    expect(instance.getSnapshot().viewMode.id).toBe('week');
    expect(instance.getTask('a')?.start?.getDate()).toBe(3);
    expect(instance.getTask('p')?.isExpanded).toBe(false);
    expect(instance.core.getSnapshot().timeline.viewportWidth).toBe(800);
    expect(instance.getVisibleRange().start.getTime()).toBe(edge);
    await view.unmount();
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(charts.length).toBe(2);
  });

  it('FR-REACT-5: the listeners and subscribers of the instance move to the new core, and the handlers stay current', async () => {
    const { capture, latest } = collect();
    const onSelectionChange = vi.fn();
    const onIssues = vi.fn();
    const seen: unknown[] = [];
    const Reader = ({ instance }: { instance: GanttInstance }): ReactElement => {
      const selected = useGanttState(instance, (snapshot) => snapshot.selection.tasks);
      seen.push(selected);
      return <b>{selected.join(',')}</b>;
    };
    const harness = (): ReactElement => (
      <Harness
        options={options({ onSelectionChange, onIssues, tooltip: { trigger: 'nope' as never } })}
        capture={capture}
      />
    );
    const view = await renderInto(page('visible', harness()));
    const instance = latest();
    const listener = vi.fn();
    instance.on('selectionChange', listener);
    await view.render(
      <>
        {page('visible', harness())}
        <Reader instance={instance} />
      </>,
    );
    expect(onIssues).toHaveBeenCalledTimes(1);

    await view.render(
      <>
        {page('hidden', harness())}
        <Reader instance={instance} />
      </>,
    );
    await view.render(
      <>
        {page('visible', harness())}
        <Reader instance={instance} />
      </>,
    );
    // What the chart said while it was made again, the application has heard once already.
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).not.toHaveBeenCalled();

    act(() => {
      instance.select(['a']);
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual(['a']);
    expect(view.container.querySelector('b')?.textContent).toBe('a');
    // Unsubscribing a listener of the first core still works, and does not touch the new one.
    await view.unmount();
  });

  it('FR-REACT-5: props that changed while it was hidden are applied when it is shown, with no echo', async () => {
    const { capture, latest } = collect();
    const harness = (extra: Partial<GanttReactOptions>): ReactElement => (
      <Harness options={options(extra)} capture={capture} />
    );
    const view = await renderInto(page('visible', harness({ locale: 'en', tasks: TASKS })));

    await view.render(page('hidden', harness({ locale: 'uk', tasks: TASKS })));
    await view.render(page('visible', harness({ locale: 'uk', tasks: TASKS })));

    // The new core is made from the latest props: nothing is left to send.
    expect(latest().core.getSnapshot().header.locale).toBe('uk');
    expect(chartOf(latest().core).setOptions).not.toHaveBeenCalled();
    expect(latest().getSnapshot().state.tasks).toBe(TASKS);
    await view.unmount();
  });

  it('FR-REACT-5: useGanttState(instance.core) goes on after the chart was shown again: instance.core is one object', async () => {
    const { capture, latest } = collect();
    const seen: unknown[] = [];
    const Reader = ({ source }: { source: GanttInstance['core'] }): ReactElement => {
      const selected = useGanttState(source, (snapshot) => snapshot.selection.tasks);
      seen.push(selected);
      return <b>{selected.join(',')}</b>;
    };
    const harness = (): ReactElement => <Harness options={options()} capture={capture} />;
    const view = await renderInto(page('visible', harness()));
    const instance = latest();
    const { core } = instance;
    const page2 = (mode: 'visible' | 'hidden'): ReactElement => (
      <>
        {page(mode, harness())}
        <Reader source={core} />
      </>
    );
    await view.render(page2('visible'));
    act(() => {
      instance.select(['a']);
    });
    expect(view.container.querySelector('b')?.textContent).toBe('a');

    await view.render(page2('hidden'));
    await view.render(page2('visible'));

    expect(instance.core).toBe(core);
    act(() => {
      instance.select(['b']);
    });
    expect(view.container.querySelector('b')?.textContent).toBe('b');
    act(() => {
      core.select(['a', 'b']);
    });
    expect(view.container.querySelector('b')?.textContent).toBe('a,b');
    await view.unmount();
  });

  it('FR-REACT-5: while it is hidden the chart is gone: the instance’s commands do nothing, its queries answer, and ref.current is null', async () => {
    const ref = createRef<GanttHandle>();
    const chart = (): ReactElement => (
      <Gantt ref={ref} defaultTasks={TASKS} now={NOW} renderer={{ frames: createManualFrames() }} />
    );
    const view = await renderInto(page('visible', chart()));
    const handle = ref.current!;
    handle.select(['a']);

    await view.render(page('hidden', chart()));

    // React detaches the ref of a hidden tree; the handle someone kept still answers and ignores commands.
    expect(ref.current).toBeNull();
    expect(() => {
      handle.select(['b']);
      handle.collapse('p');
      void handle.updateTask('a', { start: '2026-03-03' });
    }).not.toThrow();
    expect(handle.getSnapshot().selection.tasks).toEqual(['a']);
    expect(handle.getTask('a')?.start?.getDate()).toBe(2);

    await view.render(page('visible', chart()));

    expect(ref.current).toBe(handle);
    expect(handle.getSnapshot().selection.tasks).toEqual(['a']);
    expect(handle.getTask('a')?.start?.getDate()).toBe(2);
    await view.unmount();
  });

  it('FR-REACT-5: a chart hidden with an edit session open ends it as a Cancel would, and the application hears of it when it is shown', async () => {
    const { capture, latest } = collect();
    const onEditRollback = vi.fn();
    const onDirtyChange = vi.fn();
    const harness = (): ReactElement => (
      <Harness
        options={options({ editing: true, onEditRollback, onDirtyChange })}
        capture={capture}
      />
    );
    const view = await renderInto(page('visible', harness()));
    const instance = latest();
    instance.edit.begin();
    await act(async () => {
      await instance.updateTask('a', { start: '2026-03-03' });
    });
    onDirtyChange.mockClear();

    await view.render(page('hidden', harness()));
    expect(onEditRollback).not.toHaveBeenCalled();
    expect(onDirtyChange).not.toHaveBeenCalled();
    await view.render(page('visible', harness()));

    expect(onDirtyChange).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenCalledWith({ isDirty: false });
    expect(onEditRollback).toHaveBeenCalledTimes(1);
    expect(onEditRollback.mock.calls[0]?.[0]).toMatchObject({ reason: 'rollback' });
    expect(instance.edit.isOpen).toBe(false);
    expect(instance.getTask('a')?.start?.getDate()).toBe(2);
    await view.unmount();
  });

  it('FR-REACT-5: it can be hidden and shown again and again', async () => {
    const { capture, latest } = collect();
    const harness = (): ReactElement => <Harness options={options()} capture={capture} />;
    const view = await renderInto(page('visible', harness()));
    act(() => {
      latest().select(['a']);
    });

    for (let round = 0; round < 3; round++) {
      await view.render(page('hidden', harness()));
      expect(view.container.querySelector('.gantt')).toBeNull();
      await view.render(page('visible', harness()));
      expect(view.container.querySelectorAll('.gantt')).toHaveLength(1);
    }

    expect(latest().getSnapshot().selection.tasks).toEqual(['a']);
    await view.unmount();
    expect(tracker.alive()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

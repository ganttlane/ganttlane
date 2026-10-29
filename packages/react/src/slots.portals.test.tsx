import type { PointerInput, Task } from '@ganttlane/dom';
import { act, createRef } from 'react';
import * as ReactDOM from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';
import type { GanttHandle } from './types';

/**
 * What a change to one host costs (plan step 5.3 review, FR-REACT-4, NFR-PERF-1): every host has
 * a subscription of its own, so a label that changes draws the portal of that label, not those of
 * all the labels of the window. Counted in the portals React is asked to draw
 * (`createPortal` calls): in a file of its own, as the module `react-dom` is replaced here.
 */

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOM>();
  return { ...actual, createPortal: vi.fn(actual.createPortal) };
});

const BARS = 40;
const TASKS: readonly Task[] = Array.from({ length: BARS }, (_, i) => ({
  id: `t${String(i)}`,
  name: `Task ${String(i)}`,
  start: '2026-03-02',
  end: '2026-03-06',
  progress: 10,
}));

beforeEach(() => {
  vi.useFakeTimers();
  // Every row is in the window.
  stubScrollerSize(800, BARS * 48);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanUpDocument();
});

const pointer = (
  type: PointerInput['type'],
  at: { x: number; y: number },
  target?: PointerInput['target'],
): PointerInput => ({ type, pointerId: 1, ...at, time: 0, ...(target && { target }) });

describe('a change of one host draws one portal (FR-REACT-4, NFR-PERF-1)', () => {
  it('NFR-PERF-1: a progress drag of one bar asks React for one portal a step, however many labels are drawn', async () => {
    const frames = createManualFrames();
    const handle = createRef<GanttHandle>();
    const labels = vi.fn(({ progress }: { progress: number }) => <i>{Math.round(progress)}</i>);
    const view = await renderInto(
      <Gantt
        ref={handle}
        defaultTasks={TASKS}
        now={() => '2026-03-04'}
        renderer={{ frames }}
        display={{ barLabel: 'inside' }}
        renderBarLabel={labels}
      />,
    );
    await act(async () => {
      frames.step();
      await Promise.resolve();
    });
    expect(view.container.querySelectorAll('.gantt__bar-label [data-slot]')).toHaveLength(BARS);
    const portal = vi.mocked(ReactDOM.createPortal);
    const bar = handle.current!.getBarRect('t7')!;
    const y = bar.y + bar.height;
    const x = bar.x + bar.progressWidth;
    await act(async () => {
      handle.current!.core.send(
        pointer('down', { x, y }, { kind: 'task', id: 't7', part: 'progress' }),
      );
      await Promise.resolve();
    });

    const portals: number[] = [];
    const drawn: number[] = [];
    for (const dx of [30, 70, 110, 150]) {
      const portalsBefore = portal.mock.calls.length;
      const drawnBefore = labels.mock.calls.length;
      await act(async () => {
        handle.current!.core.send(pointer('move', { x: x + dx, y }));
        frames.step();
        await Promise.resolve();
      });
      portals.push(portal.mock.calls.length - portalsBefore);
      drawn.push(labels.mock.calls.length - drawnBefore);
    }

    // The label that changed is asked of the application, and its portal of React: nothing else.
    expect(drawn.every((count) => count <= 1)).toBe(true);
    expect(drawn.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(2);
    expect(portals).toEqual(drawn);
    expect(view.container.querySelector('[data-task-id="t7"] [data-slot]')?.textContent).not.toBe(
      '10',
    );
    await view.unmount();
  });

  it('NFR-PERF-1: a label that comes or goes draws the list of hosts, and the portals of the others stay as they are', async () => {
    const frames = createManualFrames();
    const handle = createRef<GanttHandle>();
    const view = await renderInto(
      <Gantt
        ref={handle}
        defaultTasks={TASKS}
        now={() => '2026-03-04'}
        renderer={{ frames }}
        display={{ barLabel: 'inside' }}
        renderBarLabel={({ name }) => <i>{name}</i>}
      />,
    );
    await act(async () => {
      frames.step();
      await Promise.resolve();
    });
    const hosts = [...view.container.querySelectorAll('[data-slot="barLabel"]')];
    expect(hosts).toHaveLength(BARS);

    // A bar leaves the window: its host goes, and the others are the hosts they were.
    await act(async () => {
      handle.current!.core.scroll({ left: 0, top: 30 * 48 });
      frames.step();
      await Promise.resolve();
    });

    const after = [...view.container.querySelectorAll('[data-slot="barLabel"]')];
    expect(after.length).toBeLessThan(BARS);
    expect(after.every((host) => hosts.includes(host))).toBe(true);
    await view.unmount();
  });
});

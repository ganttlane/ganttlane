import type { PointerInput, Task } from '@ganttlane/dom';
import type { ReactElement } from 'react';
import { act, createRef, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gantt } from './Gantt';
import { cleanUpDocument, createManualFrames, renderInto, stubScrollerSize } from './testing';
import type { GanttHandle } from './types';

/**
 * Budgets of plan step 5.3 for the bar labels, which are the only slot that comes in numbers: one
 * portal per drawn bar. A chart whose window holds a few hundred bars mounts a portal for each,
 * and a scroll that brings in a window of new bars mounts a window of new portals and unmounts the
 * old ones. The numbers are JavaScript time in a DOM without layout (React DOM and the renderer,
 * no style, layout or paint: `e2e/react-slots.spec.ts` counts the portals in real browsers, and
 * the playground page `/react/?slots=1` is where to look at the frame times there). The
 * assertions are generous so that slow CI machines pass; the measured values are attached to the
 * test report. Runs in `pnpm test:perf` only.
 *
 * A change to one label is the other number that matters: each host has a subscription of its own,
 * so one label of 300 that changes (a progress drag) costs about what one text label costs, not a
 * reconcile of all 300 portals. The baseline is the same chart with the chart's own text labels.
 */
const BARS = 300;
const TARGETS = { mount: 600, swap: 600 } as const;
/** How much a step of a drag with 300 React labels may cost against 300 text labels. */
const CHANGE_RATIO = 2.2;
/** Added to the baseline, for the steps that are short enough for a timer's noise to matter. */
const CHANGE_SLACK_MS = 0.5;

let mounted = 0;

function Label({ name }: { name: string }): ReactElement {
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
  return <b>{name}</b>;
}

beforeEach(() => {
  mounted = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanUpDocument();
});

describe('bar labels as portals (FR-REACT-4)', () => {
  it('NFR-PERF-1: a window of bars mounts one portal each, and a new window replaces them, leaving none behind', async ({
    annotate,
  }) => {
    // Every task overlaps the viewport horizontally, so the window is as tall as the viewport.
    const tasks: Task[] = Array.from({ length: BARS * 2 }, (_, i) => ({
      id: `t${i}`,
      name: `Task ${i}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    // The window holds BARS rows plus the overscan.
    stubScrollerSize(800, BARS * 48);
    const frames = createManualFrames();
    const handle = createRef<GanttHandle>();

    const begin = performance.now();
    const view = await renderInto(
      <Gantt
        ref={handle}
        defaultTasks={tasks}
        now={() => '2026-03-04'}
        renderer={{ frames }}
        display={{ barLabel: 'inside' }}
        renderBarLabel={({ name }) => <Label name={name} />}
      />,
    );
    await act(async () => {
      frames.step();
      await Promise.resolve();
    });
    const mountMs = performance.now() - begin;
    const drawn = view.container.querySelectorAll('.gantt__bar').length;
    expect(drawn).toBeGreaterThanOrEqual(BARS);
    expect(mounted).toBe(drawn);

    // A scroll that moves the whole window: every bar leaves, a window of new ones enters.
    const swapBegin = performance.now();
    await act(async () => {
      handle.current!.core.scroll({ left: 0, top: (BARS + 40) * 48 });
      frames.step();
      await Promise.resolve();
    });
    const swapMs = performance.now() - swapBegin;
    const after = view.container.querySelectorAll('.gantt__bar').length;
    expect(after).toBeGreaterThan(0);
    expect(mounted).toBe(after);
    expect(view.container.querySelectorAll('.gantt__bar-label [data-slot]')).toHaveLength(after);

    await annotate(
      `${String(drawn)} bars, ${String(drawn)} portals: first draw ${mountMs.toFixed(0)} ms (target ≤ ${String(TARGETS.mount)}); a scroll that replaces the window (${String(after)} bars in, ${String(drawn)} out) ${swapMs.toFixed(0)} ms (target ≤ ${String(TARGETS.swap)})`,
    );
    expect(mountMs).toBeLessThan(TARGETS.mount);
    expect(swapMs).toBeLessThan(TARGETS.swap);
    await view.unmount();
    expect(mounted).toBe(0);
  });
});

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

describe('one label that changes among many (FR-REACT-4)', () => {
  /**
   * Drags the progress handle of a bar to and fro and returns the time of each step: the renderer's
   * frame and everything React does for the label that changed.
   */
  async function dragSteps(react: boolean): Promise<number[]> {
    const tasks: Task[] = Array.from({ length: BARS }, (_, i) => ({
      id: `t${String(i)}`,
      name: `Task ${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
      progress: 10,
    }));
    stubScrollerSize(800, BARS * 48);
    const frames = createManualFrames();
    const handle = createRef<GanttHandle>();
    const view = await renderInto(
      <Gantt
        ref={handle}
        defaultTasks={tasks}
        now={() => '2026-03-04'}
        renderer={{ frames }}
        display={{ barLabel: 'inside' }}
        {...(react && { renderBarLabel: ({ name }: { name: string }) => <Label name={name} /> })}
      />,
    );
    await act(async () => {
      frames.step();
      await Promise.resolve();
    });
    expect(view.container.querySelectorAll('.gantt__bar').length).toBeGreaterThanOrEqual(BARS);
    const bar = handle.current!.getBarRect('t7')!;
    const y = bar.y + bar.height;
    const x = bar.x + bar.progressWidth;
    const pointer = (type: PointerInput['type'], at: number): PointerInput => ({
      type,
      pointerId: 1,
      x: at,
      y,
      time: 0,
      ...(type === 'down' && { target: { kind: 'task', id: 't7', part: 'progress' } as const }),
    });
    await act(async () => {
      handle.current!.core.send(pointer('down', x));
      await Promise.resolve();
    });
    const steps: number[] = [];
    // The first steps warm the code up; the rest are measured.
    for (let i = 0; i < 40; i++) {
      const begin = performance.now();
      await act(async () => {
        handle.current!.core.send(pointer('move', x + 20 + (i % 2) * 90));
        frames.step();
        await Promise.resolve();
      });
      if (i >= 10) steps.push(performance.now() - begin);
    }
    await view.unmount();
    return steps;
  }

  it('NFR-PERF-1: a step of a progress drag with 300 React labels costs about what it does with 300 text labels', async ({
    annotate,
  }) => {
    const text = median(await dragSteps(false));
    const react = median(await dragSteps(true));

    await annotate(
      `${String(BARS)} bars, one label changes a step: median ${react.toFixed(2)} ms with React labels, ${text.toFixed(2)} ms with text labels (target: under ${String(CHANGE_RATIO)} x the baseline + ${String(CHANGE_SLACK_MS)} ms)`,
    );
    expect(react).toBeLessThan(text * CHANGE_RATIO + CHANGE_SLACK_MS);
  });
});

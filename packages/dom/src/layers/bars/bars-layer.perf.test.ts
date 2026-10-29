import {
  barsInWindow,
  createGanttCore,
  type GanttSnapshot,
  type PointerInput,
} from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import { createLayerHarness } from '../../testing';
import { createBarsLayer } from './index';

/**
 * Budgets of plan step 4.3 on the generated 10k plan: a drag frame (the core's preview with its
 * dependents, a new layout every frame) redraws the bars layer in a small fraction of a 16 ms
 * frame (4 ms at most on average; the maximum is only reported, a single GC pause would fail it), a snapshot that leaves the same bars in the window costs next to nothing, and the
 * first draw of the window is cheap. The assertions are generous so that slow CI machines pass;
 * the measured values are attached to the test report. Runs in `pnpm test:perf` only.
 */
const TARGETS = { drag: 4, still: 0.5, first: 50 } as const;
const WARM_UP = 50;

afterEach(() => {
  document.body.replaceChildren();
});

/** Runs `step` `WARM_UP + runs` times; it returns the milliseconds to count, the warm-up's dropped. */
function sample(runs: number, step: (i: number) => number): { mean: number; max: number } {
  const counted: number[] = [];
  for (let i = 0; i < WARM_UP + runs; i++) {
    const took = step(i);
    if (i >= WARM_UP) counted.push(took);
  }
  return {
    mean: counted.reduce((sum, took) => sum + took, 0) / counted.length,
    max: Math.max(...counted),
  };
}

describe('bars layer performance (10 000 generated tasks)', () => {
  it('NFR-PERF-1, NFR-PERF-2: a drag frame redraws only what moved, well under a frame', async ({
    annotate,
  }) => {
    const fixture = generateFixture({ count: 10_000 });
    const core = createGanttCore({
      tasks: fixture.tasks,
      links: fixture.links,
      calendar: fixture.calendar,
      scroll: { initial: 'start', autoScroll: false },
    });
    core.setViewport({ width: 1600, height: 900 });
    const harness = createLayerHarness('bars');
    const layer = createBarsLayer();
    layer.mount(harness.context);

    const first = core.getSnapshot();
    const begin = performance.now();
    layer.update(first, undefined);
    const firstDraw = performance.now() - begin;
    const inWindow = barsInWindow(first.window, first.layout);
    expect(inWindow.length).toBeGreaterThan(20);
    expect(harness.root.childElementCount).toBe(inWindow.length);

    // Drag a bar from the middle of the window.
    const bar = inWindow[Math.floor(inWindow.length / 2)]!;
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    const down: PointerInput = {
      type: 'down',
      pointerId: 1,
      x,
      y,
      time: 0,
      target: { kind: 'task', id: bar.id, part: 'body' },
    };
    const move = (dx: number, time: number): PointerInput => ({
      type: 'move',
      pointerId: 1,
      x: x + dx,
      y,
      time,
    });
    core.send(down);
    core.send(move(10, 1));

    let previous: GanttSnapshot = core.getSnapshot();
    let lastX = NaN;
    let frames = 0;
    const drag = sample(300, (i) => {
      // One week and two weeks alternately (whole weeks, so that skipping non-working days
      // rolls both to the same weekday): every frame is a new preview and a new layout.
      core.send(move(280 * (1 + (i % 2)), i));
      const snapshot = core.getSnapshot();
      const start = performance.now();
      layer.update(snapshot, previous);
      const took = performance.now() - start;
      const x = snapshot.layout.getBarRect(bar.id)!.x;
      if (x !== lastX) frames++;
      lastX = x;
      previous = snapshot;
      return took;
    });
    // The bar really moved in every frame, and the DOM followed it.
    expect(frames).toBe(WARM_UP + 300);
    expect(core.getSnapshot().state.draft).toBeDefined();
    expect(harness.root.querySelector('[data-dragging]')?.getAttribute('data-task-id')).toBe(
      String(bar.id),
    );

    // Another snapshot over the same bars (a scroll by a few pixels, a hover over nothing):
    // only the comparison of the window runs.
    const resting = core.getSnapshot();
    const still = sample(2000, () => {
      const start = performance.now();
      layer.update({ ...resting }, resting);
      return performance.now() - start;
    });

    await annotate(
      `10k tasks, ${inWindow.length} bars in the window: first draw ${firstDraw.toFixed(2)} ms (target ≤ ${TARGETS.first}), drag frame ${drag.mean.toFixed(3)} ms mean / ${drag.max.toFixed(2)} ms max (target ≤ ${TARGETS.drag}), same bars again ${still.mean.toFixed(4)} ms (target ≤ ${TARGETS.still})`,
    );
    expect(firstDraw).toBeLessThan(TARGETS.first);
    expect(drag.mean).toBeLessThan(TARGETS.drag);
    expect(still.mean).toBeLessThan(TARGETS.still);

    layer.destroy();
    core.destroy();
  });
});

import type { GanttCore, GanttSnapshot } from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createLayerHarness, createTestCore } from '../../testing';
import { createGridLayer } from './index';

/**
 * Targets of plan step 4.2 on 10 000 tasks in the day mode (1600 × 900 viewport): an update
 * whose window moved by a few px stays well under one frame (16 ms), and so does an update
 * that really redraws the time parts or the rows. The assertions are generous so that slow CI
 * machines pass; the measured means (after a warm-up, `performance.now()`) are attached to the
 * test report. The core's own work (the snapshot) is not part of the measurement.
 */
const FRAME_MS = 16;

/** Mean milliseconds of `run`, after a warm-up. */
function mean(runs: number, run: (i: number) => void): number {
  for (let i = 0; i < Math.min(runs, 100); i++) run(i);
  const start = performance.now();
  for (let i = 0; i < runs; i++) run(runs + i);
  return (performance.now() - start) / runs;
}

/** The snapshots the core gives for the given scroll positions. */
function scrolled(core: GanttCore, positions: readonly [number, number][]): GanttSnapshot[] {
  return positions.map(([left, top]) => {
    core.scroll({ left, top });
    return core.getSnapshot();
  });
}

describe('grid layer performance (10 000 tasks, day mode)', () => {
  it('NFR-PERF-1, NFR-PERF-3: updates stay well under a frame, whether or not they redraw', async ({
    annotate,
  }) => {
    const fixture = generateFixture({ count: 10_000 });
    const core = createTestCore({
      tasks: fixture.tasks,
      links: fixture.links,
      calendar: fixture.calendar,
      scroll: { initial: 'start', autoScroll: false },
    });
    core.setViewport({ width: 1600, height: 900 });
    const first = core.getSnapshot();
    const left = first.timeline.scrollLeft;
    const harness = createLayerHarness('grid', { rowStripes: 'row', gridLines: 'both' });
    const layer = createGridLayer();
    layer.mount(harness.context);

    const mount = performance.now();
    layer.update(first, undefined);
    const mounted = performance.now() - mount;

    // A few px of horizontal scroll, inside the drawn window.
    const near = scrolled(
      core,
      [0, 1, 2, 3, 4, 5].map((d) => [left + d * 3, 0] as [number, number]),
    );
    // Two far apart positions: every update redraws the time parts.
    const far = scrolled(core, [
      [left, 0],
      [left + 1000, 0],
    ]);
    // A row at a time: the rows and the horizontal lines move.
    const down = scrolled(
      core,
      [0, 1, 2, 3, 4, 5].map((d) => [left, d * 48] as [number, number]),
    );

    layer.update(near[0]!, first);
    const scroll = mean(5000, (i) => {
      layer.update(near[i % near.length]!, near[(i + 5) % near.length]);
    });
    const redraw = mean(300, (i) => {
      layer.update(far[i % 2]!, far[(i + 1) % 2]);
    });
    layer.update(down[0]!, first);
    const rows = mean(1000, (i) => {
      layer.update(down[i % down.length]!, down[(i + 5) % down.length]);
    });
    const nodes = document.querySelectorAll('.gantt__grid *').length;

    await annotate(
      `grid, 10k tasks: first draw ${mounted.toFixed(2)} ms, scroll by a few px ${scroll.toFixed(4)} ms, ` +
        `scroll past the window (redraw) ${redraw.toFixed(3)} ms, one row down ${rows.toFixed(3)} ms, ${nodes} nodes`,
    );
    expect(scroll).toBeLessThan(FRAME_MS / 8);
    expect(redraw).toBeLessThan(FRAME_MS / 2);
    expect(rows).toBeLessThan(FRAME_MS / 2);
    expect(mounted).toBeLessThan(FRAME_MS * 4);
    // 10 000 rows are never drawn: the window holds a few dozen rows and about 80 days.
    expect(nodes).toBeLessThan(600);
  });
});

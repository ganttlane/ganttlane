import type { GanttCore, GanttSnapshot } from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createLayerHarness, createTestCore } from '../../testing';
import { createHeaderLayer } from './index';

/**
 * Targets of plan step 4.2 on 10 000 tasks in the day mode (1600 × 900 viewport): an update
 * whose window moved by a few px stays well under one frame (16 ms), and so does one that
 * redraws the cells, and one that only moves the range highlight. The assertions are generous
 * so that slow CI machines pass; the measured means (after a warm-up, `performance.now()`) are
 * attached to the test report. The core's own work (the snapshot) is not part of the
 * measurement.
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
function scrolled(core: GanttCore, lefts: readonly number[]): GanttSnapshot[] {
  return lefts.map((left) => {
    core.scroll({ left, top: 0 });
    return core.getSnapshot();
  });
}

describe('header layer performance (10 000 tasks, day mode)', () => {
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
    const harness = createLayerHarness('header');
    const layer = createHeaderLayer();
    layer.mount(harness.context);

    const mount = performance.now();
    layer.update(first, undefined);
    const mounted = performance.now() - mount;

    // A few px of horizontal scroll, inside the drawn cells.
    const near = scrolled(
      core,
      [0, 1, 2, 3, 4, 5].map((d) => left + d * 3),
    );
    // Two far apart positions: every update redraws the cells.
    const far = scrolled(core, [left, left + 1000]);
    // Hovering a bar and leaving it: the snapshot differs in its feedback only.
    core.scroll({ left, top: 0 });
    const bar = [0, 1, 2, 3, 4, 5]
      .map((row) => first.layout.barAt(row))
      .find((found) => found !== undefined)!;
    const hovered = (x: number, y: number): GanttSnapshot => {
      core.send({ type: 'move', pointerId: 1, time: 0, x, y });
      return core.getSnapshot();
    };
    const over = hovered(bar.x + 1, bar.y + 1);
    const out = hovered(-50, 5);

    layer.update(near[0]!, first);
    const scroll = mean(5000, (i) => {
      layer.update(near[i % near.length]!, near[(i + 5) % near.length]);
    });
    const redraw = mean(300, (i) => {
      layer.update(far[i % 2]!, far[(i + 1) % 2]);
    });
    layer.update(out, first);
    const hover = mean(2000, (i) => {
      layer.update(i % 2 === 0 ? over : out, i % 2 === 0 ? out : over);
    });
    // Counted in this run's own root: a retry must not see the cells of an earlier attempt.
    const cells = harness.root.querySelectorAll('.gantt__header-cell').length;
    layer.destroy();
    harness.root.closest('.gantt')?.remove();

    await annotate(
      `header, 10k tasks: first draw ${mounted.toFixed(2)} ms, scroll by a few px ${scroll.toFixed(4)} ms, ` +
        `scroll past the cells (redraw) ${redraw.toFixed(3)} ms, hover in / out ${hover.toFixed(4)} ms, ${cells} cells`,
    );
    expect(scroll).toBeLessThan(FRAME_MS / 8);
    expect(redraw).toBeLessThan(FRAME_MS / 2);
    expect(hover).toBeLessThan(FRAME_MS / 8);
    // Mostly the warm-up of `Intl` formatters, which a loaded machine slows down most.
    expect(mounted).toBeLessThan(FRAME_MS * 8);
    // The cells of the window, not of the two years of content.
    expect(cells).toBeLessThan(100);
  });
});

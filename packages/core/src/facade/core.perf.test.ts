import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import type { PointerInput } from '../interaction';
import { createGanttCore, type GanttCore } from './index';

/**
 * Targets of plan step 3.8 on the generated 10k plan in the day mode: a pointer move through the
 * facade (`send`: the machine, the controller, the store's draft, the sync and a new snapshot)
 * stays well under one frame (16 ms), and `setOptions` with a handler only is O(1). The
 * assertions are generous so that slow CI machines pass; the measured means (after a warm-up,
 * `Date.now()` has 1 ms resolution) are attached to the test report.
 */
const FRAME_MS = 16;
const TARGETS = { hover: 0.05, substep: 0.05, preview: 4, handler: 0.01 } as const;

function mean(runs: number, run: (i: number) => void): number {
  for (let i = 0; i < Math.min(runs, 200); i++) run(i);
  const start = Date.now();
  for (let i = 0; i < runs; i++) run(runs + i);
  return (Date.now() - start) / runs;
}

function chartOf(count: number): GanttCore {
  const fixture = generateFixture({ count });
  const gantt = createGanttCore({
    tasks: fixture.tasks,
    links: fixture.links,
    calendar: fixture.calendar,
    scroll: { initial: 'start', autoScroll: false },
  });
  gantt.setViewport({ width: 1600, height: 900 });
  return gantt;
}

describe('createGanttCore performance (10 000 generated tasks)', () => {
  it('NFR-PERF-1, FR-EDIT-5: pointer moves through the facade stay well under a frame', async ({
    annotate,
  }) => {
    const gantt = chartOf(10_000);
    const { model } = gantt.getSnapshot().state.derived;
    const middle = model.tasks.find(
      (task, i) => i >= model.tasks.length / 2 && task.span !== undefined && task.type === 'task',
    )!;
    const bar = gantt.getBarRect(middle.id)!;
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    const event = (type: PointerInput['type'], dx: number, time: number): PointerInput => ({
      type,
      pointerId: 1,
      x: x + dx,
      y,
      time,
    });
    let snapshots = 0;
    gantt.subscribe(() => snapshots++);

    const hover = mean(5000, (i) => gantt.send(event('move', i % 7, i)));
    gantt.send(event('down', 0, 0));
    gantt.send(event('move', 10, 1));
    const substep = mean(5000, (i) => gantt.send(event('move', 10 + (i % 5), i)));
    snapshots = 0;
    const preview = mean(500, (i) => gantt.send(event('move', 40 * (1 + (i % 2)), i)));
    await annotate(
      `10k tasks through send(): hover ${hover.toFixed(4)} ms (target ≤ ${TARGETS.hover}), drag within a step ${substep.toFixed(4)} ms (target ≤ ${TARGETS.substep}), drag with a new preview and snapshot ${preview.toFixed(3)} ms (target ≤ ${TARGETS.preview})`,
    );
    expect(snapshots).toBeGreaterThan(400);
    expect(hover).toBeLessThan(FRAME_MS);
    expect(substep).toBeLessThan(FRAME_MS);
    expect(preview).toBeLessThan(FRAME_MS);
  });

  it('FR-API-2, FR-EVT-2: setOptions with a handler only is O(1)', async ({ annotate }) => {
    const large = chartOf(10_000);
    const small = chartOf(10);
    const swap = (gantt: GanttCore) => (i: number) => {
      gantt.setOptions({ onTaskClick: i % 2 === 0 ? () => undefined : () => 1 });
    };
    const before = large.getSnapshot();
    const big = mean(20_000, swap(large));
    const tiny = mean(20_000, swap(small));
    await annotate(
      `setOptions({ onTaskClick }): ${big.toFixed(4)} ms with 10k tasks, ${tiny.toFixed(4)} ms with 10 (target ≤ ${TARGETS.handler})`,
    );
    expect(large.getSnapshot()).toBe(before);
    // O(n) work on 10k tasks would take milliseconds per call.
    expect(big).toBeLessThan(0.5);
  });
});

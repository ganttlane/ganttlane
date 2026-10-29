import { describe, expect, it } from 'vitest';

import type { Link, Task } from '../index';
import { createGanttCore, type GanttCore } from './index';

/**
 * NFR-PERF-1: one frame of dragging a task with 50 dependents costs under 8 ms (plan step 6.2).
 * The core's share of that frame is `send` and the snapshot after it: the interaction machine,
 * the propagation to every dependent, the draft of the store and the layout of the moved bars.
 * The renderer's share is measured by the dom package (`links-layer.perf.test.ts`,
 * `render-path.perf.test.ts`) and, in a real browser, by the benchmark page; `pnpm bench` prints
 * all of them next to the target.
 *
 * The plan: a chain of 50 tasks, each linked finish-to-start to the previous one, behind the
 * task that is dragged (so a move reaches exactly 50 dependents), among independent tasks that
 * make the plan as long as asked. The pointer alternates between two and three days, so every
 * frame is a new preview. The assertion is generous so that slow CI machines pass; the measured
 * mean (after a warm-up, as `Date.now()` has 1 ms resolution) is attached to the test report.
 */
const DEPENDENTS = 50;
const FRAME_BUDGET_MS = 8;
const FRAMES = 2000;
const DAY_MS = 86_400_000;
const BASE = Date.UTC(2026, 0, 5);
const iso = (day: number): string => new Date(BASE + day * DAY_MS).toISOString().slice(0, 10);

/** `total` tasks: `lead`, `DEPENDENTS` followers in a chain after it, and independent fillers. */
function plan(total: number): { tasks: Task[]; links: Link[] } {
  const tasks: Task[] = [];
  const links: Link[] = [];
  for (let i = 0; i < total; i++) {
    const day = (i % 400) * 2;
    tasks.push({ id: `t${i}`, name: `Task ${i}`, start: iso(day), end: iso(day + 1) });
    if (i > 0 && i <= DEPENDENTS) links.push({ source: `t${i - 1}`, target: `t${i}` });
  }
  return { tasks, links };
}

function chartOf(total: number): GanttCore {
  const { tasks, links } = plan(total);
  const core = createGanttCore({
    tasks,
    links,
    calendar: { weekends: [0, 6] },
    now: () => iso(10),
    scheduling: { propagation: 'preserve-lag' },
    scroll: { initial: 'start', autoScroll: false },
  });
  core.setViewport({ width: 1600, height: 900 });
  return core;
}

describe('dragging a task with 50 dependents through the facade', () => {
  it.for([1_000, 10_000])(
    'NFR-PERF-1, FR-EDIT-5: a drag frame within 8 ms (%d tasks)',
    async (total, { annotate }) => {
      const core = chartOf(total);
      const bar = core.getBarRect('t0');
      expect(bar).toBeDefined();
      const x = bar!.x + bar!.width / 2;
      const y = bar!.y + bar!.height / 2;
      core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
      core.send({ type: 'move', pointerId: 1, x: x + 10, y, time: 1 });

      // `send` and the snapshot the renderer reads after it (the draft's layout and window).
      const frame = (i: number): void => {
        core.send({ type: 'move', pointerId: 1, x: x + 40 * (2 + (i % 2)), y, time: i + 2 });
        core.getSnapshot();
      };
      for (let i = 0; i < 100; i++) frame(i);
      const start = Date.now();
      for (let i = 0; i < FRAMES; i++) frame(100 + i);
      const mean = (Date.now() - start) / FRAMES;
      const moved = core.getSnapshot().state.draft?.patches.size ?? 0;
      core.send({ type: 'cancel', pointerId: 1 });

      await annotate(
        `drag with ${moved} moved bars of ${total} tasks: ${mean.toFixed(3)} ms per frame (target ≤ ${FRAME_BUDGET_MS} ms)`,
      );
      expect(moved).toBeGreaterThanOrEqual(DEPENDENTS + 1);
      expect(mean).toBeLessThan(FRAME_BUDGET_MS);
    },
  );
});

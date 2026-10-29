import { createGanttCore, type GanttCore, type GanttSnapshot, type Task } from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import { createLayerHarness } from '../../testing';
import { createLinksLayer } from './index';

/**
 * Target of plan step 4.4 (NFR-PERF-1, NFR-PERF-2): with about 3 000 links in the plan, a frame
 * of dragging one bar re-routes only that bar's links, and a frame of scrolling finds that
 * nothing changed, both well inside one frame (16.7 ms). The core's drag frame budget is 8 ms
 * for 50 dependents; the layer's share is small by comparison.
 *
 * Measured on `layer.update` alone (the core's work is done before the clock starts), in
 * happy-dom, whose DOM is slower than a browser's. The budgets are generous so that slow CI
 * machines pass; the measured numbers are attached to the test report.
 */
const FRAME_BUDGET_MS = 2;
const COLD_BUDGET_MS = 30;
const FRAMES = 60;
const PASSES = 10;

const DAY_MS = 86_400_000;
const BASE = Date.UTC(2026, 0, 5);
const iso = (day: number): string => new Date(BASE + day * DAY_MS).toISOString().slice(0, 10);

/**
 * `count` tasks in a row each, every task linked to the next three: about `3 × count` links.
 * Neighbouring rows overlap in time, so a window shows many links.
 */
function densePlan(count: number): { tasks: Task[]; links: { source: string; target: string }[] } {
  const tasks: Task[] = [];
  const links: { source: string; target: string }[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push({ id: `t${i}`, name: `Task ${i}`, start: iso(i * 2), end: iso(i * 2 + 4) });
    for (let k = 1; k <= 3; k++) {
      if (i + k < count) links.push({ source: `t${i}`, target: `t${i + k}` });
    }
  }
  return { tasks, links };
}

const cores: GanttCore[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
});

interface Run {
  readonly core: GanttCore;
  readonly update: (snapshot: GanttSnapshot) => void;
  readonly root: SVGGElement;
}

function mount(core: GanttCore): Run {
  cores.push(core);
  core.setViewport({ width: 1280, height: 900 });
  const harness = createLayerHarness('links');
  const layer = createLinksLayer();
  layer.mount(harness.context);
  let previous: GanttSnapshot | undefined;
  return {
    core,
    root: harness.root,
    update: (snapshot) => {
      layer.update(snapshot, previous);
      previous = snapshot;
    },
  };
}

/** The `d` of every drawn route by link id. */
function routes(root: Element): Map<string, string> {
  return new Map(
    [...root.querySelectorAll('g.gantt__link')].map((group) => [
      group.getAttribute('data-link-id') ?? '',
      group.querySelector('.gantt__link-path')?.getAttribute('d') ?? '',
    ]),
  );
}

/** Mean milliseconds of one call of `step` over `PASSES` passes through `snapshots`. */
function meanMs(
  snapshots: readonly GanttSnapshot[],
  step: (snapshot: GanttSnapshot) => void,
): number {
  for (const snapshot of snapshots) step(snapshot);
  const start = performance.now();
  for (let pass = 0; pass < PASSES; pass++) {
    for (const snapshot of snapshots) step(snapshot);
  }
  return (performance.now() - start) / (PASSES * snapshots.length);
}

/** Snapshots of a drag of one bar: the pointer alternates between two places, a day apart. */
function dragSnapshots(core: GanttCore, id: string): GanttSnapshot[] {
  const bar = core.getBarRect(id);
  if (bar === undefined) throw new Error(`No bar for ${id}.`);
  const y = bar.y + bar.height / 2;
  const x = bar.x + bar.width / 2;
  core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
  const snapshots: GanttSnapshot[] = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    core.send({ type: 'move', pointerId: 1, x: x + 40 * (2 + (frame % 2)), y, time: frame });
    snapshots.push(core.getSnapshot());
  }
  return snapshots;
}

/** Snapshots of scrolling `dx` right and `dy` down per frame from where the core is. */
function scrollSnapshots(core: GanttCore, dx: number, dy: number): GanttSnapshot[] {
  const { timeline, scrollTop } = core.getSnapshot();
  const snapshots: GanttSnapshot[] = [];
  for (let frame = 1; frame <= FRAMES; frame++) {
    core.scroll({ left: timeline.scrollLeft + frame * dx, top: scrollTop + frame * dy });
    snapshots.push(core.getSnapshot());
  }
  return snapshots;
}

describe('links layer performance (3 000 links)', () => {
  const { tasks, links } = densePlan(1000);

  /** A chart whose first drawn rows are the dense plan, scrolled so that row 20 is in view. */
  function chart(propagation: 'none' | 'preserve-lag'): Run {
    const core = createGanttCore({
      tasks,
      links,
      calendar: { weekends: [0, 6] },
      now: () => iso(40),
      scheduling: { propagation },
      scroll: { initial: iso(40) },
    });
    return mount(core);
  }

  it('NFR-PERF-1: the first draw of a window of a 3 000 link plan is cheap', async ({
    annotate,
  }) => {
    expect(links.length).toBeGreaterThan(2900);
    const run = chart('none');
    const snapshot = run.core.getSnapshot();
    const start = performance.now();
    run.update(snapshot);
    const elapsed = performance.now() - start;
    const drawn = run.root.childElementCount;

    await annotate(`first draw: ${drawn} links of ${links.length} in ${elapsed.toFixed(2)} ms`);
    expect(drawn).toBeGreaterThan(20);
    expect(drawn).toBeLessThan(links.length / 4);
    expect(elapsed).toBeLessThan(COLD_BUDGET_MS);
  });

  it('NFR-PERF-1: a drag frame of one bar stays well under a frame', async ({ annotate }) => {
    const run = chart('none');
    run.update(run.core.getSnapshot());
    const drawn = run.root.childElementCount;
    const snapshots = dragSnapshots(run.core, 't20');
    expect(snapshots[0]?.state.draft?.patches.size).toBe(1);
    const before = routes(run.root);

    const mean = meanMs(snapshots, run.update);
    run.update(snapshots[0]!);
    const after = routes(run.root);
    const changed = [...after].filter(([id, d]) => before.get(id) !== d).length;

    await annotate(
      `drag of one bar: ${mean.toFixed(3)} ms per frame with ${drawn} links drawn, ${changed} re-routed (budget ${FRAME_BUDGET_MS} ms)`,
    );
    expect(changed).toBeGreaterThan(0);
    // The dragged bar has at most three links in and three out.
    expect(changed).toBeLessThanOrEqual(6);
    expect(mean).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('NFR-PERF-1: a drag frame of a bar with 50 dependents stays under a frame', async ({
    annotate,
  }) => {
    const run = chart('preserve-lag');
    run.update(run.core.getSnapshot());
    const snapshots = dragSnapshots(run.core, 't20');
    const moved = snapshots[0]?.state.draft?.patches.size ?? 0;
    expect(moved).toBeGreaterThan(50);

    const mean = meanMs(snapshots, run.update);

    await annotate(
      `drag with ${moved} moved bars: ${mean.toFixed(3)} ms per frame (budget ${FRAME_BUDGET_MS} ms)`,
    );
    expect(mean).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('NFR-PERF-2: a scroll frame that keeps the links in the window stays well under a frame', async ({
    annotate,
  }) => {
    const run = chart('none');
    run.update(run.core.getSnapshot());
    const snapshots = scrollSnapshots(run.core, 1, 0);

    const mean = meanMs(snapshots, run.update);

    await annotate(
      `1 px scroll: ${mean.toFixed(3)} ms per frame with ${run.root.childElementCount} links drawn (budget ${FRAME_BUDGET_MS} ms)`,
    );
    expect(mean).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('NFR-PERF-2: a fast scroll that brings links in and out stays well under a frame', async ({
    annotate,
  }) => {
    const run = chart('none');
    run.update(run.core.getSnapshot());
    // Along the plan's diagonal (a row is 80 px of time): two rows a frame, links enter and leave
    // in every frame.
    const snapshots = scrollSnapshots(run.core, 160, 96);
    let entered = 0;
    let previous = new Set(routes(run.root).keys());
    for (const snapshot of snapshots) {
      run.update(snapshot);
      const ids = new Set(routes(run.root).keys());
      for (const id of ids) if (!previous.has(id)) entered++;
      previous = ids;
    }

    const mean = meanMs(snapshots, run.update);

    await annotate(
      `diagonal scroll: ${mean.toFixed(3)} ms per frame, ${entered} links entered in ${FRAMES} frames (budget ${FRAME_BUDGET_MS} ms)`,
    );
    expect(entered).toBeGreaterThan(FRAMES);
    expect(mean).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('NFR-PERF-3: the 10 000 task fixture (about 3 000 links) draws and scrolls within a frame', async ({
    annotate,
  }) => {
    const fixture = generateFixture({ count: 10_000 });
    const core = createGanttCore({
      tasks: fixture.tasks,
      links: fixture.links,
      ...(fixture.calendar && { calendar: fixture.calendar }),
      ...fixture.options,
      scroll: { initial: 'start' },
    });
    const run = mount(core);
    const start = performance.now();
    run.update(core.getSnapshot());
    const cold = performance.now() - start;
    expect(run.root.childElementCount).toBeGreaterThan(0);

    const mean = meanMs(scrollSnapshots(core, 60, 0), run.update);
    const { scrollLeft } = core.getSnapshot().timeline;
    const down: GanttSnapshot[] = [];
    for (let frame = 1; frame <= FRAMES; frame++) {
      core.scroll({ left: scrollLeft, top: frame * 48 });
      down.push(core.getSnapshot());
    }
    const vertical = meanMs(down, run.update);

    await annotate(
      `10k tasks, ${fixture.links.length} links: first draw ${cold.toFixed(2)} ms, horizontal scroll ${mean.toFixed(3)} ms, one row down ${vertical.toFixed(3)} ms per frame`,
    );
    expect(cold).toBeLessThan(COLD_BUDGET_MS);
    expect(mean).toBeLessThan(FRAME_BUDGET_MS);
    expect(vertical).toBeLessThan(FRAME_BUDGET_MS);
  });
});

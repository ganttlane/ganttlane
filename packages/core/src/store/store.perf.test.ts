import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import type { Task } from '../model';
import { createStoreState, reduceStore, type StoreState } from './index';

/**
 * Targets from plan step 3.1 (Node, Apple Silicon), 10k generated tasks: `toggleExpanded` ≤ 2 ms
 * (rows only), `setTasks` with one changed task ≤ 40 ms. `setTasks` runs the whole pipeline for
 * now (normalization ≈ 25 ms of it); incremental normalization is left for later. The assertions
 * are generous so that slow CI machines pass; the measured numbers (the mean of `RUNS` calls after
 * a warm-up, as `Date.now()` has 1 ms resolution) are attached to the test report.
 */
const TOGGLE_BUDGET_MS = 10;
const SET_TASKS_BUDGET_MS = 200;

function mean(runs: number, run: (i: number) => void): number {
  run(-1);
  const start = Date.now();
  for (let i = 0; i < runs; i++) run(i);
  return (Date.now() - start) / runs;
}

describe('store performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const initial = createStoreState({
    tasks: fixture.tasks,
    links: fixture.links,
    options: { calendar: fixture.calendar },
  });

  it('FR-ROW-2, NFR-PERF-3: toggleExpanded recomputes the rows only within budget', async ({
    annotate,
  }) => {
    const parent = initial.derived.hierarchy.parentIds[0]!;
    let state: StoreState = initial;
    const elapsed = mean(200, () => {
      state = reduceStore(state, { type: 'toggleExpanded', id: parent });
    });
    await annotate(
      `toggleExpanded: ${state.derived.rows.length} of ${initial.derived.rows.length} rows in ${elapsed.toFixed(3)} ms (target ≤ 2 ms)`,
    );
    expect(state.derived.model).toBe(initial.derived.model);
    expect(state.derived.conflicts).toBe(initial.derived.conflicts);
    expect(state.derived.rows).not.toBe(initial.derived.rows);
    expect(elapsed).toBeLessThan(TOGGLE_BUDGET_MS);
  });

  it('FR-DATA-7, NFR-PERF-3: setTasks with one changed task within budget', async ({
    annotate,
  }) => {
    const tasks = fixture.tasks as readonly Task[];
    let state: StoreState = initial;
    const elapsed = mean(10, (i) => {
      const next = [...tasks];
      next[500] = { ...tasks[500]!, name: `renamed ${i}` };
      state = reduceStore(state, { type: 'setTasks', tasks: next });
    });
    await annotate(
      `setTasks (one changed of ${tasks.length}, full pipeline): ${elapsed.toFixed(1)} ms (target ≤ 40 ms)`,
    );
    expect(state.lastDataChange).toMatchObject({
      added: [],
      removed: [],
      updated: [tasks[500]!.id],
    });
    expect(elapsed).toBeLessThan(SET_TASKS_BUDGET_MS);
  });
});

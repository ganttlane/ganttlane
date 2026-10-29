import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel } from '../model';
import { buildHierarchy, visibleRows } from './index';

/**
 * Target from plan step 2.2 (Node, Apple Silicon): tree + visible rows of 10k tasks ≤ 10 ms.
 * The assertion is generous so that slow CI machines pass; the measured numbers are attached
 * to the test report.
 */
const BUDGET_MS = 100;
const RUNS = 5;

/** The fastest of `RUNS` runs (the first one warms up the JIT). */
function fastest(run: () => void): number {
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    run();
    best = Math.min(best, Date.now() - start);
  }
  return best;
}

describe('hierarchy performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const { calendar } = createWorkCalendar(fixture.calendar);
  const model = normalizeModel(fixture, { calendar });

  it('FR-ROW-1, FR-ROW-2: builds the tree and the visible rows within budget', async ({
    annotate,
  }) => {
    let rows = 0;
    let parents = 0;
    const elapsed = fastest(() => {
      const tree = buildHierarchy(model);
      parents = tree.parentIds.length;
      rows = visibleRows(tree, 'all').length;
    });
    const tree = buildHierarchy(model);
    const rowsOnly = fastest(() => {
      visibleRows(tree, 'all');
    });
    await annotate(
      `buildHierarchy + visibleRows('all'): ${model.tasks.length} tasks (${parents} parents) in ${elapsed} ms, visibleRows alone ${rowsOnly} ms (target ≤ 10 ms)`,
    );
    expect(rows).toBe(10_000);
    expect(parents).toBeGreaterThan(0);
    expect(tree.issues).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

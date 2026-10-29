import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { propagate } from '../schedule';
import { asDateTimeMs, DAY } from '../time';
import {
  createStoreState,
  reduceStore,
  selectSessionChanges,
  selectSessionDirty,
  type StoreState,
} from './index';

/**
 * Targets of plan step 3.3 (Node, Apple Silicon), 10k generated tasks with one task moved in an
 * open session: `selectSessionDirty` ≤ 2 ms (it runs after every action of a session),
 * `selectSessionChanges` ≤ 10 ms (diff plus the conflicts of the changes). The assertions are
 * generous for slow CI machines; the measured means are attached to the test report.
 */
const DIRTY_BUDGET_MS = 20;
const CHANGES_BUDGET_MS = 60;

function mean(runs: number, run: () => void): number {
  run();
  const start = Date.now();
  for (let i = 0; i < runs; i++) run();
  return (Date.now() - start) / runs;
}

describe('edit session performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const initial = createStoreState({
    tasks: fixture.tasks,
    links: fixture.links,
    options: { calendar: fixture.calendar },
  });
  const open = reduceStore(initial, { type: 'beginSession' });
  const { model, hierarchy, graph } = open.derived;
  const last = model.tasks.findLast((task) => task.span !== undefined)!;
  const changeSet = propagate(
    { kind: 'move', id: last.id, start: asDateTimeMs(last.span!.start + 7 * DAY) },
    { model, hierarchy, graph, options: open.settings.propagation },
  );
  const moved: StoreState = reduceStore(open, { type: 'applyChangeSet', changeSet });

  it('FR-TX-6, NFR-PERF-3: the dirty check of a session within budget', async ({ annotate }) => {
    let dirty = false;
    const elapsed = mean(50, () => {
      dirty = selectSessionDirty(moved);
    });
    await annotate(`selectSessionDirty: ${elapsed.toFixed(3)} ms (target ≤ 2 ms)`);
    expect(dirty).toBe(true);
    expect(elapsed).toBeLessThan(DIRTY_BUDGET_MS);
  });

  it('FR-TX-4, NFR-PERF-3: the aggregated diff of a session within budget', async ({
    annotate,
  }) => {
    let count = 0;
    const elapsed = mean(20, () => {
      count = selectSessionChanges(moved)!.changes.length;
    });
    await annotate(
      `selectSessionChanges (${count} changes): ${elapsed.toFixed(2)} ms (target ≤ 10 ms)`,
    );
    expect(count).toBe(changeSet.changes.length);
    expect(elapsed).toBeLessThan(CHANGES_BUDGET_MS);
  });
});

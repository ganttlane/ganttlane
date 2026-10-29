import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import { normalizeModel } from '../model';
import { asDateTimeMs, DAY } from '../time';
import {
  buildLinkGraph,
  type ChangeSet,
  propagate,
  type PropagationCommand,
  type PropagationContext,
} from './index';

/**
 * Target from plan step 2.4: moving the first task of 10k generated, chain-heavy tasks (two
 * incoming links per task on average, so the edit reaches most of the plan) in ≤ 20 ms; with the
 * conflicts of the change set (plan step 2.5, which checks nearly every task and link here) in
 * ≤ 25 ms; a drag preview, which skips the conflicts (`options.conflicts: false`), in ≤ 20 ms.
 * The assertion is generous so that slow CI machines pass; the measured numbers (the mean of
 * `RUNS` calls after a warm-up, as `Date.now()` has 1 ms resolution) are attached to the test
 * report.
 */
const BUDGET_MS = 100;
const RUNS = 20;

describe('propagation performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000, linkDensity: 2 });
  const { calendar } = createWorkCalendar(fixture.calendar);

  /** The mean time of `RUNS` calls after a warm-up, and the last result. */
  function measure(
    command: PropagationCommand,
    context: PropagationContext,
  ): { readonly mean: number; readonly changeSet: ChangeSet } {
    let changeSet: ChangeSet = propagate(command, context);
    const start = Date.now();
    for (let i = 0; i < RUNS; i++) changeSet = propagate(command, context);
    return { mean: (Date.now() - start) / RUNS, changeSet };
  }

  it.for(['calendar', 'working'] as const)(
    'FR-SCH-5, FR-SCH-6, NFR-PERF-1: moves the first task of a chain-heavy plan within budget (%s)',
    async (durationMode, { annotate }) => {
      const model = normalizeModel(fixture, { calendar, durationMode });
      const context: PropagationContext = {
        model,
        hierarchy: buildHierarchy(model),
        graph: buildLinkGraph(model),
      };
      const first = model.tasks[0]!;
      const command: PropagationCommand = {
        kind: 'move',
        id: first.id,
        start: asDateTimeMs(first.span!.start + 7 * DAY),
      };
      const commit = measure(command, context);
      // A drag preview (plan step 3.7) skips the conflicts: the same changes, no conflict checks.
      const preview = measure(command, { ...context, options: { conflicts: false } });
      const { changeSet } = commit;
      await annotate(
        `propagate (${durationMode}): ${changeSet.changes.length} of ${model.tasks.length} tasks changed (${model.links.length} links), ${changeSet.conflicts.length} conflicts, in ${commit.mean.toFixed(2)} ms (target ≤ 25 ms); preview without conflicts in ${preview.mean.toFixed(2)} ms (target ≤ 20 ms)`,
      );
      expect(changeSet.changes.length).toBeGreaterThan(model.tasks.length / 2);
      expect(preview.changeSet.changes).toEqual(changeSet.changes);
      expect(preview.changeSet.conflicts).toEqual([]);
      expect(commit.mean).toBeLessThan(BUDGET_MS);
      expect(preview.mean).toBeLessThan(BUDGET_MS);
    },
  );
});

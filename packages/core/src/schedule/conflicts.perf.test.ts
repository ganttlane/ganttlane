import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import { normalizeModel } from '../model';
import { buildLinkGraph, type Conflict, detectConflicts } from './index';

/**
 * Target from plan step 2.5 (Node, Apple Silicon): every conflict of 10k generated tasks (the
 * initial state the facade shows as `TaskRecord.issues`) in ≤ 10 ms; `propagation.perf.test.ts`
 * covers `propagate`, which includes the conflicts of its change set. The assertion is generous
 * so that slow CI machines pass; the measured number (the mean of `RUNS` calls after a warm-up,
 * as `Date.now()` has 1 ms resolution) is attached to the test report.
 */
const BUDGET_MS = 100;
const RUNS = 20;

describe('conflict detection performance (10 000 generated tasks)', () => {
  it.for([0.3, 2])(
    'FR-SCH-6, NFR-PERF-1: finds every conflict of the model within budget (link density %d)',
    async (linkDensity, { annotate }) => {
      const fixture = generateFixture({ count: 10_000, linkDensity });
      const { calendar } = createWorkCalendar(fixture.calendar);
      for (const durationMode of ['calendar', 'working'] as const) {
        const model = normalizeModel(fixture, { calendar, durationMode });
        const context = { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) };
        const state = new Map();
        let conflicts: readonly Conflict[] = detectConflicts(state, context);
        const start = Date.now();
        for (let i = 0; i < RUNS; i++) conflicts = detectConflicts(state, context);
        const mean = (Date.now() - start) / RUNS;
        await annotate(
          `detectConflicts (${durationMode}): ${conflicts.length} conflicts in ${model.tasks.length} tasks + ${model.links.length} links in ${mean.toFixed(2)} ms (target ≤ 10 ms)`,
        );
        expect(conflicts.length).toBeGreaterThan(0);
        expect(mean).toBeLessThan(BUDGET_MS);
      }
    },
  );
});

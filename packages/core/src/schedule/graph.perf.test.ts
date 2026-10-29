import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel } from '../model';
import { buildLinkGraph, type LinkGraph } from './graph';

/**
 * Target from plan step 2.3 (Node, Apple Silicon): the graph of 10k generated tasks (≈ 2.9k
 * links) in ≤ 10 ms. The assertion is generous so that slow CI machines pass; the measured number
 * (the mean of `RUNS` builds after a warm-up, as `Date.now()` has 1 ms resolution) is attached to
 * the test report.
 */
const BUDGET_MS = 100;
const RUNS = 20;

describe('graph performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const { calendar } = createWorkCalendar(fixture.calendar);

  it('FR-SCH-5, NFR-PERF-1: builds the link graph within budget', async ({ annotate }) => {
    for (const durationMode of ['calendar', 'working'] as const) {
      const model = normalizeModel(fixture, { calendar, durationMode });
      let graph: LinkGraph = buildLinkGraph(model);
      const start = Date.now();
      for (let i = 0; i < RUNS; i++) graph = buildLinkGraph(model);
      const mean = (Date.now() - start) / RUNS;
      await annotate(
        `buildLinkGraph (${durationMode}): ${model.tasks.length} tasks + ${model.links.length} links in ${mean.toFixed(2)} ms (target ≤ 10 ms)`,
      );
      expect(graph.issues).toEqual([]);
      expect(graph.links).toHaveLength(model.links.length);
      expect(graph.topologicalOrder).toHaveLength(model.tasks.length);
      expect(mean).toBeLessThan(BUDGET_MS);
    }
  });
});

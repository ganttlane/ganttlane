import { generateFixture } from '@ganttlane/fixtures';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel } from './normalize';
import { LinkSchema, TaskSchema } from './schema';

/**
 * Targets from plan step 2.1 (Node, Apple Silicon): schema validation of 10k tasks ≤ 10 ms
 * (ADR-016) and full normalization ≤ 50 ms. The assertions are generous so that slow CI machines
 * pass; the measured numbers are attached to the test report.
 */
const SCHEMA_BUDGET_MS = 100;
const NORMALIZE_BUDGET_MS = 500;
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

describe('model performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const { calendar } = createWorkCalendar(fixture.calendar);

  it('FR-DATA-11: validates 10k tasks with TaskSchema within budget', async ({ annotate }) => {
    let valid = 0;
    const elapsed = fastest(() => {
      valid = 0;
      for (const task of fixture.tasks) if (v.safeParse(TaskSchema, task).success) valid++;
      for (const link of fixture.links) if (v.safeParse(LinkSchema, link).success) valid++;
    });
    await annotate(
      `safeParse: ${fixture.tasks.length} tasks + ${fixture.links.length} links in ${elapsed} ms (target ≤ 10 ms)`,
    );
    expect(valid).toBe(fixture.tasks.length + fixture.links.length);
    expect(elapsed).toBeLessThan(SCHEMA_BUDGET_MS);
  });

  it('FR-DATA-8: normalizes 10k tasks within budget', async ({ annotate }) => {
    let issues = -1;
    const elapsed = fastest(() => {
      issues = normalizeModel(fixture, { calendar }).issues.length;
    });
    await annotate(
      `normalizeModel: ${fixture.tasks.length} tasks + ${fixture.links.length} links in ${elapsed} ms (target ≤ 50 ms)`,
    );
    expect(issues).toBe(0);
    expect(elapsed).toBeLessThan(NORMALIZE_BUDGET_MS);
  });
});

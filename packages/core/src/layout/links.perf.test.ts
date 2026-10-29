import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type TaskId } from '../model';
import { createTimeScale, VIEW_MODE_PRESETS } from '../scale';
import { buildLinkGraph } from '../schedule';
import { linkBBox, type LinkRect, type LinkRouteInput, routeLink } from './links';

/**
 * Target from plan step 3.5 (Node, Apple Silicon): routing ≈ 3k links in ≤ 3 ms. The 10k
 * generated tasks have ≈ 2.9k links; bars sit one per row in model order (38 px rows, 24 px
 * bars) on the Day scale. The assertion is generous so that slow CI machines pass; the measured
 * numbers (the mean of `RUNS` passes after a warm-up, as `Date.now()` has 1 ms resolution) are
 * attached to the test report.
 */
const BUDGET_MS = 30;
const RUNS = 50;
const ROW_HEIGHT = 38;
const BAR_HEIGHT = 24;

describe('link router performance (10 000 generated tasks)', () => {
  const fixture = generateFixture({ count: 10_000 });
  const { calendar } = createWorkCalendar(fixture.calendar);
  const model = normalizeModel(fixture, { calendar });
  const graph = buildLinkGraph(model);
  const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
  const origin = model.tasks.find((task) => task.span)!.span!.start;
  const scale = createTimeScale({ origin, pxPerDay: day.pxPerDay });
  const rects = new Map<TaskId, LinkRect>();
  model.tasks.forEach((task, row) => {
    if (!task.span) return;
    const x = scale.dateToX(task.span.start);
    rects.set(task.id, {
      x,
      y: row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
      width: scale.dateToX(task.span.endExclusive) - x,
      height: BAR_HEIGHT,
    });
  });
  const inputs: LinkRouteInput[] = graph.links.flatMap((link) =>
    link.active
      ? [
          {
            type: link.type,
            source: rects.get(link.source)!,
            target: rects.get(link.target)!,
            options: { rowGap: ROW_HEIGHT - BAR_HEIGHT },
          },
        ]
      : [],
  );

  function mean(run: () => void): number {
    run();
    const start = Date.now();
    for (let i = 0; i < RUNS; i++) run();
    return (Date.now() - start) / RUNS;
  }

  it('FR-LINK-3, NFR-PERF-1: routes every link within budget', async ({ annotate }) => {
    expect(inputs.length).toBeGreaterThan(2500);
    let length = 0;
    const routing = mean(() => {
      length = 0;
      for (const input of inputs) length += routeLink(input).d.length;
    });
    const boxes = mean(() => {
      for (const input of inputs) linkBBox(input);
    });
    await annotate(
      `routeLink: ${inputs.length} links in ${routing.toFixed(2)} ms (target ≤ 3 ms), linkBBox in ${boxes.toFixed(2)} ms, ${(length / inputs.length).toFixed(0)} chars of d per link`,
    );
    expect(routing).toBeLessThan(BUDGET_MS);
    expect(boxes).toBeLessThan(BUDGET_MS);
  });
});

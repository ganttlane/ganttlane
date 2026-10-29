import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { createLayout, layoutRows } from '../layout';
import { normalizeModel, type TaskId } from '../model';
import { createTimeScale, resolveSnap, VIEW_MODE_PRESETS } from '../scale';
import { buildLinkGraph } from '../schedule';
import { asDateTimeMs, createFloatingAdapter } from '../time';
import { createInteraction, type InteractionContext, type PointerInput } from './index';

/**
 * Target from plan step 3.7: a pointer move must stay well under one frame (16 ms) on 10k tasks.
 * Measured on the generated 10k plan in the day mode: a hover move (hit test, cursor), a drag
 * move that stays within one snap step (no new preview), and a drag move that changes the
 * snapped day every time (snap + `propagate` with `conflicts: false` + effects) for a task in the
 * middle of the plan. The worst case, the first task of a chain-heavy plan whose drag moves most
 * of it, is `propagate`'s own cost (plan step 2.4) and is reported only. The assertions are
 * generous so that slow CI machines pass; the measured means (after a warm-up, `Date.now()` has
 * 1 ms resolution) are attached to the test report.
 */
const BUDGET_MS = 16;
const TARGETS = { hover: 0.05, substep: 0.05, preview: 4 } as const;

/** A day-mode context over a generated 10k plan. */
function contextOf(linkDensity: number): InteractionContext {
  const fixture = generateFixture({ count: 10_000, linkDensity });
  const { calendar } = createWorkCalendar(fixture.calendar);
  const model = normalizeModel(fixture, { calendar });
  const hierarchy = buildHierarchy(model);
  const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
  const starts = model.tasks.flatMap((task) => (task.span === undefined ? [] : [task.span.start]));
  const origin = starts.reduce((a, b) => (b < a ? b : a));
  const end = asDateTimeMs(
    model.tasks.reduce<number>((a, task) => Math.max(a, task.span?.endExclusive ?? a), origin),
  );
  const scale = createTimeScale({ origin, pxPerDay: day.pxPerDay });
  const rows = layoutRows(visibleRows(hierarchy, 'all'));
  return {
    model,
    hierarchy,
    graph: buildLinkGraph(model),
    layout: createLayout({ rows, tasks: model.taskById, scale }),
    timeline: { range: { start: origin, end }, scale, scrollLeft: 0, viewportWidth: 1600 },
    snap: resolveSnap({ viewMode: day }).snap,
    adapter: createFloatingAdapter(),
  };
}

function mean(runs: number, run: (i: number) => void): number {
  for (let i = 0; i < Math.min(runs, 200); i++) run(i);
  const start = Date.now();
  for (let i = 0; i < runs; i++) run(runs + i);
  return (Date.now() - start) / runs;
}

/** Pointer events at the middle of a task's bar, shifted by `dx`. */
function pointerOn(
  context: InteractionContext,
  id: TaskId,
): (type: PointerInput['type'], dx: number, time: number) => PointerInput {
  const bar = context.layout.getBarRect(id)!;
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;
  return (type, dx, time) => ({ type, pointerId: 1, x: x + dx, y, time });
}

describe('interaction performance (10 000 generated tasks)', () => {
  it('NFR-PERF-1, FR-EDIT-5: pointer moves stay well under a frame', async ({ annotate }) => {
    const context = contextOf(0.3);
    const { model } = context;
    const middle = model.tasks.find(
      (task, i) => i >= model.tasks.length / 2 && task.span !== undefined && task.type === 'task',
    )!;
    const event = pointerOn(context, middle.id);

    const hovering = createInteraction();
    const hover = mean(5000, (i) => hovering.send(event('move', i % 7, i), context));

    const dragging = createInteraction();
    dragging.send(event('down', 0, 0), context);
    dragging.send(event('move', 10, 1), context);
    const substep = mean(5000, (i) => dragging.send(event('move', 10 + (i % 5), i), context));
    let previews = 0;
    const preview = mean(500, (i) => {
      // One day (40 px) further or back on every move: always a new snapped start.
      const effects = dragging.send(event('move', 40 * (1 + (i % 2)), i), context);
      previews += effects.filter((effect) => effect.type === 'preview').length;
    });

    await annotate(
      `10k tasks: hover ${hover.toFixed(4)} ms (target ≤ ${TARGETS.hover}), drag within a step ${substep.toFixed(4)} ms (target ≤ ${TARGETS.substep}), drag with a new preview ${preview.toFixed(3)} ms (target ≤ ${TARGETS.preview})`,
    );
    expect(previews).toBeGreaterThan(400);
    expect(hover).toBeLessThan(BUDGET_MS);
    expect(substep).toBeLessThan(BUDGET_MS);
    expect(preview).toBeLessThan(BUDGET_MS);
  });

  it('FR-EDIT-5: reports the worst case, a drag that moves most of the plan', async ({
    annotate,
  }) => {
    const context = contextOf(2);
    const first = context.model.tasks[0]!;
    const event = pointerOn(context, first.id);
    const dragging = createInteraction();
    dragging.send(event('down', 0, 0), context);
    let changed = 0;
    const preview = mean(20, (i) => {
      const effects = dragging.send(event('move', 40 * (1 + (i % 2)), i), context);
      for (const effect of effects) {
        if (effect.type === 'preview') changed = effect.changeSet.changes.length;
      }
    });
    await annotate(
      `10k chain-heavy tasks: dragging the first one moves ${changed} tasks per preview in ${preview.toFixed(2)} ms (propagate, plan step 2.4: ≤ 20 ms)`,
    );
    expect(changed).toBeGreaterThan(context.model.tasks.length / 2);
    expect(preview).toBeLessThan(100);
  });
});

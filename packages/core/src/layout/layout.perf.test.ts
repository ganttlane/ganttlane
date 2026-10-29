import { generateFixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, type Row, visibleRows } from '../hierarchy';
import { type NormalizedModel, normalizeModel } from '../model';
import { createTimeScale, type TimeScale } from '../scale';
import { asDateTimeMs } from '../time';
import { createLayout } from './layout';
import { layoutRows } from './rows';
import { barsInWindow, visibleWindow } from './window';

/**
 * Targets from plan step 3.4 (Node, Apple Silicon): rows + every bar of 1k tasks ≤ 5 ms and of
 * 10k tasks ≤ 50 ms (NFR-PERF-1 allows 50 ms for 1k); one 2000 × 1000 px window of bars over 10k
 * tasks ≤ 1 ms (NFR-PERF-3). The measured numbers (means over many runs after a warm-up, as
 * `Date.now()` has 1 ms resolution) are attached to the test report.
 */
const FULL_TARGET_MS = { 1_000: 5, 10_000: 50 } as const;
const WINDOW_TARGET_MS = 1;

interface Prepared {
  readonly model: NormalizedModel;
  readonly rows: readonly Row[];
  readonly scale: TimeScale;
}

function prepare(count: number): Prepared {
  const fixture = generateFixture({ count });
  const { calendar } = createWorkCalendar(fixture.calendar);
  const model = normalizeModel(fixture, { calendar });
  const starts = model.tasks.flatMap((task) => (task.span ? [task.span.start] : []));
  const scale = createTimeScale({ origin: asDateTimeMs(Math.min(...starts)), pxPerDay: 40 });
  return { model, rows: visibleRows(buildHierarchy(model), 'all'), scale };
}

/** The mean time of `run` over `runs` runs, after one warm-up run. */
function mean(runs: number, run: () => void): number {
  run();
  const start = Date.now();
  for (let i = 0; i < runs; i++) run();
  return (Date.now() - start) / runs;
}

describe('layout performance', () => {
  for (const count of [1_000, 10_000] as const) {
    it(`NFR-PERF-1: rows and every bar of ${count} tasks within budget`, async ({ annotate }) => {
      const { model, rows, scale } = prepare(count);
      let bars = 0;
      const elapsed = mean(count === 1_000 ? 200 : 20, () => {
        const layout = createLayout({ rows: layoutRows(rows), tasks: model.taskById, scale });
        bars = 0;
        for (let index = 0; index < rows.length; index++) if (layout.barAt(index)) bars++;
      });
      await annotate(
        `layoutRows + createLayout + ${bars} bars: ${count} rows in ${elapsed.toFixed(3)} ms (target ≤ ${FULL_TARGET_MS[count]} ms)`,
      );
      expect(bars).toBeGreaterThan(count * 0.9);
      expect(elapsed).toBeLessThan(FULL_TARGET_MS[count]);
    });
  }

  it('NFR-PERF-3: a 2000 × 1000 px window of bars over 10k tasks within budget', async ({
    annotate,
  }) => {
    const { model, rows, scale } = prepare(10_000);
    const rowLayout = layoutRows(rows);
    const positions = 500;
    // Windows centred on the start of every 20th row's task, top row first.
    const views = Array.from({ length: positions }, (_, i) => {
      const row = rowLayout.rows[(i * 20) % rows.length]!;
      const start = model.taskById.get(row.id)?.span?.start;
      return {
        scrollLeft: start === undefined ? 0 : scale.dateToX(start) - 1000,
        scrollTop: row.y,
        width: 2000,
        height: 1000,
      };
    });
    let step = 0;
    let shown = 0;
    // A fresh layout per scroll position: no bar is cached, the worst case.
    const elapsed = mean(positions, () => {
      const layout = createLayout({ rows: rowLayout, tasks: model.taskById, scale });
      const window = visibleWindow(views[step++ % positions]!, rowLayout, scale);
      shown += barsInWindow(window, layout).length;
    });
    await annotate(
      `visibleWindow + barsInWindow (cold cache): ${(shown / (positions + 1)).toFixed(1)} bars per window over ${rows.length} rows in ${(elapsed * 1000).toFixed(1)} µs (target ≤ ${WINDOW_TARGET_MS} ms)`,
    );
    expect(shown).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(WINDOW_TARGET_MS);
  });
});

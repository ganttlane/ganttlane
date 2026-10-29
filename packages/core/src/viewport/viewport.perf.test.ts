import { describe, expect, it } from 'vitest';

import { createTimeScale, VIEW_MODE_PRESETS } from '../scale';
import { asDateTimeMs, createFloatingAdapter, type DateTimeMs, DAY, parseDateInput } from '../time';
import { columnGrid } from './columns';
import { type ExtensionPolicy, planExtension } from './extension';
import type { TimelineState } from './state';

/**
 * Target from plan step 3.6: `planExtension` ≤ 0.05 ms per call, so it fits in every scroll frame
 * next to the render. Measured per kind of call (nothing to do, an extension with its column
 * rounding and new scale, a trim), as means over many calls after a warm-up; the numbers are
 * attached to the test report.
 */
const TARGET_MS = 0.05;

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

/** The mean time of `run` over `runs` runs, after a warm-up. */
function mean(runs: number, run: (i: number) => void): number {
  for (let i = 0; i < 1000; i++) run(i);
  const start = Date.now();
  for (let i = 0; i < runs; i++) run(i);
  return (Date.now() - start) / runs;
}

const adapter = createFloatingAdapter();

describe('viewport performance', () => {
  for (const id of ['hour', 'day', 'week', 'month', 'year'] as const) {
    const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id)!;
    const columns = columnGrid(mode, adapter);
    // 40 000 px of content at every zoom level, a 1000 px viewport.
    const start = columns.floor(at('2026-01-01'));
    const end = columns.next(asDateTimeMs(start + Math.round((40_000 * DAY) / mode.pxPerDay)));
    const range = { start, end };
    const scale = createTimeScale({ origin: start, pxPerDay: mode.pxPerDay });
    const width = scale.durationToPx(end - start);
    const plain: ExtensionPolicy = { columns };
    const maxSpan = { months: 0, ms: Math.round((end - start) / 2) };
    const cases: Record<string, readonly [TimelineState, ExtensionPolicy]> = {
      idle: [{ range, scale, scrollLeft: width / 2, viewportWidth: 1000 }, plain],
      extend: [{ range, scale, scrollLeft: 100, viewportWidth: 1000 }, plain],
      // Twice as long as maxSpan, the viewport in the middle.
      trim: [
        { range, scale, scrollLeft: width / 2, viewportWidth: 1000 },
        { columns, maxSpan },
      ],
    };

    it(`FR-TL-2, FR-TL-4: planExtension in the ${id} mode within budget`, async ({ annotate }) => {
      const results: string[] = [];
      for (const [kind, [state, policy]] of Object.entries(cases)) {
        let changes = 0;
        // Slightly different scroll offsets, so nothing can be cached between calls.
        const elapsed = mean(20_000, (i) => {
          if (planExtension({ ...state, scrollLeft: state.scrollLeft + (i % 7) * 0.25 }, policy)) {
            changes++;
          }
        });
        if (kind === 'idle') expect(changes, kind).toBe(0);
        else expect(changes, kind).toBeGreaterThan(0);
        results.push(`${kind} ${(elapsed * 1000).toFixed(2)} µs`);
        expect(elapsed, kind).toBeLessThan(TARGET_MS);
      }
      await annotate(
        `planExtension (${id}): ${results.join(', ')} (target ≤ ${TARGET_MS * 1000} µs)`,
      );
    });
  }
});

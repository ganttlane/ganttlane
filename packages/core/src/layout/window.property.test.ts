import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { TaskId, TaskType } from '../model';
import { createTimeScale } from '../scale';
import { asDateTimeMs, HOUR, parseDateInput } from '../time';
import { type BarGeometry, barGeometry, type BarSource } from './bars';
import { createLayout } from './layout';
import { layoutRows } from './rows';
import { barsInWindow, type Viewport, visibleWindow, type WindowOptions } from './window';

const parsed = parseDateInput('2026-03-01');
if (!parsed.ok) throw new Error(parsed.issue.message);
const ORIGIN = parsed.value.value;
/** Spans are whole multiples of 6 h, like a `'6h'` granularity. */
const STEP = 6 * HOUR;

interface TaskSpec {
  readonly type: TaskType | 'invalid';
  readonly start: number;
  readonly length: number;
  readonly done: number;
  /** Under a collapsed parent: no row. */
  readonly hidden: boolean;
}

const taskSpec: fc.Arbitrary<TaskSpec> = fc.record({
  type: fc.constantFrom<TaskType | 'invalid'>(
    'task',
    'task',
    'task',
    'milestone',
    'placeholder',
    'invalid',
  ),
  start: fc.integer({ min: -40, max: 800 }),
  length: fc.integer({ min: 0, max: 120 }),
  done: fc.double({ min: 0, max: 1, noNaN: true }),
  hidden: fc.boolean(),
});

/** Positions in quarter pixels, like scroll offsets on a high-density screen. */
const quarterPx = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: min * 4, max: max * 4 }).map((n) => n / 4);

const scenario = fc.record({
  specs: fc.array(taskSpec, { maxLength: 150 }),
  rowHeight: fc.integer({ min: 1, max: 80 }),
  headerRowHeights: fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 3 }),
  pxPerDay: fc.constantFrom(1, 4, 20, 40, 80, 160, 960),
  viewport: fc.record<Viewport>({
    scrollLeft: quarterPx(-2_000, 40_000),
    scrollTop: quarterPx(-200, 8_000),
    width: quarterPx(0, 2_500),
    height: quarterPx(0, 1_500),
  }),
  options: fc.record<WindowOptions>({
    overscanRows: fc.integer({ min: 0, max: 10 }),
    overscanPx: quarterPx(0, 800),
  }),
});

function source(spec: TaskSpec): BarSource {
  if (spec.type === 'invalid') return { type: 'task', span: undefined };
  const start = asDateTimeMs(ORIGIN + spec.start * STEP);
  const length = spec.type === 'milestone' ? 0 : spec.length * STEP;
  const span = {
    start,
    endExclusive: asDateTimeMs(start + length),
    progressDate: asDateTimeMs(start + Math.round(spec.done * length)),
  };
  return { type: spec.type, span };
}

describe('layout window properties', () => {
  it('§7a, NFR-PERF-1: barsInWindow is exactly the brute-force intersection', () => {
    fc.assert(
      fc.property(
        scenario,
        ({ specs, rowHeight, headerRowHeights, pxPerDay, viewport, options }) => {
          const tasks = new Map<TaskId, BarSource>(specs.map((spec, i) => [`t${i}`, source(spec)]));
          const visibleIds = specs.flatMap((spec, i) => (spec.hidden ? [] : [`t${i}`]));
          const rows = layoutRows(
            visibleIds.map((id) => ({ id })),
            { rowHeight, headerRowHeights },
          );
          const scale = createTimeScale({ origin: ORIGIN, pxPerDay });
          const layout = createLayout({ rows, tasks, scale });
          const window = visibleWindow(viewport, rows, scale, options);

          // Rows: those intersecting the body band under the header, widened by the overscan.
          const top = viewport.scrollTop;
          const bottom = top + Math.max(viewport.height - rows.headerHeight, 0);
          const inBand = visibleIds
            .map((_, index) => index)
            // An empty band (no body under the header) touches nothing.
            .filter(
              (index) =>
                top < bottom && index * rowHeight < bottom && (index + 1) * rowHeight > top,
            );
          const overscan = options.overscanRows ?? 0;
          const expectedFirst = inBand.length === 0 ? 0 : Math.max(inBand[0]! - overscan, 0);
          const expectedLast =
            inBand.length === 0 ? -1 : Math.min(inBand.at(-1)! + overscan, visibleIds.length - 1);
          expect([window.firstRow, window.lastRow]).toEqual([expectedFirst, expectedLast]);

          // Bars: every task, placed in its row if it has one, kept if inside the window.
          const left = viewport.scrollLeft - (options.overscanPx ?? 0);
          const right = viewport.scrollLeft + viewport.width + (options.overscanPx ?? 0);
          const expected: BarGeometry[] = [];
          for (const [id, task] of tasks) {
            const row = rows.rowOf(id);
            if (row === undefined || row.index < window.firstRow || row.index > window.lastRow)
              continue;
            const bar = barGeometry(task, row, scale);
            if (bar !== undefined && bar.x <= right && bar.x + bar.width >= left)
              expected.push(bar);
          }
          expected.sort((a, b) => a.rowIndex - b.rowIndex);
          expect(barsInWindow(window, layout)).toEqual(expected);
          // Hidden (collapsed) tasks never show up.
          for (const bar of barsInWindow(window, layout)) {
            expect(specs[Number(String(bar.id).slice(1))]!.hidden).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('FR-ROW-5: rowAt and rowOf agree with the row positions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 1, max: 80 }),
        quarterPx(-100, 25_000),
        (count, rowHeight, y) => {
          const rows = layoutRows(
            Array.from({ length: count }, (_, i) => ({ id: i })),
            { rowHeight },
          );
          const row = rows.rowAt(y);
          if (y < 0 || y >= count * rowHeight) {
            expect(row).toBeUndefined();
            return;
          }
          expect(row).toBeDefined();
          expect(row!.y <= y && y < row!.y + row!.height).toBe(true);
          expect(rows.rowOf(row!.id)).toBe(row);
          expect(rows.rows[row!.index]).toBe(row);
        },
      ),
    );
  });
});

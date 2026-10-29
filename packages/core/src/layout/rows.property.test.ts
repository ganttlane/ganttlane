import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { layoutRows, type RowLayout } from './rows';

/** Where row `i` ends: the next row's stored `y`, or the body height after the last row. */
function bottomOf(layout: RowLayout, index: number): number {
  return layout.rows[index + 1]?.y ?? layout.bodyHeight;
}

const scenario = fc.record({
  count: fc.integer({ min: 0, max: 300 }),
  // Any row height, most of them not binary fractions (33.3, 0.1 …).
  rowHeight: fc.double({ min: 0.05, max: 120, noNaN: true }),
  a: fc.double({ min: -0.1, max: 1.1, noNaN: true }),
  b: fc.double({ min: -0.1, max: 1.1, noNaN: true }),
});

describe('layout rows properties', () => {
  it('FR-ROW-5: rowAt finds every row at its own stored y, and the row whose band holds a position', () => {
    fc.assert(
      fc.property(scenario, ({ count, rowHeight, a }) => {
        const layout = layoutRows(
          Array.from({ length: count }, (_, i) => ({ id: i })),
          { rowHeight },
        );
        for (const row of layout.rows) expect(layout.rowAt(row.y)).toBe(row);
        const at = a * layout.bodyHeight;
        const found = layout.rowAt(at);
        const expected = layout.rows.findLast((row) => row.y <= at);
        if (at < 0 || at >= layout.bodyHeight || expected === undefined) {
          expect(found).toBeUndefined();
          return;
        }
        expect(found).toBe(expected);
        expect(at).toBeLessThan(bottomOf(layout, found!.index));
      }),
      { numRuns: 300 },
    );
  });

  it('FR-ROW-5: rowRange is exactly the rows whose band overlaps [top, bottom)', () => {
    fc.assert(
      fc.property(scenario, ({ count, rowHeight, a, b }) => {
        const layout = layoutRows(
          Array.from({ length: count }, (_, i) => ({ id: i })),
          { rowHeight },
        );
        // Bands from stored row edges (the risky case) and from arbitrary positions.
        const edge = (fraction: number): number =>
          layout.rows[Math.floor(Math.min(Math.max(fraction, 0), 0.999) * count)]?.y ?? 0;
        for (const [top, bottom] of [
          [a * layout.bodyHeight, b * layout.bodyHeight],
          [edge(a), edge(b)],
          [edge(a), b * layout.bodyHeight],
        ] as const) {
          const touched = layout.rows.filter(
            (row) => Math.max(row.y, top) < Math.min(bottomOf(layout, row.index), bottom),
          );
          const { first, last } = layout.rowRange(top, bottom);
          if (touched.length === 0) {
            expect(first).toBeGreaterThan(last);
            continue;
          }
          expect([first, last]).toEqual([touched[0]!.index, touched.at(-1)!.index]);
        }
      }),
      { numRuns: 300 },
    );
  });
});

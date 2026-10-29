import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { normalizeModel, type Task } from '../model';
import { layoutRows } from './rows';

const ids = (count: number): { id: string }[] =>
  Array.from({ length: count }, (_, i) => ({ id: `t${i}` }));

describe('layout/rows', () => {
  it('FR-ROW-5: stacks the visible rows at the default row height', () => {
    const layout = layoutRows(ids(3));
    expect(layout.rows).toEqual([
      { id: 't0', index: 0, y: 0, height: 48 },
      { id: 't1', index: 1, y: 48, height: 48 },
      { id: 't2', index: 2, y: 96, height: 48 },
    ]);
    expect(layout.rowHeight).toBe(48);
    expect(layout.bodyHeight).toBe(144);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.rows)).toBe(true);
    expect(Object.isFrozen(layout.rows[0])).toBe(true);
  });

  it('FR-ROW-5: the header is the sum of its rows (no upstream "+ 10")', () => {
    const defaults = layoutRows([]);
    expect(defaults.headerRowHeights).toEqual([45, 30]);
    expect(defaults.headerHeight).toBe(75);
    expect(defaults.bodyHeight).toBe(0);

    const custom = layoutRows(ids(2), { rowHeight: 30, headerRowHeights: [40, 24, 20] });
    expect(custom.headerHeight).toBe(84);
    expect(custom.bodyHeight).toBe(60);
    expect(custom.rows[1]).toEqual({ id: 't1', index: 1, y: 30, height: 30 });
    expect(Object.isFrozen(custom.headerRowHeights)).toBe(true);
    expect(layoutRows([], { headerRowHeights: [] }).headerHeight).toBe(0);
  });

  it('FR-ROW-5: rowAt finds the row under a body position; a boundary belongs to the row below', () => {
    const layout = layoutRows(ids(3), { rowHeight: 40 });
    const at = (y: number): number | undefined => layout.rowAt(y)?.index;
    expect(at(0)).toBe(0);
    expect(at(39.999)).toBe(0);
    expect(at(40)).toBe(1);
    expect(at(80)).toBe(2);
    expect(at(119.999)).toBe(2);
    expect(at(120)).toBeUndefined();
    expect(at(-0.001)).toBeUndefined();
    expect(at(Number.NaN)).toBeUndefined();
    expect(layoutRows([]).rowAt(0)).toBeUndefined();
    // Just below the body with a row height that is not a binary fraction.
    const thin = layoutRows(ids(3), { rowHeight: 0.1 });
    expect(thin.rowAt(thin.bodyHeight - Number.EPSILON)?.index).toBe(2);
  });

  it('FR-ROW-5: rowOf finds a visible row by task id', () => {
    const layout = layoutRows([{ id: 1 }, { id: '1' }, { id: 'b' }]);
    expect(layout.rowOf(1)?.index).toBe(0);
    expect(layout.rowOf('1')?.index).toBe(1);
    expect(layout.rowOf('b')).toBe(layout.rows[2]);
    expect(layout.rowOf('missing')).toBeUndefined();
  });

  it('FR-ROW-2, FR-ROW-5: rows of a collapsed parent are not laid out', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task[] = [
      { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-06' },
      { id: 'child', name: 'Child', parentId: 'phase', start: '2026-03-02', end: '2026-03-03' },
      { id: 'next', name: 'Next', start: '2026-03-09', end: '2026-03-10' },
    ];
    const tree = buildHierarchy(normalizeModel({ tasks }, { calendar }));
    const collapsed = layoutRows(visibleRows(tree, []));
    expect(collapsed.rows.map((row) => [row.id, row.y])).toEqual([
      ['phase', 0],
      ['next', 48],
    ]);
    expect(collapsed.rowOf('child')).toBeUndefined();
    expect(layoutRows(visibleRows(tree, 'all')).rowOf('next')?.y).toBe(96);
  });

  it('FR-ROW-5: rowRange lists the rows a vertical band touches', () => {
    const layout = layoutRows(ids(5), { rowHeight: 10 });
    const range = (top: number, bottom: number): [number, number] => {
      const { first, last } = layout.rowRange(top, bottom);
      return [first, last];
    };
    expect(range(0, 10)).toEqual([0, 0]);
    expect(range(0, 10.5)).toEqual([0, 1]);
    expect(range(9.5, 10.5)).toEqual([0, 1]);
    expect(range(10, 20)).toEqual([1, 1]);
    expect(range(15, 35)).toEqual([1, 3]);
    expect(range(-100, 15)).toEqual([0, 1]);
    expect(range(45, 1000)).toEqual([4, 4]);
    expect(range(-Infinity, Infinity)).toEqual([0, 4]);
    // Empty: nothing between, outside the body, reversed, NaN.
    for (const [top, bottom] of [
      [20, 20],
      [50, 60],
      [-20, 0],
      [30, 20],
      [Number.NaN, 20],
    ] as const) {
      const empty = layout.rowRange(top, bottom);
      expect(empty.first).toBeGreaterThan(empty.last);
    }
    expect(layoutRows([]).rowRange(0, 100)).toEqual({ first: 0, last: -1 });
  });

  it('FR-ROW-5: rowAt and rowRange agree with the stored y of a row height that is not a binary fraction', () => {
    const layout = layoutRows(ids(100), { rowHeight: 33.3 });
    const row = layout.rows[63]!;
    const next = layout.rows[64]!;
    // 63 × 33.3 is stored as 2097.8999999999996, whose quotient by 33.3 floors to 62.
    expect(row.y / 33.3).toBeLessThan(63);
    expect(layout.rowAt(row.y)).toBe(row);
    expect(layout.rowAt(next.y)).toBe(next);
    expect(layout.rowRange(row.y, next.y)).toEqual({ first: 63, last: 63 });
    expect(layout.rowRange(row.y - 0.001, next.y + 0.001)).toEqual({ first: 62, last: 64 });
  });

  it('throws on sizes that are programming errors', () => {
    for (const rowHeight of [0, -1, Number.NaN, Infinity]) {
      expect(() => layoutRows([], { rowHeight })).toThrow(RangeError);
    }
    for (const height of [-1, Number.NaN, Infinity]) {
      expect(() => layoutRows([], { headerRowHeights: [30, height] })).toThrow(RangeError);
    }
  });

  it('never mutates its input', () => {
    const rows = Object.freeze([Object.freeze({ id: 'a' })]);
    const headerRowHeights = Object.freeze([40]);
    const layout = layoutRows(rows, { headerRowHeights });
    expect(layout.rows[0]).not.toBe(rows[0]);
    expect(layout.headerRowHeights).toEqual([40]);
  });
});

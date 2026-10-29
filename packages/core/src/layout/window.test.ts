import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { normalizeModel, type Task } from '../model';
import { createTimeScale, headerRows, VIEW_MODE_PRESETS } from '../scale';
import { asDateTimeMs, createFloatingAdapter, type DateTimeMs, DAY, parseDateInput } from '../time';
import type { BarSource } from './bars';
import { createLayout } from './layout';
import { layoutRows } from './rows';
import { barsInWindow, visibleWindow } from './window';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

const origin = at('2026-03-01');
const scale = createTimeScale({ origin, pxPerDay: 40 });
/** 100 rows of 48 px under the default 75 px header. */
const rows = layoutRows(Array.from({ length: 100 }, (_, i) => ({ id: i })));
const NO_OVERSCAN = { overscanRows: 0, overscanPx: 0 };

describe('layout/window', () => {
  it('§7a: the rows under the sticky header and the dates across the viewport', () => {
    // 75 px of header + 3 rows of body.
    const view = { scrollLeft: 80, scrollTop: 0, width: 400, height: 75 + 144 };
    const window = visibleWindow(view, rows, scale, NO_OVERSCAN);
    expect(window).toEqual({
      firstRow: 0,
      lastRow: 2,
      start: at('2026-03-03'),
      end: at('2026-03-13'),
      left: 80,
      right: 480,
    });
    expect(Object.isFrozen(window)).toBe(true);
    // Half a row more shows part of row 3.
    expect(visibleWindow({ ...view, height: 75 + 168 }, rows, scale, NO_OVERSCAN).lastRow).toBe(3);
  });

  it('§7a: partially scrolled rows count, a boundary does not', () => {
    const view = { scrollLeft: 0, scrollTop: 60, width: 400, height: 75 + 96 };
    // Body band [60, 156): rows 1 (48…96), 2 (96…144) and 3 (144…192).
    expect(visibleWindow(view, rows, scale, NO_OVERSCAN)).toMatchObject({
      firstRow: 1,
      lastRow: 3,
    });
    // Body band [48, 144): exactly rows 1 and 2.
    const aligned = visibleWindow({ ...view, scrollTop: 48 }, rows, scale, NO_OVERSCAN);
    expect(aligned).toMatchObject({ firstRow: 1, lastRow: 2 });
  });

  it('§7a: overscan widens the window, within the rows', () => {
    const view = { scrollLeft: 1000, scrollTop: 480, width: 800, height: 75 + 480 };
    const window = visibleWindow(view, rows, scale, { overscanRows: 3, overscanPx: 200 });
    expect(window).toMatchObject({ firstRow: 7, lastRow: 22, left: 800, right: 2000 });
    expect(window.start).toBe(origin + 20 * DAY);
    expect(window.end).toBe(origin + 50 * DAY);
    // At the top and the bottom the overscan is cut at the first and the last row.
    expect(
      visibleWindow({ ...view, scrollTop: 0 }, rows, scale, { overscanRows: 3 }),
    ).toMatchObject({
      firstRow: 0,
      lastRow: 12,
    });
    const bottom = visibleWindow({ ...view, scrollTop: 4800 - 480 }, rows, scale, {
      overscanRows: 3,
    });
    expect(bottom).toMatchObject({ firstRow: 87, lastRow: 99 });
  });

  it('§7a: default overscan is 5 rows and 400 px; negative overscan counts as none', () => {
    const view = { scrollLeft: 1000, scrollTop: 480, width: 800, height: 75 + 480 };
    expect(visibleWindow(view, rows, scale)).toMatchObject({
      firstRow: 5,
      lastRow: 24,
      left: 600,
      right: 2200,
    });
    expect(visibleWindow(view, rows, scale, { overscanRows: -2, overscanPx: -50 })).toMatchObject({
      firstRow: 10,
      lastRow: 19,
      left: 1000,
      right: 1800,
    });
  });

  it('§7a: no rows when the viewport shows no body', () => {
    const empty = (window: { firstRow: number; lastRow: number }): boolean =>
      window.firstRow > window.lastRow;
    // Only the header fits.
    const short = { scrollLeft: 0, scrollTop: 0, width: 400, height: 60 };
    expect(empty(visibleWindow(short, rows, scale))).toBe(true);
    // Scrolled past the last row.
    const past = { scrollLeft: 0, scrollTop: 5000, width: 400, height: 600 };
    expect(empty(visibleWindow(past, rows, scale))).toBe(true);
    // No rows at all; the time range is still there.
    const none = visibleWindow({ ...short, height: 600 }, layoutRows([]), scale, NO_OVERSCAN);
    expect(none).toMatchObject({ firstRow: 0, lastRow: -1, start: origin, end: origin + 10 * DAY });
    // A negative width shows no time.
    const flat = visibleWindow({ ...short, width: -10 }, rows, scale, NO_OVERSCAN);
    expect([flat.start, flat.end]).toEqual([origin, origin]);
  });

  it('FR-SCALE-4: the window is a time range for the header rows', () => {
    const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
    const view = { scrollLeft: 0, scrollTop: 0, width: 120, height: 600 };
    const window = visibleWindow(view, rows, scale, NO_OVERSCAN);
    const ctx = { scale, adapter: createFloatingAdapter(), locale: 'en' };
    const [, days] = headerRows(day, window, ctx);
    expect([...days!].map((cell) => cell.label)).toEqual(['1', '2', '3']);
  });

  describe('barsInWindow', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task[] = [
      // Row 0: days 2 … 4 → x 40 … 160.
      { id: 'early', name: 'Early', start: '2026-03-02', end: '2026-03-04' },
      // Row 1: a parent, x 400 … 800, collapsed below.
      { id: 'phase', name: 'Phase', start: '2026-03-11', end: '2026-03-20' },
      { id: 'child', name: 'Child', parentId: 'phase', start: '2026-03-11', end: '2026-03-12' },
      // Row 2 when collapsed: a placeholder.
      { id: 'stub', name: 'Stub', type: 'placeholder' },
      // Row 3: a milestone at x 200, its diamond spans 185 … 215.
      { id: 'gate', name: 'Gate', type: 'milestone', start: '2026-03-06' },
      // Row 4: far right.
      { id: 'late', name: 'Late', start: '2026-05-01', end: '2026-05-02' },
    ];
    const model = normalizeModel({ tasks }, { calendar });
    const tree = buildHierarchy(model);
    const visible = (keys: 'all' | readonly string[]): ReturnType<typeof createLayout> =>
      createLayout({ rows: layoutRows(visibleRows(tree, keys)), tasks: model.taskById, scale });
    const everything = { scrollLeft: 0, scrollTop: 0, width: 1000, height: 1000 };

    it('§7a: bars of the rows in the window that intersect its time range', () => {
      const layout = visible([]);
      const ids = (left: number, width: number): unknown[] => {
        const window = visibleWindow(
          { ...everything, scrollLeft: left, width },
          layout.rows,
          scale,
          NO_OVERSCAN,
        );
        return barsInWindow(window, layout).map((bar) => bar.id);
      };
      expect(ids(0, 1000)).toEqual(['early', 'phase', 'gate']);
      expect(ids(170, 100)).toEqual(['gate']);
      expect(ids(300, 50)).toEqual([]);
      expect(ids(2400, 100)).toEqual(['late']);
      expect(
        Object.isFrozen(barsInWindow(visibleWindow(everything, layout.rows, scale), layout)),
      ).toBe(true);
    });

    it('§7a: bars touching an edge of the window count', () => {
      const layout = visible([]);
      const window = (left: number, width: number) =>
        visibleWindow({ ...everything, scrollLeft: left, width }, layout.rows, scale, NO_OVERSCAN);
      // `early` ends at 160, `gate` starts at 185.
      expect(barsInWindow(window(160, 25), layout).map((bar) => bar.id)).toEqual(['early', 'gate']);
      expect(barsInWindow(window(161, 23), layout)).toEqual([]);
    });

    it('§7a: only the rows of the window, and never bars of collapsed rows', () => {
      const layout = visible([]);
      // Rows 1 … 2 (y 48 … 144): the phase and the placeholder.
      const band = visibleWindow(
        { ...everything, scrollTop: 48, height: 75 + 96 },
        layout.rows,
        scale,
        NO_OVERSCAN,
      );
      expect(band).toMatchObject({ firstRow: 1, lastRow: 2 });
      expect(barsInWindow(band, layout).map((bar) => bar.id)).toEqual(['phase']);
      const all = barsInWindow(visibleWindow(everything, layout.rows, scale), layout);
      expect(all.map((bar) => bar.id)).not.toContain('child');
      const expanded = visible('all');
      const ids = barsInWindow(visibleWindow(everything, expanded.rows, scale), expanded).map(
        (bar) => bar.id,
      );
      expect(ids).toEqual(['early', 'phase', 'child', 'gate']);
    });

    it('§7a: a zero-width bar on the window edge counts', () => {
      const point: BarSource = {
        type: 'task',
        span: {
          start: at('2026-03-04'),
          endExclusive: at('2026-03-04'),
          progressDate: at('2026-03-04'),
        },
      };
      const layout = createLayout({
        rows: layoutRows([{ id: 'p' }]),
        tasks: new Map([['p', point]]),
        scale,
      });
      const window = (left: number) =>
        visibleWindow(
          { ...everything, scrollLeft: left, width: 40 },
          layout.rows,
          scale,
          NO_OVERSCAN,
        );
      expect(barsInWindow(window(120), layout)).toHaveLength(1);
      expect(barsInWindow(window(80), layout)).toHaveLength(1);
      expect(barsInWindow(window(121), layout)).toHaveLength(0);
    });

    it('§7a, NFR-PERF-1: a fractional or non-finite overscan still lists the bars', () => {
      const layout = visible([]);
      const ids = (options: Parameters<typeof visibleWindow>[3]): unknown[] =>
        barsInWindow(visibleWindow(everything, layout.rows, scale, options), layout).map(
          (bar) => bar.id,
        );
      const all = ['early', 'phase', 'gate'];
      // A fraction is floored, so rows stay whole indexes.
      const fractional = visibleWindow(
        { ...everything, scrollTop: 96, height: 75 + 48 },
        layout.rows,
        scale,
        { overscanRows: 1.5, overscanPx: 0 },
      );
      expect(fractional).toMatchObject({ firstRow: 1, lastRow: 3 });
      expect(ids({ overscanRows: 2.5 })).toEqual(all);
      // Not finite: the default, 5 rows and 400 px.
      for (const value of [Number.NaN, Infinity, -Infinity]) {
        const window = visibleWindow(everything, layout.rows, scale, {
          overscanRows: value,
          overscanPx: value,
        });
        expect(window).toMatchObject({ firstRow: 0, lastRow: 4, left: -400, right: 1400 });
        expect(ids({ overscanRows: value, overscanPx: value })).toEqual(all);
      }
    });

    it('ignores rows of a window beyond the layout', () => {
      const layout = visible([]);
      const window = Object.freeze({
        firstRow: -3,
        lastRow: 1_000_000,
        start: asDateTimeMs(origin),
        end: asDateTimeMs(origin + 365 * DAY),
        left: 0,
        right: 365 * 40,
      });
      expect(barsInWindow(window, layout).map((bar) => bar.id)).toEqual([
        'early',
        'phase',
        'gate',
        'late',
      ]);
    });
  });
});

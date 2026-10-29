import { describe, expect, it } from 'vitest';

import { LAYOUT_DEFAULTS, type LayoutOptions, resolveLayoutOptions } from './dimensions';

describe('layout/dimensions', () => {
  it('FR-ROW-5: defaults follow the fork, without the magic header margin', () => {
    expect(LAYOUT_DEFAULTS).toEqual({
      rowHeight: 48,
      barHeight: 30,
      barRadius: 3,
      headerRowHeights: [45, 30],
      labelPadding: 5,
      labelHandleReach: 16,
      overscanRows: 5,
      overscanPx: 400,
    });
    expect(Object.isFrozen(LAYOUT_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(LAYOUT_DEFAULTS.headerRowHeights)).toBe(true);

    const { options, issues } = resolveLayoutOptions(undefined, 2);
    expect(options).toEqual({
      rowHeight: 48,
      barHeight: 30,
      barRadius: 3,
      headerRowHeights: [45, 30],
    });
    expect(issues).toEqual([]);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.headerRowHeights)).toBe(true);
  });

  it('FR-ROW-5: one header height per header row of the view mode', () => {
    const heights = (
      headerRowHeight: LayoutOptions['headerRowHeight'],
      count: number,
    ): number[] => [...resolveLayoutOptions({ headerRowHeight }, count).options.headerRowHeights];
    expect(heights(undefined, 0)).toEqual([]);
    expect(heights(undefined, 1)).toEqual([45]);
    expect(heights(undefined, 3)).toEqual([45, 30, 30]);
    expect(heights(32, 3)).toEqual([32, 32, 32]);
    expect(heights(0, 2)).toEqual([0, 0]);
    expect(heights([50], 2)).toEqual([50, 30]);
    expect(heights([50, 40, 20], 2)).toEqual([50, 40]);
    expect(heights([], 2)).toEqual([45, 30]);
  });

  it('FR-ROW-5: takes valid sizes as given', () => {
    const { options, issues } = resolveLayoutOptions(
      { rowHeight: 36.5, barHeight: 20, barRadius: 0, headerRowHeight: [40, 24] },
      2,
    );
    expect(options).toEqual({
      rowHeight: 36.5,
      barHeight: 20,
      barRadius: 0,
      headerRowHeights: [40, 24],
    });
    expect(issues).toEqual([]);
  });

  it('FR-ROW-5: the default bar fits a low row; a taller bar is clamped with a warning', () => {
    expect(resolveLayoutOptions({ rowHeight: 24 }, 2)).toEqual({
      options: { rowHeight: 24, barHeight: 24, barRadius: 3, headerRowHeights: [45, 30] },
      issues: [],
    });
    const { options, issues } = resolveLayoutOptions({ rowHeight: 24, barHeight: 30 }, 2);
    expect(options.barHeight).toBe(24);
    expect(issues).toEqual([
      {
        code: 'invalid-layout-option',
        severity: 'warning',
        message: 'layout.barHeight: 30 is taller than the row (24), clamped',
        path: 'barHeight',
        value: 30,
        suggested: 24,
      },
    ]);
  });

  it('FR-ROW-5: unusable sizes are errors and fall back to their defaults', () => {
    const { options, issues } = resolveLayoutOptions(
      {
        rowHeight: 0,
        barHeight: Number.NaN,
        barRadius: -1,
        headerRowHeight: [Infinity, -2],
      },
      3,
    );
    expect(options).toEqual({
      rowHeight: 48,
      barHeight: 30,
      barRadius: 3,
      headerRowHeights: [45, 30, 30],
    });
    expect(
      issues.map((issue) => [issue.path, issue.severity, issue.value, issue.suggested]),
    ).toEqual([
      ['rowHeight', 'error', 0, 48],
      ['barHeight', 'error', Number.NaN, 30],
      ['barRadius', 'error', -1, 3],
      ['headerRowHeight[0]', 'error', Infinity, 45],
      ['headerRowHeight[1]', 'error', -2, 30],
    ]);
    expect(issues[0]!.message).toBe('layout.rowHeight: 0 is not a finite number greater than 0');
    expect(issues[2]!.message).toBe('layout.barRadius: -1 is not a finite number, 0 or more');
    expect(new Set(issues.map((issue) => issue.code))).toEqual(new Set(['invalid-layout-option']));
    expect(Object.isFrozen(issues)).toBe(true);
    expect(Object.isFrozen(issues[0])).toBe(true);
  });

  it('FR-ROW-5: a malformed value from an untyped caller is reported, not thrown', () => {
    const untyped = { rowHeight: '48', headerRowHeight: 'tall' } as unknown as LayoutOptions;
    const { options, issues } = resolveLayoutOptions(untyped, 2);
    expect(options).toEqual({
      rowHeight: 48,
      barHeight: 30,
      barRadius: 3,
      headerRowHeights: [45, 30],
    });
    expect(issues.map((issue) => [issue.path, issue.suggested])).toEqual([
      ['rowHeight', 48],
      ['headerRowHeight', [45, 30]],
    ]);
  });

  it('never mutates the options', () => {
    const options: LayoutOptions = Object.freeze({
      rowHeight: 40,
      headerRowHeight: Object.freeze([50]),
    });
    expect(resolveLayoutOptions(options, 2).options.headerRowHeights).toEqual([50, 30]);
  });
});

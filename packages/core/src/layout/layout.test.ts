import { describe, expect, it, vi } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { normalizeModel, type Task, type TaskId } from '../model';
import { createTimeScale } from '../scale';
import { asDateTimeMs, type DateTimeMs, DAY, parseDateInput } from '../time';
import type { BarSource } from './bars';
import { type BarLookup, createLayout } from './layout';
import { layoutRows } from './rows';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

const { calendar } = createWorkCalendar();
const tasks: Task[] = [
  { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-13', progress: 50 },
  { id: 'design', name: 'Design', parentId: 'phase', start: '2026-03-02', end: '2026-03-06' },
  { id: 'gate', name: 'Gate', parentId: 'phase', type: 'milestone', start: '2026-03-09' },
  { id: 'tbd', name: 'To be scheduled', parentId: 'phase', type: 'placeholder' },
  { id: 'later', name: 'Later', start: '2026-04-01', duration: 3 },
];
const model = normalizeModel({ tasks }, { calendar });
const tree = buildHierarchy(model);
const scale = createTimeScale({ origin: at('2026-03-01'), pxPerDay: 40 });

describe('layout/layout', () => {
  it('FR-ROW-5, FR-API-5: getRowMetrics and getBarRect over the visible rows', () => {
    const rows = layoutRows(visibleRows(tree, 'all'));
    const layout = createLayout({ rows, tasks: model.taskById, scale });
    expect(Object.isFrozen(layout)).toBe(true);
    expect(layout.rows).toBe(rows);
    expect(layout.scale).toBe(scale);
    expect(layout.getRowMetrics('gate')).toEqual({ id: 'gate', index: 2, y: 96, height: 48 });
    expect(layout.getBarRect('design')).toEqual({
      id: 'design',
      rowIndex: 1,
      kind: 'bar',
      x: 40,
      y: 48 + 9,
      width: 200,
      height: 30,
      radius: 3,
      progressWidth: 0,
    });
    expect(layout.getBarRect('phase')).toMatchObject({ x: 40, width: 480, progressWidth: 240 });
    expect(layout.getBarRect('gate')).toMatchObject({ kind: 'milestone', x: 8 * 40 - 15 });
    // A placeholder has a row but no bar.
    expect(layout.getRowMetrics('tbd')?.index).toBe(3);
    expect(layout.getBarRect('tbd')).toBeUndefined();
    expect(layout.getRowMetrics('unknown')).toBeUndefined();
    expect(layout.getBarRect('unknown')).toBeUndefined();
  });

  it('FR-ROW-2, FR-API-5: a collapsed child has neither row metrics nor a bar', () => {
    const rows = layoutRows(visibleRows(tree, []));
    const layout = createLayout({ rows, tasks: model.taskById, scale });
    expect(layout.getRowMetrics('design')).toBeUndefined();
    expect(layout.getBarRect('design')).toBeUndefined();
    expect(layout.getBarRect('later')).toMatchObject({ rowIndex: 1, y: 48 + 9 });
  });

  it('FR-ROW-5: bar sizes come from the input', () => {
    const rows = layoutRows(visibleRows(tree, 'all'), { rowHeight: 40 });
    const layout = createLayout({
      rows,
      tasks: model.taskById,
      scale,
      barHeight: 20,
      barRadius: 0,
    });
    expect(layout.getBarRect('later')).toMatchObject({ y: 4 * 40 + 10, height: 20, radius: 0 });
  });

  it('NFR-PERF-1: bars are placed on first use and cached', () => {
    const rows = layoutRows(visibleRows(tree, 'all'));
    const get = vi.fn((id: TaskId): BarSource | undefined => model.taskById.get(id));
    const layout = createLayout({ rows, tasks: { get }, scale });
    expect(get).not.toHaveBeenCalled();
    const bar = layout.barAt(1);
    expect(layout.getBarRect('design')).toBe(bar);
    expect(layout.barAt(3)).toBeUndefined();
    expect(layout.barAt(3)).toBeUndefined();
    expect(get.mock.calls).toEqual([['design'], ['tbd']]);
    expect(layout.barAt(-1)).toBeUndefined();
    expect(layout.barAt(99)).toBeUndefined();
    expect(layout.barAt(0.5)).toBeUndefined();
  });

  it('places draft-overlaid spans from a custom lookup', () => {
    const rows = layoutRows(visibleRows(tree, 'all'));
    const design = model.taskById.get('design')!;
    const moved = { ...design.span!, start: asDateTimeMs(design.span!.start + DAY) };
    const tasks: BarLookup = {
      get: (id) => (id === 'design' ? { type: design.type, span: moved } : model.taskById.get(id)),
    };
    const layout = createLayout({ rows, tasks, scale });
    expect(layout.getBarRect('design')).toMatchObject({ x: 80, width: 160 });
    // A row whose task the lookup does not know has no bar.
    const empty = createLayout({ rows, tasks: new Map<TaskId, BarSource>(), scale });
    expect(empty.getBarRect('design')).toBeUndefined();
  });
});

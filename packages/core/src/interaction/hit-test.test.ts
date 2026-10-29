import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { createLayout, type Layout, layoutRows } from '../layout';
import { normalizeModel, type Task } from '../model';
import { createTimeScale } from '../scale';
import { parseDateInput } from '../time';
import {
  barHandles,
  type HitTarget,
  hitTest,
  type HitTestInput,
  INTERACTION_DEFAULTS,
  type TaskPermissions,
} from './index';

const { calendar } = createWorkCalendar();

/**
 * Day scale, 40 px per day from 2026-03-01, granularity 1 h; rows 48 px with 30 px bars (rows at y 0, 48, 96, 144,
 * bars 9 px below the row top):
 * - `a` 03-02 … 03-06 at 50 %: x 40 … 240, done part 100 px;
 * - `m` milestone 03-04: a 30 px diamond box, x 105 … 135;
 * - `n` 03-02 00:00 … 06:00: x 40 … 50, resize zones of 10 / 3 px;
 * - `p` placeholder: no bar.
 */
const TASKS: readonly Task[] = deepFreeze([
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06', progress: 50 },
  { id: 'm', name: 'M', type: 'milestone', start: '2026-03-04' },
  { id: 'n', name: 'N', start: '2026-03-02T00:00', end: '2026-03-02T06:00' },
  { id: 'p', name: 'P', type: 'placeholder' },
]);

function layoutOf(tasks: readonly Task[]): Layout {
  const model = normalizeModel({ tasks }, { calendar, granularity: '1h' });
  const parsed = parseDateInput('2026-03-01');
  if (!parsed.ok) throw new Error(parsed.issue.message);
  const scale = createTimeScale({ origin: parsed.value.value, pxPerDay: 40 });
  const rows = layoutRows(visibleRows(buildHierarchy(model), 'all'));
  return createLayout({ rows, tasks: model.taskById, scale });
}

const layout = layoutOf(TASKS);

function text(target: HitTarget): string {
  switch (target.kind) {
    case 'task':
      return `${target.id}:${target.part}`;
    case 'link':
      return `link:${target.id}`;
    case 'empty':
      return target.rowId === undefined ? 'empty' : `empty:${target.rowId}`;
  }
}

describe('hitTest', () => {
  const cases: readonly (readonly [string, number, number, string])[] = [
    ['the body', 140, 24, 'a:body'],
    ['the start resize zone', 42, 24, 'a:resize-start'],
    ['the end resize zone', 238, 24, 'a:resize-end'],
    ['the progress handle below the bar', 140, 42, 'a:progress'],
    ['the progress handle inside the bar', 144, 36, 'a:progress'],
    ['the start link handle', 30, 24, 'a:link-start'],
    ['the end link handle', 250, 24, 'a:link-end'],
    ['the edge of a link handle', 256, 24, 'a:link-end'],
    ['outside a link handle (a circle)', 255, 29, 'empty:a'],
    ['empty space left of the bar', 18, 24, 'empty:a'],
    ['the row above the bar', 140, 5, 'empty:a'],
    ['above the rows', 140, -1, 'empty'],
    ['below the rows', 140, 400, 'empty'],
    ['a milestone body (no resize zones)', 106, 72, 'm:body'],
    ['a milestone bottom (no progress)', 120, 86, 'm:body'],
    ['a milestone link handle', 95, 72, 'm:link-start'],
    ['a narrow bar: start zone', 41, 120, 'n:resize-start'],
    ['a narrow bar: the middle third moves', 45, 120, 'n:body'],
    ['a narrow bar: end zone', 49, 120, 'n:resize-end'],
    ['a row without a bar', 45, 168, 'empty:p'],
  ];

  it.each(cases)('FR-EDIT-1: finds %s', (_name, x, y, expected) => {
    expect(text(hitTest({ x, y }, { layout }))).toBe(expected);
  });

  it('FR-EDIT-7: skips the handles of what is not allowed', () => {
    const allowed: TaskPermissions = { move: true, resize: false, progress: false, link: false };
    const input: HitTestInput = { layout, permissions: () => allowed };
    const hits = [
      [42, 24],
      [238, 24],
      [144, 36],
      [140, 42],
      [30, 24],
      [250, 24],
    ].map(([x, y]) => text(hitTest({ x: x!, y: y! }, input)));
    expect(hits).toEqual(['a:body', 'a:body', 'a:body', 'empty:a', 'empty:a', 'empty:a']);
    expect(text(hitTest({ x: 42, y: 24 }, { layout, permissions: () => undefined }))).toBe(
      'a:resize-start',
    );
  });

  it('honours custom handle sizes', () => {
    const handles = { resize: 20, link: 3, linkOffset: 4, progress: 2 };
    expect(text(hitTest({ x: 58, y: 24 }, { layout, handles }))).toBe('a:resize-start');
    expect(text(hitTest({ x: 30, y: 24 }, { layout, handles }))).toBe('empty:a');
    expect(text(hitTest({ x: 37, y: 24 }, { layout, handles }))).toBe('a:link-start');
    expect(text(hitTest({ x: 124, y: 36 }, { layout, handles }))).toBe('a:body');
  });
});

describe('barHandles', () => {
  it('FR-EDIT-1: places the handles of a bar with the default sizes', () => {
    const bar = layout.getBarRect('a')!;
    expect(INTERACTION_DEFAULTS.handles).toEqual({
      resize: 8,
      progress: 6,
      link: 6,
      linkOffset: 10,
    });
    expect(barHandles(bar)).toEqual({
      resizeStart: { x: 40, y: 9, width: 8, height: 30 },
      resizeEnd: { x: 232, y: 9, width: 8, height: 30 },
      progress: { x: 134, y: 33, width: 12, height: 12 },
      linkStart: { x: 24, y: 18, width: 12, height: 12 },
      linkEnd: { x: 244, y: 18, width: 12, height: 12 },
    });
    expect(Object.isFrozen(barHandles(bar))).toBe(true);
  });

  it('FR-BAR-6: a milestone has link handles only', () => {
    const handles = barHandles(layout.getBarRect('m')!);
    expect(handles.resizeStart).toBeUndefined();
    expect(handles.resizeEnd).toBeUndefined();
    expect(handles.progress).toBeUndefined();
    expect(handles.linkStart).toEqual({ x: 89, y: 66, width: 12, height: 12 });
  });

  it('a zero-width bar has no resize zones', () => {
    const zero = layoutOf([
      { id: 'z', name: 'Z', start: '2026-03-02T00:00', end: '2026-03-02T00:00' },
    ]);
    const handles = barHandles(zero.getBarRect('z')!);
    expect(handles.resizeStart).toBeUndefined();
    expect(handles.resizeEnd).toBeUndefined();
  });
});

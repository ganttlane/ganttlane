import type { GanttRow } from '@ganttlane/core';
import { describe, expect, it } from 'vitest';

import { cellAction, cellAttributes, type CellPlace, treeAction } from './model';

/** Only what the keys read of a row: its task, whether it is a group, and whether it is open. */
const row = (
  id: string,
  more: { readonly group?: 'open' | 'shut'; readonly parentId?: string } = {},
): GanttRow =>
  ({
    id,
    hasChildren: more.group !== undefined,
    isExpanded: more.group === 'open',
    record: { parentId: more.parentId },
  }) as unknown as GanttRow;

// a, an open group g with two children, a shut group h, and z.
const ROWS = [
  row('a'),
  row('g', { group: 'open' }),
  row('g1', { parentId: 'g' }),
  row('g2', { parentId: 'g' }),
  row('h', { group: 'shut' }),
  row('z'),
];

/** Three columns, the second of them the tree. */
const place = (column: number | undefined): CellPlace => ({ column, columns: 3, tree: 1 });
const key = (name: string, id: string, column: number | undefined, ctrl = false, page = 2) =>
  cellAction(name, ctrl, ROWS, id, place(column), page);
const focus = (id: string, column?: number) => ({ type: 'focus', id, column });

describe('cellAttributes', () => {
  it('FR-A11Y-1: the place of a column, 1-based, only when the keys walk the cells', () => {
    expect(cellAttributes(0, true)).toEqual({ 'aria-colindex': 1 });
    expect(cellAttributes(2, true)).toEqual({ 'aria-colindex': 3 });
    expect(cellAttributes(2, false)).toEqual({ 'aria-colindex': undefined });
  });
});

describe('cellAction: from a row', () => {
  it('FR-A11Y-2: Right steps into the first cell of a task and of an open group', () => {
    expect(key('ArrowRight', 'a', undefined)).toEqual(focus('a', 0));
    expect(key('ArrowRight', 'g', undefined)).toEqual(focus('g', 0));
  });

  it('FR-A11Y-2: a shut group is opened by the tree first, and every other key is the tree’s', () => {
    expect(key('ArrowRight', 'h', undefined)).toBeUndefined();
    expect(treeAction('ArrowRight', ROWS, 'h', 2)).toEqual({ type: 'toggle', id: 'h' });
    for (const other of ['ArrowLeft', 'ArrowDown', 'Home', 'End', 'PageDown', 'Enter', ' ', 'x']) {
      expect(key(other, 'g', undefined)).toBeUndefined();
    }
  });
});

describe('cellAction: from a cell', () => {
  it('FR-A11Y-2: Right and Left move along the row and stay at its ends', () => {
    expect(key('ArrowRight', 'a', 0)).toEqual(focus('a', 1));
    expect(key('ArrowRight', 'a', 1)).toEqual(focus('a', 2));
    expect(key('ArrowRight', 'a', 2)).toEqual(focus('a', 2));
    expect(key('ArrowLeft', 'a', 2)).toEqual(focus('a', 1));
    expect(key('ArrowLeft', 'a', 1)).toEqual(focus('a', 0));
  });

  it('FR-A11Y-2: Left from the first cell steps back to the row', () => {
    expect(key('ArrowLeft', 'a', 0)).toEqual({ type: 'focus', id: 'a' });
  });

  it('FR-A11Y-2: Up and Down keep the column and stay at the first and last row', () => {
    expect(key('ArrowDown', 'a', 2)).toEqual(focus('g', 2));
    expect(key('ArrowUp', 'g', 0)).toEqual(focus('a', 0));
    expect(key('ArrowUp', 'a', 1)).toEqual(focus('a', 1));
    expect(key('ArrowDown', 'z', 1)).toEqual(focus('z', 1));
  });

  it('FR-A11Y-2: Page Up and Page Down keep the column and move a page of rows', () => {
    expect(key('PageDown', 'a', 1)).toEqual(focus('g1', 1));
    expect(key('PageDown', 'h', 2)).toEqual(focus('z', 2));
    expect(key('PageUp', 'g2', 0)).toEqual(focus('g', 0));
    expect(key('PageUp', 'g', 0)).toEqual(focus('a', 0));
    expect(cellAction('PageDown', false, ROWS, 'a', place(1), 4)).toEqual(focus('h', 1));
  });

  it('FR-A11Y-2: Home and End go to the first and last cell; with Ctrl or Cmd, to the first and last row', () => {
    expect(key('Home', 'g1', 2)).toEqual(focus('g1', 0));
    expect(key('End', 'g1', 0)).toEqual(focus('g1', 2));
    expect(key('Home', 'g1', 2, true)).toEqual(focus('a', 2));
    expect(key('End', 'g1', 0, true)).toEqual(focus('z', 0));
  });

  it('FR-A11Y-2: in the tree column Right opens a shut group and Left shuts an open one, first', () => {
    expect(key('ArrowRight', 'h', 1)).toEqual({ type: 'toggle', id: 'h' });
    expect(key('ArrowLeft', 'g', 1)).toEqual({ type: 'toggle', id: 'g' });
    // Once they are so, the keys move.
    expect(key('ArrowRight', 'g', 1)).toEqual(focus('g', 2));
    expect(key('ArrowLeft', 'h', 1)).toEqual(focus('h', 0));
    // A task has no state to change, and another column does not change a group.
    expect(key('ArrowRight', 'a', 1)).toEqual(focus('a', 2));
    expect(key('ArrowRight', 'h', 0)).toEqual(focus('h', 1));
    expect(key('ArrowLeft', 'g', 2)).toEqual(focus('g', 1));
  });

  it('FR-A11Y-2: a tree in the first column shuts a group before the focus goes back to the row', () => {
    const first: CellPlace = { column: 0, columns: 2, tree: 0 };
    expect(cellAction('ArrowLeft', false, ROWS, 'g', first, 2)).toEqual({
      type: 'toggle',
      id: 'g',
    });
    expect(cellAction('ArrowLeft', false, ROWS, 'g1', first, 2)).toEqual({
      type: 'focus',
      id: 'g1',
    });
  });

  it('FR-A11Y-2: Enter, Space and every other key are the tree’s; a row that is not there is nothing', () => {
    for (const other of ['Enter', ' ', 'Tab', 'a', 'Escape']) {
      expect(key(other, 'a', 1)).toBeUndefined();
    }
    expect(treeAction('Enter', ROWS, 'a', 2)).toEqual({ type: 'activate', id: 'a' });
    expect(key('ArrowDown', 'ghost', 1)).toBeUndefined();
    expect(key('ArrowRight', 'ghost', undefined)).toBeUndefined();
  });

  it('FR-A11Y-2: a list of one column has nowhere to go sideways', () => {
    const one: CellPlace = { column: 0, columns: 1, tree: 0 };
    expect(cellAction('ArrowRight', false, ROWS, 'a', one, 2)).toEqual(focus('a', 0));
    expect(cellAction('End', false, ROWS, 'a', one, 2)).toEqual(focus('a', 0));
  });
});

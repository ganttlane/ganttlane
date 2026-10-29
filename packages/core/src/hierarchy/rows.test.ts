import { deepFreeze, edgeCase, sampleProject } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type TaskId } from '../model';
import {
  buildHierarchy,
  collapseAll,
  expandAll,
  type ExpandedKeys,
  type Hierarchy,
  type Row,
  setExpanded,
  toggleExpanded,
  visibleRows,
} from './index';

const { calendar } = createWorkCalendar();

/**
 * ```
 * a        group 0
 *   a1
 *     a1x
 *   a2
 * b        group 1
 * c        group 0
 *   c1
 * d        group 1
 * ```
 */
const tree: Hierarchy = buildHierarchy(
  normalizeModel(
    {
      tasks: deepFreeze([
        { id: 'a', name: 'A' },
        { id: 'a1', name: 'A1', parentId: 'a' },
        { id: 'a1x', name: 'A1x', parentId: 'a1' },
        { id: 'a2', name: 'A2', parentId: 'a' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'c1', name: 'C1', parentId: 'c' },
        { id: 'd', name: 'D' },
      ]),
    },
    { calendar },
  ),
);

/** `id:depth:flags:rowStripe/groupStripe`, flags `+` expanded, `-` collapsed, `.` leaf. */
function show(rows: readonly Row[]): string[] {
  return rows.map((row) => {
    const flag = row.hasChildren ? (row.isExpanded ? '+' : '-') : '.';
    return `${String(row.id)}:${row.depth}:${flag}:${row.rowStripe}/${row.groupStripe}`;
  });
}

function ids(rows: readonly Row[]): TaskId[] {
  return rows.map((row) => row.id);
}

describe('visibleRows', () => {
  it('FR-ROW-1, FR-ROW-4: "all" shows every task with row and group stripes', () => {
    const rows = visibleRows(tree, 'all');
    expect(show(rows)).toEqual([
      'a:0:+:0/0',
      'a1:1:+:1/0',
      'a1x:2:.:0/0',
      'a2:1:.:1/0',
      'b:0:.:0/1',
      'c:0:+:1/0',
      'c1:1:.:0/0',
      'd:0:.:1/1',
    ]);
    expect(rows[2]).toEqual({
      id: 'a1x',
      index: 2,
      depth: 2,
      hasChildren: false,
      isExpanded: false,
      rootId: 'a',
      rowStripe: 0,
      groupStripe: 0,
    });
    rows.forEach((row, index) => expect(row.index).toBe(index));
  });

  it.each<[string, ExpandedKeys, string[]]>([
    ['nothing expanded', [], ['a:0:-:0/0', 'b:0:.:1/1', 'c:0:-:0/0', 'd:0:.:1/1']],
    [
      'one root expanded, its child parent collapsed',
      ['a'],
      ['a:0:+:0/0', 'a1:1:-:1/0', 'a2:1:.:0/0', 'b:0:.:1/1', 'c:0:-:0/0', 'd:0:.:1/1'],
    ],
    [
      'a nested parent listed under a collapsed root stays hidden',
      ['a1'],
      ['a:0:-:0/0', 'b:0:.:1/1', 'c:0:-:0/0', 'd:0:.:1/1'],
    ],
    [
      'a root and its nested parent expanded',
      ['a1', 'a'],
      [
        'a:0:+:0/0',
        'a1:1:+:1/0',
        'a1x:2:.:0/0',
        'a2:1:.:1/0',
        'b:0:.:0/1',
        'c:0:-:1/0',
        'd:0:.:0/1',
      ],
    ],
    [
      'the second group expanded',
      ['c'],
      ['a:0:-:0/0', 'b:0:.:1/1', 'c:0:+:0/0', 'c1:1:.:1/0', 'd:0:.:0/1'],
    ],
    [
      'leaf and unknown ids are ignored',
      ['b', 'a1x', 'ghost'],
      ['a:0:-:0/0', 'b:0:.:1/1', 'c:0:-:0/0', 'd:0:.:1/1'],
    ],
    [
      'a Set of keys',
      new Set<TaskId>(['c', 'a']),
      [
        'a:0:+:0/0',
        'a1:1:-:1/0',
        'a2:1:.:0/0',
        'b:0:.:1/1',
        'c:0:+:0/0',
        'c1:1:.:1/0',
        'd:0:.:0/1',
      ],
    ],
  ])(
    'FR-ROW-2, FR-ROW-4: collapse / expand: %s (row stripes follow visible rows, group stripes the roots)',
    (_, keys, expected) => {
      expect(show(visibleRows(tree, keys))).toEqual(expected);
    },
  );

  it('FR-ROW-2: malformed keys from untyped callers collapse everything', () => {
    const rows = visibleRows(tree, true as unknown as ExpandedKeys);
    expect(ids(rows)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('FR-ROW-2: does not mutate the keys and returns frozen rows', () => {
    const keys = deepFreeze(['a']);
    const set = new Set<TaskId>(['a']);
    const rows = visibleRows(tree, keys);
    expect(visibleRows(tree, set)).toEqual(rows);
    expect([...set]).toEqual(['a']);
    expect(Object.isFrozen(rows)).toBe(true);
    for (const row of rows) expect(Object.isFrozen(row)).toBe(true);
  });

  it('FR-ROW-2: parent-without-children fixture: a listed parent without children is a plain row', () => {
    const fixture = edgeCase('parent-without-children');
    const hierarchy = buildHierarchy(normalizeModel(fixture, { calendar }));
    const keys = fixture.options?.hierarchy?.expandedKeys ?? 'all';
    expect(show(visibleRows(hierarchy, keys))).toEqual([
      'empty-group:0:.:0/0',
      'group:0:+:1/1',
      'child:1:.:0/1',
    ]);
    expect(show(visibleRows(hierarchy, []))).toEqual(['empty-group:0:.:0/0', 'group:0:-:1/1']);
    expect(hierarchy.parentIds).toEqual(['group']);
  });

  it('FR-ROW-1, FR-ROW-4: sample-project: six groups with their children', () => {
    const { calendar: own } = createWorkCalendar(sampleProject.calendar);
    const model = normalizeModel(sampleProject, { calendar: own });
    const options = sampleProject.options?.hierarchy;
    const hierarchy = buildHierarchy(model, { childAnchor: options?.childAnchor });
    expect(hierarchy.issues).toEqual([]);
    const groups = [1, 2, 3, 4, 5, 6].map((n) => `group-${n}`);
    expect(hierarchy.rootIds).toEqual(groups);
    expect(hierarchy.parentIds).toEqual(groups);

    const rows = visibleRows(hierarchy, options?.expandedKeys ?? 'all');
    expect(rows).toHaveLength(sampleProject.tasks.length);
    for (const row of rows) {
      const groupIndex = groups.indexOf(String(row.rootId));
      expect(row.groupStripe).toBe(groupIndex % 2);
      expect(row.depth).toBe(row.id === row.rootId ? 0 : 1);
      expect(row.rowStripe).toBe(row.index % 2);
    }
    // Rows of one group share a stripe, neighbouring groups alternate.
    const stripes = groups.map((id) => rows.filter((row) => row.rootId === id));
    expect(stripes.map((group) => group.length)).toEqual([6, 6, 7, 8, 5, 6]);
    expect(stripes.map((group) => new Set(group.map((row) => row.groupStripe)).size)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);

    // Collapsing groups 2 and 4 hides their children; group stripes stay, row stripes shift.
    const collapsed = setExpanded(
      hierarchy,
      setExpanded(hierarchy, 'all', 'group-2', false),
      'group-4',
      false,
    );
    const shown = visibleRows(hierarchy, collapsed);
    expect(shown).toHaveLength(rows.length - 5 - 7);
    expect(
      shown
        .filter((row) => row.depth === 0)
        .map((row) => [row.id, row.isExpanded, row.groupStripe]),
    ).toEqual([
      ['group-1', true, 0],
      ['group-2', false, 1],
      ['group-3', true, 0],
      ['group-4', false, 1],
      ['group-5', true, 0],
      ['group-6', true, 1],
    ]);
    shown.forEach((row, index) => expect(row.rowStripe).toBe(index % 2));

    // Parent anchors from the fixture (legacy `pinned_to`).
    const anchor = (id: TaskId): readonly string[] | undefined =>
      hierarchy.nodeById.get(id)?.parentAnchor;
    expect(anchor('checkpoint-1')).toEqual(['SS']);
    expect(anchor('task-2')).toEqual(['SS', 'FF']);
    expect(anchor('task-4')).toEqual(['FF']);
    expect(anchor('deliverable-1')).toEqual(['FS']);
    expect(hierarchy.nodeById.get('task-7')?.followParent).toBe(false);
    expect(hierarchy.nodeById.get('deliverable-3')?.followParent).toBe(true);
  });
});

describe('expanded-state helpers', () => {
  it('FR-ROW-2: expandAll lists every current parent and shows what "all" shows', () => {
    expect(expandAll(tree)).toEqual(['a', 'a1', 'c']);
    expect(visibleRows(tree, expandAll(tree))).toEqual(visibleRows(tree, 'all'));
  });

  it('FR-ROW-2: collapseAll leaves only the roots', () => {
    expect(collapseAll()).toEqual([]);
    expect(Object.isFrozen(collapseAll())).toBe(true);
    expect(ids(visibleRows(tree, collapseAll()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('FR-ROW-2: setExpanded expands and collapses one task without mutating the keys', () => {
    const keys = deepFreeze<TaskId[]>(['c', 'c', 'a']);
    expect(setExpanded(tree, keys, 'a1', true)).toEqual(['c', 'a', 'a1']);
    expect(setExpanded(tree, keys, 'a', true)).toEqual(['c', 'a']);
    expect(setExpanded(tree, keys, 'c', false)).toEqual(['a']);
    expect(setExpanded(tree, keys, 'ghost', false)).toEqual(['c', 'a']);
    expect(setExpanded(tree, 'all', 'a', true)).toBe('all');
    expect(setExpanded(tree, 'all', 'a', false)).toEqual(['a1', 'c']);
    expect(setExpanded(tree, new Set<TaskId>(['a']), 'c', true)).toEqual(['a', 'c']);
    expect(keys).toEqual(['c', 'c', 'a']);
    expect(Object.isFrozen(setExpanded(tree, keys, 'a1', true))).toBe(true);
    expect(Object.isFrozen(setExpanded(tree, 'all', 'a', false))).toBe(true);
  });

  it('FR-ROW-2: a task without children, or an unknown id, is neither expanded nor collapsed', () => {
    const keys = deepFreeze<TaskId[]>(['c']);
    for (const id of ['b', 'a2', 'ghost']) {
      expect(setExpanded(tree, keys, id, true)).toEqual(['c']);
      expect(setExpanded(tree, keys, id, false)).toEqual(['c']);
      expect(setExpanded(tree, 'all', id, true)).toBe('all');
      // Nothing is collapsed, so "all" stays "all" instead of turning into a list of parents.
      expect(setExpanded(tree, 'all', id, false)).toBe('all');
      expect(toggleExpanded(tree, 'all', id)).toBe('all');
      expect(toggleExpanded(tree, keys, id)).toEqual(['c']);
    }
    expect(setExpanded(tree, new Set<TaskId>(['c']), 'b', true)).toEqual(['c']);
    expect(Object.isFrozen(setExpanded(tree, new Set<TaskId>(['c']), 'b', true))).toBe(true);
  });

  it('FR-ROW-2: toggleExpanded flips one task; with "all" every task counts as expanded', () => {
    expect(toggleExpanded(tree, [], 'a')).toEqual(['a']);
    expect(toggleExpanded(tree, ['a', 'c'], 'a')).toEqual(['c']);
    expect(toggleExpanded(tree, new Set<TaskId>(['c']), 'c')).toEqual([]);
    expect(toggleExpanded(tree, 'all', 'a1')).toEqual(['a', 'c']);
    const collapsed = toggleExpanded(tree, 'all', 'a1');
    expect(ids(visibleRows(tree, collapsed))).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1', 'd']);
    expect(ids(visibleRows(tree, toggleExpanded(tree, collapsed, 'a1')))).toEqual(
      ids(visibleRows(tree, 'all')),
    );
  });
});

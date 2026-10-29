import { deepFreeze, edgeCase, type Fixture } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type Task, type TaskId } from '../model';
import {
  buildHierarchy,
  type Hierarchy,
  type HierarchyIssue,
  type HierarchyNode,
  type HierarchyOptions,
} from './index';

const { calendar } = createWorkCalendar();

/** Tasks without dates (placeholder rows): the hierarchy needs only ids and parents. */
type TaskInput = Omit<Task, 'name'> & { readonly name?: string };

function build(tasks: readonly TaskInput[], options?: HierarchyOptions): Hierarchy {
  const input = deepFreeze(tasks.map((task) => ({ name: String(task.id), ...task })));
  return buildHierarchy(normalizeModel({ tasks: input }, { calendar }), options);
}

function buildFixture(fixture: Fixture): Hierarchy {
  const { calendar: own } = createWorkCalendar(fixture.calendar);
  const model = normalizeModel(fixture, { calendar: own });
  return buildHierarchy(model, { childAnchor: fixture.options?.hierarchy?.childAnchor });
}

/** Row order with depths: `['a', 0]`. */
function outline(tree: Hierarchy): [TaskId, number][] {
  return tree.nodes.map((node) => [node.id, node.depth]);
}

function node(tree: Hierarchy, id: TaskId): HierarchyNode {
  const found = tree.nodeById.get(id);
  if (!found) throw new Error(`No node ${String(id)}`);
  return found;
}

function codes(issues: readonly HierarchyIssue[]): string[] {
  return issues.map((issue) => `${issue.code}@${String(issue.taskId ?? issue.path)}`);
}

describe('buildHierarchy', () => {
  describe('row order', () => {
    it('FR-ROW-1: lays unsorted input out in pre-order, roots and siblings in input order', () => {
      const tree = build([
        { id: 'c1', parentId: 'p' },
        { id: 'gc', parentId: 'c1' },
        { id: 'r2' },
        { id: 'p' },
        { id: 'c2', parentId: 'p' },
        { id: 'r2c', parentId: 'r2' },
      ]);
      expect(outline(tree)).toEqual([
        ['r2', 0],
        ['r2c', 1],
        ['p', 0],
        ['c1', 1],
        ['gc', 2],
        ['c2', 1],
      ]);
      expect(tree.rootIds).toEqual(['r2', 'p']);
      expect(tree.parentIds).toEqual(['r2', 'p', 'c1']);
      expect(tree.issues).toEqual([]);
      expect(node(tree, 'p')).toEqual({
        id: 'p',
        parentId: undefined,
        childIds: ['c1', 'c2'],
        depth: 0,
        rootId: 'p',
        hasChildren: true,
        parentAnchor: ['SS'],
        followParent: false,
        index: 2,
        descendantCount: 3,
      });
      expect(node(tree, 'gc')).toMatchObject({
        parentId: 'c1',
        childIds: [],
        depth: 2,
        rootId: 'p',
        hasChildren: false,
        index: 4,
        descendantCount: 0,
      });
      tree.nodes.forEach((each, index) => expect(each.index).toBe(index));
    });

    it('FR-ROW-1: rows depend only on the relative order of siblings and of roots', () => {
      const ordered = build([
        { id: 'p' },
        { id: 'c1', parentId: 'p' },
        { id: 'c2', parentId: 'p' },
        { id: 'q' },
        { id: 'd1', parentId: 'q' },
      ]);
      const shuffled = build([
        { id: 'd1', parentId: 'q' },
        { id: 'c1', parentId: 'p' },
        { id: 'p' },
        { id: 'c2', parentId: 'p' },
        { id: 'q' },
      ]);
      expect(shuffled.nodes).toEqual(ordered.nodes);
      expect(outline(ordered)).toEqual([
        ['p', 0],
        ['c1', 1],
        ['c2', 1],
        ['q', 0],
        ['d1', 1],
      ]);
    });

    it('FR-ROW-1: deep-hierarchy fixture: five levels, siblings at several depths', () => {
      const fixture = edgeCase('deep-hierarchy');
      const expected: [TaskId, number][] = [
        ['level-1', 0],
        ['level-2', 1],
        ['level-3', 2],
        ['level-4', 3],
        ['level-5', 4],
        ['level-5b', 4],
        ['level-3b', 2],
        ['level-2b', 1],
      ];
      const tree = buildFixture(fixture);
      expect(outline(tree)).toEqual(expected);
      expect(tree.issues).toEqual([]);
      expect(tree.rootIds).toEqual(['level-1']);
      expect(tree.parentIds).toEqual(['level-1', 'level-2', 'level-3', 'level-4']);
      expect(node(tree, 'level-1').descendantCount).toBe(7);
      expect(node(tree, 'level-3').descendantCount).toBe(3);
      expect(node(tree, 'level-4').childIds).toEqual(['level-5', 'level-5b']);
      for (const each of tree.nodes) expect(each.rootId).toBe('level-1');

      // Reversed input: children still follow their parents, siblings in (reversed) input order.
      const reversed = buildFixture({ ...fixture, tasks: fixture.tasks.toReversed() });
      expect(outline(reversed)).toEqual([
        ['level-1', 0],
        ['level-2b', 1],
        ['level-2', 1],
        ['level-3b', 2],
        ['level-3', 2],
        ['level-4', 3],
        ['level-5b', 4],
        ['level-5', 4],
      ]);
    });

    it('FR-ROW-3: placeholders and invalid tasks are rows and can be parents', () => {
      const model = normalizeModel(
        {
          tasks: [
            { id: 'bad', name: 'End before start', start: '2026-03-05', end: '2026-03-02' },
            { id: 'slot', name: 'Placeholder', type: 'placeholder', parentId: 'bad' },
            { id: 'leaf', name: 'Task', start: '2026-03-02', duration: 1, parentId: 'slot' },
          ],
        },
        { calendar },
      );
      expect(model.taskById.get('bad')?.valid).toBe(false);
      const tree = buildHierarchy(model);
      expect(outline(tree)).toEqual([
        ['bad', 0],
        ['slot', 1],
        ['leaf', 2],
      ]);
    });

    it('FR-ROW-1: an empty model gives an empty tree', () => {
      const tree = build([]);
      expect(tree.nodes).toEqual([]);
      expect(tree.nodeById.size).toBe(0);
      expect(tree.rootIds).toEqual([]);
      expect(tree.issues).toEqual([]);
    });
  });

  describe('unknown parents', () => {
    it('FR-ROW-1, FR-DATA-4: unknown-parent fixture: warnings, the tasks become roots', () => {
      const tree = buildFixture(edgeCase('unknown-parent'));
      expect(outline(tree)).toEqual([
        ['orphan', 0],
        ['orphan-numeric', 0],
        ['parent', 0],
        ['child', 1],
      ]);
      expect(tree.issues).toEqual([
        {
          code: 'unknown-parent',
          severity: 'warning',
          message: 'task "orphan": parent "ghost" not found, shown as a root',
          path: 'parentId',
          taskId: 'orphan',
          value: 'ghost',
        },
        {
          code: 'unknown-parent',
          severity: 'warning',
          message: 'task "orphan-numeric": parent 404 not found, shown as a root',
          path: 'parentId',
          taskId: 'orphan-numeric',
          value: 404,
        },
      ]);
      expect(node(tree, 'orphan').parentId).toBeUndefined();
    });

    it('FR-ROW-1: ids are compared with ===, so 1 and "1" are different tasks', () => {
      const tree = build([{ id: 1 }, { id: 'child', parentId: '1' }, { id: 'kid', parentId: 1 }]);
      expect(codes(tree.issues)).toEqual(['unknown-parent@child']);
      expect(node(tree, 'kid').parentId).toBe(1);
    });

    it('FR-ROW-1: a malformed parentId is left to the model (invalid-shape), the task is a root', () => {
      const legacy = { id: 'x', name: 'Legacy parent', parentId: { id: 'p' } } as unknown as Task;
      const model = normalizeModel({ tasks: [{ id: 'p', name: 'P' }, legacy] }, { calendar });
      expect(model.issues.map((issue) => issue.code)).toContain('invalid-shape');
      const tree = buildHierarchy(model);
      expect(tree.issues).toEqual([]);
      expect(node(tree, 'x')).toMatchObject({ parentId: undefined, depth: 0 });
    });
  });

  describe('parent cycles', () => {
    it('FR-ROW-1, FR-DATA-4: parent-cycle fixture: one error per loop, the first member becomes a root', () => {
      const tree = buildFixture(edgeCase('parent-cycle'));
      expect(outline(tree)).toEqual([
        ['a', 0],
        ['b', 1],
        ['self', 0],
        ['root', 0],
      ]);
      expect(tree.issues).toEqual([
        {
          code: 'parent-cycle',
          severity: 'error',
          message: 'task "a": parent cycle "a" → "b" → "a", shown as a root',
          path: 'parentId',
          taskId: 'a',
          value: ['a', 'b'],
        },
        {
          code: 'parent-cycle',
          severity: 'error',
          message: 'task "self": parent cycle "self" → "self", shown as a root',
          path: 'parentId',
          taskId: 'self',
          value: ['self'],
        },
      ]);
    });

    it('FR-ROW-1: the cut depends on input order only (the first member in the input)', () => {
      const tree = build([
        { id: 'b', parentId: 'a' },
        { id: 'a', parentId: 'b' },
      ]);
      expect(outline(tree)).toEqual([
        ['b', 0],
        ['a', 1],
      ]);
      expect(tree.issues[0]).toMatchObject({ taskId: 'b', value: ['b', 'a'] });
    });

    it('FR-ROW-1: a longer loop becomes a chain; tasks hanging off it keep their parents', () => {
      const tree = build([
        { id: 't', parentId: 'y' },
        { id: 'x', parentId: 'z' },
        { id: 'y', parentId: 'x' },
        { id: 'z', parentId: 'y' },
      ]);
      // Walking up from `t` meets the loop at `y`; `x` comes first in the input and is cut.
      expect(tree.issues).toEqual([
        expect.objectContaining({
          code: 'parent-cycle',
          taskId: 'x',
          value: ['x', 'z', 'y'],
          message: 'task "x": parent cycle "x" → "z" → "y" → "x", shown as a root',
        }),
      ]);
      expect(outline(tree)).toEqual([
        ['x', 0],
        ['y', 1],
        ['t', 2],
        ['z', 2],
      ]);
    });

    it('FR-ROW-1: a long loop is abbreviated in the message but listed in full in value', () => {
      const ids = Array.from({ length: 6 }, (_, i) => `c${i}`);
      const tree = build(ids.map((id, i) => ({ id, parentId: ids[(i + 1) % ids.length] })));
      expect(tree.issues).toHaveLength(1);
      expect(tree.issues[0]!.message).toBe(
        'task "c0": parent cycle "c0" → "c1" → "c2" → "c3" → … (6 tasks), shown as a root',
      );
      expect(tree.issues[0]!.value).toEqual(ids);
      expect(outline(tree)).toEqual([
        ['c0', 0],
        ['c5', 1],
        ['c4', 2],
        ['c3', 3],
        ['c2', 4],
        ['c1', 5],
      ]);
    });

    it('FR-ROW-1: a loop of 10 000 tasks is broken without deep recursion', () => {
      const count = 10_000;
      const tree = build(
        Array.from({ length: count }, (_, i) => ({ id: i, parentId: (i + 1) % count })),
      );
      expect(codes(tree.issues)).toEqual(['parent-cycle@0']);
      expect(tree.nodes).toHaveLength(count);
      expect(tree.nodes.at(-1)).toMatchObject({ id: 1, depth: count - 1 });
    });

    it('FR-ROW-1: issues come in input order (unknown parents, anchors and cycles mixed)', () => {
      const tree = build([
        { id: 'loop', parentId: 'loop' },
        { id: 'lost', parentId: 'ghost' },
        { id: 'pinned', parentAnchor: 'XX' as never },
      ]);
      expect(codes(tree.issues)).toEqual([
        'parent-cycle@loop',
        'unknown-parent@lost',
        'invalid-parent-anchor@pinned',
      ]);
    });
  });

  describe('parent anchors (FR-SCH-2)', () => {
    function anchors(tree: Hierarchy): Record<string, readonly string[]> {
      return Object.fromEntries(tree.nodes.map((each) => [each.id, each.parentAnchor]));
    }

    it('FR-SCH-2: defaults to hierarchy.childAnchor, SS when not set', () => {
      const tasks = [{ id: 'p' }, { id: 'c', parentId: 'p' }];
      expect(anchors(build(tasks))).toEqual({ p: ['SS'], c: ['SS'] });
      expect(anchors(build(tasks, { childAnchor: 'FS' }))).toEqual({ p: ['FS'], c: ['FS'] });
      expect(anchors(build(tasks, { childAnchor: ['FF', 'SS'] }))).toEqual({
        p: ['SS', 'FF'],
        c: ['SS', 'FF'],
      });
      expect(build(tasks, { childAnchor: undefined }).issues).toEqual([]);
    });

    it('FR-SCH-2: one link type or an array, canonical: start pin first, repeats dropped', () => {
      const tree = build([
        { id: 'p' },
        { id: 'ff', parentId: 'p', parentAnchor: 'FF' },
        { id: 'pair', parentId: 'p', parentAnchor: ['FF', 'FS'] },
        { id: 'sf', parentId: 'p', parentAnchor: ['SF'] },
        { id: 'twice', parentId: 'p', parentAnchor: ['SS', 'SS', 'FF', 'FF'] },
      ]);
      expect(anchors(tree)).toEqual({
        p: ['SS'],
        ff: ['FF'],
        pair: ['FS', 'FF'],
        sf: ['SF'],
        twice: ['SS', 'FF'],
      });
      expect(tree.issues).toEqual([]);
    });

    it('FR-SCH-2, FR-DATA-4: unusable anchors give a warning and fall back to the default', () => {
      const tree = build(
        [
          { id: 'p' },
          { id: 'typo', parentId: 'p', parentAnchor: 'XX' as never },
          { id: 'legacy', parentId: 'p', parentAnchor: { start: 'end' } as never },
          { id: 'empty', parentId: 'p', parentAnchor: [] },
          { id: 'number', parentId: 'p', parentAnchor: 5 as never },
          { id: 'fn', parentId: 'p', parentAnchor: (() => 'SS') as never },
          { id: 'null', parentId: 'p', parentAnchor: null as never },
        ],
        { childAnchor: 'FS' },
      );
      expect(anchors(tree)).toMatchObject({
        typo: ['FS'],
        legacy: ['FS'],
        empty: ['FS'],
        number: ['FS'],
        fn: ['FS'],
        null: ['FS'],
      });
      expect(tree.issues.map((issue) => issue.message)).toEqual([
        'task "typo": parentAnchor "XX" is not a link type, FS is used',
        'task "legacy": parentAnchor an object is not a link type, FS is used',
        'task "empty": parentAnchor is empty, FS is used',
        'task "number": parentAnchor 5 is not a link type, FS is used',
        'task "fn": parentAnchor a function is not a link type, FS is used',
        'task "null": parentAnchor null is not a link type, FS is used',
      ]);
      expect(tree.issues[0]).toEqual({
        code: 'invalid-parent-anchor',
        severity: 'warning',
        message: 'task "typo": parentAnchor "XX" is not a link type, FS is used',
        path: 'parentAnchor',
        taskId: 'typo',
        value: 'XX',
        suggested: ['FS'],
      });
    });

    it('FR-SCH-2: bad entries of an array and second pins of one edge are ignored', () => {
      const tree = build([
        { id: 'p' },
        { id: 'conflict', parentId: 'p', parentAnchor: ['SS', 'FS', 'FF'] },
        { id: 'ends', parentId: 'p', parentAnchor: ['SF', 'FF'] },
        { id: 'partly', parentId: 'p', parentAnchor: ['FF', 'start'] as never },
      ]);
      expect(anchors(tree)).toMatchObject({
        conflict: ['SS', 'FF'],
        ends: ['SF'],
        partly: ['FF'],
      });
      expect(tree.issues.map((issue) => [issue.message, issue.suggested])).toEqual([
        ['task "conflict": parentAnchor FS pins the start again, SS + FF is used', ['SS', 'FF']],
        ['task "ends": parentAnchor FF pins the end again, SF is used', ['SF']],
        ['task "partly": parentAnchor "start" is not a link type, FF is used', ['FF']],
      ]);
    });

    it('FR-SCH-2, FR-DATA-4: an unusable childAnchor option is reported first, at its option path, and SS is used', () => {
      const tree = build(
        [
          { id: 'p' },
          { id: 'c', parentId: 'p' },
          { id: 'bad', parentId: 'p', parentAnchor: 'XX' as never },
        ],
        { childAnchor: 'start' as never },
      );
      expect(anchors(tree)).toEqual({ p: ['SS'], c: ['SS'], bad: ['SS'] });
      expect(tree.issues[0]).toEqual({
        code: 'invalid-parent-anchor',
        severity: 'warning',
        message: 'hierarchy.childAnchor: "start" is not a link type, SS is used',
        path: 'hierarchy.childAnchor',
        value: 'start',
        suggested: ['SS'],
      });
      expect(codes(tree.issues)).toEqual([
        'invalid-parent-anchor@hierarchy.childAnchor',
        'invalid-parent-anchor@bad',
      ]);
    });

    it('FR-SCH-2: followParent is true only for an explicit true', () => {
      const tree = build([
        { id: 'p' },
        { id: 'yes', parentId: 'p', followParent: true },
        { id: 'no', parentId: 'p', followParent: false },
        { id: 'unset', parentId: 'p' },
        { id: 'malformed', parentId: 'p', followParent: 'yes' as never },
      ]);
      expect(tree.nodes.map((each) => [each.id, each.followParent])).toEqual([
        ['p', false],
        ['yes', true],
        ['no', false],
        ['unset', false],
        ['malformed', false],
      ]);
    });
  });

  describe('immutability', () => {
    it('FR-DATA-1: never mutates the model and returns deeply frozen results', () => {
      const tree = build([
        { id: 'b', parentId: 'a' },
        { id: 'a', parentId: 'b' },
        { id: 'c', parentId: 'a', parentAnchor: ['FF', 'XX'] as never },
        { id: 'd', parentId: 'ghost' },
      ]);
      expect(tree.issues).toHaveLength(3);
      const objects: unknown[] = [tree, tree.nodes, tree.rootIds, tree.parentIds, tree.issues];
      for (const each of tree.nodes) objects.push(each, each.childIds, each.parentAnchor);
      for (const issue of tree.issues) {
        objects.push(issue);
        if (issue.code !== 'invalid-parent-anchor') objects.push(issue.value);
        if (issue.suggested !== undefined) objects.push(issue.suggested);
      }
      for (const object of objects) expect(Object.isFrozen(object)).toBe(true);
      expect([...tree.nodeById.values()]).toEqual(tree.nodes);
    });

    it('FR-DATA-1: an anchor issue keeps the caller value as given', () => {
      const anchor = ['FF', 'XX'];
      const model = normalizeModel(
        {
          tasks: [
            { id: 'p', name: 'P' },
            { id: 'c', name: 'C', parentId: 'p', parentAnchor: anchor as never },
          ],
        },
        { calendar },
      );
      const tree = buildHierarchy(model);
      expect(tree.issues[0]?.value).toBe(anchor);
      expect(anchor).toEqual(['FF', 'XX']);
      expect(Object.isFrozen(anchor)).toBe(false);
    });
  });
});

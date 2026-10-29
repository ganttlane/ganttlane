import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { normalizeModel, type Task, type TaskId } from '../model';
import { buildHierarchy, type Hierarchy, type HierarchyNode, visibleRows } from './index';

const { calendar } = createWorkCalendar();

/** Parent of task `i`: none, another task by index (may form loops), or an unknown id. */
type ParentSpec =
  | { readonly kind: 'none' }
  | { readonly kind: 'task'; readonly at: number }
  | {
      readonly kind: 'unknown';
    };

interface Forest {
  readonly tasks: readonly Task[];
  /** Ids of some tasks, as `expandedKeys`. */
  readonly expanded: readonly TaskId[];
}

const parentSpec: fc.Arbitrary<ParentSpec> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: 'none' as const }) },
  { weight: 6, arbitrary: fc.nat().map((at) => ({ kind: 'task' as const, at })) },
  { weight: 1, arbitrary: fc.constant({ kind: 'unknown' as const }) },
);

/**
 * Random task lists: with `acyclic`, parents come earlier in the input (deep trees); otherwise
 * any task can be a parent, so loops and self-parents are common. Children often come before
 * their parents either way once `shuffle` reorders the input.
 */
const forest: fc.Arbitrary<Forest> = fc
  .record({
    specs: fc.array(parentSpec, { maxLength: 60 }),
    acyclic: fc.boolean(),
    order: fc.array(fc.nat(), { maxLength: 60 }),
    expanded: fc.array(fc.nat(), { maxLength: 30 }),
  })
  .map(({ specs, acyclic, order, expanded }) => {
    const ids = specs.map((_, i) => `t${i}`);
    const tasks: Task[] = specs.map((spec, i) => {
      const task = { id: `t${i}`, name: `Task ${i}` };
      if (spec.kind === 'none') return task;
      if (spec.kind === 'unknown') return { ...task, parentId: `ghost-${i}` };
      const at = acyclic ? (i === 0 ? undefined : spec.at % i) : spec.at % specs.length;
      return at === undefined ? task : { ...task, parentId: `t${at}` };
    });
    // Shuffle by sort keys so the input is not in tree order.
    const keyed = tasks.map((task, i) => ({ task, key: order[i] ?? i }));
    keyed.sort((a, b) => a.key - b.key);
    return {
      tasks: keyed.map(({ task }) => task),
      expanded: expanded.flatMap((n) => (ids.length === 0 ? [] : [ids[n % ids.length]!])),
    };
  });

function build({ tasks }: Forest): Hierarchy {
  return buildHierarchy(normalizeModel({ tasks }, { calendar }));
}

function nodeOf(tree: Hierarchy, id: TaskId | undefined): HierarchyNode | undefined {
  return id === undefined ? undefined : tree.nodeById.get(id);
}

describe('hierarchy properties', () => {
  it('FR-ROW-1: every task appears exactly once; a parent precedes its children, depth + 1', () => {
    fc.assert(
      fc.property(forest, (input) => {
        const tree = build(input);
        const rows = visibleRows(tree, 'all');
        expect(rows.map((row) => row.id).sort()).toEqual(input.tasks.map((task) => task.id).sort());
        expect(tree.nodes).toHaveLength(input.tasks.length);
        const rowIndex = new Map(rows.map((row) => [row.id, row.index]));
        for (const row of rows) {
          const node = tree.nodeById.get(row.id)!;
          const parent = nodeOf(tree, node.parentId);
          if (parent === undefined) {
            expect(row.depth).toBe(0);
            expect(row.rootId).toBe(row.id);
          } else {
            expect(rowIndex.get(parent.id)!).toBeLessThan(row.index);
            expect(row.depth).toBe(parent.depth + 1);
            expect(row.rootId).toBe(parent.rootId);
            expect(parent.childIds).toContain(row.id);
          }
        }
      }),
    );
  });

  it('FR-ROW-1: each subtree is contiguous and sized by descendantCount', () => {
    fc.assert(
      fc.property(forest, (input) => {
        const tree = build(input);
        for (const node of tree.nodes) {
          const end = node.index + 1 + node.descendantCount;
          for (const below of tree.nodes.slice(node.index + 1, end)) {
            expect(below.depth).toBeGreaterThan(node.depth);
          }
          const after = tree.nodes[end];
          if (after) expect(after.depth).toBeLessThanOrEqual(node.depth);
          expect(node.hasChildren).toBe(node.childIds.length > 0);
          for (const child of node.childIds) expect(nodeOf(tree, child)?.parentId).toBe(node.id);
        }
      }),
    );
  });

  it('FR-ROW-1, FR-DATA-4: a parent is dropped only with an issue; loops are cut at their first member', () => {
    fc.assert(
      fc.property(forest, (input) => {
        const tree = build(input);
        const position = new Map(input.tasks.map((task, i) => [task.id, i]));
        const given = new Map(input.tasks.map((task) => [task.id, task.parentId]));
        const issueOf = new Map(tree.issues.map((issue) => [issue.taskId, issue]));
        for (const task of input.tasks) {
          const node = tree.nodeById.get(task.id)!;
          if (node.parentId === task.parentId) {
            expect(issueOf.has(task.id)).toBe(false);
            continue;
          }
          const issue = issueOf.get(task.id);
          const expected = position.has(task.parentId!) ? 'parent-cycle' : 'unknown-parent';
          expect(issue?.code).toBe(expected);
          if (expected === 'parent-cycle') {
            const members = issue!.value as TaskId[];
            expect(members[0]).toBe(task.id);
            members.forEach((member, k) => {
              expect(given.get(member)).toBe(members[(k + 1) % members.length]);
              expect(position.get(member)!).toBeGreaterThanOrEqual(position.get(task.id)!);
            });
          }
        }
      }),
    );
  });

  it('FR-ROW-2, FR-ROW-4: a row is visible iff all its ancestors are expanded; stripes alternate', () => {
    fc.assert(
      fc.property(forest, (input) => {
        const tree = build(input);
        const keys = new Set(input.expanded);
        const rows = visibleRows(tree, input.expanded);
        const visible = tree.nodes.filter((node) => {
          for (let up = nodeOf(tree, node.parentId); up; up = nodeOf(tree, up.parentId)) {
            if (!keys.has(up.id)) return false;
          }
          return true;
        });
        expect(rows.map((row) => row.id)).toEqual(visible.map((node) => node.id));
        for (const row of rows) {
          expect(row.isExpanded).toBe(row.hasChildren && keys.has(row.id));
          expect(row.rowStripe).toBe(row.index % 2);
          expect(row.groupStripe).toBe(tree.rootIds.indexOf(row.rootId) % 2);
        }
      }),
    );
  });
});

/**
 * `buildHierarchy`: the task tree from `parentId`, in row order, with normalized
 * parent anchors and typed issues for unknown parents and parent cycles.
 */

import type { LinkType, NormalizedModel, TaskId } from '../model';
import { DEV } from '../shared';
import { DEFAULT_CHILD_ANCHOR, readAnchor } from './anchor';
import { type HierarchyIssue, hierarchyIssue, show } from './issues';

/** Options of {@link buildHierarchy} (the data part of `GanttOptions.hierarchy`). */
export interface HierarchyOptions {
  /**
   * Default `Task.parentAnchor` (`hierarchy.childAnchor`):
   * one link type or one per child edge, e.g. `['SS', 'FF']`; default `'SS'`. Like
   * `Task.parentAnchor`, it is only read for children with `followParent`.
   */
  readonly childAnchor?: LinkType | readonly LinkType[] | undefined;
}

/**
 * One task in the tree. Every task of the model is a node, placeholders and invalid tasks
 * included (they are rows without a bar). Deeply frozen.
 */
export interface HierarchyNode {
  /** The task id. */
  readonly id: TaskId;
  /**
   * The resolved parent; `undefined` for a root, also when the given `parentId` matches no task
   * or was cut to break a parent cycle.
   */
  readonly parentId: TaskId | undefined;
  /** Direct children in input order. */
  readonly childIds: readonly TaskId[];
  /** `0` for a root, the parent's depth + 1 otherwise. */
  readonly depth: number;
  /** The root of the top-level group the task belongs to (its own id for a root). */
  readonly rootId: TaskId;
  /** Whether the task has children (a parent row with an expand toggle). */
  readonly hasChildren: boolean;
  /**
   * Which edges of the task follow which edges of its parent: `Task.parentAnchor`,
   * else `hierarchy.childAnchor`. Canonical: at most one link type per child edge, the start pin
   * (`SS` / `FS`) before the end pin (`FF` / `SF`). Only read for children with `followParent`.
   */
  readonly parentAnchor: readonly LinkType[];
  /** `Task.followParent === true`. */
  readonly followParent: boolean;
  /** Position in {@link Hierarchy.nodes}: the row index when every parent is expanded. */
  readonly index: number;
  /**
   * Number of tasks below this one; the subtree is
   * `nodes.slice(index + 1, index + 1 + descendantCount)`.
   */
  readonly descendantCount: number;
}

/** Result of {@link buildHierarchy}: the task tree, deeply frozen. */
export interface Hierarchy {
  /**
   * Every task in row order (pre-order): each parent is directly followed by its subtree,
   * siblings and roots keep their input order, whatever order the input lists parents and
   * children in. A parent always comes before its descendants.
   */
  readonly nodes: readonly HierarchyNode[];
  /** Nodes by task id. */
  readonly nodeById: ReadonlyMap<TaskId, HierarchyNode>;
  /** Top-level tasks in input order. */
  readonly rootIds: readonly TaskId[];
  /** Tasks that have children, in row order (what `expandAll` expands). */
  readonly parentIds: readonly TaskId[];
  /** The `childAnchor` option first, then task issues in input order. */
  readonly issues: readonly HierarchyIssue[];
}

const NO_IDS: readonly TaskId[] = /* @__PURE__ */ Object.freeze([]);
/** Longest loop spelled out in a `'parent-cycle'` message. */
const SHOWN_MEMBERS = 4;

/** Mutable working record of one task while the tree is built. */
interface Item {
  readonly id: TaskId;
  /** Position in `NormalizedModel.tasks` (`TaskModel.index`): the input order. */
  readonly index: number;
  /** `TaskModel.parentId`, as given. */
  readonly parentId: TaskId | undefined;
  readonly anchor: readonly LinkType[];
  readonly followParent: boolean;
  parent: Item | undefined;
  children: Item[] | undefined;
  depth: number;
  rootId: TaskId;
  /** Tasks in the subtree, this one included. */
  size: number;
  /** Cycle search: 0 not seen, 1 on the current walk, 2 done. */
  state: 0 | 1 | 2;
}

/** A task issue with the task's input position, to sort issues into input order. */
type TaskIssue = readonly [index: number, issue: HierarchyIssue];

/**
 * Builds the task tree of a normalized model: resolves every `parentId`, breaks
 * parent cycles, normalizes parent anchors and lays the tasks out in row order. Never throws on
 * bad data and never mutates its input.
 *
 * - **Unknown parent**: a `parentId` that matches no task (ids are compared with `===`) gives an
 *   `'unknown-parent'` warning; the task becomes a root.
 * - **Parent cycles** (`a → b → a`, longer loops, a task that is its own parent): one
 *   `'parent-cycle'` error per loop, on the member that comes **first in the input**, which
 *   becomes a root; the other members keep their parents, so the loop turns into a chain under
 *   that task. The result does not depend on the order the tasks are visited in.
 * - **Anchors**: see {@link HierarchyNode.parentAnchor}; an unusable value gives
 *   `'invalid-parent-anchor'`.
 * - **Row order**: see {@link Hierarchy.nodes}.
 *
 * Runs in O(n).
 *
 * @param model - Normalized tasks (`normalizeModel`); only `tasks` is read.
 * @param options - The default parent anchor.
 * @returns The frozen tree with its issues.
 *
 * @example
 * ```ts
 * const model = normalizeModel({ tasks }, { calendar });
 * const tree = buildHierarchy(model, { childAnchor: 'SS' });
 * const rows = visibleRows(tree, ['group-1']); // group-1 expanded, every other parent collapsed
 * ```
 */
export function buildHierarchy(model: NormalizedModel, options: HierarchyOptions = {}): Hierarchy {
  const issues: HierarchyIssue[] = [];
  const taskIssues: TaskIssue[] = [];
  const fallback = readChildAnchor(options.childAnchor, issues);
  const items = readItems(model, fallback, taskIssues);
  breakCycles(items, taskIssues);

  const roots: Item[] = [];
  for (const item of items) {
    const { parent } = item;
    if (parent === undefined) roots.push(item);
    else (parent.children ??= []).push(item);
  }

  // Pre-order: each root, then its subtree; children are pushed in reverse to pop in order.
  const order: Item[] = [];
  const stack: Item[] = [];
  for (const root of roots) {
    stack.push(root);
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      at.rootId = root.id;
      order.push(at);
      if (at.children === undefined) continue;
      for (const kid of at.children.toReversed()) {
        kid.depth = at.depth + 1;
        stack.push(kid);
      }
    }
  }
  // Subtree sizes: in reverse pre-order every task comes before its parent.
  for (const item of order.toReversed()) if (item.parent) item.parent.size += item.size;

  const nodes: HierarchyNode[] = [];
  const nodeById = new Map<TaskId, HierarchyNode>();
  const parentIds: TaskId[] = [];
  for (const item of order) {
    const { id, children } = item;
    const node: HierarchyNode = Object.freeze({
      id,
      parentId: item.parent?.id,
      childIds: children ? Object.freeze(children.map((kid) => kid.id)) : NO_IDS,
      depth: item.depth,
      rootId: item.rootId,
      hasChildren: children !== undefined,
      parentAnchor: item.anchor,
      followParent: item.followParent,
      index: nodes.length,
      descendantCount: item.size - 1,
    });
    nodes.push(node);
    nodeById.set(id, node);
    if (children) parentIds.push(id);
  }

  taskIssues.sort((a, b) => a[0] - b[0]);
  for (const [, issue] of taskIssues) issues.push(issue);
  return Object.freeze({
    nodes: Object.freeze(nodes),
    nodeById,
    rootIds: Object.freeze(roots.map((root) => root.id)),
    parentIds: Object.freeze(parentIds),
    issues: Object.freeze(issues),
  });
}

/** One item per task with its anchor; resolves parents (`'unknown-parent'`). */
function readItems(
  model: NormalizedModel,
  fallback: readonly LinkType[],
  taskIssues: TaskIssue[],
): Item[] {
  const items: Item[] = [];
  const byId = new Map<TaskId, Item>();
  for (const { id, index, task, parentId } of model.tasks) {
    // Read from the caller's task: the field may be malformed (an 'invalid-shape' task).
    const raw = (task as { readonly parentAnchor?: unknown }).parentAnchor;
    const { anchor, problem } = readAnchor(raw, fallback);
    if (problem !== undefined) {
      const message = DEV ? `parentAnchor ${problem}, ${anchor.join(' + ')} is used` : '';
      const issue = hierarchyIssue(
        'invalid-parent-anchor',
        'warning',
        'parentAnchor',
        id,
        message,
        raw,
        anchor,
      );
      taskIssues.push([index, issue]);
    }
    const item: Item = {
      id,
      index,
      parentId,
      anchor,
      followParent: task.followParent === true,
      parent: undefined,
      children: undefined,
      depth: 0,
      rootId: id,
      size: 1,
      state: 0,
    };
    items.push(item);
    byId.set(id, item);
  }
  for (const item of items) {
    const { parentId } = item;
    if (parentId === undefined) continue;
    item.parent = byId.get(parentId);
    if (item.parent === undefined) {
      const message = DEV ? `parent ${show(parentId)} not found, shown as a root` : '';
      taskIssues.push([
        item.index,
        hierarchyIssue('unknown-parent', 'warning', 'parentId', item.id, message, parentId),
      ]);
    }
  }
  return items;
}

/** Reads the `childAnchor` option; an unusable value is reported and `'SS'` is used. */
function readChildAnchor(value: unknown, issues: HierarchyIssue[]): readonly LinkType[] {
  const { anchor, problem } = readAnchor(value, DEFAULT_CHILD_ANCHOR);
  if (problem !== undefined) {
    const message = DEV ? `${problem}, ${anchor.join(' + ')} is used` : '';
    issues.push(
      hierarchyIssue(
        'invalid-parent-anchor',
        'warning',
        'hierarchy.childAnchor',
        undefined,
        message,
        value,
        anchor,
      ),
    );
  }
  return anchor;
}

/**
 * Finds every loop of parent links and cuts it at the member that comes first in the input,
 * which becomes a root. Each task has at most one parent, so walking up from every task in turn
 * visits each task once: a walk that reaches a task of its own path has closed a loop.
 */
function breakCycles(items: readonly Item[], taskIssues: TaskIssue[]): void {
  const walk: Item[] = [];
  for (const start of items) {
    let at: Item | undefined = start;
    while (at?.state === 0) {
      at.state = 1;
      walk.push(at);
      at = at.parent;
    }
    if (at?.state === 1) {
      // The loop is the walk from `at` on, each member followed by its parent.
      const loop = walk.slice(walk.indexOf(at));
      const cut = loop.reduce((first, item) => (item.index < first.index ? item : first));
      const pos = loop.indexOf(cut);
      const members = [...loop.slice(pos), ...loop.slice(0, pos)].map((item) => item.id);
      cut.parent = undefined;
      taskIssues.push([cut.index, cycleIssue(cut.id, members)]);
    }
    for (const item of walk) item.state = 2;
    walk.length = 0;
  }
}

/** The `'parent-cycle'` issue of a loop; `id`, its first member, was made a root. */
function cycleIssue(id: TaskId, members: readonly TaskId[]): HierarchyIssue {
  const message = DEV ? `parent cycle ${cycleText(id, members)}, shown as a root` : '';
  return hierarchyIssue('parent-cycle', 'error', 'parentId', id, message, Object.freeze(members));
}

/** A loop of parents for the `'parent-cycle'` message: `"a" → "b" → "a"`. */
function cycleText(id: TaskId, members: readonly TaskId[]): string {
  const shown = members.slice(0, SHOWN_MEMBERS).map(show);
  return members.length > SHOWN_MEMBERS
    ? `${shown.join(' → ')} → … (${members.length} tasks)`
    : [...shown, show(id)].join(' → ');
}

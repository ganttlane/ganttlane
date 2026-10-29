/**
 * Visible rows of a {@link Hierarchy} for an expanded state (FR-ROW-1, FR-ROW-2, FR-ROW-4), and
 * pure helpers that compute the next expanded state.
 */

import type { TaskId } from '../model';
import type { Hierarchy } from './build';

/**
 * Which parents are expanded (`hierarchy.expandedKeys`, legacy `display_children`): `'all'`, or
 * the ids of the expanded parents. Ids of tasks without children are allowed and have no
 * effect until the task gets children; unknown ids are ignored.
 */
export type ExpandedKeys = 'all' | readonly TaskId[] | ReadonlySet<TaskId>;

/** One visible row (FR-ROW-1). Deeply frozen. */
export interface Row {
  /** The task id. */
  readonly id: TaskId;
  /** Position among the visible rows. */
  readonly index: number;
  /** Nesting level, `0` for a root. */
  readonly depth: number;
  /** Whether the task has children (shows an expand toggle). */
  readonly hasChildren: boolean;
  /** Whether its children are shown; always `false` without children. */
  readonly isExpanded: boolean;
  /** The root of its top-level group. */
  readonly rootId: TaskId;
  /** Alternates per visible row: zebra `display.rowStripes: 'row'` (FR-ROW-4). */
  readonly rowStripe: 0 | 1;
  /**
   * Alternates per top-level group, a root with its subtree: `display.rowStripes: 'group'`
   * (legacy `children_row_color_inherit`, FR-ROW-4). Roots are always visible, so it does not
   * depend on what is collapsed.
   */
  readonly groupStripe: 0 | 1;
}

/**
 * The rows to show for an expanded state, in row order (FR-ROW-1, FR-ROW-2): a collapsed parent
 * hides its whole subtree, whatever the keys say about its descendants. Pure and O(visible
 * rows): it walks {@link Hierarchy.nodes} and skips collapsed subtrees, without rebuilding the
 * tree.
 *
 * @param hierarchy - The tree from `buildHierarchy`.
 * @param expandedKeys - `'all'` or the ids of the expanded parents.
 * @returns Frozen rows with stripes for both zebra modes (FR-ROW-4).
 *
 * @example
 * ```ts
 * const rows = visibleRows(tree, 'all');
 * rows.map((row) => row.id); // every task, parents before their children
 * ```
 */
export function visibleRows(hierarchy: Hierarchy, expandedKeys: ExpandedKeys): readonly Row[] {
  const { nodes } = hierarchy;
  const keys = expandedKeys === 'all' ? undefined : toKeySet(expandedKeys);
  const rows: Row[] = [];
  let group = -1;
  let next = 0;
  for (let node = nodes[0]; node !== undefined; node = nodes[next]) {
    const { id, depth, hasChildren } = node;
    const isExpanded = hasChildren && (keys === undefined || keys.has(id));
    if (depth === 0) group++;
    const index = rows.length;
    rows.push(
      Object.freeze({
        id,
        index,
        depth,
        hasChildren,
        isExpanded,
        rootId: node.rootId,
        rowStripe: (index & 1) as 0 | 1,
        groupStripe: (group & 1) as 0 | 1,
      }),
    );
    // A collapsed parent skips its subtree.
    next += isExpanded ? 1 : node.descendantCount + 1;
  }
  return Object.freeze(rows);
}

/**
 * Keys that expand every current parent (FR-ROW-2, `expandAll()`): {@link Hierarchy.parentIds}.
 * Unlike `'all'`, parents that appear later start collapsed.
 *
 * @param hierarchy - The tree from `buildHierarchy`.
 * @returns The frozen ids of the tasks with children, in row order.
 */
export function expandAll(hierarchy: Hierarchy): readonly TaskId[] {
  return hierarchy.parentIds;
}

/**
 * Keys that collapse every parent (FR-ROW-2, `collapseAll()`).
 *
 * @returns A frozen empty list.
 */
export function collapseAll(): readonly TaskId[] {
  return NO_KEYS;
}

/**
 * The expanded state with one task expanded or collapsed (FR-ROW-2, `expand(id)` /
 * `collapse(id)`). Never mutates `keys`; other ids keep their order.
 *
 * - expanding: `'all'` stays `'all'`, otherwise `id` is appended when missing;
 * - collapsing: `id` is removed; `'all'` becomes every parent of `hierarchy` except `id`.
 *
 * @param hierarchy - The tree; read only to collapse from `'all'`.
 * @param keys - The current expanded state.
 * @param id - The task to expand or collapse.
 * @param expanded - The new state of `id`.
 * @returns `'all'` or a frozen list without repeats.
 */
export function setExpanded(
  hierarchy: Hierarchy,
  keys: ExpandedKeys,
  id: TaskId,
  expanded: boolean,
): 'all' | readonly TaskId[] {
  if (keys === 'all') {
    return expanded ? 'all' : Object.freeze(hierarchy.parentIds.filter((key) => key !== id));
  }
  const list = [...toKeySet(keys)];
  if (expanded) {
    if (!list.includes(id)) list.push(id);
    return Object.freeze(list);
  }
  return Object.freeze(list.filter((key) => key !== id));
}

/**
 * Flips whether `id` is in the expanded state (FR-ROW-2, the row's expand toggle): with
 * `'all'` every id counts as expanded, so the toggle collapses it. See {@link setExpanded}.
 *
 * @param hierarchy - The tree; read only to collapse from `'all'`.
 * @param keys - The current expanded state.
 * @param id - The task whose toggle was used.
 * @returns `'all'` or a frozen list without repeats.
 */
export function toggleExpanded(
  hierarchy: Hierarchy,
  keys: ExpandedKeys,
  id: TaskId,
): 'all' | readonly TaskId[] {
  const expanded = keys === 'all' || toKeySet(keys).has(id);
  return setExpanded(hierarchy, keys, id, !expanded);
}

const NO_KEYS: readonly TaskId[] = /* @__PURE__ */ Object.freeze([]);

/** The keys as a set; a malformed value (untyped callers) counts as no keys. */
function toKeySet(keys: readonly TaskId[] | ReadonlySet<TaskId>): ReadonlySet<TaskId> {
  if (keys instanceof Set) return keys;
  return new Set(Array.isArray(keys) ? keys : NO_KEYS);
}

/**
 * The task hierarchy (FR-ROW-1 … FR-ROW-4, `docs/architecture.md` §3): the tree from
 * `parentId` in row order, issues for unknown parents and parent cycles, normalized parent
 * anchors (FR-SCH-2), visible rows for an expanded state with zebra stripes per row or per
 * group, and pure helpers for the expanded state. Depends only on `model` (§3.1).
 *
 * Other core modules import the hierarchy only through this file.
 *
 * @module
 */

export type { Hierarchy, HierarchyNode, HierarchyOptions } from './build';
export { buildHierarchy } from './build';
export type { HierarchyIssue, HierarchyIssueCode } from './issues';
export type { ExpandedKeys, Row } from './rows';
export { collapseAll, expandAll, setExpanded, toggleExpanded, visibleRows } from './rows';

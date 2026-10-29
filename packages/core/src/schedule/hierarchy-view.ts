/**
 * The task tree as scheduling reads it: a structural view that the `Hierarchy` of
 * `buildHierarchy` fits, so that the schedule module does not depend on the hierarchy module
 * (`docs/architecture.md` §3.1).
 */

import type { LinkType, TaskId } from '../model';

/**
 * What scheduling (`propagate`, `detectConflicts`) reads about a task's place in the tree; a
 * `HierarchyNode` from `buildHierarchy` has these fields.
 */
export interface ScheduleNode {
  /** The resolved parent, `undefined` for a root. */
  readonly parentId: TaskId | undefined;
  /** Direct children. */
  readonly childIds: readonly TaskId[];
  /** Which edges follow which parent edges: at most one start pin and one end pin. */
  readonly parentAnchor: readonly LinkType[];
  /** `Task.followParent`. */
  readonly followParent: boolean;
}

/** The task tree as scheduling reads it; the `Hierarchy` of `buildHierarchy` fits. */
export interface ScheduleHierarchy {
  /** Nodes by task id. */
  readonly nodeById: ReadonlyMap<TaskId, ScheduleNode>;
}

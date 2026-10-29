/**
 * Scheduling (FR-LINK, FR-SCH, `docs/architecture.md` §3): the dependency graph over the
 * normalized model (typed anchors, lags, adjacency, cycles, topological order), the propagation
 * of an edit through links and the hierarchy into a `ChangeSet`, and the scheduling conflicts of
 * a state of the plan (non-working days, children outside their parent, violated links), and the
 * re-validation of change sets from outside `propagate` (before-hooks, API). Depends on
 * `calendar` and `model` (§3.1).
 *
 * Other core modules import scheduling only through this file.
 *
 * @module
 */

export type {
  Change,
  ChangeCause,
  ChangeReason,
  ChangeSet,
  Conflict,
  ConflictBase,
  ConflictType,
  LinkViolatedConflict,
  NonWorkingDayConflict,
  OutsideParentConflict,
  TaskBounds,
  TaskPatch,
} from './changeset';
export type { ConflictContext, ScheduleState } from './conflicts';
export { applyChangeSet, detectConflicts } from './conflicts';
export type {
  ActiveLinkRecord,
  InactiveLinkRecord,
  LinkAnchor,
  LinkAnchors,
  LinkGraph,
  LinkLag,
  LinkRecord,
  LinkRecordBase,
} from './graph';
export { anchorTime, buildLinkGraph, linkAnchors, measureLag, wouldCreateCycle } from './graph';
export type { ScheduleHierarchy, ScheduleNode } from './hierarchy-view';
export type { ScheduleIssue, ScheduleIssueCode } from './issues';
export type {
  MoveChildren,
  MoveCommand,
  PropagationCommand,
  PropagationContext,
  PropagationOptions,
  PropagationPolicy,
  RescheduleCommand,
  ResizeEndCommand,
  ResizeStartCommand,
  SkipNonWorkingDays,
} from './propagation';
export { propagate } from './propagation';
export type { ChangeSetIssue, ChangeSetIssueCode, RevalidatedChangeSet } from './revalidate';
export { revalidateChangeSet } from './revalidate';
export type { TopoSortResult } from './topo-sort';
export { topoSort } from './topo-sort';

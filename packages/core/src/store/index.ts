/**
 * The state store (FR-TX-3, FR-DATA-7, `docs/architecture.md` §3, §4, §10): immutable snapshots
 * of the committed data, the resolved options and the UI state, with derived data (model,
 * hierarchy, link graph, conflicts, visible rows, view mode, snap) recomputed through a memoized
 * pipeline; serializable commands applied by a pure reducer; a draft of two layers (committed
 * changes the owner of controlled data has not applied yet, previews over them); controlled and
 * uncontrolled data; the base of an edit session and its diff (FR-TX-4);
 * `subscribe` / `getSnapshot` for `useSyncExternalStore`; memoized selectors. Synchronous:
 * before-hooks, async confirmation, sessions and history live in `events` (§3.1).
 *
 * Other core modules import the store only through this file.
 *
 * @module
 */

export { createStoreState, reduceStore } from './reducer';
export type { SelectorResults } from './selectors';
export { createSelector, selectTaskPatch } from './selectors';
export {
  selectCommittedPatch,
  selectSessionChanges,
  selectSessionDirty,
  selectSessionRollback,
} from './session';
export { createStore } from './store';
export type {
  ApplyChangeSetCommand,
  BeginSessionCommand,
  CollapseAllCommand,
  CommitSessionCommand,
  DataChange,
  DataMode,
  Draft,
  DraftLayer,
  EditSessionBase,
  ExpandAllCommand,
  IdDiff,
  RollbackSessionCommand,
  SessionChanges,
  SessionLinkChanges,
  SetDataCommand,
  SetDraftCommand,
  SetExpandedCommand,
  SetExpandedKeysCommand,
  SetLinksCommand,
  SetOptionsCommand,
  SetTasksCommand,
  SetViewModeCommand,
  Store,
  StoreCommand,
  StoreDatesOptions,
  StoreDerived,
  StoreExpandedKeys,
  StoreHierarchyOptions,
  StoreInit,
  StoreIssue,
  StoreIssueCode,
  StoreOptions,
  StoreSchedulingOptions,
  StoreSettings,
  StoreState,
  ToggleExpandedCommand,
} from './types';

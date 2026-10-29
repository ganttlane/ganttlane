/**
 * Events, before-hooks and transactions: a typed emitter with an `error` channel (Observer), the
 * core event map, before-hook chains (Chain of Responsibility), the change controller that runs
 * them between the synchronous store and the after-events, with option-style handlers that can be
 * swapped at any time, and on top of it the edit session and the change history. Sits above
 * `store`.
 *
 * Other core modules import events only through this file.
 *
 * @module
 */

export type {
  BusyResult,
  CancelledResult,
  CancelReason,
  ChangeController,
  ChangeControllerOptions,
  CommitResult,
  CommittedResult,
  ControllerObserver,
  ControllerOperation,
  DataCommand,
  DataOperation,
  LinkCreatedResult,
  LinkCreateOperation,
  LinkCreateResult,
  LinkDeletedResult,
  LinkDeleteOperation,
  LinkDeleteResult,
  LinkRejectedResult,
  LinkRejectReason,
  OperationBase,
  TasksOperation,
  UnchangedResult,
} from './controller';
export { createChangeController } from './controller';
export type { Emitter, EmitterEvents, ErrorPayload, Listener, Unsubscribe } from './emitter';
export { createEmitter } from './emitter';
export type {
  ChangeHistory,
  ChangeHistoryOptions,
  HistoryCheckpoint,
  HistoryEmptyResult,
  HistoryEntry,
  HistoryResult,
  HistorySettings,
  HistoryStaleResult,
  HistorySteppedResult,
  LinkCreateHistoryEntry,
  LinkDeleteHistoryEntry,
  TasksHistoryEntry,
} from './history';
export { createChangeHistory } from './history';
export type {
  Awaitable,
  BeforeLinkCreateContext,
  BeforeLinkCreateHook,
  BeforeLinkCreateResult,
  BeforeTaskChangeContext,
  BeforeTaskChangeHook,
  BeforeTaskChangeResult,
  HookMap,
  HookName,
  Hooks,
} from './hooks';
export { createHooks } from './hooks';
export type {
  EditSession,
  EditSessionOptions,
  NoSessionResult,
  SessionAlreadyOpenResult,
  SessionBeginResult,
  SessionBegunResult,
  SessionCommitResult,
  SessionCommittedResult,
  SessionRollbackResult,
  SessionRolledBackResult,
} from './session';
export { createEditSession } from './session';
export type {
  CoreEventHandlers,
  CoreEventName,
  CoreEvents,
  CoreHandlers,
  CoreHookHandlers,
  DirtyChangePayload,
  EditRefusedPayload,
  ExpandedChangePayload,
  HistoryChangePayload,
  IssueSource,
  IssuesPayload,
  LinkCreatePayload,
  LinkDeletePayload,
  LinkPointerPayload,
  RangeChangePayload,
  ScrollPayload,
  SelectionChangePayload,
  TaskDatesChangePayload,
  TaskHoverPayload,
  TaskPointerPayload,
  TaskProgressChangePayload,
  ViewModeChangePayload,
} from './types';

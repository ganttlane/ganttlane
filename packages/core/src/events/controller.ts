/**
 * The change controller (`docs/architecture.md` §4): the orchestration between the synchronous
 * store and the outside world. It shows previews, runs the before-hook chains (sync or async),
 * re-validates what they return, commits through the store and emits the after-events.
 */

import { type Link, type ModelIssue, normalizeLink, type Task } from '../model';
import {
  type ChangeSet,
  type ChangeSetIssue,
  type LinkRecord,
  revalidateChangeSet,
  wouldCreateCycle,
} from '../schedule';
import type {
  SetDataCommand,
  SetLinksCommand,
  SetOptionsCommand,
  SetTasksCommand,
  Store,
  StoreCommand,
  StoreDerived,
  StoreState,
} from '../store';
import { type Emitter, type ErrorPayload, throwAll, type Unsubscribe } from './emitter';
import { createHooks, type HookMap, type HookName, type Hooks } from './hooks';
import type { CoreEventName, CoreEvents, CoreHandlers } from './types';

/** What {@link createChangeController} works with. */
export interface ChangeControllerOptions<TData = unknown> {
  /** The store whose data the controller changes. */
  readonly store: Store<TData>;
  /** Where the controller emits its events, and where option-style handlers listen. */
  readonly emitter: Emitter<CoreEvents>;
  /** The before-hook registry; a new one when omitted (see `ChangeController.hooks`). */
  readonly hooks?: Hooks | undefined;
  /** Initial option-style handlers (see `ChangeController.setHandlers`). */
  readonly handlers?: CoreHandlers | undefined;
}

/** Another operation of the controller is in progress (see `ChangeController.pending`). */
export interface BusyResult {
  /** Discriminant. */
  readonly status: 'busy';
}

/**
 * Why an operation was cancelled: a hook answered `false` (`'hook'`), a hook threw, rejected or
 * answered something invalid (`'error'`), or the controller was disposed (`'disposed'`).
 */
export type CancelReason = 'hook' | 'error' | 'disposed';

/** The operation was cancelled; nothing was changed or emitted except an `error`. */
export interface CancelledResult {
  /** Discriminant. */
  readonly status: 'cancelled';
  /** Why. */
  readonly reason: CancelReason;
  /** For `'error'`: what the hook threw or rejected with (also emitted on `error`). */
  readonly error?: unknown;
}

/** The change set was committed (FR-TX-1). */
export interface CommittedResult {
  /** Discriminant. */
  readonly status: 'committed';
  /** The change set that was applied and emitted as `tasksChange`. */
  readonly changeSet: ChangeSet;
  /** What re-validation corrected or dropped (also emitted on `issues`). */
  readonly issues: readonly ChangeSetIssue[];
}

/** Nothing was left to commit: the change set was empty, or became empty when re-validated. */
export interface UnchangedResult {
  /** Discriminant. */
  readonly status: 'unchanged';
  /** What re-validation dropped (also emitted on `issues`). */
  readonly issues: readonly ChangeSetIssue[];
}

/** Outcome of `ChangeController.commit`. */
export type CommitResult = CommittedResult | UnchangedResult | CancelledResult | BusyResult;

/**
 * Why a link operation was refused without asking the hooks (or despite them, for a cycle):
 * - `'invalid'`: the model would drop the link (FR-DATA-11): a malformed field (`'invalid-shape'`,
 *   e.g. an unknown type), an invalid lag or one with months (`'invalid-duration'`), or a
 *   misaligned lag with `alignInput: 'reject'` (`'misaligned'`); see `issues`;
 * - `'unknown-task'`: the source or the target is not a task;
 * - `'duplicate'`: a link with the same source, target and type exists (whatever its id), or the
 *   explicit `link.id` is in use (an id-less link whose default id is taken gets a free one);
 * - `'cycle'`: the link would close a cycle of links (FR-LINK-7), or is a self-link;
 * - `'unknown-link'`: no link has the id to delete.
 */
export type LinkRejectReason = 'invalid' | 'unknown-task' | 'duplicate' | 'cycle' | 'unknown-link';

/** A link operation was refused; nothing was changed or emitted. */
export interface LinkRejectedResult {
  /** Discriminant. */
  readonly status: 'rejected';
  /** Why. */
  readonly reason: LinkRejectReason;
  /** For `'invalid'`: why the model would drop the link (errors, paths such as `link.lag`). */
  readonly issues?: readonly ModelIssue[];
}

/** The link was created (FR-LINK-6). */
export interface LinkCreatedResult {
  /** Discriminant. */
  readonly status: 'created';
  /** Its id: `link.id`, the default `` `${source}:${type}:${target}` ``, or a free one. */
  readonly id: string;
  /**
   * The link as written: as given, or, when its default id was taken by another link, a copy
   * with the free id as its explicit `id` (the given object is never mutated).
   */
  readonly link: Link;
}

/** Outcome of `ChangeController.createLink`. */
export type LinkCreateResult =
  LinkCreatedResult | LinkRejectedResult | CancelledResult | BusyResult;

/** The link was deleted (FR-LINK-5). */
export interface LinkDeletedResult {
  /** Discriminant. */
  readonly status: 'deleted';
  /** Its id. */
  readonly id: string;
  /** The link as it was in the graph. */
  readonly link: LinkRecord;
}

/** Outcome of `ChangeController.deleteLink`. */
export type LinkDeleteResult =
  LinkDeletedResult | LinkRejectedResult | CancelledResult | BusyResult;

/**
 * A command of the data owner that `ChangeController.update` forwards to the store: new tasks,
 * links or options, or several of them at once (`setData`: derived once, one operation for the
 * observers).
 *
 * @typeParam TData - Type of `task.data`.
 */
export type DataCommand<TData = unknown> =
  SetTasksCommand<TData> | SetLinksCommand | SetOptionsCommand | SetDataCommand<TData>;

/** Fields of every {@link ControllerOperation}. */
export interface OperationBase<TData = unknown> {
  /** The store snapshot right before the operation changed it. */
  readonly before: StoreState<TData>;
  /** The store snapshot right after (the same as `before` when controlled data stayed as is). */
  readonly after: StoreState<TData>;
}

/** A change set was applied (`commit`, `apply`). */
export interface TasksOperation<TData = unknown> extends OperationBase<TData> {
  /** Discriminant. */
  readonly type: 'tasks';
  /** The change set as applied and emitted as `tasksChange`. */
  readonly changeSet: ChangeSet;
}

/** A link was created (`createLink`, `applyLinkCreate`). */
export interface LinkCreateOperation<TData = unknown> extends OperationBase<TData> {
  /** Discriminant. */
  readonly type: 'linkCreate';
  /** Its id. */
  readonly id: string;
  /** The link as written (see `LinkCreatedResult.link`). */
  readonly link: Link;
}

/** A link was deleted (`deleteLink`, `applyLinkDelete`). */
export interface LinkDeleteOperation<TData = unknown> extends OperationBase<TData> {
  /** Discriminant. */
  readonly type: 'linkDelete';
  /** Its id. */
  readonly id: string;
  /** The link as it was in the graph. */
  readonly link: LinkRecord;
}

/** The owner changed the data or the options (`update`); reported when the snapshot changed. */
export interface DataOperation<TData = unknown> extends OperationBase<TData> {
  /** Discriminant. */
  readonly type: 'data';
  /** The command. */
  readonly command: DataCommand<TData>;
}

/**
 * What the controller did, as its observers see it (`ChangeController.observe`). Frozen.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type ControllerOperation<TData = unknown> =
  | TasksOperation<TData>
  | LinkCreateOperation<TData>
  | LinkDeleteOperation<TData>
  | DataOperation<TData>;

/** An observer of the controller's operations (`ChangeController.observe`). */
export type ControllerObserver<TData = unknown> = (operation: ControllerOperation<TData>) => void;

/**
 * The change controller of {@link createChangeController}. Its methods need no `this`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface ChangeController<TData = unknown> {
  /**
   * Shows a change set over the committed data (`setDraft`, FR-EDIT-5): the preview layer of the
   * draft, as given (a drag preview from `propagate` is valid), over a committed change the owner
   * of controlled data has not applied yet. Refused while an operation is
   * {@link ChangeController.pending} (the draft then shows the change set being confirmed) and
   * after `dispose`.
   *
   * @returns Whether the preview was set.
   */
  readonly preview: (changeSet: ChangeSet) => boolean;
  /**
   * Removes the preview (`setDraft(undefined)`, FR-EDIT-4); a committed change the owner has not
   * applied yet stays. Refused like `preview`.
   *
   * @returns Whether the preview was removed.
   */
  readonly cancelPreview: () => boolean;
  /**
   * Commits a change set computed on the store's current model (FR-TX-1, FR-TX-2, FR-SNAP-13),
   * see {@link createChangeController}.
   */
  readonly commit: (changeSet: ChangeSet) => Promise<CommitResult>;
  /** Creates a link (FR-LINK-6), see {@link createChangeController}. */
  readonly createLink: (link: Link) => Promise<LinkCreateResult>;
  /** Deletes a link by id (FR-LINK-5), see {@link createChangeController}. */
  readonly deleteLink: (id: string) => Promise<LinkDeleteResult>;
  /**
   * Applies a change set like `commit`, but synchronously and without the before-hooks: for
   * changes that must not be vetoed, such as undo and redo (FR-TX-5). It is re-validated
   * (FR-SNAP-13), applied and emitted exactly like a commit; a change set that is empty after
   * re-validation leaves the store (and its draft) as it is. `'busy'` while an operation is
   * {@link ChangeController.pending} or a committed change waits for the owner of controlled
   * data.
   */
  readonly apply: (changeSet: ChangeSet) => CommitResult;
  /**
   * Creates a link like `createLink`, but synchronously and without the before-hooks (undo,
   * redo). The checks still apply: an invalid link, an unknown task, a duplicate or a cycle is
   * `'rejected'`.
   */
  readonly applyLinkCreate: (link: Link) => LinkCreateResult;
  /** Deletes a link like `deleteLink`, synchronously (undo, redo). */
  readonly applyLinkDelete: (id: string) => LinkDeleteResult;
  /**
   * Forwards a command of the data owner to the store (`setTasks`, `setLinks`, `setOptions`, or
   * `setData` for several at once, FR-DATA-7) and tells the observers when the snapshot changed,
   * so that edit sessions and the history see data replaced from outside: one operation per
   * command, so `setData` is one owner change for them. Never refused while an operation is
   * pending (a pending commit is re-validated against the new data); does nothing after
   * `dispose`. Dispatching such commands to the store directly bypasses the observers.
   */
  readonly update: (command: DataCommand<TData>) => void;
  /**
   * Adds an observer of every operation the controller applies (Observer pattern): a commit or an
   * `apply`, a link created or deleted, an owner's `update`. It is called synchronously right
   * after the store changed and the lock was released, **before** the after-events, in
   * subscription order (also for an operation started while another one emits its events, whose
   * own events wait, see {@link createChangeController}); what it throws is rethrown to the
   * caller once the other observers and the events have run (never swallowed). Not called for
   * cancelled, rejected or unchanged operations. Edit sessions and the history build on it.
   *
   * @returns A function that removes the observer (idempotent).
   */
  readonly observe: (observer: ControllerObserver<TData>) => Unsubscribe;
  /**
   * Emits an event of a component built on the controller (the history's `historyChange`, the
   * edit session's `dirtyChange` and `editRollback`) in the controller's event order. `emit`
   * emits it (on the component's emitter) and is called:
   * - when an observer reports while it is told about an operation: after the observers, right
   *   before the operation's own events (for a nested operation: in the outbox, after the events
   *   of the running one, like the nested operation's own events);
   * - when called while an operation reports (a listener of its events started the component's
   *   step): after the events waiting in the outbox;
   * - otherwise at once.
   *
   * What `emit` throws is collected and rethrown like what the operation's listeners throw; when
   * it is called at once, it is thrown to the caller.
   */
  readonly report: (emit: () => void) => void;
  /**
   * Sets, swaps or removes option-style handlers (FR-EVT-2): `onTasksChange` listens to
   * `tasksChange` and so on, `onBeforeTaskChange` / `onBeforeLinkCreate` run in their hook chains.
   * Keys missing from `handlers` are kept; a key set to anything but a function removes its
   * handler. Swapping a handler keeps its place among the listeners and hooks (it is subscribed
   * once, where it was first set, and always calls the current function), and never touches the
   * subscriptions made with `emitter.on` or `hooks.add`.
   */
  readonly setHandlers: (handlers: CoreHandlers) => void;
  /** The before-hook registry the controller runs (`hooks.add('beforeTaskChange', fn)`). */
  readonly hooks: Hooks;
  /**
   * Whether a commit or a link creation is running its hooks (typically: awaiting one). Other
   * operations then resolve `{ status: 'busy' }` and `preview` is refused. Already `false` while
   * the after-events are emitted. Operations (not previews) are also `'busy'` while controlled
   * data shows a committed change its owner has not applied yet (`state.draft?.committed`).
   */
  readonly pending: boolean;
  /**
   * Aborts the pending operation (it resolves `{ status: 'cancelled', reason: 'disposed' }` at
   * once, a hook's late answer is ignored) and removes the option-style handlers and the
   * observers. Afterwards nothing is dispatched or emitted, and every operation resolves
   * cancelled. The store is left as it is (also a draft shown while a hook was awaited).
   * Idempotent.
   */
  readonly dispose: () => void;
}

/** A new link that passed the checks of `checkLink`. */
interface CheckedLink {
  /** Its id: `link.id`, its default id, or a free id when the default one is taken. */
  readonly id: string;
  /** The link to write: as given, or a copy with the free id as its explicit id. */
  readonly link: Link;
  /** Whether it would close a cycle of links (FR-LINK-7). */
  readonly wouldCreateCycle: boolean;
}

/** The result of calling a hook: its answer, or what it threw or rejected with. */
type Outcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/** An event of an operation, waiting to be emitted. */
type Outgoing = { [K in CoreEventName]: readonly [K, CoreEvents[K]] }[CoreEventName];

/** What waits in the outbox: an event of an operation, or one reported by a component. */
type Pending = Outgoing | (() => void);

/** The method an operation was started with, named in the message of its errors. */
type OperationName =
  | 'commit'
  | 'apply'
  | 'createLink'
  | 'applyLinkCreate'
  | 'deleteLink'
  | 'applyLinkDelete'
  | 'update';

const BUSY: BusyResult = /* @__PURE__ */ Object.freeze({ status: 'busy' });
const DISPOSED: CancelledResult = /* @__PURE__ */ Object.freeze({
  status: 'cancelled',
  reason: 'disposed',
});
const VETOED: CancelledResult = /* @__PURE__ */ Object.freeze({
  status: 'cancelled',
  reason: 'hook',
});
const NO_ISSUES: readonly ChangeSetIssue[] = /* @__PURE__ */ Object.freeze([]);
const NO_EVENTS: readonly Outgoing[] = /* @__PURE__ */ Object.freeze([]);
const HOOK_HANDLERS: ReadonlyMap<string, HookName> = /* @__PURE__ */ new Map([
  ['onBeforeTaskChange', 'beforeTaskChange'],
  ['onBeforeLinkCreate', 'beforeLinkCreate'],
]);

/**
 * Creates the change controller over a store, an emitter and a hook registry (FR-TX-1, FR-TX-2,
 * FR-TX-3, FR-EVT-1 … FR-EVT-3, FR-LINK-6, FR-SNAP-13). The store stays synchronous and
 * hook-free; the controller is the only place where edits wait for hooks.
 *
 * **`commit(changeSet)`** — one user action or API change:
 * 1. The change set is re-validated against the store's current model (`revalidateChangeSet`):
 *    aligned to the granularity, unknown and locked tasks dropped, conflicts recomputed.
 * 2. The `beforeTaskChange` hooks run **one after another in registration order** (Chain of
 *    Responsibility), each with `{ changeSet, reason, conflicts }` of the current change set:
 *    `false` cancels; a `ChangeSet` replaces the current one (one without a `reason` gets the
 *    current one's), which is re-validated first, so the next hook sees it aligned and with its
 *    own conflicts; `true` or nothing passes. A hook that throws, rejects or answers anything else
 *    cancels, and the error is emitted on `error` (`source: 'hook'`). Before a hook's promise is
 *    awaited, the change set being confirmed is shown as the preview.
 * 3. Cancelled: the preview is removed and the result is `{ status: 'cancelled' }`. Nothing left
 *    to change (empty from the start or after re-validation): the preview is removed,
 *    `'unchanged'`.
 * 4. Otherwise the change set is re-validated once more if the store changed while a hook was
 *    awaited, and applied with the store's `applyChangeSet`: uncontrolled data is patched,
 *    controlled data stays and the change set goes to the committed layer of the draft until the
 *    owner's next `setTasks` (FR-TX-3). Then the observers (`observe`) and the events: `issues`
 *    (when re-validation reported any, also on cancel), **exactly one `tasksChange`** (FR-TX-1),
 *    then per change `taskDatesChange` (when `start` or `endExclusive` changed; with the
 *    `precision` of `after` when the change sets one) and `taskProgressChange` (when `progress`
 *    changed).
 *
 * When no hook returns a promise, the whole commit happens synchronously inside the call; the
 * returned promise only reports the result.
 *
 * **One operation at a time.** While a commit or a link creation awaits a hook,
 * {@link ChangeController.pending} is `true`: `commit`, `createLink` and `deleteLink` resolve
 * `{ status: 'busy' }` at once and `preview` is refused (the interaction layer does not start a
 * drag while pending). The lock is released before the after-events, so their listeners may
 * start the next operation.
 *
 * **Waiting for the owner** (controlled data, FR-TX-3). While the store shows a committed change
 * the owner has not applied yet (`state.draft?.committed`), every operation that changes data
 * (`commit`, `apply`, `createLink`, `applyLinkCreate`, `deleteLink`, `applyLinkDelete`) resolves
 * `'busy'`: it would be computed on the owner's old data, and the change would be lost. Previews
 * still show over it. The owner's `setTasks` (through `update`) ends the wait.
 *
 * **Event order.** An operation started while another one reports (by one of its observers or
 * event listeners) is applied at once, and its observers are called right after its store
 * change, but its events wait in an outbox: the running operation's events all go out first,
 * then those of the nested operations, in the order they were applied. Each action still emits
 * exactly one `tasksChange`. The nested call returns its result at once; what its observers and
 * listeners throw is rethrown by the outermost operation. The events of the history and the edit
 * session (`historyChange`, `dirtyChange`, `editRollback`) go through `report` and keep this
 * order too: an operation's own `historyChange` and `dirtyChange` come right before its events,
 * also for a nested one, and a session step started by a listener reports after the running
 * operation's events.
 *
 * **`createLink(link)`** (FR-LINK-6): the link is checked as the model normalizes it
 * (`normalizeLink`): one the model would drop (a malformed field, an invalid lag or one with
 * months, a misaligned lag with `alignInput: 'reject'`) is `'rejected'` as `'invalid'` with the
 * issues; a link to or from an unknown task, or a duplicate (the same source, target and type,
 * defaults applied, whatever the id; or an explicit `link.id` already in use), is `'rejected'` at
 * once too. An id-less link whose default id `` `${source}:${type}:${target}` `` another link
 * took (a link with other ends that has it as its explicit id) gets the first free id of
 * `` `${defaultId}#2` ``, `#3`, …, written as its explicit `id` into a copy of the link, which is
 * what the hooks see, what is appended and what `linkCreate` and the result carry: the model
 * would drop the link otherwise. Then the `beforeLinkCreate` hooks run in order with
 * `{ link, id, wouldCreateCycle }` (from the link graph): `false` cancels, a throw or rejection
 * cancels with an `error` event. A link that would close a cycle (or a self-link) is then always
 * `'rejected'` with `'cycle'`, whatever the hooks answered: they may only veto more. The checks
 * are repeated if the store changed while a hook was awaited. Then uncontrolled links get the
 * link appended (`setLinks`), controlled ones stay for the owner to apply, and `linkCreate` is
 * emitted.
 *
 * **`deleteLink(id)`** (FR-LINK-5): an unknown id is `'rejected'`. Uncontrolled data loses the
 * link: removed from `links`, or, for a link from the `Task.dependencies` shorthand, the matching
 * entries are removed from its target task (`setTasks`). Controlled data stays for the owner.
 * Then `linkDelete` is emitted. Permissions (`linkable`, `editable`) are the interaction layer's
 * job (plan step 3.7); API calls are never refused for them.
 *
 * **Without hooks.** `apply`, `applyLinkCreate` and `applyLinkDelete` do the same synchronously
 * and skip the before-hooks (undo, redo: FR-TX-5); they are `'busy'` like the others.
 * **`update(command)`** forwards the owner's `setTasks` / `setLinks` / `setOptions` / `setData`
 * to the store and reports it to the observers, which is how edit sessions and the history learn
 * about data replaced from outside.
 *
 * **Errors.** An exception of an after-event listener reaches the `error` listeners; when there
 * are none it rejects the returned promise (or is thrown by the synchronous methods), after the
 * change was applied (it is never swallowed). So does what a store listener throws: the
 * observers and the events still run. Several errors are one `AggregateError` naming the
 * operation (`'2 event listeners or observers threw during commit()'`).
 *
 * @param options - The store, the emitter, the hook registry and initial handlers.
 * @returns The controller.
 *
 * @example
 * ```ts
 * const store = createStore({ tasks, links });
 * const emitter = createEmitter<CoreEvents>();
 * const controller = createChangeController({
 *   store,
 *   emitter,
 *   handlers: { onBeforeTaskChange: ({ conflicts }) => conflicts.length === 0 || confirm() },
 * });
 * emitter.on('tasksChange', (changeSet) => save(changeSet));
 * controller.preview(dragPreview);              // while dragging
 * const result = await controller.commit(drop); // on pointer up
 * if (result.status === 'cancelled') showWhy(result.reason);
 * ```
 */
export function createChangeController<TData = unknown>(
  options: ChangeControllerOptions<TData>,
): ChangeController<TData> {
  const { store, emitter } = options;
  const hooks = options.hooks ?? createHooks();
  /** The operation in progress, while it awaits a hook. */
  let active: object | undefined;
  /** Resolves the hook being awaited with `undefined` (dispose). */
  let abortWait: (() => void) | undefined;
  let disposed = false;
  /** Option-style handlers by key: the current function and how to unsubscribe its forwarder. */
  const handlers = new Map<string, { readonly box: { fn: unknown }; readonly off: Unsubscribe }>();
  /** Observers (copy on write: a notification iterates over the list it started with). */
  let observers: readonly { readonly observer: ControllerObserver<TData> }[] = [];

  // Read through a function: TypeScript would keep `disposed` narrowed across an `await`.
  const isDisposed = (): boolean => disposed;

  const release = (token: object): void => {
    if (active !== token) return;
    active = undefined;
    abortWait = undefined;
  };

  /** The events and errors of the operation that reports, while one does (the outbox). */
  let outbox: { readonly events: Pending[]; readonly errors: unknown[] } | undefined;
  /**
   * While the observers are told about an operation: where the events they `report` go, so that
   * they come before the operation's own events (and, for a nested operation, after the events
   * already waiting in the outbox).
   */
  let reported: Pending[] | undefined;

  /**
   * Whether operations that change data wait: one awaits a hook, or controlled data shows a
   * committed change the owner has not applied yet (a change set would be computed on its old
   * data).
   */
  const isBusy = (): boolean =>
    active !== undefined || store.getSnapshot().draft?.committed === true;

  /** Dispatches to the store, collecting what its listeners threw (the change is made). */
  const dispatch = (errors: unknown[], command: StoreCommand<TData>): void => {
    try {
      store.dispatch(command);
    } catch (error) {
      errors.push(error);
    }
  };

  /**
   * Tells the observers about an operation unless disposed, collecting what they threw; the
   * events they `report` meanwhile go to `into`.
   */
  const notify = (
    errors: unknown[],
    operation: ControllerOperation<TData>,
    into: Pending[],
  ): void => {
    if (disposed) return;
    const frozen = Object.freeze(operation);
    const outer = reported;
    reported = into;
    try {
      for (const entry of observers) {
        if (!observers.includes(entry)) continue;
        try {
          entry.observer(frozen);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      reported = outer;
    }
  };

  /** Emits an event unless disposed, collecting what its listeners threw. */
  const send = (errors: unknown[], event: Pending): void => {
    if (disposed) return;
    try {
      if (typeof event === 'function') event();
      else emitter.emit(event[0], event[1]);
    } catch (error) {
      errors.push(error);
    }
  };

  /** `ChangeController.report`: queues `emit` where the controller's event order puts it. */
  const report = (emit: () => void): void => {
    const into = reported ?? outbox?.events;
    if (into === undefined) emit();
    else into.push(emit);
  };

  /**
   * The end of every operation: tells the observers about `operation` (when given), emits what
   * they reported, then `events`, then rethrows `errors` (of the store's listeners) and what
   * observers and listeners threw. While another operation reports (this one was started by one
   * of its observers or listeners), the observers are told at once, but what they report, the
   * events and the errors join the outbox, which the reporting operation empties after its own
   * events.
   */
  const publish = (
    name: OperationName,
    operation: ControllerOperation<TData> | undefined,
    events: readonly Outgoing[],
    errors: readonly unknown[],
  ): void => {
    const running = outbox;
    if (running !== undefined) {
      running.errors.push(...errors);
      if (operation !== undefined) notify(running.errors, operation, running.events);
      running.events.push(...events);
      return;
    }
    const own: { readonly events: Pending[]; readonly errors: unknown[] } = {
      events: [...events],
      errors: [...errors],
    };
    outbox = own;
    try {
      if (operation !== undefined) {
        // Reported by the observers: before the operation's events, and before the events of
        // operations an observer started (already in the outbox).
        const observed: Pending[] = [];
        notify(own.errors, operation, observed);
        own.events.unshift(...observed);
      }
      // An array iterator sees the events that nested operations append meanwhile.
      for (const event of own.events) send(own.errors, event);
    } finally {
      outbox = undefined;
    }
    const failed = own.errors;
    if (failed.length > 0) {
      throwAll(failed, `${failed.length} event listeners or observers threw during ${name}()`);
    }
  };

  /**
   * Calls a hook. A synchronous answer is returned as it is; a thenable is awaited after
   * `onAsync`, racing `dispose` (which resolves `undefined`).
   */
  const invoke = (
    call: () => unknown,
    onAsync: () => void,
  ): Outcome | Promise<Outcome | undefined> => {
    let result: unknown;
    try {
      result = call();
      if (!isThenable(result)) return { ok: true, value: result };
    } catch (error) {
      return { ok: false, error };
    }
    // Settle first: a later rejection is handled even if `onAsync` throws.
    const settled = Promise.resolve(result).then(
      (value): Outcome => ({ ok: true, value }),
      (error: unknown): Outcome => ({ ok: false, error }),
    );
    onAsync();
    return new Promise((resolve) => {
      abortWait = () => {
        resolve(undefined);
      };
      void settled.then(resolve);
    });
  };

  /**
   * Applies a valid, non-empty change set, releases the lock of `token`, then tells the observers
   * and emits `issues`, `tasksChange` and the per-task events (the end of `commit` and `apply`).
   */
  const applyTasks = (
    name: OperationName,
    changeSet: ChangeSet,
    issues: readonly ChangeSetIssue[],
    errors: unknown[],
    token?: object,
  ): CommittedResult => {
    const before = store.getSnapshot();
    dispatch(errors, { type: 'applyChangeSet', changeSet });
    if (token !== undefined) release(token);
    const events: Outgoing[] = [];
    if (issues.length > 0) {
      events.push(['issues', Object.freeze({ source: 'change-set', issues })]);
    }
    events.push(['tasksChange', changeSet]);
    for (const { id, before: old, after } of changeSet.changes) {
      if (after.start !== old.start || after.endExclusive !== old.endExclusive) {
        const { start, endExclusive, precision } = after;
        const dates = { id, start, endExclusive };
        const payload = precision === undefined ? dates : { ...dates, precision };
        events.push(['taskDatesChange', Object.freeze(payload)]);
      }
      if (after.progress !== old.progress) {
        events.push(['taskProgressChange', Object.freeze({ id, progress: after.progress })]);
      }
    }
    const operation: TasksOperation<TData> = {
      type: 'tasks',
      changeSet,
      before,
      after: store.getSnapshot(),
    };
    publish(name, operation, events, errors);
    return Object.freeze({ status: 'committed', changeSet, issues });
  };

  /** Emits `issues` (when any) and, for a failed hook, `error`; then rethrows what was thrown. */
  const finish = (
    name: OperationName,
    issues: readonly ChangeSetIssue[],
    errors: readonly unknown[],
    failure?: { readonly error: unknown; readonly name: HookName },
  ): void => {
    const events: Outgoing[] = [];
    if (issues.length > 0) {
      const frozen = Object.isFrozen(issues) ? issues : Object.freeze([...issues]);
      events.push(['issues', Object.freeze({ source: 'change-set', issues: frozen })]);
    }
    if (failure !== undefined) {
      const payload: ErrorPayload = { error: failure.error, source: 'hook', name: failure.name };
      events.push(['error', Object.freeze(payload)]);
    }
    publish(name, undefined, events, errors);
  };

  /** `DISPOSED`, or what the store's listeners threw before (never swallowed). */
  const disposedAfter = (errors: readonly unknown[]): CancelledResult => {
    if (errors.length > 0) {
      throwAll(errors, `${errors.length} store listeners threw during commit()`);
    }
    return DISPOSED;
  };

  const revalidate = (
    changeSet: ChangeSet,
    context: StoreDerived<TData>,
    issues: ChangeSetIssue[],
  ): ChangeSet => {
    const result = revalidateChangeSet(changeSet, context);
    issues.push(...result.issues);
    return result.changeSet;
  };

  const commit = async (input: ChangeSet): Promise<CommitResult> => {
    if (disposed) return DISPOSED;
    if (isBusy()) return BUSY;
    const token = {};
    active = token;
    /** What the store's listeners threw, rethrown at the end. */
    const errors: unknown[] = [];
    try {
      const issues: ChangeSetIssue[] = [];
      let base = store.getSnapshot().derived;
      let current = revalidate(input, base, issues);
      for (const hook of hooks.chain('beforeTaskChange')) {
        if (current.changes.length === 0) break;
        const shown = current;
        const context = Object.freeze({
          changeSet: shown,
          reason: shown.reason,
          conflicts: shown.conflicts,
        });
        const called = invoke(
          () => hook(context),
          () => {
            dispatch(errors, { type: 'setDraft', changeSet: shown });
          },
        );
        const outcome = called instanceof Promise ? await called : called;
        if (isDisposed() || outcome === undefined) return disposedAfter(errors);
        if (outcome.ok && outcome.value === false) return cancelCommit(token, issues, errors);
        if (outcome.ok && isChangeSet(outcome.value)) {
          base = store.getSnapshot().derived;
          current = revalidate(withReason(outcome.value, shown.reason), base, issues);
        } else if (!outcome.ok || (outcome.value !== true && outcome.value !== undefined)) {
          const error = outcome.ok
            ? invalidAnswer('beforeTaskChange', outcome.value, 'a boolean, a ChangeSet')
            : outcome.error;
          return cancelCommit(token, issues, errors, error);
        }
      }
      const now = store.getSnapshot().derived;
      if (
        now.model !== base.model ||
        now.hierarchy !== base.hierarchy ||
        now.graph !== base.graph
      ) {
        current = revalidate(current, now, issues);
      }
      const frozen = issues.length === 0 ? NO_ISSUES : Object.freeze(issues);
      if (current.changes.length === 0) {
        dispatch(errors, { type: 'setDraft', changeSet: undefined });
        release(token);
        finish('commit', frozen, errors);
        return Object.freeze({ status: 'unchanged', issues: frozen });
      }
      return applyTasks('commit', current, frozen, errors, token);
    } finally {
      release(token);
    }
  };

  /**
   * Cancels a commit: removes the preview, releases the lock, emits `issues` and, when a hook
   * failed with `error`, the error; returns the cancelled result.
   */
  const cancelCommit = (
    token: object,
    issues: readonly ChangeSetIssue[],
    errors: unknown[],
    ...failed: [error: unknown] | []
  ): CancelledResult => {
    dispatch(errors, { type: 'setDraft', changeSet: undefined });
    release(token);
    if (failed.length === 0) {
      finish('commit', issues, errors);
      return VETOED;
    }
    const [error] = failed;
    finish('commit', issues, errors, { error, name: 'beforeTaskChange' });
    const result: CancelledResult = { status: 'cancelled', reason: 'error', error };
    return Object.freeze(result);
  };

  const apply = (input: ChangeSet): CommitResult => {
    if (disposed) return DISPOSED;
    if (isBusy()) return BUSY;
    const issues: ChangeSetIssue[] = [];
    const current = revalidate(input, store.getSnapshot().derived, issues);
    const frozen = issues.length === 0 ? NO_ISSUES : Object.freeze(issues);
    if (current.changes.length > 0) return applyTasks('apply', current, frozen, []);
    finish('apply', frozen, []);
    return Object.freeze({ status: 'unchanged', issues: frozen });
  };

  /**
   * Adds a checked link (uncontrolled data: appended to `links`), releases the lock of `token`,
   * then tells the observers and emits `linkCreate` (the end of `createLink` and
   * `applyLinkCreate`).
   */
  const addLink = (
    name: OperationName,
    link: Link,
    id: string,
    token?: object,
  ): LinkCreatedResult => {
    const before = store.getSnapshot();
    const errors: unknown[] = [];
    if (before.settings.dataMode === 'uncontrolled') {
      dispatch(errors, { type: 'setLinks', links: [...(before.links ?? []), link] });
    }
    if (token !== undefined) release(token);
    const after = store.getSnapshot();
    const operation: LinkCreateOperation<TData> = { type: 'linkCreate', id, link, before, after };
    publish(name, operation, [['linkCreate', Object.freeze({ id, link })]], errors);
    return Object.freeze({ status: 'created', id, link });
  };

  /**
   * The id, the link to write and the cycle check of a new link, or why it is refused: the link
   * as the model normalizes it (`normalizeLink`), its ends, then duplicates: a link with the same
   * source, target and type (whatever its id), or an explicit `link.id` already in use. An
   * id-less link whose default id another link took gets a free one ({@link freeLinkId}), written
   * into a copy of it: the model would drop it otherwise.
   */
  const checkLink = (link: Link): LinkRejectedResult | CheckedLink => {
    const { model, graph } = store.getSnapshot().derived;
    const normalized = normalizeLink(link, model.options);
    if (!normalized.ok) {
      return Object.freeze({ status: 'rejected', reason: 'invalid', issues: normalized.issue });
    }
    const { id, source, target, type } = normalized.value;
    if (!model.taskById.has(source) || !model.taskById.has(target)) {
      return rejected('unknown-task');
    }
    const same = graph.links.some(
      (other) => other.source === source && other.target === target && other.type === type,
    );
    const taken = model.linkById.has(id);
    if (same || (taken && link.id !== undefined)) return rejected('duplicate');
    const free = taken ? freeLinkId(id, model.linkById) : id;
    return {
      id: free,
      link: taken ? Object.freeze({ ...link, id: free }) : link,
      wouldCreateCycle: wouldCreateCycle(graph, source, target),
    };
  };

  const createLink = async (link: Link): Promise<LinkCreateResult> => {
    if (disposed) return DISPOSED;
    if (isBusy()) return BUSY;
    const token = {};
    active = token;
    try {
      const before = store.getSnapshot();
      let check = checkLink(link);
      if ('status' in check) return check;
      const context = Object.freeze({
        link: check.link,
        id: check.id,
        wouldCreateCycle: check.wouldCreateCycle,
      });
      for (const hook of hooks.chain('beforeLinkCreate')) {
        const called = invoke(
          () => hook(context),
          () => undefined,
        );
        const outcome = called instanceof Promise ? await called : called;
        if (isDisposed() || outcome === undefined) return DISPOSED;
        if (outcome.ok && outcome.value === false) return VETOED;
        if (!outcome.ok || (outcome.value !== true && outcome.value !== undefined)) {
          const error = outcome.ok
            ? invalidAnswer('beforeLinkCreate', outcome.value, 'a boolean')
            : outcome.error;
          release(token);
          finish('createLink', NO_ISSUES, [], { error, name: 'beforeLinkCreate' });
          const result: CancelledResult = { status: 'cancelled', reason: 'error', error };
          return Object.freeze(result);
        }
      }
      if (store.getSnapshot() !== before) check = checkLink(link);
      if ('status' in check) return check;
      if (check.wouldCreateCycle) return rejected('cycle');
      return addLink('createLink', check.link, check.id, token);
    } finally {
      release(token);
    }
  };

  const applyLinkCreate = (link: Link): LinkCreateResult => {
    if (disposed) return DISPOSED;
    if (isBusy()) return BUSY;
    const check = checkLink(link);
    if ('status' in check) return check;
    if (check.wouldCreateCycle) return rejected('cycle');
    return addLink('applyLinkCreate', check.link, check.id);
  };

  const removeLink = (name: OperationName, id: string): LinkDeleteResult => {
    if (disposed) return DISPOSED;
    if (isBusy()) return BUSY;
    const before = store.getSnapshot();
    const record = before.derived.graph.linkById.get(id);
    if (record === undefined) return rejected('unknown-link');
    const errors: unknown[] = [];
    if (before.settings.dataMode === 'uncontrolled') {
      const command = withoutLink(before, record);
      if (command !== undefined) dispatch(errors, command);
    }
    const after = store.getSnapshot();
    const operation: LinkDeleteOperation<TData> = {
      type: 'linkDelete',
      id,
      link: record,
      before,
      after,
    };
    publish(name, operation, [['linkDelete', Object.freeze({ id, link: record })]], errors);
    return Object.freeze({ status: 'deleted', id, link: record });
  };

  const update = (command: DataCommand<TData>): void => {
    if (disposed) return;
    const before = store.getSnapshot();
    const errors: unknown[] = [];
    dispatch(errors, command);
    const after = store.getSnapshot();
    if (after === before) return;
    publish('update', { type: 'data', command, before, after }, NO_EVENTS, errors);
  };

  const observe = (observer: ControllerObserver<TData>): Unsubscribe => {
    if (disposed) return () => undefined;
    const entry = { observer };
    observers = [...observers, entry];
    return () => {
      observers = observers.filter((other) => other !== entry);
    };
  };

  const setHandlers = (next: CoreHandlers): void => {
    if (disposed) return;
    for (const [key, fn] of Object.entries(next) as [string, unknown][]) {
      if (!key.startsWith('on') || key.length < 3) continue;
      const slot = handlers.get(key);
      if (typeof fn !== 'function') {
        slot?.off();
        handlers.delete(key);
      } else if (slot !== undefined) {
        slot.box.fn = fn;
      } else {
        const box = { fn };
        // Always the current handler: swapping it never re-subscribes (no stale closures).
        const call = (payload: unknown): unknown =>
          (box.fn as (payload: unknown) => unknown)(payload);
        const hook = HOOK_HANDLERS.get(key);
        const off =
          hook === undefined
            ? emitter.on((key.charAt(2).toLowerCase() + key.slice(3)) as CoreEventName, call)
            : hooks.add(hook, call as HookMap[HookName]);
        handlers.set(key, { box, off });
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    abortWait?.();
    active = undefined;
    abortWait = undefined;
    for (const { off } of handlers.values()) off();
    handlers.clear();
    observers = [];
  };

  if (options.handlers !== undefined) setHandlers(options.handlers);

  return Object.freeze({
    preview: (changeSet: ChangeSet): boolean => {
      if (disposed || active !== undefined) return false;
      store.dispatch({ type: 'setDraft', changeSet });
      return true;
    },
    cancelPreview: (): boolean => {
      if (disposed || active !== undefined) return false;
      store.dispatch({ type: 'setDraft', changeSet: undefined });
      return true;
    },
    commit,
    createLink,
    deleteLink: (id: string): Promise<LinkDeleteResult> =>
      new Promise((resolve) => {
        resolve(removeLink('deleteLink', id));
      }),
    apply,
    applyLinkCreate,
    applyLinkDelete: (id: string): LinkDeleteResult => removeLink('applyLinkDelete', id),
    update,
    observe,
    report,
    setHandlers,
    hooks,
    get pending(): boolean {
      return active !== undefined;
    },
    dispose,
  });
}

function rejected(reason: LinkRejectReason): LinkRejectedResult {
  return Object.freeze({ status: 'rejected', reason });
}

/**
 * The first of `` `${id}#2` ``, `` `${id}#3` ``, … that no link of the model has: the id of an
 * id-less link whose default id is taken (FR-LINK-6). It is written into the link as its
 * explicit id, which the model then keeps (it drops a later link with an id already in use).
 */
function freeLinkId(id: string, links: ReadonlyMap<string, unknown>): string {
  let n = 2;
  while (links.has(`${id}#${n}`)) n++;
  return `${id}#${n}`;
}

function invalidAnswer(name: HookName, value: unknown, expected: string): TypeError {
  const got = value === null ? 'null' : typeof value;
  return new TypeError(`a ${name} hook answered ${got}, expected ${expected} or nothing`);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

function isChangeSet(value: unknown): value is ChangeSet {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { readonly changes?: unknown }).changes)
  );
}

/** A hook's replacement with `reason` when it has none (the reason of the one it replaces). */
function withReason(changeSet: ChangeSet, reason: ChangeSet['reason']): ChangeSet {
  const own = (changeSet as { readonly reason?: unknown }).reason;
  return own === undefined ? { ...changeSet, reason } : changeSet;
}

/**
 * The command that removes a link from uncontrolled data: from `links`, or from the
 * `dependencies` of its target task for a link of the shorthand.
 */
function withoutLink<TData>(
  state: StoreState<TData>,
  record: LinkRecord,
): StoreCommand<TData> | undefined {
  const own = record.model.link;
  if (own !== undefined) {
    return { type: 'setLinks', links: (state.links ?? []).filter((link) => link !== own) };
  }
  const { model } = state.derived;
  const target = model.taskById.get(record.target)?.task;
  const listed = target?.dependencies;
  if (target === undefined || listed === undefined) return undefined;
  const defaultType = model.options.defaultLinkType;
  const dependencies = listed.filter((entry) => {
    const source = typeof entry === 'object' ? entry.id : entry;
    const type = (typeof entry === 'object' ? entry.type : undefined) ?? defaultType;
    return source !== record.source || type !== record.type;
  });
  const patched: Task<TData> = { ...target, dependencies };
  return { type: 'setTasks', tasks: state.tasks.map((task) => (task === target ? patched : task)) };
}

/**
 * The edit session (FR-TX-4, FR-TX-6, `docs/architecture.md` §4), the model behind an edit mode
 * with Save / Cancel: changes accumulate from `begin()`, `getChanges()` is their aggregated diff,
 * `commit()` keeps them, `rollback()` returns to where the session began. Sits on top of the
 * change controller; the base lives in the store (`StoreState.session`).
 */

import {
  type EditSessionBase,
  selectSessionChanges,
  selectSessionDirty,
  selectSessionRollback,
  type SessionChanges,
  type Store,
  type StoreCommand,
  type StoreState,
} from '../store';
import type { BusyResult, CancelledResult, ChangeController } from './controller';
import { type Emitter, throwAll } from './emitter';
import type { ChangeHistory, HistoryCheckpoint } from './history';
import type { CoreEventName, CoreEvents } from './types';

/** What {@link createEditSession} works with. */
export interface EditSessionOptions<TData = unknown> {
  /** The store that holds the data and the session's base. */
  readonly store: Store<TData>;
  /** The controller whose operations change the data (its lock is respected). */
  readonly controller: ChangeController<TData>;
  /** Where `editRollback` and `dirtyChange` are emitted. */
  readonly emitter: Emitter<CoreEvents>;
  /** The history to put back on rollback, if any. */
  readonly history?: ChangeHistory | undefined;
}

/** A session was opened. */
export interface SessionBegunResult {
  /** Discriminant. */
  readonly status: 'begun';
}

/** A session is already open; it goes on with its base. */
export interface SessionAlreadyOpenResult {
  /** Discriminant. */
  readonly status: 'already-open';
}

/** No session is open: nothing to commit or roll back. */
export interface NoSessionResult {
  /** Discriminant. */
  readonly status: 'no-session';
}

/** The session was closed and its changes kept. */
export interface SessionCommittedResult {
  /** Discriminant. */
  readonly status: 'committed';
  /** Its aggregated changes (`reason: 'session'`), as `getChanges()` returned them last. */
  readonly changes: SessionChanges;
}

/** The session was closed and the data returned to its base. */
export interface SessionRolledBackResult {
  /** Discriminant. */
  readonly status: 'rolled-back';
  /** What was reverted (`reason: 'rollback'`), also emitted as `editRollback`. */
  readonly changes: SessionChanges;
}

/** Outcome of `EditSession.begin`. */
export type SessionBeginResult =
  SessionBegunResult | SessionAlreadyOpenResult | BusyResult | CancelledResult;

/** Outcome of `EditSession.commit`. */
export type SessionCommitResult =
  SessionCommittedResult | NoSessionResult | BusyResult | CancelledResult;

/** Outcome of `EditSession.rollback`. */
export type SessionRollbackResult =
  SessionRolledBackResult | NoSessionResult | BusyResult | CancelledResult;

/**
 * The edit session of a chart (`edit.*` of the facade), see {@link createEditSession}. At most
 * one session is open at a time. Its methods need no `this`.
 */
export interface EditSession {
  /** Opens a session on the current data. */
  readonly begin: () => SessionBeginResult;
  /** Closes the session and keeps the data; returns the aggregated changes. */
  readonly commit: () => SessionCommitResult;
  /** Closes the session and returns to its base; never vetoed by the before-hooks. */
  readonly rollback: () => SessionRollbackResult;
  /** The aggregated changes since `begin()` (`selectSessionChanges`); `undefined` when closed. */
  readonly getChanges: () => SessionChanges | undefined;
  /** Whether a session is open. */
  readonly isOpen: boolean;
  /** Whether a session is open and has changes (FR-TX-6). */
  readonly isDirty: boolean;
  /**
   * Stops tracking: no more events; `begin`, `commit` and `rollback` resolve cancelled. The store
   * is left as it is (an open session stays in it). Idempotent.
   */
  readonly dispose: () => void;
}

const BEGUN: SessionBegunResult = /* @__PURE__ */ Object.freeze({ status: 'begun' });
const ALREADY_OPEN: SessionAlreadyOpenResult = /* @__PURE__ */ Object.freeze({
  status: 'already-open',
});
const NO_SESSION: NoSessionResult = /* @__PURE__ */ Object.freeze({ status: 'no-session' });
const BUSY: BusyResult = /* @__PURE__ */ Object.freeze({ status: 'busy' });
const DISPOSED: CancelledResult = /* @__PURE__ */ Object.freeze({
  status: 'cancelled',
  reason: 'disposed',
});

/** A value computed from a snapshot, kept while the parts of the snapshot it reads are the same. */
interface Memo<T> {
  readonly key: readonly unknown[];
  readonly value: T;
}

/**
 * Creates the edit session of a chart (FR-TX-4, FR-TX-6): the "Edit mode: Save / Cancel" flow.
 *
 * - **`begin()`** stores the current data as the base (`beginSession`): the tasks and links as
 *   given and, for controlled data, a committed change the owner has not applied yet. A preview
 *   is not part of it. With a session already open it changes nothing and resolves
 *   `'already-open'` (sessions do not nest; the open one keeps its base). While an operation of
 *   the controller is pending (a hook is being awaited) it resolves `'busy'`: the change being
 *   confirmed would belong to neither side.
 * - **While open**, every action goes through the controller as usual and emits its own events
 *   (one `tasksChange` per action, FR-TX-1). Undo and redo work inside the session.
 *   `getChanges()` diffs the base against the current data: one change per task whose dates,
 *   progress or precision differ (changed back: not listed), and the links added and removed. A
 *   change of the precision (FR-SNAP-7) carries it on both sides, so a controlled rollback
 *   (`editRollback`) brings a task made timed back to day precision. Data the owner passes
 *   (`controller.update` with `setTasks`, `setLinks` or `setData`) does not touch the session:
 *   in controlled mode that is how changes arrive, and in both modes the new data is diffed
 *   against the same base (and is reverted by a rollback). Tasks the owner adds or removes are
 *   not part of the diff.
 * - **`commit()`** closes the session and returns the aggregate; the data and the history stay.
 * - **`rollback()`** closes the session and returns to the base, without asking the before-hooks
 *   (a cancel is never vetoed). Uncontrolled data gets the base arrays back, the very task and
 *   link objects. Controlled data stays the owner's: the store shows the base values as a
 *   committed draft until the owner's next `setTasks`, and **one `editRollback` event** (emitted
 *   in both modes) carries everything the owner has to revert, a committed change it has not
 *   applied yet included. The history, when given, is put back to its state at `begin()`, so no
 *   entry undoes into a rolled-back state (a session begun on the store directly has no saved
 *   state: the history is cleared). `'busy'` while a controller operation is pending: the pending
 *   change would land after the rollback.
 * - **Dirty state.** `isDirty` is `true` while a session is open and `getChanges()` would list
 *   something; `dirtyChange` is emitted only when it flips: after the operations of the
 *   controller (before their own events), `begin`, `commit` and `rollback`.
 *
 * Event order of a rollback: `historyChange`, `dirtyChange`, then `editRollback`. Errors of
 * listeners are collected and rethrown after all events, as by the controller. The events go
 * through `ChangeController.report`: for a step started by a listener of a controller operation,
 * after the events of that operation (whose outermost call then rethrows the listeners' errors).
 * The `dirtyChange` of an operation comes right before its own events, also when it is nested.
 *
 * @param options - The store, the controller, the emitter and the history.
 * @returns The session.
 *
 * @example
 * ```ts
 * const edit = createEditSession({ store, controller, emitter, history });
 * edit.begin();                        // "Edit"
 * await controller.commit(drop);       // the user drags
 * edit.isDirty;                        // true
 * const result = edit.commit();        // "Save": result.changes → the payload
 * // or edit.rollback();               // "Cancel": back to the data at begin()
 * ```
 */
export function createEditSession<TData = unknown>(
  options: EditSessionOptions<TData>,
): EditSession {
  const { store, controller, emitter, history } = options;
  let disposed = false;
  /**
   * The history when the open session began, with that session's token (the base itself is
   * rebuilt when options change, the token is kept).
   */
  let saved:
    | { readonly token: EditSessionBase['token']; readonly checkpoint: HistoryCheckpoint }
    | undefined;
  let dirtyMemo: Memo<boolean> | undefined;
  let changesMemo: Memo<SessionChanges | undefined> | undefined;

  const keyOf = (state: StoreState<TData>): readonly unknown[] => {
    const { session, derived, draft } = state;
    return [session, derived.model, derived.hierarchy, derived.graph, draft?.committedLayer];
  };

  const memo = <T>(
    last: Memo<T> | undefined,
    compute: (state: StoreState<TData>) => T,
  ): Memo<T> => {
    const state = store.getSnapshot();
    const key = keyOf(state);
    if (last?.key.every((part, i) => part === key[i])) return last;
    return { key, value: compute(state) };
  };

  const isDirty = (): boolean => {
    dirtyMemo = memo(dirtyMemo, selectSessionDirty);
    return dirtyMemo.value;
  };

  let dirty = isDirty();

  const send = <K extends CoreEventName>(
    errors: unknown[],
    name: K,
    payload: CoreEvents[K],
  ): void => {
    if (disposed) return;
    try {
      // In the controller's event order (an operation's dirtyChange before its own events).
      controller.report(() => {
        emitter.emit(name, payload);
      });
    } catch (error) {
      errors.push(error);
    }
  };

  /** Emits `dirtyChange` when the dirty state flipped since the last one. */
  const refresh = (errors: unknown[]): void => {
    const next = isDirty();
    if (next === dirty) return;
    dirty = next;
    send(errors, 'dirtyChange', Object.freeze({ isDirty: next }));
  };

  /** Dispatches to the store, collecting what its listeners threw (the change is made). */
  const dispatch = (errors: unknown[], command: StoreCommand<TData>): void => {
    try {
      store.dispatch(command);
    } catch (error) {
      errors.push(error);
    }
  };

  const rethrow = (errors: readonly unknown[], step: string): void => {
    if (errors.length === 0) return;
    throwAll(errors, `${errors.length} event listeners threw during the edit session's ${step}`);
  };

  const off = controller.observe(() => {
    const errors: unknown[] = [];
    refresh(errors);
    rethrow(errors, 'dirty check');
  });

  const begin = (): SessionBeginResult => {
    if (disposed) return DISPOSED;
    if (store.getSnapshot().session !== undefined) return ALREADY_OPEN;
    if (controller.pending) return BUSY;
    const errors: unknown[] = [];
    dispatch(errors, { type: 'beginSession' });
    const token = store.getSnapshot().session?.token;
    saved = token && history && { token, checkpoint: history.checkpoint() };
    refresh(errors);
    rethrow(errors, 'begin()');
    return BEGUN;
  };

  const getChanges = (): SessionChanges | undefined => {
    changesMemo = memo(changesMemo, selectSessionChanges);
    return changesMemo.value;
  };

  const commit = (): SessionCommitResult => {
    if (disposed) return DISPOSED;
    const changes = getChanges();
    if (changes === undefined) return NO_SESSION;
    if (controller.pending) return BUSY;
    const errors: unknown[] = [];
    dispatch(errors, { type: 'commitSession' });
    saved = undefined;
    refresh(errors);
    rethrow(errors, 'commit()');
    return Object.freeze({ status: 'committed', changes });
  };

  const rollback = (): SessionRollbackResult => {
    if (disposed) return DISPOSED;
    const state = store.getSnapshot();
    const base = state.session;
    const changes = selectSessionRollback(state);
    if (base === undefined || changes === undefined) return NO_SESSION;
    if (controller.pending) return BUSY;
    const errors: unknown[] = [];
    dispatch(errors, { type: 'rollbackSession' });
    const checkpoint = saved?.token === base.token ? saved.checkpoint : undefined;
    saved = undefined;
    try {
      if (checkpoint !== undefined) history?.restore(checkpoint);
      else history?.clear();
    } catch (error) {
      errors.push(error);
    }
    refresh(errors);
    send(errors, 'editRollback', changes);
    rethrow(errors, 'rollback()');
    return Object.freeze({ status: 'rolled-back', changes });
  };

  return Object.freeze({
    begin,
    commit,
    rollback,
    getChanges,
    get isOpen(): boolean {
      return store.getSnapshot().session !== undefined;
    },
    get isDirty(): boolean {
      return isDirty();
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      off();
    },
  });
}

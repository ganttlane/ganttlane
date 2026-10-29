/**
 * The change history (FR-TX-5, `docs/architecture.md` §10: Command, Memento as inverse changes):
 * one entry per action the change controller applied, stepped back and forward through the
 * controller without the before-hooks. A skeleton: off unless enabled; keyboard shortcuts and
 * the full feature come with plan step 7.4.
 */

import type { Link } from '../model';
import type { Change, ChangeSet, Conflict, LinkRecord, TaskPatch } from '../schedule';
import { selectCommittedPatch, type Store, type StoreState } from '../store';
import type {
  BusyResult,
  CancelledResult,
  ChangeController,
  CommitResult,
  ControllerOperation,
  LinkCreateResult,
  LinkDeleteResult,
} from './controller';
import type { Emitter } from './emitter';
import type { CoreEvents } from './types';

/** A committed change set, undone by applying its inverse. */
export interface TasksHistoryEntry {
  /** Discriminant. */
  readonly type: 'tasks';
  /**
   * The change set in its forward direction (`before` → `after`), as last applied: after an undo
   * and a redo it is the redo's change set, with the reason of the original action.
   */
  readonly changeSet: ChangeSet;
}

/** A created link, undone by deleting it. */
export interface LinkCreateHistoryEntry {
  /** Discriminant. */
  readonly type: 'linkCreate';
  /** Its id. */
  readonly id: string;
  /**
   * The link as written (with a free id when its default one was taken); a redo creates it
   * again.
   */
  readonly link: Link;
}

/** A deleted link, undone by creating it again. */
export interface LinkDeleteHistoryEntry {
  /** Discriminant. */
  readonly type: 'linkDelete';
  /** Its id. */
  readonly id: string;
  /** The link as it was in the graph. */
  readonly link: LinkRecord;
  /**
   * The link an undo creates again: the caller's `Link` (`link.model.link`) or, for a link of the
   * `Task.dependencies` shorthand, an equal one (for `links`) with the entry's type and its `lag`
   * as written, so that a lead or a sub-day lag comes back exactly.
   */
  readonly restore: Link;
}

/** One action in the history: what the controller applied (a commit, a link created or deleted). */
export type HistoryEntry = TasksHistoryEntry | LinkCreateHistoryEntry | LinkDeleteHistoryEntry;

/** The stacks of a history at one moment (`ChangeHistory.checkpoint`). Deeply frozen. */
export interface HistoryCheckpoint {
  /** Entries to undo, the oldest first (the next undo is the last). */
  readonly undo: readonly HistoryEntry[];
  /** Entries to redo, the farthest first (the next redo is the last). */
  readonly redo: readonly HistoryEntry[];
}

/**
 * Settings of a history (`ChangeHistory.configure`). A key left out keeps its value, a key set to
 * `undefined` returns to its default.
 */
export interface HistorySettings {
  /** Whether actions are recorded; default `false` (off unless enabled). Off clears the history. */
  readonly enabled?: boolean | undefined;
  /**
   * The most entries kept, undo and redo together; the oldest go first. Default `100`; a whole
   * number of at least `0` (`0` keeps nothing), `Infinity` for no limit; anything else is the
   * default.
   */
  readonly limit?: number | undefined;
}

/** What {@link createChangeHistory} works with. */
export interface ChangeHistoryOptions<TData = unknown> extends HistorySettings {
  /** The store whose data the history checks before each step. */
  readonly store: Store<TData>;
  /** The controller whose operations are recorded and through which steps are applied. */
  readonly controller: ChangeController<TData>;
  /** Where `historyChange` is emitted. */
  readonly emitter: Emitter<CoreEvents>;
}

/** An entry was undone or redone. */
export interface HistorySteppedResult {
  /** Discriminant. */
  readonly status: 'undone' | 'redone';
  /** The entry, as it is now on the other stack. */
  readonly entry: HistoryEntry;
}

/** Nothing to undo or redo. */
export interface HistoryEmptyResult {
  /** Discriminant. */
  readonly status: 'empty';
}

/**
 * The data no longer shows the entry's result (for a redo: its start), or it could not be
 * applied: the history was cleared.
 */
export interface HistoryStaleResult {
  /** Discriminant. */
  readonly status: 'stale';
  /** The entry that could not be applied. */
  readonly entry: HistoryEntry;
}

/** Outcome of `ChangeHistory.undo` and `redo`. */
export type HistoryResult =
  HistorySteppedResult | HistoryEmptyResult | HistoryStaleResult | BusyResult | CancelledResult;

/** The history of {@link createChangeHistory}. Its methods need no `this`. */
export interface ChangeHistory {
  /** Undoes the last entry, see {@link createChangeHistory}. */
  readonly undo: () => HistoryResult;
  /** Redoes the last undone entry, see {@link createChangeHistory}. */
  readonly redo: () => HistoryResult;
  /** Whether there is an entry to undo. */
  readonly canUndo: boolean;
  /** Whether there is an entry to redo. */
  readonly canRedo: boolean;
  /** Whether actions are recorded. */
  readonly enabled: boolean;
  /** The most entries kept. */
  readonly limit: number;
  /** Changes the settings; disabling or a smaller limit drops entries (oldest first). */
  readonly configure: (settings: HistorySettings) => void;
  /** Drops every entry. */
  readonly clear: () => void;
  /** The stacks as they are now, e.g. when an edit session begins. */
  readonly checkpoint: () => HistoryCheckpoint;
  /**
   * Puts back the stacks of a checkpoint (an edit session rolled back to where it began), within
   * the current limit; a disabled history stays empty.
   */
  readonly restore: (checkpoint: HistoryCheckpoint) => void;
  /** Stops recording and drops every entry; afterwards steps resolve cancelled. Idempotent. */
  readonly dispose: () => void;
}

/** A step being applied: set while the controller applies it, so that it is not recorded. */
interface Replay {
  readonly entry: HistoryEntry;
  readonly direction: 'undo' | 'redo';
  /** The entry as moved to the other stack, once the controller applied the step. */
  moved: HistoryEntry | undefined;
}

const DEFAULT_LIMIT = 100;
const EMPTY: HistoryEmptyResult = /* @__PURE__ */ Object.freeze({ status: 'empty' });
const BUSY: BusyResult = /* @__PURE__ */ Object.freeze({ status: 'busy' });
const DISPOSED: CancelledResult = /* @__PURE__ */ Object.freeze({
  status: 'cancelled',
  reason: 'disposed',
});
const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);

/**
 * Creates the change history of a controller (FR-TX-5): one entry per action the controller
 * applies (one drag, one API change, one link created or deleted), recorded through
 * `controller.observe` while enabled. Off by default: pass `enabled: true` or
 * `configure({ enabled: true })`.
 *
 * - **Steps.** `undo()` applies the inverse of the last entry, `redo()` the last undone entry,
 *   through the controller **without the before-hooks** (an undo restores a state the hooks
 *   already accepted, and a veto would leave the history out of step with the data): task
 *   changes with `controller.apply` (`reason: 'undo'` / `'redo'`, re-validated like any change
 *   set and emitted as one `tasksChange`), links with `applyLinkCreate` / `applyLinkDelete`
 *   (`linkCreate` / `linkDelete`). A new action clears the redo entries. Steps are synchronous.
 * - **Safety.** A step is applied only while the data still shows the entry's result (for a redo:
 *   its start): every task of the entry has its `after` values (`before` for a redo), a created
 *   link exists, a deleted one does not. Otherwise, or when the controller cannot apply it, the
 *   whole history is cleared and the step resolves `'stale'`. While an operation of the
 *   controller is pending, or controlled data shows a committed change its owner has not applied
 *   yet, steps resolve `'busy'`.
 * - **Data from outside.** Uncontrolled data replaced by the owner (`controller.update` with
 *   `setTasks`, `setLinks`, `setData` or options that change the model) clears the history: its
 *   entries describe data that is gone. For controlled data `setTasks` is how the owner applies
 *   changes, so the history is kept; the check before each step catches data the owner changed
 *   otherwise.
 * - **Edit sessions** take a `checkpoint()` when they begin and `restore()` it on rollback, so
 *   that no entry undoes into a rolled-back state (see `createEditSession`).
 * - **Events.** `historyChange` with `{ canUndo, canRedo }` whenever one of them flips, right
 *   after the change that flipped it (before the action's own events), in the controller's event
 *   order (`ChangeController.report`): for an action started by a listener of another one, after
 *   the events of that one.
 *
 * @param options - The store, the controller, the emitter and the settings.
 * @returns The history.
 *
 * @example
 * ```ts
 * const history = createChangeHistory({ store, controller, emitter, enabled: true, limit: 50 });
 * await controller.commit(drop); // one entry
 * history.undo();                // { status: 'undone', … }: one tasksChange with reason 'undo'
 * history.canRedo;               // true
 * ```
 */
export function createChangeHistory<TData = unknown>(
  options: ChangeHistoryOptions<TData>,
): ChangeHistory {
  const { store, controller, emitter } = options;
  let enabled = options.enabled === true;
  let limit = limitOf(options.limit);
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let shown = { canUndo: false, canRedo: false };
  let replay: Replay | undefined;
  let disposed = false;

  /** Emits `historyChange` when `canUndo` or `canRedo` flipped since the last one. */
  const changed = (): void => {
    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;
    if (disposed || (canUndo === shown.canUndo && canRedo === shown.canRedo)) return;
    shown = { canUndo, canRedo };
    const payload = Object.freeze({ canUndo, canRedo });
    // In the controller's event order: right before the events of the operation that flipped it.
    controller.report(() => {
      emitter.emit('historyChange', payload);
    });
  };

  const trim = (): void => {
    if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
    const room = limit - undoStack.length;
    if (redoStack.length > room) redoStack.splice(0, redoStack.length - room);
  };

  const clear = (): void => {
    undoStack = [];
    redoStack = [];
    changed();
  };

  const record = (operation: ControllerOperation<TData>): void => {
    if (operation.type === 'data') {
      const { before, after } = operation;
      const replaced = before.derived.model !== after.derived.model;
      if (replaced && after.settings.dataMode === 'uncontrolled') clear();
      return;
    }
    if (!enabled || limit === 0) return;
    undoStack.push(entryOf(operation));
    redoStack = [];
    trim();
    changed();
  };

  /** Moves a step's entry to the other stack, as the controller applied it. */
  const move = (step: Replay, operation: ControllerOperation<TData>): void => {
    const { entry, direction } = step;
    const moved =
      entry.type === 'tasks' && operation.type === 'tasks'
        ? forward(entry.changeSet, operation.changeSet, direction)
        : entry;
    step.moved = moved;
    if (direction === 'undo') {
      undoStack.pop();
      redoStack.push(moved);
    } else {
      redoStack.pop();
      undoStack.push(moved);
    }
    changed();
  };

  const off = controller.observe((operation) => {
    const step = replay;
    if (step === undefined) {
      record(operation);
      return;
    }
    // The first operation during a step is the step itself (it is reported before its events,
    // so operations that its listeners start are recorded as usual).
    replay = undefined;
    move(step, operation);
  });

  const run = (
    entry: HistoryEntry,
    direction: 'undo' | 'redo',
  ): CommitResult | LinkCreateResult | LinkDeleteResult => {
    switch (entry.type) {
      case 'tasks': {
        const { changes } = entry.changeSet;
        const steps = direction === 'undo' ? changes.map(invert) : changes;
        const changeSet: ChangeSet = { reason: direction, changes: steps, conflicts: NO_CONFLICTS };
        return controller.apply(Object.freeze(changeSet));
      }
      case 'linkCreate':
        return direction === 'undo'
          ? controller.applyLinkDelete(entry.id)
          : controller.applyLinkCreate(entry.link);
      case 'linkDelete':
        return direction === 'undo'
          ? controller.applyLinkCreate(entry.restore)
          : controller.applyLinkDelete(entry.id);
    }
  };

  const step = (direction: 'undo' | 'redo'): HistoryResult => {
    if (disposed) return DISPOSED;
    const entry = (direction === 'undo' ? undoStack : redoStack).at(-1);
    if (entry === undefined) return EMPTY;
    const state = store.getSnapshot();
    if (controller.pending || state.draft?.committed === true) return BUSY;
    if (!shows(state, entry, direction)) return stale(entry);
    const current: Replay = { entry, direction, moved: undefined };
    replay = current;
    let result: CommitResult | LinkCreateResult | LinkDeleteResult;
    try {
      result = run(entry, direction);
    } finally {
      if (replay === current) replay = undefined;
    }
    if (current.moved !== undefined) {
      const status = direction === 'undo' ? 'undone' : 'redone';
      return Object.freeze({ status, entry: current.moved });
    }
    if (result.status === 'busy' || result.status === 'cancelled') return result;
    return stale(entry);
  };

  const stale = (entry: HistoryEntry): HistoryStaleResult => {
    clear();
    return Object.freeze({ status: 'stale', entry });
  };

  const configure = (settings: HistorySettings): void => {
    if (disposed) return;
    if ('enabled' in settings) enabled = settings.enabled === true;
    if ('limit' in settings) limit = limitOf(settings.limit);
    if (enabled) trim();
    else {
      undoStack = [];
      redoStack = [];
    }
    changed();
  };

  return Object.freeze({
    undo: (): HistoryResult => step('undo'),
    redo: (): HistoryResult => step('redo'),
    get canUndo(): boolean {
      return undoStack.length > 0;
    },
    get canRedo(): boolean {
      return redoStack.length > 0;
    },
    get enabled(): boolean {
      return enabled;
    },
    get limit(): number {
      return limit;
    },
    configure,
    clear: (): void => {
      if (!disposed) clear();
    },
    checkpoint: (): HistoryCheckpoint =>
      Object.freeze({
        undo: Object.freeze([...undoStack]),
        redo: Object.freeze([...redoStack]),
      }),
    restore: (checkpoint: HistoryCheckpoint): void => {
      if (disposed || !enabled) return;
      undoStack = [...checkpoint.undo];
      redoStack = [...checkpoint.redo];
      trim();
      changed();
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      off();
      undoStack = [];
      redoStack = [];
    },
  });
}

/** The entry of a recorded operation. */
function entryOf(operation: Exclude<ControllerOperation, { type: 'data' }>): HistoryEntry {
  switch (operation.type) {
    case 'tasks':
      return Object.freeze({ type: 'tasks', changeSet: operation.changeSet });
    case 'linkCreate':
      return Object.freeze({ type: 'linkCreate', id: operation.id, link: operation.link });
    case 'linkDelete': {
      const { id, link, before } = operation;
      return Object.freeze({ type: 'linkDelete', id, link, restore: linkOf(link, before) });
    }
  }
}

/**
 * The forward change set of an entry after a step: an undo applied the inverse of what is
 * returned, a redo applied it. Keeps the reason of the original action.
 */
function forward(
  original: ChangeSet,
  applied: ChangeSet,
  direction: 'undo' | 'redo',
): TasksHistoryEntry {
  const changeSet: ChangeSet =
    direction === 'undo'
      ? {
          reason: original.reason,
          changes: applied.changes.map(invert),
          conflicts: original.conflicts,
        }
      : { ...applied, reason: original.reason };
  return Object.freeze({ type: 'tasks', changeSet: Object.freeze(changeSet) });
}

/** Whether the data shows the result of an entry (undo) or its start (redo). */
function shows(state: StoreState, entry: HistoryEntry, direction: 'undo' | 'redo'): boolean {
  const has = (id: string): boolean => state.derived.graph.linkById.has(id);
  switch (entry.type) {
    case 'tasks':
      return entry.changeSet.changes.every((change) => {
        const now = selectCommittedPatch(state, change.id);
        const expected = direction === 'undo' ? change.after : change.before;
        return now !== undefined && samePatch(now, expected);
      });
    case 'linkCreate':
      return has(entry.id) === (direction === 'undo');
    case 'linkDelete':
      return has(entry.id) === (direction === 'redo');
  }
}

/** The change in the other direction. */
function invert(change: Change): Change {
  const inverse = {
    id: change.id,
    before: change.after,
    after: change.before,
    cause: change.cause,
  };
  return Object.freeze(change.via === undefined ? inverse : { ...inverse, via: change.via });
}

/**
 * The link to create again for a deleted one: the caller's, or one equal to the
 * `Task.dependencies` entry it was read from (`LinkModel.path`) in `state`, the data the record
 * was built from, with the entry's `lag` as written. The model reads that input exactly as
 * before; no other form would do for every lag (a lead can only be written as a signed number of
 * days, which a computed number of days does not reproduce for every number of minutes).
 */
function linkOf(record: LinkRecord, state: StoreState): Link {
  const own = record.model.link;
  if (own !== undefined) return own;
  const { source, target, type, editable } = record;
  const index = /\.dependencies\[(\d+)\]$/.exec(record.model.path)?.[1];
  const entry = state.derived.model.taskById.get(target)?.task.dependencies?.[Number(index)];
  const lag = typeof entry === 'object' ? entry.lag : undefined;
  const link: Link = { source, target, type, editable };
  return Object.freeze(lag === undefined ? link : { ...link, lag });
}

function samePatch(a: TaskPatch, b: TaskPatch): boolean {
  return a.start === b.start && a.endExclusive === b.endExclusive && a.progress === b.progress;
}

/** A valid limit, else the default. */
function limitOf(value: number | undefined): number {
  if (value === Infinity) return value;
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : DEFAULT_LIMIT;
}

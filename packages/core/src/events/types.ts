/**
 * The core event map (FR-EVT-1, `docs/api.md` §5) in core's numeric form: task ids, floating
 * date-times (`DateTimeMs`), `ChangeSet`s and link records. The facade (plan step 3.8) maps them
 * to the public `Date`-based records and the `onX` options.
 */

import type { GestureKind, RefusalReason } from '../interaction';
import type { Link, TaskId } from '../model';
import type { ViewMode } from '../scale';
import type { ChangeSet, LinkRecord } from '../schedule';
import type { Issue } from '../shared';
import type { SessionChanges, StoreExpandedKeys } from '../store';
import type { DatePrecision, DateTimeMs } from '../time';
import type { RangeChangeReason } from '../viewport';
import type { EmitterEvents, ErrorPayload, Listener } from './emitter';
import type { BeforeLinkCreateHook, BeforeTaskChangeHook } from './hooks';

/**
 * A task's new dates (`taskDatesChange`, the convenience form of `tasksChange`): one per change of
 * a committed change set whose `start` or `endExclusive` changed.
 */
export interface TaskDatesChangePayload {
  /** The task. */
  readonly id: TaskId;
  /** Its new start. */
  readonly start: DateTimeMs;
  /** Its new exclusive end. */
  readonly endExclusive: DateTimeMs;
  /**
   * The task's precision after the change, present only when the change sets it
   * (`after.precision`, FR-SNAP-7: a day task turned into a timed one, or back by an undo). The
   * dates are in that precision; a listener that reads the end in the semantics of the input
   * (FR-TIME-8) uses it rather than the precision of the model, which in controlled mode is the
   * owner's until it applies the change.
   */
  readonly precision?: DatePrecision | undefined;
}

/**
 * A task's new progress (`taskProgressChange`, the convenience form of `tasksChange`): one per
 * change of a committed change set whose `progress` changed.
 */
export interface TaskProgressChangePayload {
  /** The task. */
  readonly id: TaskId;
  /** Its new progress in percent. */
  readonly progress: number;
}

/** A link was created (`linkCreate`, FR-LINK-6). */
export interface LinkCreatePayload {
  /**
   * Its id: `link.id`, or `` `${source}:${type}:${target}` `` with the default type, or, when
   * another link already has that id, the first free `` `${defaultId}#2` ``, `#3`, ….
   */
  readonly id: string;
  /**
   * The link as written: as given, or a copy with the free id as its explicit `id`. In
   * controlled mode the owner appends this object to its `links`.
   */
  readonly link: Link;
}

/** A link was deleted (`linkDelete`, FR-LINK-5). */
export interface LinkDeletePayload {
  /** Its id. */
  readonly id: string;
  /** The deleted link as it was in the graph (`record.model.link` is the caller's `Link`). */
  readonly link: LinkRecord;
}

/** A pointer event on a task bar, emitted by renderers (`taskClick`, `taskDoubleClick`). */
export interface TaskPointerPayload {
  /** The task. */
  readonly id: TaskId;
  /** The renderer's input event (a DOM `PointerEvent`, a React event, …). */
  readonly event: unknown;
}

/** The hovered task changed (`taskHoverChange`), emitted by renderers. */
export interface TaskHoverPayload {
  /** The task under the pointer, `undefined` when the pointer left the bars. */
  readonly id: TaskId | undefined;
  /** The renderer's input event. */
  readonly event: unknown;
}

/** A pointer event on a link, emitted by renderers (`linkClick`). */
export interface LinkPointerPayload {
  /** The link. */
  readonly id: string;
  /** The renderer's input event. */
  readonly event: unknown;
}

/** The selected tasks or the selected link changed (`selectionChange`, FR-SEL-1, FR-SEL-2). */
export interface SelectionChangePayload {
  /** The selected tasks. */
  readonly selectedKeys: readonly TaskId[];
  /** The selected link (FR-SEL-1), `undefined` for none. */
  readonly selectedLink: string | undefined;
}

/** The view mode changed (`viewModeChange`, FR-SCALE-3). */
export interface ViewModeChangePayload {
  /** The view mode now in use. */
  readonly viewMode: ViewMode;
}

/** The timeline range changed (`rangeChange`, FR-TL-7), e.g. for lazy loading. */
export interface RangeChangePayload {
  /** The new start of the range. */
  readonly start: DateTimeMs;
  /** The new end of the range. */
  readonly end: DateTimeMs;
  /** Why it changed (see `RangeChangeReason`). */
  readonly reason: RangeChangeReason;
}

/**
 * A gesture of the interaction layer was refused (`editRefused`, FR-EDIT-7, FR-LINK-6): when the
 * drag was about to start or to be committed, `context.busy`, the permissions, a gone task or an
 * invalid link target forbade it. Nothing was changed.
 */
export interface EditRefusedPayload {
  /** The gesture. */
  readonly gesture: GestureKind;
  /** The dragged task, or the link source. */
  readonly id: TaskId;
  /** For links: the target, when there was one. */
  readonly target: TaskId | undefined;
  /** Why. */
  readonly reason: RefusalReason;
  /** When: the drag was about to start, or to be committed. */
  readonly at: 'start' | 'commit';
}

/** The expanded parents changed (`expandedChange`, FR-ROW-2). */
export interface ExpandedChangePayload {
  /** The expanded parents. */
  readonly expandedKeys: StoreExpandedKeys;
}

/** The timeline scrolled (`scroll`, FR-SCROLL-5). */
export interface ScrollPayload {
  /** Horizontal scroll offset in px. */
  readonly x: number;
  /** Vertical scroll offset in px. */
  readonly y: number;
  /** The date at the left edge of the viewport. */
  readonly date: DateTimeMs;
}

/** The edit session became dirty or clean (`dirtyChange`, FR-TX-6). */
export interface DirtyChangePayload {
  /** Whether a session is open and has changes (`EditSession.isDirty`). */
  readonly isDirty: boolean;
}

/** What the history can do changed (`historyChange`, FR-TX-5). */
export interface HistoryChangePayload {
  /** Whether `undo()` has an entry to undo. */
  readonly canUndo: boolean;
  /** Whether `redo()` has an entry to redo. */
  readonly canRedo: boolean;
}

/**
 * Where reported issues come from (`issues`): the data (`'data'`: model, hierarchy, link graph),
 * the options (`'options'`) or a change set being committed (`'change-set'`, its re-validation).
 */
export type IssueSource = 'data' | 'options' | 'change-set';

/** Problems found (`issues`, FR-DATA-4, FR-SNAP-13). */
export interface IssuesPayload {
  /** What was checked. */
  readonly source: IssueSource;
  /** The issues, in the order they were found. */
  readonly issues: readonly Issue[];
}

/**
 * The events of core (FR-EVT-1, `docs/api.md` §5) by name, with their payloads. The change
 * controller emits `tasksChange`, `taskDatesChange`, `taskProgressChange`, `linkCreate`,
 * `linkDelete`, `issues` (of change sets) and `error`; the edit session `editRollback` and
 * `dirtyChange`; the history `historyChange`; the others the facade (`createGanttCore`), the
 * pointer-level ones (`taskClick`, `linkClick`, `taskHoverChange`, `editRefused`, …) from the
 * interaction events a renderer sends it.
 */
export interface CoreEvents extends EmitterEvents {
  /**
   * A change set was committed (FR-TX-1): exactly one per user action or API change, with every
   * task it changed, directly or through propagation; also one per undo or redo of a task change
   * (`reason: 'undo'` / `'redo'`).
   */
  readonly tasksChange: ChangeSet;
  /**
   * An edit session was rolled back (FR-TX-4): the one event of a rollback, in both data modes,
   * with everything it reverts (`reason: 'rollback'`, see `selectSessionRollback`). Controlled
   * data applies it like any change: tasks get `after`, `links.added` are added back,
   * `links.removed` are removed. No `tasksChange`, `linkCreate` or `linkDelete` is emitted for a
   * rollback.
   */
  readonly editRollback: SessionChanges;
  /**
   * `EditSession.isDirty` flipped (FR-TX-6). Emitted right after the data changed, so before the
   * action's own events (`tasksChange`, …); for an action started by a listener of another one,
   * after that one's events, like the action's own events (the controller's outbox).
   */
  readonly dirtyChange: DirtyChangePayload;
  /**
   * `canUndo` or `canRedo` of the history changed (FR-TX-5). Like `dirtyChange`, emitted before
   * the action's own events, in the same order for a nested action.
   */
  readonly historyChange: HistoryChangePayload;
  /** Convenience: a task's dates changed, one per change after `tasksChange`. */
  readonly taskDatesChange: TaskDatesChangePayload;
  /** Convenience: a task's progress changed, one per change after `tasksChange`. */
  readonly taskProgressChange: TaskProgressChangePayload;
  /** A link was created (FR-LINK-6). */
  readonly linkCreate: LinkCreatePayload;
  /** A link was deleted (FR-LINK-5). */
  readonly linkDelete: LinkDeletePayload;
  /** A link was clicked (FR-SEL-1). */
  readonly linkClick: LinkPointerPayload;
  /** A task bar was clicked. */
  readonly taskClick: TaskPointerPayload;
  /** A task bar was double-clicked. */
  readonly taskDoubleClick: TaskPointerPayload;
  /** The hovered task changed. */
  readonly taskHoverChange: TaskHoverPayload;
  /** The selected tasks changed. */
  readonly selectionChange: SelectionChangePayload;
  /** The view mode changed. */
  readonly viewModeChange: ViewModeChangePayload;
  /** The timeline range changed. */
  readonly rangeChange: RangeChangePayload;
  /** The expanded parents changed. */
  readonly expandedChange: ExpandedChangePayload;
  /** The timeline scrolled. */
  readonly scroll: ScrollPayload;
  /** A gesture was refused (FR-EDIT-7). */
  readonly editRefused: EditRefusedPayload;
  /** Problems were found in data, options or a change set. */
  readonly issues: IssuesPayload;
  /** A listener or a hook threw (FR-EVT-1). */
  readonly error: ErrorPayload;
}

/** Name of a core event. */
export type CoreEventName = keyof CoreEvents;

/**
 * Option-style event handlers (FR-EVT-2): `onTasksChange` for `tasksChange`, and so on. Swapped
 * with `ChangeController.setHandlers`; `undefined` removes one.
 */
export type CoreEventHandlers = {
  readonly [K in CoreEventName as `on${Capitalize<K>}`]?: Listener<CoreEvents[K]> | undefined;
};

/** Option-style before-hooks (FR-TX-2, FR-LINK-6); `undefined` removes one. */
export interface CoreHookHandlers {
  /** Runs in the `beforeTaskChange` chain. */
  readonly onBeforeTaskChange?: BeforeTaskChangeHook | undefined;
  /** Runs in the `beforeLinkCreate` chain. */
  readonly onBeforeLinkCreate?: BeforeLinkCreateHook | undefined;
}

/** Every option-style handler of core: events and before-hooks. */
export type CoreHandlers = CoreEventHandlers & CoreHookHandlers;

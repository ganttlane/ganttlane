/**
 * Types of the state store (`docs/architecture.md` §3, §4, §10): its options, the immutable
 * state snapshot, the commands and the store itself.
 */

import type { WorkCalendarOptions, WorkCalendarResult } from '../calendar';
import type { Hierarchy, HierarchyOptions, Row } from '../hierarchy';
import type {
  AlignInput,
  DurationMode,
  Link,
  LinkModel,
  LinkType,
  NormalizedModel,
  NormalizeModelOptions,
  Task,
  TaskId,
} from '../model';
import type {
  ResolvedSnapResult,
  ResolvedViewModes,
  ResolveSnapInput,
  SnapInput,
  ViewMode,
  ViewModesInput,
} from '../scale';
import type {
  ChangeSet,
  Conflict,
  LinkGraph,
  MoveChildren,
  PropagationOptions,
  PropagationPolicy,
  SkipNonWorkingDays,
  TaskPatch,
} from '../schedule';
import type { Issue } from '../shared';
import type { DurationInput, Granularity } from '../time';

/**
 * Who owns the task data (FR-TX-3, FR-REACT-1):
 * - `'uncontrolled'` (default): the store applies committed change sets to its own `tasks`;
 * - `'controlled'`: the owner applies them and passes the new `tasks` back (`setTasks`); until
 *   then the committed change set stays visible as the draft (see {@link ApplyChangeSetCommand}).
 */
export type DataMode = 'controlled' | 'uncontrolled';

/** `GanttOptions.dates` as far as the store uses it. */
export interface StoreDatesOptions {
  /** Whether a date-only `end` is the inclusive last day; default `true`. */
  readonly endInclusive?: boolean | undefined;
}

/** `GanttOptions.scheduling` (`docs/api.md` §3) as far as the store uses it. */
export interface StoreSchedulingOptions {
  /** Default `Task.durationMode`; default `'calendar'`. */
  readonly durationMode?: DurationMode | undefined;
  /**
   * How edits spread along links; default `'preserve-lag'`. `'push-forward'` is planned
   * (`docs/api.md` §3, FR-SCH-1) and resolved like the facade's fallback for it: the default,
   * `'preserve-lag'` (`settings.propagation.propagation` is `undefined`). The store reports
   * nothing; the facade reports it as `'unsupported-option'`.
   */
  readonly propagation?: PropagationPolicy | 'push-forward' | undefined;
  /** Default `Link.type`; default `'FS'`. */
  readonly defaultLinkType?: LinkType | undefined;
  /** The data step; default `'1d'`. */
  readonly granularity?: DurationInput | undefined;
  /** Policy for misaligned input; default `'expand'`. */
  readonly alignInput?: AlignInput | undefined;
  /** Snap settings over the view mode's snap. */
  readonly snap?: SnapInput | undefined;
  /** Whether day-precision tasks snap to whole days at least; default `true`. */
  readonly keepDayPrecision?: boolean | undefined;
  /** Whether edited edges skip non-working days; default `{ move: true, resize: false }`. */
  readonly skipNonWorkingDays?: SkipNonWorkingDays | undefined;
}

/** `GanttOptions.hierarchy` as far as the store uses it (the expanded state is UI state). */
export interface StoreHierarchyOptions {
  /** Default `Task.parentAnchor`; default `'SS'`. */
  readonly childAnchor?: HierarchyOptions['childAnchor'];
  /** Which children move with their parent; default `'all'`. */
  readonly moveChildren?: MoveChildren | undefined;
}

/**
 * The options the store resolves: the data part of `GanttOptions` (`docs/api.md` §3), by domain
 * group. `setOptions` merges a partial object field by field within each group (`calendar`,
 * `dates`, `scheduling`, `hierarchy`); `dataMode` and `viewModes` are replaced whole. A field set
 * to `undefined` returns to its default.
 */
export interface StoreOptions {
  /** Who owns the task data; default `'uncontrolled'`. */
  readonly dataMode?: DataMode | undefined;
  /** The work calendar. */
  readonly calendar?: WorkCalendarOptions | undefined;
  /** Date semantics. */
  readonly dates?: StoreDatesOptions | undefined;
  /** Scheduling. */
  readonly scheduling?: StoreSchedulingOptions | undefined;
  /** The task tree. */
  readonly hierarchy?: StoreHierarchyOptions | undefined;
  /** View mode overrides or a custom list (`resolveViewModes`). */
  readonly viewModes?: ViewModesInput | undefined;
}

/** The expanded parents in the store: `'all'` or the ids of the expanded parents (FR-ROW-2). */
export type StoreExpandedKeys = 'all' | readonly TaskId[];

/**
 * {@link StoreOptions} resolved into what the core modules take. Each object is reused while its
 * fields are unchanged, so later stages can compare it by reference. Deeply frozen.
 */
export interface StoreSettings {
  /** Who owns the task data. */
  readonly dataMode: DataMode;
  /** The work calendar and the problems found in `calendar`. */
  readonly calendar: WorkCalendarResult;
  /** The options of `normalizeModel`. */
  readonly model: NormalizeModelOptions;
  /** The options of `buildHierarchy`. */
  readonly hierarchy: HierarchyOptions;
  /**
   * The options of `propagate` (plan step 3.7): `scheduling.propagation`, `.skipNonWorkingDays`,
   * `.keepDayPrecision` and `hierarchy.moveChildren`, so that a programmatic change converts a
   * day task like a drag does (FR-SNAP-7).
   */
  readonly propagation: PropagationOptions;
  /** The parsed `scheduling.granularity` (the default `'1d'` when invalid; the model reports it). */
  readonly granularity: Granularity;
  /** `resolveSnap` input besides the view mode. */
  readonly snap: Omit<ResolveSnapInput, 'viewMode'>;
  /** The view modes. */
  readonly viewModes: ResolvedViewModes;
}

/**
 * Issue codes of the store:
 * - `'unknown-view-mode'` (warning, `path: 'viewMode'`, the option of the id): the view mode id is
 *   not among the resolved view modes; the `'day'` mode (else the first one) is used.
 */
export type StoreIssueCode = 'unknown-view-mode';

/** An {@link Issue} raised by the store. */
export type StoreIssue = Issue<StoreIssueCode>;

/**
 * What the store derives from its inputs (`docs/architecture.md` §4), each stage recomputed only
 * when one of its inputs changed, as {@link StoreState} documents.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface StoreDerived<TData = unknown> {
  /** The normalized tasks and links (`normalizeModel`) of the committed data. */
  readonly model: NormalizedModel<TData>;
  /** The task tree (`buildHierarchy`). */
  readonly hierarchy: Hierarchy;
  /** The link graph (`buildLinkGraph`). */
  readonly graph: LinkGraph;
  /**
   * Every conflict of the committed data (`detectConflicts` of the whole model), by the task it
   * is shown on, in model order; tasks without conflicts are absent.
   */
  readonly conflicts: ReadonlyMap<TaskId, readonly Conflict[]>;
  /** The visible rows for the expanded state (`visibleRows`). */
  readonly rows: readonly Row[];
  /** The active view mode. */
  readonly viewMode: ViewMode;
  /** Snap settings of the active view mode (`resolveSnap`). */
  readonly snap: ResolvedSnapResult;
  /** Problems of the UI state, e.g. an unknown view mode id. */
  readonly issues: readonly StoreIssue[];
}

/** One layer of the draft: a change set and its values by task. Deeply frozen. */
export interface DraftLayer {
  /** The change set. */
  readonly changeSet: ChangeSet;
  /** `after` of each change by task id (of two changes of a task the later wins). */
  readonly patches: ReadonlyMap<TaskId, TaskPatch>;
}

/**
 * What is shown over the committed data, in two layers (FR-EDIT-5, FR-TX-3). Renderers read a
 * task's values with `selectTaskPatch`.
 *
 * - The **committed layer** (controlled data only): change sets committed with `applyChangeSet`
 *   (and the rollback of a session) that the owner has not applied yet. They are part of the data
 *   until the owner's next `setTasks`, which alone clears the layer (`setLinks`, `setOptions`,
 *   previews and further commits keep it), so edit sessions and the history count it
 *   (`selectCommittedPatch`).
 * - The **preview layer** on top: the change set of `setDraft`, e.g. a drag preview; replaced or
 *   removed by the next `setDraft`, removed by `applyChangeSet` and `setTasks`.
 *
 * `changeSet` and `patches` are the combined overlay that is drawn; with one layer they are that
 * layer's own. Deeply frozen.
 */
export interface Draft extends DraftLayer {
  /** The preview's change set when there is one, else the committed layer's. */
  readonly changeSet: ChangeSet;
  /** The committed layer's patches with the preview's over them (where both change a task). */
  readonly patches: ReadonlyMap<TaskId, TaskPatch>;
  /**
   * `true` exactly when there is a committed layer: a committed change the owner of controlled
   * data has not applied yet, also under a preview. `false` for a preview alone.
   */
  readonly committed: boolean;
  /** The committed layer; `undefined` without one. */
  readonly committedLayer: DraftLayer | undefined;
  /** The preview layer; `undefined` without one. */
  readonly previewLayer: DraftLayer | undefined;
}

/**
 * Where an edit session started (FR-TX-4): the committed data to diff against and to roll back
 * to, with what is derived from it. Deeply frozen.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface EditSessionBase<TData = unknown> {
  /**
   * Identifies the session: new with every `beginSession`, kept when the base is rebuilt for new
   * options, so that the session is recognized after a rebuild.
   */
  readonly token: object;
  /** The tasks when the session began, as given. */
  readonly tasks: readonly Task<TData>[];
  /** The links when the session began, as given. */
  readonly links: readonly Link[] | undefined;
  /**
   * Controlled data: the patches of the committed layer of the draft (what the owner had not
   * applied when the session began; it belongs to the base); `undefined` when there was none.
   */
  readonly pending: ReadonlyMap<TaskId, TaskPatch> | undefined;
  /**
   * `tasks` and `links` normalized with the current options: the model when the session began,
   * rebuilt when an option that affects normalization changes, so that only data changes are
   * diffed.
   */
  readonly model: NormalizedModel<TData>;
  /** The task tree of {@link EditSessionBase.model}. */
  readonly hierarchy: Hierarchy;
  /** The link graph of {@link EditSessionBase.model}. */
  readonly graph: LinkGraph;
}

/** Links added and removed by an edit session (FR-TX-4), compared by id. */
export interface SessionLinkChanges {
  /**
   * Links now present that were not at the start, in model order: new ids, and ids whose source,
   * target, type or lag changed (also listed in `removed` with their old values).
   */
  readonly added: readonly LinkModel[];
  /** Links present at the start that are gone or changed, in the base model order. */
  readonly removed: readonly LinkModel[];
}

/**
 * The aggregated diff of an edit session (FR-TX-4): a `ChangeSet` with one change per task whose
 * scheduled values differ between the start of the session and now, plus the links added and
 * removed. Deeply frozen.
 *
 * - `changes`: tasks with a bar at both ends, in model order; `before` is the value at the start,
 *   `after` the value now, `cause` is always `'direct'`. A task whose precision differs is listed
 *   too, also with the same dates, with `precision` on both sides (`TaskPatch.precision`,
 *   FR-SNAP-7), so that the inverse restores it; otherwise `precision` is left out. A task changed
 *   and changed back is not listed. Tasks the owner added or removed with `setTasks` are not
 *   compared.
 * - `conflicts`: of the state `after` describes, involving a changed task or the ends of a changed
 *   link.
 * - `reason`: `'session'` for {@link selectSessionChanges}, `'rollback'` for its inverse (what a
 *   rollback reverts: `before` is now, `after` the start; `links.added` are the links to restore,
 *   `links.removed` the links to drop).
 *
 * Controlled data counts a committed change the owner has not applied yet (the committed layer of
 * the draft) as part of the data, at the start and now; a preview never counts.
 */
export interface SessionChanges extends ChangeSet {
  /** `'session'` (the diff from the start) or `'rollback'` (its inverse). */
  readonly reason: 'session' | 'rollback';
  /** Links added and removed. */
  readonly links: SessionLinkChanges;
}

/** Ids added, removed and updated by a data change. */
export interface IdDiff<Id> {
  /** Ids that are new, in model order. */
  readonly added: readonly Id[];
  /** Ids that are gone, in the previous model order. */
  readonly removed: readonly Id[];
  /** Ids kept with another input object or other normalized values, in model order. */
  readonly updated: readonly Id[];
}

/**
 * What the last recomputation of the model changed (FR-DATA-7), so that renderers redraw only
 * that: task ids (`updated`: the same id with another input object, or, after an option change,
 * another kind, validity, precision, duration mode, progress, span — `end` and lengths included —
 * or other issues) and link ids. `version` grows by one with every
 * new model (`0` for the first, which adds every task): a renderer that saw `version - 1` can
 * apply this diff, any other one redraws everything.
 */
export interface DataChange extends IdDiff<TaskId> {
  /** Number of the model this diff leads to. */
  readonly version: number;
  /** Link ids (`updated`: another input object, source, target, type, lag or `editable`). */
  readonly links: IdDiff<string>;
}

/**
 * One immutable snapshot of the store (`useSyncExternalStore`-compatible: a new object only when
 * something changed; untouched parts keep their identity). Frozen throughout, except what the
 * caller passed in (tasks, links, option values), which is referenced as given and never mutated.
 *
 * Derived data is recomputed through a memoized pipeline, only where an input changed:
 *
 * | Input change | Recomputed |
 * | --- | --- |
 * | `tasks`, `links` | model → graph → conflicts; hierarchy → rows only when the tree changed (task ids and their order, `parentId`, `parentAnchor`, `followParent`) |
 * | `calendar` (→ work calendar), `dates.endInclusive`, `scheduling.granularity`, `.alignInput`, `.durationMode`, `.defaultLinkType` | as for `tasks`; `granularity` also snap |
 * | `hierarchy.childAnchor` | hierarchy → conflicts, rows |
 * | `expandedKeys` | rows |
 * | `viewModes` (→ resolved view modes), `viewModeId` | view mode → snap |
 * | `scheduling.snap` | snap |
 * | `scheduling.keepDayPrecision` | snap; settings (`propagation`) |
 * | `scheduling.propagation`, `.skipNonWorkingDays`, `hierarchy.moveChildren`, `dataMode` | settings only |
 * | `draft` (either layer) | nothing: the draft is overlaid when read (`selectTaskPatch`) |
 * | `session` | nothing; an open session's base model, tree and graph are rebuilt when an option it was normalized with changes (as for `tasks`, or `hierarchy.childAnchor`) |
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface StoreState<TData = unknown> {
  /** The committed tasks as given (uncontrolled: as patched by the store). */
  readonly tasks: readonly Task<TData>[];
  /** The committed links as given. */
  readonly links: readonly Link[] | undefined;
  /** The options as merged by `setOptions`. */
  readonly options: StoreOptions;
  /** The resolved options. */
  readonly settings: StoreSettings;
  /** The requested view mode id (`derived.viewMode` is the one in use). */
  readonly viewModeId: string;
  /** The expanded parents. */
  readonly expandedKeys: StoreExpandedKeys;
  /**
   * What is shown over the committed data, if anything: the committed layer (controlled changes
   * the owner has not applied yet) and the preview layer, combined (see {@link Draft}).
   * `draft?.committed === true` exactly while a committed change waits for the owner.
   */
  readonly draft: Draft | undefined;
  /** The base of the open edit session, if any (`beginSession`). */
  readonly session: EditSessionBase<TData> | undefined;
  /** Derived data. */
  readonly derived: StoreDerived<TData>;
  /** What the last new model changed. */
  readonly lastDataChange: DataChange;
}

/** Initial values of a store. */
export interface StoreInit<TData = unknown> {
  /** The tasks. */
  readonly tasks: readonly Task<TData>[];
  /** The links. */
  readonly links?: readonly Link[] | undefined;
  /** The options. */
  readonly options?: StoreOptions | undefined;
  /** The view mode id; default `'day'`. */
  readonly viewMode?: string | undefined;
  /** The expanded parents (`hierarchy.expandedKeys`); default `'all'`. */
  readonly expandedKeys?: StoreExpandedKeys | undefined;
}

/**
 * Replaces the tasks (FR-DATA-7). Always clears the draft, both layers, also with the same array:
 * for controlled data this is the owner's answer to the committed changes (applied or rejected).
 * An open edit session keeps its base: the new tasks are diffed against it.
 */
export interface SetTasksCommand<TData = unknown> {
  /** Discriminant. */
  readonly type: 'setTasks';
  /** The new tasks. */
  readonly tasks: readonly Task<TData>[];
}

/** Replaces the links (FR-DATA-7). The draft stays as it is. */
export interface SetLinksCommand {
  /** Discriminant. */
  readonly type: 'setLinks';
  /** The new links. */
  readonly links: readonly Link[] | undefined;
}

/** Merges options (see {@link StoreOptions}). */
export interface SetOptionsCommand {
  /** Discriminant. */
  readonly type: 'setOptions';
  /** The options to change. */
  readonly options: StoreOptions;
}

/**
 * The data owner's tasks, links and options in one step (FR-DATA-7, FR-API-2): what
 * `setOptions`, `setTasks` and `setLinks` do one after another, derived once, so the model is
 * normalized once and `lastDataChange.version` grows by one (`createGanttCore.setOptions` with
 * data and data options together). `options` is merged like `setOptions`; `tasks` replaces the
 * tasks and clears the draft like `setTasks`; `links` replaces the links when the key is present
 * (`links: undefined` removes them). Keys left out keep their value; with none the state stays.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface SetDataCommand<TData = unknown> {
  /** Discriminant. */
  readonly type: 'setData';
  /** The new tasks; left out (or `undefined`): the tasks stay. */
  readonly tasks?: readonly Task<TData>[] | undefined;
  /** The new links when the key is present, `undefined` for none; left out: the links stay. */
  readonly links?: readonly Link[] | undefined;
  /** The options to change; left out (or `undefined`): the options stay. */
  readonly options?: StoreOptions | undefined;
}

/** Switches the view mode (FR-SCALE-3). */
export interface SetViewModeCommand {
  /** Discriminant. */
  readonly type: 'setViewMode';
  /** The view mode id. */
  readonly id: string;
}

/** Replaces the expanded state (controlled `expandedKeys`, FR-ROW-2). */
export interface SetExpandedKeysCommand {
  /** Discriminant. */
  readonly type: 'setExpandedKeys';
  /** The expanded parents. */
  readonly keys: StoreExpandedKeys;
}

/** Expands or collapses one task (FR-ROW-2, `expand(id)` / `collapse(id)`). */
export interface SetExpandedCommand {
  /** Discriminant. */
  readonly type: 'setExpanded';
  /** The task. */
  readonly id: TaskId;
  /** Its new state. */
  readonly expanded: boolean;
}

/** Flips one task's expanded state (FR-ROW-2, the row toggle). */
export interface ToggleExpandedCommand {
  /** Discriminant. */
  readonly type: 'toggleExpanded';
  /** The task. */
  readonly id: TaskId;
}

/** Expands every current parent (FR-ROW-2, `expandAll()`); later parents start collapsed. */
export interface ExpandAllCommand {
  /** Discriminant. */
  readonly type: 'expandAll';
}

/** Collapses every parent (FR-ROW-2, `collapseAll()`). */
export interface CollapseAllCommand {
  /** Discriminant. */
  readonly type: 'collapseAll';
}

/**
 * Commits a change set (FR-TX-1, FR-TX-3), computed on the current model.
 * - uncontrolled: every changed task is replaced with `patchTask(task, change.after, model)` in
 *   its own representation; the draft is cleared;
 * - controlled: `tasks` stay as they are and the change set goes to the committed layer of the
 *   draft (`committed: true`), so the UI keeps showing it until the owner answers; the preview is
 *   removed. Only the next `setTasks` clears the layer (whatever it contains, also the same
 *   array: the owner's way to reject the change). A change set committed while the layer holds
 *   another one is added to it: the changes of the tasks it does not change stay, `reason` and
 *   `conflicts` are the new one's. The change controller does not commit then (`'busy'`): its
 *   change sets would be computed on the owner's old data.
 */
export interface ApplyChangeSetCommand {
  /** Discriminant. */
  readonly type: 'applyChangeSet';
  /** The committed change set. */
  readonly changeSet: ChangeSet;
}

/**
 * Shows a change set over the committed data (FR-EDIT-5, the drag preview), or removes it with
 * `undefined`: the preview layer of the draft. Committed data, the committed layer and derived
 * data stay as they are.
 */
export interface SetDraftCommand {
  /** Discriminant. */
  readonly type: 'setDraft';
  /** The preview, or `undefined` for none. */
  readonly changeSet: ChangeSet | undefined;
}

/**
 * Opens an edit session (FR-TX-4): the current data becomes its base (`StoreState.session`):
 * the tasks and links as given, and, for controlled data, the committed layer of the draft (what
 * the owner has not applied yet). A preview is not part of the base. With a session already open
 * nothing changes.
 */
export interface BeginSessionCommand {
  /** Discriminant. */
  readonly type: 'beginSession';
}

/** Closes the open edit session and keeps the data as it is (FR-TX-4). */
export interface CommitSessionCommand {
  /** Discriminant. */
  readonly type: 'commitSession';
}

/**
 * Closes the open edit session and returns to its base (FR-TX-4):
 * - uncontrolled: `tasks` and `links` become the base arrays again (the very objects), the draft
 *   is cleared;
 * - controlled: the data stays the owner's; the committed layer of the draft becomes the base
 *   values of every task whose value differs (`committed: true`, cleared by the owner's next
 *   `setTasks` like any committed change), or goes when none does; the preview is removed. Links
 *   cannot be shown before the owner applies them.
 */
export interface RollbackSessionCommand {
  /** Discriminant. */
  readonly type: 'rollbackSession';
}

/**
 * A change of the store (Command pattern, `docs/architecture.md` §10): a serializable plain
 * object applied by `reduceStore`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type StoreCommand<TData = unknown> =
  | SetTasksCommand<TData>
  | SetLinksCommand
  | SetOptionsCommand
  | SetDataCommand<TData>
  | SetViewModeCommand
  | SetExpandedKeysCommand
  | SetExpandedCommand
  | ToggleExpandedCommand
  | ExpandAllCommand
  | CollapseAllCommand
  | ApplyChangeSetCommand
  | SetDraftCommand
  | BeginSessionCommand
  | CommitSessionCommand
  | RollbackSessionCommand;

/**
 * A synchronous state container (Observer pattern) compatible with React's
 * `useSyncExternalStore(store.subscribe, store.getSnapshot)`. Its methods need no `this`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface Store<TData = unknown> {
  /** The current snapshot; the same object until a command changes something. */
  readonly getSnapshot: () => StoreState<TData>;
  /**
   * Calls `listener` after every command that changed the snapshot.
   *
   * @returns A function that removes the listener (idempotent).
   */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Applies a command (`reduceStore`) and notifies the listeners when the snapshot changed; then
   * rethrows what listeners threw (one error as it is, several as an `AggregateError`).
   */
  readonly dispatch: (command: StoreCommand<TData>) => void;
  /** `selector(getSnapshot())`. */
  readonly select: <T>(selector: (state: StoreState<TData>) => T) => T;
}

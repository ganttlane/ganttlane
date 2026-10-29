/**
 * Public types of the headless facade (`createGanttCore`): its options, the
 * `Date`-based records and event payloads, the renderer-facing snapshot and scroll requests, and
 * the instance itself.
 */

import type { WorkCalendarOptions } from '../calendar';
import type {
  CommitResult,
  CoreHookHandlers,
  DirtyChangePayload,
  EditRefusedPayload,
  EditSession,
  ErrorPayload,
  HistoryChangePayload,
  HistoryResult,
  IssuesPayload,
  LinkCreateResult,
  LinkDeleteResult,
  Unsubscribe,
} from '../events';
import type { HierarchyOptions } from '../hierarchy';
import type {
  AutoScrollEffect,
  EditingOption,
  FeedbackEffect,
  InteractionEvent,
  InteractionFeedback,
  InteractionOptions,
  LinkPreviewEffect,
  ResolvedEditing,
  ResolvedHandles,
} from '../interaction';
import type {
  BarGeometry,
  Layout,
  LayoutOptions,
  LayoutWindow,
  ResolvedLayoutOptions,
  RowMetrics,
} from '../layout';
import type { Link, Task, TaskDuration, TaskId, TaskType } from '../model';
import type { HeaderContext, ScaleDirection, ViewMode, ViewModesInput } from '../scale';
import type { ChangeSet, Conflict, LinkRecord, MoveChildren } from '../schedule';
import type { Issue } from '../shared';
import type {
  DataMode,
  SessionChanges,
  StoreDatesOptions,
  StoreExpandedKeys,
  StoreSchedulingOptions,
  StoreState,
} from '../store';
import type { DateInput, DatePrecision, DateTimeMs } from '../time';
import type {
  RangeChangeReason,
  ScrollAlign,
  ScrollOptionsInput,
  TimelineOptions,
  TimelineState,
  ViewportChange,
} from '../viewport';

/**
 * The `hierarchy` options: the task tree's data options and the expanded
 * parents.
 */
export interface GanttHierarchyOptions {
  /**
   * The expanded parents: `'all'` (default) or their ids. Setting it replaces the expanded state
   * (a controlled `expandedKeys`); `expand` / `collapse` change it from inside. Ids of tasks
   * without children are allowed and have no effect; unknown ids are ignored.
   *
   * `setOptions` compares the value with the one it was given last time, not with the current
   * expanded state: the same array (or `'all'` again) does nothing, also after `expand` or
   * `collapse` changed the state since, and a new array replaces the state. Setting it never
   * fires `expandedChange`; only changes from inside do.
   */
  readonly expandedKeys?: StoreExpandedKeys | undefined;
  /** Default `Task.parentAnchor`; default `'SS'`. */
  readonly childAnchor?: HierarchyOptions['childAnchor'];
  /** Which children move with their parent; default `'all'`. */
  readonly moveChildren?: MoveChildren | undefined;
}

/**
 * The `history` option: `true` / `false`, or `{ enabled, limit }`. The object form is
 * on unless `enabled: false`; `limit` is the most entries kept (default 100). Off by default.
 */
export type HistoryOption =
  boolean | { readonly enabled?: boolean | undefined; readonly limit?: number | undefined };

/** The new dates of a task (`onTaskDatesChange`), as `Date`s with the local wall clock. */
export interface TaskDates {
  /** The new start. */
  readonly start: Date;
  /**
   * The new end in the semantics of the input: the last day (inclusive) for a day-precision task
   * with `dates.endInclusive`, else the exact end.
   */
  readonly end: Date;
  /** The new end of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: Date;
}

/**
 * A computed task as the facade reports it: dates as local
 * `Date`s with the task's floating wall-clock values (`toDate`), lengths, progress, its place in
 * the tree and its problems. Frozen, and the same object while nothing it shows changed; never
 * mutate its `Date`s. Rows without a bar (placeholders, invalid tasks) have no dates.
 *
 * In controlled data mode a committed change shows in the record once the owner passes the new
 * tasks back (`setTasks`); until then the snapshot's draft shows it.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskRecord<TData = unknown> {
  /** `task.id`. */
  readonly id: TaskId;
  /** `task.name`. */
  readonly name: string;
  /** The caller's task, never mutated. */
  readonly task: Task<TData>;
  /** Effective kind: `'placeholder'` also for a task without dates. */
  readonly type: TaskType;
  /** `'day'` (date-only values) or `'time'`. */
  readonly precision: DatePrecision;
  /** First moment; `undefined` without a bar. */
  readonly start: Date | undefined;
  /**
   * End in the semantics of the input: for a day-precision task with `dates.endInclusive`, the
   * last day (midnight); otherwise the exact end. `undefined` without a bar.
   */
  readonly end: Date | undefined;
  /** End of the half-open interval `[start, endExclusive)`; `undefined` without a bar. */
  readonly endExclusive: Date | undefined;
  /** Lengths in days and milliseconds; `undefined` without a bar. */
  readonly duration: TaskDuration | undefined;
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
  /** Boundary of the done part; `undefined` without a bar. */
  readonly progressDate: Date | undefined;
  /** Depth in the tree, `0` for a root. */
  readonly level: number;
  /** The resolved parent; `undefined` for a root. */
  readonly parentId: TaskId | undefined;
  /** Direct children, in input order. */
  readonly childIds: readonly TaskId[];
  /** Index among the visible rows; `undefined` while a collapsed ancestor hides the row. */
  readonly rowIndex: number | undefined;
  /** Whether its children are shown; `false` without children. */
  readonly isExpanded: boolean;
  /** Problems of the task's input: model and hierarchy issues. */
  readonly issues: readonly Issue[];
  /** Scheduling conflicts shown on the task. */
  readonly conflicts: readonly Conflict[];
}

/** A date range `[start, end)` as local `Date`s. */
export interface DateRange {
  /** First moment. */
  readonly start: Date;
  /** End, exclusive. */
  readonly end: Date;
}

/** The timeline range changed (`onRangeChange`), e.g. for lazy loading by dates. */
export interface RangeChangeInfo extends DateRange {
  /** Why it changed. */
  readonly reason: RangeChangeReason;
}

/** The timeline scrolled, by the renderer or by a scroll request of the core (`onScroll`). */
export interface ScrollInfo {
  /** Horizontal scroll offset in content px. */
  readonly x: number;
  /** Vertical scroll offset in body px. */
  readonly y: number;
  /** The date at the left edge of the viewport. */
  readonly date: Date;
}

/**
 * The events of the facade with the arguments their handlers receive: the
 * same signature for `on(name, handler)` and for the `on<Name>` option. Records and dates are the
 * public, `Date`-based forms; change sets and session changes keep core's floating date-times
 * (`DateTimeMs`, convert with `toDate`), so that they can be passed back to core (`patchTask`,
 * a before-hook's answer).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttEventMap<TData = unknown> {
  /** A change set was committed: one per user action or API change. */
  readonly tasksChange: (changeSet: ChangeSet) => void;
  /** Convenience: a task's dates changed, once per change, after `tasksChange`. */
  readonly taskDatesChange: (record: TaskRecord<TData>, dates: TaskDates) => void;
  /** Convenience: a task's progress changed, once per change, after `tasksChange`. */
  readonly taskProgressChange: (record: TaskRecord<TData>, progress: number) => void;
  /**
   * A link was created: the caller's `Link` as given and its id. Controlled data
   * appends it to its `links`.
   */
  readonly linkCreate: (link: Link, id: string) => void;
  /** A link was deleted, as it was in the graph. */
  readonly linkDelete: (link: LinkRecord) => void;
  /** A link was clicked; it is now the selected link. */
  readonly linkClick: (link: LinkRecord, event: unknown) => void;
  /** A task bar was clicked; `event` is the renderer's input event. */
  readonly taskClick: (record: TaskRecord<TData>, event: unknown) => void;
  /** A task bar was double-clicked. */
  readonly taskDoubleClick: (record: TaskRecord<TData>, event: unknown) => void;
  /** The task under the pointer changed; `null` when the pointer left the bars. */
  readonly taskHoverChange: (record: TaskRecord<TData> | null, event: unknown) => void;
  /** The selected tasks or the selected link changed. */
  readonly selectionChange: (
    selectedKeys: readonly TaskId[],
    selectedLink: string | undefined,
  ) => void;
  /** The view mode in use changed. */
  readonly viewModeChange: (viewMode: ViewMode) => void;
  /** The timeline range changed. */
  readonly rangeChange: (range: RangeChangeInfo) => void;
  /**
   * `expand` / `collapse` / `expandAll` / `collapseAll`, or `scrollToTask` opening the ancestors of
   * its task, changed the expanded parents. It is not fired for `hierarchy.expandedKeys` given to
   * `setOptions` (the application already has that value), nor when a call changes nothing.
   */
  readonly expandedChange: (expandedKeys: StoreExpandedKeys) => void;
  /**
   * The scroll position changed: the renderer reported a new one (`scroll`), or the core moved
   * it itself. The core's own scroll requests (`scrollToDate`, `scrollToTask`, `scrollToToday`,
   * a view mode switch or zoom, the initial scroll, a range that grew at its start) fire it
   * too, before the renderer has performed them; the position the renderer then reports fires
   * it again only if it differs.
   */
  readonly scroll: (scroll: ScrollInfo) => void;
  /** An edit session was rolled back: what controlled data has to revert. */
  readonly editRollback: (changes: SessionChanges) => void;
  /** `edit.isDirty` flipped. */
  readonly dirtyChange: (payload: DirtyChangePayload) => void;
  /** `canUndo` or `canRedo` flipped. */
  readonly historyChange: (payload: HistoryChangePayload) => void;
  /** A gesture was refused: busy, forbidden, or an invalid link target. */
  readonly editRefused: (refusal: EditRefusedPayload) => void;
  /**
   * Problems found: in the data (`'data'`: model, hierarchy, link graph) or the
   * options (`'options'`) whenever their list changes, and in a change set being committed.
   */
  readonly issues: (payload: IssuesPayload) => void;
  /**
   * A listener or a before-hook threw or rejected. Without a listener of `error`, the error is
   * rethrown by the API call that caused the event (a throw, or a rejected promise), and goes to
   * the host's unhandled-rejection channel when renderer input or a gesture caused it; see
   * {@link ErrorPayload}.
   */
  readonly error: (payload: ErrorPayload) => void;
}

/** Name of a facade event. */
export type GanttEventName = keyof GanttEventMap;

/**
 * Option-style event handlers: `onTasksChange` for `tasksChange`, and so on.
 * `setOptions` swaps them in O(1), keeping their place among the listeners; `undefined` removes
 * one.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttEventHandlers<TData = unknown> = {
  readonly [K in GanttEventName as `on${Capitalize<K>}`]?: GanttEventMap<TData>[K] | undefined;
};

/**
 * Every option-style handler: the events plus the before-hooks `onBeforeTaskChange`
 * and `onBeforeLinkCreate`, which receive core's contexts as they are.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttHandlers<TData = unknown> = GanttEventHandlers<TData> & CoreHookHandlers;

/**
 * The options of {@link createGanttCore}: the core part of `GanttOptions`
 * plus the handlers. Display, tooltip and toolbar options belong to the renderers: keys this type
 * does not know are ignored, so a renderer can pass its whole options object.
 *
 * Every option is validated at the boundary: an unusable value is reported as an issue
 * (`onIssues`, `getIssues()`, the result of `setOptions`) and its default is used; nothing
 * throws on bad options or data. The options and the data are never mutated.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttCoreOptions<TData = unknown> = GanttHandlers<TData> & {
  /** The tasks, in display order. */
  readonly tasks: readonly Task<TData>[];
  /** The links; `Task.dependencies` are merged in. */
  readonly links?: readonly Link[] | undefined;
  /**
   * Who owns the data: `'uncontrolled'` (default) applies committed changes to the
   * facade's own tasks; `'controlled'` leaves them to the owner, who passes the new tasks back
   * with `setTasks` (until then the change shows as the snapshot's draft).
   */
  readonly dataMode?: DataMode | undefined;
  /** The view mode id; default `'day'` (an unknown id falls back to it with an issue). */
  readonly viewMode?: string | undefined;
  /** View mode overrides or a complete list (`resolveViewModes`). */
  readonly viewModes?: ViewModesInput | undefined;
  /**
   * BCP 47 locale of the chart; default `'en'`, not the runtime's, so that the same
   * options draw the same text on a server and in a browser. Core formats the header labels with
   * it, and `snapshot.header.locale` hands it to renderers for what they write themselves
   * (tooltip dates and numbers). An invalid tag is an option issue and falls back to `'en'`;
   * `setOptions({ locale })` re-labels the header and nothing else.
   */
  readonly locale?: string | undefined;
  /**
   * Writing direction; default `'ltr'`. `'rtl'` is stored only: mirroring is not available yet.
   */
  readonly direction?: ScaleDirection | undefined;
  /** The source of "today"; default the system clock (`new Date()`). */
  readonly now?: (() => DateInput) | undefined;
  /** Date semantics: `endInclusive` (default `true`). */
  readonly dates?: StoreDatesOptions | undefined;
  /** The work calendar. */
  readonly calendar?: WorkCalendarOptions | undefined;
  /** Scheduling: duration mode, propagation, link type, granularity, snap, skipped days. */
  readonly scheduling?: StoreSchedulingOptions | undefined;
  /** The task tree and the expanded parents. */
  readonly hierarchy?: GanttHierarchyOptions | undefined;
  /** Row, bar and header sizes (`resolveLayoutOptions`). */
  readonly layout?: LayoutOptions | undefined;
  /** Editing from the UI: `false` turns it off; default `true`. */
  readonly editing?: EditingOption | undefined;
  /** Undo / redo; off by default. */
  readonly history?: HistoryOption | undefined;
  /** The timeline range and the infinite timeline; `infinite` is off by default. */
  readonly timeline?: TimelineOptions | undefined;
  /** Initial scroll, programmatic scroll behaviour and alignment, drag autoscroll. */
  readonly scroll?: ScrollOptionsInput | undefined;
  /** Drag thresholds, double-click timing and handle sizes of the interaction machine. */
  readonly interaction?: InteractionOptions | undefined;
};

/**
 * A partial update of {@link GanttCoreOptions} (`setOptions`):
 * - a key left out keeps its value; a key given with `undefined` returns to its default.
 *   `tasks` has none and the types do not allow `undefined` for it: untyped code gets an
 *   `invalid-option` issue, and the chart is emptied;
 * - the groups (`calendar`, `dates`, `scheduling`, `hierarchy`, `layout`, `timeline`, `scroll`,
 *   `interaction`) are merged one level deep: a field you give replaces that field, one you
 *   leave out keeps its value, and one given with `undefined` returns to its default.
 *   `undefined` for a whole group puts all of its fields back;
 * - objects nested in a group are replaced whole, not merged (a field you leave out is back to
 *   its default): `scheduling.skipNonWorkingDays`, `scheduling.snap`, `timeline.range`,
 *   `timeline.infinite`, `scroll.autoScroll` and `interaction.handles`. So are lists (`tasks`,
 *   `links`, `calendar.holidays`, …), `editing`, `history`, `viewModes` and every other option.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttCoreOptionsPatch<TData = unknown> = Partial<GanttCoreOptions<TData>>;

/**
 * A programmatic change of a task's dates or progress (`updateTask`). Dates take any
 * `DateInput`; `end` is read in the input semantics, as the task's own `end` is: a
 * date-only `end` is the last day with `dates.endInclusive`, unless the task has
 * `precision: 'time'`. The end must come after the start (a milestone may end at its start).
 * Values are aligned to the granularity, not snapped; a day-precision task stays on
 * whole days unless `scheduling.keepDayPrecision` is `false`, which lets a value off midnight
 * make it timed.
 */
export interface TaskUpdate {
  /** The new start: alone, the task moves there and keeps its length (like a bar drag). */
  readonly start?: DateInput | undefined;
  /** The new end: alone, the end edge moves and the start stays (like an end-edge drag). */
  readonly end?: DateInput | undefined;
  /** The new progress in percent, `0` … `100`. */
  readonly progress?: number | undefined;
}

/**
 * `updateTask` refused the update before computing a change set: the task has no bar
 * (`'unknown-task'`: an unknown id, a placeholder, an invalid task) or a value is unusable
 * (`'invalid-value'`: unreadable, an end that is not after the start, or misaligned with
 * `alignInput: 'reject'`; see `issues`). Nothing was changed; for `'invalid-value'` the issues
 * are also emitted as an `issues` event (`source: 'change-set'`).
 */
export interface UpdateRejectedResult {
  /** Discriminant. */
  readonly status: 'rejected';
  /** Why. */
  readonly reason: 'unknown-task' | 'invalid-value';
  /** For `'invalid-value'`: what is unusable; empty for `'unknown-task'`. */
  readonly issues: readonly Issue[];
}

/** Outcome of `updateTask`: the commit's result, or why it was refused. */
export type UpdateTaskResult = CommitResult | UpdateRejectedResult;

/** How a scroll request moves: the `scroll.behavior` option or the call's `behavior`. */
export type ScrollBehaviorOption = 'smooth' | 'instant' | 'auto';

/**
 * Why the facade asks the renderer to scroll: the initial scroll at mount, a `scrollTo*` call, a
 * view mode switch or zoom that keeps an anchor date in place, a range re-resolved for new data
 * or new options (the left edge date kept), the infinite timeline settled for a new viewport
 * width, or the range grown under a dragged bar.
 */
export type ScrollRequestReason =
  'initial' | 'scroll-to' | 'view-mode' | 'zoom' | 'data' | 'options' | 'resize' | 'drag';

/**
 * A scroll the renderer performs for the facade, which cannot touch the DOM. Returned by the
 * methods that make one and kept in the snapshot (`scrollRequest`), so a renderer also sees the
 * requests of calls it did not make. Values are in the coordinates of the snapshot that carries the
 * request. Frozen.
 *
 * Contract: apply each request once (by `id`), in the frame that renders its snapshot: first set
 * the horizontal offset to `from` instantly when it is set, then scroll to `left` / `top` with
 * `behavior`; report the resulting position with `scroll()` as usual. Every value is absolute and
 * already accounts for earlier requests, so a renderer that skips a superseded request loses
 * nothing: a request is made only when there is something to scroll (a new scale or offset), and
 * a smooth one carries `from` while an earlier request that moved the offset is not reported
 * back by `scroll()`.
 */
export interface ScrollRequest {
  /** Grows by one with every request of an instance. */
  readonly id: number;
  /** Why. */
  readonly reason: ScrollRequestReason;
  /**
   * The offset to jump to instantly first, for a smooth request: the current picture in the
   * coordinates of this snapshot, after the range grew at its start (`scrollToDate` outside the
   * range of the infinite timeline) or while an earlier request is not reported back, so a
   * smooth scroll starts without a jump. Never set on an instant request. `undefined`: start
   * from where the scroller is.
   */
  readonly from: number | undefined;
  /** The horizontal offset to scroll to, in content px; `undefined` to keep it. */
  readonly left: number | undefined;
  /** The vertical offset to scroll to, in body px; `undefined` to keep it. */
  readonly top: number | undefined;
  /**
   * How to scroll to `left` / `top`: the requested behaviour, except `'instant'` for a
   * `scrollTo*` whose range change cut the current view away (`ScrollPlan.jump`).
   */
  readonly behavior: ScrollBehaviorOption;
}

/** Options of `scrollToDate` and `scrollToToday`. */
export interface ScrollToDateOptions {
  /** Where the date lands in the viewport; default `scroll.align`. */
  readonly align?: ScrollAlign | undefined;
  /** How to scroll; default `scroll.behavior`. */
  readonly behavior?: ScrollBehaviorOption | undefined;
}

/** Options of `scrollToTask`. */
export interface ScrollToTaskOptions extends ScrollToDateOptions {
  /** Where the row lands vertically; default `align`. */
  readonly alignY?: ScrollAlign | undefined;
  /** Expand collapsed ancestors so the row is visible first; default `true`. */
  readonly expand?: boolean | undefined;
}

/** Options of `setViewMode`. */
export interface SetViewModeOptions {
  /**
   * `true` (default): the date at the centre of the viewport stays in place. `false`: the
   * timeline scrolls like at mount (`scroll.initial`).
   */
  readonly keepScroll?: boolean | undefined;
}

/** Options of `zoomTo`. */
export interface ZoomToOptions {
  /** Viewport x of the date that stays in place (e.g. the cursor); default the centre. */
  readonly anchor?: number | undefined;
}

/** The size of the scroller (`setViewport`), in CSS px, header included. */
export interface ViewportSize {
  /** Client width. */
  readonly width: number;
  /** Client height. */
  readonly height: number;
}

/** A scroll position the renderer reports (`scroll`), in CSS px. */
export interface ScrollPosition {
  /** `scrollLeft` of the scroller: content x at the left edge of the viewport. */
  readonly left: number;
  /** `scrollTop` of the scroller: body y at the bottom edge of the sticky header. */
  readonly top: number;
}

/**
 * The selection: selected tasks (`select`) and the selected link (a click on
 * a link, `selectLink`). Ids that leave the data leave the selection. Frozen.
 */
export interface GanttSelection {
  /** Selected tasks, in the order given. */
  readonly tasks: readonly TaskId[];
  /** The selected link, `undefined` for none. */
  readonly link: string | undefined;
}

/** The current problems of the data and the options (`getIssues`). Frozen. */
export interface GanttIssues {
  /** Model, hierarchy and link graph issues of the current data. */
  readonly data: readonly Issue[];
  /** Issues of the current options (invalid values replaced by their defaults). */
  readonly options: readonly Issue[];
}

/**
 * An effect of `send` the renderer acts on: the drag autoscroll velocity, the link preview line
 * and the interaction feedback (cursor, hover, dragged values). The facade applies the others
 * itself (previews, commits, links, clicks, range extension); everything here is also in the
 * snapshot.
 */
export type RendererEffect = AutoScrollEffect | LinkPreviewEffect | FeedbackEffect;

/**
 * The renderer's view-model (`getSnapshot`): everything needed to draw the chart, memoized. A new
 * object only when something in it changed, and its parts keep their identity while their inputs
 * do, so `useSyncExternalStore(core.subscribe, core.getSnapshot)` and keyed redraws work as is.
 *
 * Incremental redraws: `state.lastDataChange` lists the tasks and links of the last new model
 * (a renderer that drew `version - 1` applies it, any other redraws everything); bars changed by
 * the draft are `state.draft?.patches` (and those of the previous draft).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttSnapshot<TData = unknown> {
  /**
   * The store snapshot: tasks, links and options as given, the draft, the edit session's base,
   * derived data (model, hierarchy, link graph, conflicts, visible rows, view mode, snap) and
   * `lastDataChange`.
   */
  readonly state: StoreState<TData>;
  /** The view mode in use (`state.derived.viewMode`). */
  readonly viewMode: ViewMode;
  /** Range, scale (origin `range.start`, zoom applied), scroll offset and viewport width. */
  readonly timeline: TimelineState;
  /** Width of the scrolled content: the range on the scale, in px. */
  readonly contentWidth: number;
  /** Vertical scroll offset in body px. */
  readonly scrollTop: number;
  /** Height of the viewport, header included. */
  readonly viewportHeight: number;
  /**
   * What header rows and grid lines need with the view mode and the window:
   * `headerRows(viewMode, window, header)`, `gridLines(viewMode, window, header)`.
   */
  readonly header: HeaderContext;
  /** Row, bar and header row sizes in use. */
  readonly layoutOptions: ResolvedLayoutOptions;
  /** Row metrics and bar geometry of the visible rows, with the draft over the committed data. */
  readonly layout: Layout;
  /** What to render: visible rows and time with overscan (`visibleWindow`). */
  readonly window: LayoutWindow;
  /** The selection. */
  readonly selection: GanttSelection;
  /** The interaction feedback: cursor, hovered target, dragged values, link preview. */
  readonly feedback: InteractionFeedback;
  /**
   * The `editing` option with every flag spelled out. A renderer draws the handles a task's
   * permissions allow: `resolvePermissions(model, snapshot.editing)`. Its own part: it keeps its
   * identity while the flags are the same, and `setOptions({ editing })` changes it and nothing
   * else.
   */
  readonly editing: ResolvedEditing;
  /**
   * The handle sizes in use: `interaction.handles` over the defaults. The renderer draws the
   * handles with the sizes (`barHandles(bar, snapshot.handles)`) that the machine hit tests with.
   * Its own part, like {@link GanttSnapshot.editing}.
   */
  readonly handles: ResolvedHandles;
  /**
   * "Now" as floating wall-clock time truncated to the minute: the `now` option, else the system
   * clock, read when the chart starts, when `now` is set and by {@link GanttCore.refreshNow}.
   * Renderers draw the today line and marker from it, so they follow the option (a fixed clock in
   * tests, a server clock) and need no clock of their own; they call `refreshNow()` once a minute.
   */
  readonly now: DateTimeMs;
  /** The drag autoscroll velocity in px per frame; `0` when none. */
  readonly autoScroll: number;
  /**
   * Whether a commit or a link creation awaits a before-hook, or controlled data holds a
   * committed change the owner has not applied yet (`state.draft.committed`, until its next
   * `setTasks`). No gesture and no `updateTask` starts meanwhile.
   */
  readonly busy: boolean;
  /** The latest scroll request, see {@link ScrollRequest}. */
  readonly scrollRequest: ScrollRequest | undefined;
}

/**
 * The edit session of a chart (`edit`): `begin` / `commit` / `rollback`,
 * `getChanges`, `isOpen`, `isDirty`, as `createEditSession` describes them. A rollback cancels a
 * gesture in progress first.
 */
export type GanttEditSession = Omit<EditSession, 'dispose'>;

/**
 * The headless chart of {@link createGanttCore}: data, view, scrolling, rows, selection, sessions,
 * history and events for applications, and viewport input, interaction input and a memoized
 * snapshot for renderers. Its members need no `this`. After `destroy()` queries still answer from the
 * last state, commands change nothing (those with a result resolve `cancelled` with reason
 * `'disposed'`), and no event fires.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttCore<TData = unknown> {
  /** Replaces the tasks: diffed by id, only what changed is recomputed. */
  readonly setTasks: (tasks: readonly Task<TData>[]) => void;
  /** Replaces the links. */
  readonly setLinks: (links: readonly Link[] | undefined) => void;
  /**
   * Changes a task's dates or progress from code (reason `'api'`), see {@link createGanttCore}:
   * propagated like the same drag and passed through the before-hooks.
   */
  readonly updateTask: (id: TaskId, update: TaskUpdate) => Promise<UpdateTaskResult>;
  /**
   * Creates a link through the `beforeLinkCreate` hooks. A value that is no valid link (not an
   * object, an unknown type, …) is `'rejected'` as `'invalid'`, with the issues.
   */
  readonly addLink: (link: Link) => Promise<LinkCreateResult>;
  /**
   * Deletes a link by id, whatever its `Link.editable`: that flag only hides the Remove action of
   * the UI.
   */
  readonly removeLink: (id: string) => Promise<LinkDeleteResult>;
  /**
   * Changes options with minimal recomputation, see {@link createGanttCore} for what
   * each option invalidates and {@link GanttCoreOptionsPatch} for how a patch is merged.
   *
   * @returns The issues of the options now in use.
   */
  readonly setOptions: (options: GanttCoreOptionsPatch<TData>) => readonly Issue[];
  /** Switches the view mode; the returned request keeps or resets the scroll. */
  readonly setViewMode: (id: string, options?: SetViewModeOptions) => ScrollRequest | undefined;
  /** Sets the zoom level of the current view mode, keeping the anchor date in place. */
  readonly zoomTo: (pxPerDay: number, options?: ZoomToOptions) => ScrollRequest | undefined;
  /**
   * Scrolls a date into view; the infinite timeline grows first.
   * `undefined` for an unreadable date, and before the viewport is known (the first non-zero
   * width): the call is then kept, the latest one wins, and the mount performs it (instantly)
   * in place of `scroll.initial`, which a later change of the option cannot override.
   */
  readonly scrollToDate: (
    date: DateInput,
    options?: ScrollToDateOptions,
  ) => ScrollRequest | undefined;
  /** Scrolls today into view; before the viewport is known it is kept like `scrollToDate`. */
  readonly scrollToToday: (options?: ScrollToDateOptions) => ScrollRequest | undefined;
  /**
   * Scrolls a task's row and bar into view; before the viewport is known it is kept
   * like `scrollToDate` (a task that is not there then leaves `scroll.initial` in charge).
   */
  readonly scrollToTask: (id: TaskId, options?: ScrollToTaskOptions) => ScrollRequest | undefined;
  /** Expands a parent; a task without children, or an unknown id, is left as it is. */
  readonly expand: (id: TaskId) => void;
  /** Collapses a parent; a task without children, or an unknown id, is left as it is. */
  readonly collapse: (id: TaskId) => void;
  /** Expands every parent. */
  readonly expandAll: () => void;
  /** Collapses every parent. */
  readonly collapseAll: () => void;
  /** Replaces the selected tasks; unknown ids are left out. */
  readonly select: (ids: readonly TaskId[]) => void;
  /** Selects a link, or none with `undefined`; an unknown id selects none. */
  readonly selectLink: (id: string | undefined) => void;
  /** Clears the selected tasks and the selected link. */
  readonly clearSelection: () => void;
  /** The edit session. */
  readonly edit: GanttEditSession;
  /** Undoes the last action; a gesture in progress is cancelled first. */
  readonly undo: () => HistoryResult;
  /** Redoes the last undone action. */
  readonly redo: () => HistoryResult;
  /** Whether `undo()` has an entry. */
  readonly canUndo: boolean;
  /** Whether `redo()` has an entry. */
  readonly canRedo: boolean;
  /**
   * Adds a listener with the same signature as the `on<Name>` option.
   *
   * @returns A function that removes it (idempotent).
   */
  readonly on: <K extends GanttEventName>(name: K, handler: GanttEventMap<TData>[K]) => Unsubscribe;
  /**
   * The renderer reports the scroller's size (from a `ResizeObserver`). The first
   * non-zero width mounts the timeline: the infinite timeline settles and `scroll.initial` (or
   * the scroll the application asked for before, see `scrollToDate`) is applied, returned as a
   * request.
   *
   * **Listener errors.** The renderer-input methods (`setViewport`, `scroll`, `send` and
   * `refreshNow`) never throw after they changed the chart: their result (a request, a range
   * change to compensate, the effects) is what the renderer needs to stay consistent with the
   * state that was already published. What the application's listeners threw reaches the
   * `error` listeners as usual; when nobody listens to `error` it is reported to the host's
   * unhandled-rejection channel instead of being thrown into the renderer, so it is never lost.
   * Every other method throws what its listeners threw, once it is done.
   */
  readonly setViewport: (size: ViewportSize) => ScrollRequest | undefined;
  /**
   * The renderer reports a scroll position (from every `scroll` event, once per frame).
   * Runs the infinite timeline's policy and re-places a dragged bar under the pointer. Does not
   * throw after the range changed, see {@link GanttCore.setViewport}.
   *
   * @returns The range change to apply in the same frame (`scrollLeft += change.shift`, the new
   * content width), or `undefined`.
   */
  readonly scroll: (position: ScrollPosition) => ViewportChange | undefined;
  /**
   * The renderer's input adapter sends a pointer, key, cancel or timeline event in content
   * coordinates (`PointerInput`). The facade applies previews, commits, links, clicks and range
   * growth itself and emits the events. Does not throw after it changed something, see
   * {@link GanttCore.setViewport}.
   *
   * @returns The effects the renderer acts on.
   */
  readonly send: (event: InteractionEvent) => readonly RendererEffect[];
  /**
   * Reads "now" again (the `now` option, else the system clock) and publishes a new snapshot
   * when the minute changed (`GanttSnapshot.now`); does nothing otherwise. Renderers call it from
   * one timer aligned to the next minute boundary, so the today line does not go stale overnight.
   * Listener errors are reported like those of {@link GanttCore.setViewport}.
   */
  readonly refreshNow: () => void;
  /** The current snapshot; the same object until something in it changed. */
  readonly getSnapshot: () => GanttSnapshot<TData>;
  /**
   * Calls `listener` after every change of the snapshot (`useSyncExternalStore`).
   *
   * @returns A function that removes it (idempotent).
   */
  readonly subscribe: (listener: () => void) => Unsubscribe;
  /** A task as a public record; `undefined` for an unknown id. */
  readonly getTask: (id: TaskId) => TaskRecord<TData> | undefined;
  /** A link of the graph; `undefined` for an unknown or dropped id. */
  readonly getLink: (id: string) => LinkRecord | undefined;
  /** The dates at the viewport's left and right edges. */
  readonly getVisibleRange: () => DateRange;
  /**
   * Where a task's row lies, in body px; `undefined` when hidden.
   * Add `layout.rows.headerHeight` for scroller content px.
   */
  readonly getRowMetrics: (id: TaskId) => RowMetrics | undefined;
  /** Where a task's bar lies as drawn (draft included), in body px. */
  readonly getBarRect: (id: TaskId) => BarGeometry | undefined;
  /** The current problems of the data and the options. */
  readonly getIssues: () => GanttIssues;
  /**
   * Disposes the controller, the edit session and the history, removes every listener and
   * subscription; nothing is emitted afterwards and a pending before-hook's answer is ignored.
   * Leaves no timers. Idempotent.
   */
  readonly destroy: () => void;
}

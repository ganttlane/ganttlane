/**
 * `createGanttCore`: the headless facade of core (Facade pattern, `docs/architecture.md` §3, §4,
 * §7, §10). It composes the store, the change controller, the history and the edit session, the
 * viewport math and the interaction machine into one instance with the methods of
 * `docs/api.md` §6, the public events of §5 and a memoized snapshot for renderers.
 */

import {
  type BusyResult,
  type CancelledResult,
  type CommitResult,
  type CoreEventName,
  type CoreEvents,
  createChangeController,
  createChangeHistory,
  createEditSession,
  createEmitter,
  type HistoryResult,
  type HistorySettings,
  type LinkCreateResult,
  type LinkDeleteResult,
  type Unsubscribe,
} from '../events';
import {
  createInteraction,
  type HitTarget,
  type InteractionContext,
  type InteractionEffect,
  type InteractionEvent,
  type InteractionFeedback,
  type InteractionOptions,
  type ResolvedEditing,
  type ResolvedHandles,
  resolveEditing,
  resolveHandles,
} from '../interaction';
import {
  type BarLookup,
  type BarSource,
  createLayout,
  type Layout,
  type LayoutOptions,
  layoutRows,
  type ResolvedLayoutResult,
  resolveLayoutOptions,
  type RowLayout,
  visibleWindow,
} from '../layout';
import {
  alignTo,
  isoText,
  type Link,
  type ModelIssue,
  type NormalizedModel,
  reportMisaligned,
  type Task,
  type TaskId,
  type TaskModel,
  type TaskSpan,
} from '../model';
import { progressToDate } from '../progress';
import { createTimeScale, type TimeRange, type TimeScale, type ViewMode } from '../scale';
import {
  type ChangeSet,
  type ChangeSetIssue,
  type ChangeSetIssueCode,
  propagate,
  type PropagationCommand,
} from '../schedule';
import { DEV, isFiniteNumber, isRecord, isSize, type Issue, shortMessage } from '../shared';
import {
  createStore,
  type Draft,
  type SetDataCommand,
  type StoreExpandedKeys,
  type StoreOptions,
  type StoreState,
} from '../store';
import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateInput,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  DEFAULT_GRANULARITY,
  parseDateInput,
  type ParsedDate,
  toDate,
} from '../time';
import {
  type ColumnGrid,
  columnGrid,
  ensureContains,
  type ExtensionPolicy,
  type InfinitePolicy,
  planExtension,
  planScrollTo,
  type RangeChangeReason,
  rebaseTimeline,
  type ResolvedScrollResult,
  type ResolvedTimelineOptions,
  resolveInitialScroll,
  resolveRange,
  resolveScrollOptions,
  resolveTimelineOptions,
  type ScrollAlign,
  type ScrollPlan,
  scrollToTask as planTaskScroll,
  type TimelineState,
  type ViewportChange,
} from '../viewport';
import {
  type CheckedOptions,
  checkOptions,
  eventOfHandler,
  issue as optionIssue,
  mergeOptions,
  type OptionIssue,
  qualifyIssues,
  reuse,
  sameIssues,
  show,
  targetsOf,
} from './options';
import { createRecordCache, dateRange, type RecordSource, taskDates } from './records';
import type {
  DateRange,
  GanttCore,
  GanttCoreOptions,
  GanttCoreOptionsPatch,
  GanttEventMap,
  GanttEventName,
  GanttIssues,
  GanttSelection,
  GanttSnapshot,
  HistoryOption,
  RendererEffect,
  ScrollBehaviorOption,
  ScrollPosition,
  ScrollRequest,
  ScrollRequestReason,
  ScrollToDateOptions,
  ScrollToTaskOptions,
  SetViewModeOptions,
  TaskUpdate,
  UpdateRejectedResult,
  UpdateTaskResult,
  ViewportSize,
  ZoomToOptions,
} from './types';

/** The options the facade keeps besides the data and the handlers. */
type Current<TData> = Partial<Omit<GanttCoreOptions<TData>, 'tasks' | 'links'>>;

/** A handler of any facade event, called with the mapped arguments. */
type AnyHandler = (...args: readonly unknown[]) => void;

/** What the timeline was last derived from. */
interface Synced {
  readonly model: NormalizedModel;
  /** The store's model options (calendar, dates, …): a new model for them is an option change. */
  readonly modelOptions: StoreState['settings']['model'];
  readonly viewMode: ViewMode;
  readonly pxPerDay: number;
  readonly settings: ResolvedTimelineOptions;
  readonly direction: 'ltr' | 'rtl';
  readonly now: (() => DateInput) | undefined;
}

/** A rebase asked for by `setViewMode` or `zoomTo`, carried out by the next timeline sync. */
interface PendingRebase {
  readonly reason: 'view-mode' | 'zoom';
  /** Viewport x of the date kept in place; default the centre. */
  readonly anchorX: number | undefined;
  /** `setViewMode(…, { keepScroll: false })`: scroll like at mount afterwards. */
  readonly reset: boolean;
}

/** Why the timeline was re-derived: the scale, the timeline options or the data changed. */
type SyncReason = 'view-mode' | 'zoom' | 'options' | 'data';

/** A scroll request before it gets its id. */
interface RequestInput {
  readonly reason: ScrollRequestReason;
  readonly from?: number | undefined;
  readonly left?: number | undefined;
  readonly top?: number | undefined;
  readonly behavior: ScrollBehaviorOption;
}

/**
 * A scroll the application asked for (`scrollToDate`, `scrollToToday`, `scrollToTask`) before the
 * chart had a width to place it on. `'today'` is read when it is performed.
 */
type ScrollIntent =
  | {
      readonly kind: 'date';
      readonly t: DateTimeMs | 'today';
      readonly options: ScrollToDateOptions | undefined;
    }
  | {
      readonly kind: 'task';
      readonly id: TaskId;
      readonly options: ScrollToTaskOptions | undefined;
    };

const NO_SELECTION: GanttSelection = /* @__PURE__ */ Object.freeze({
  tasks: /* @__PURE__ */ Object.freeze([]),
  link: undefined,
});
const DISPOSED: CancelledResult = /* @__PURE__ */ Object.freeze({
  status: 'cancelled',
  reason: 'disposed',
});
const BUSY: BusyResult = /* @__PURE__ */ Object.freeze({ status: 'busy' });
const NO_TASK: LinkCreateResult = /* @__PURE__ */ Object.freeze({
  status: 'rejected',
  reason: 'unknown-task',
});
const NO_EFFECTS: readonly RendererEffect[] = /* @__PURE__ */ Object.freeze([]);
const NO_ISSUES: readonly Issue[] = /* @__PURE__ */ Object.freeze([]);
/** Cascades of listeners that change the chart again are followed this many rounds at most. */
const MAX_ROUNDS = 8;
/** `planExtension` settles within four calls without scrolling. */
const SETTLE_STEPS = 4;
const ALIGN_KEYWORDS: ReadonlySet<unknown> = /* @__PURE__ */ new Set(['start', 'center', 'end']);
const BEHAVIORS: ReadonlySet<unknown> = /* @__PURE__ */ new Set(['smooth', 'instant', 'auto']);

/**
 * Creates the headless chart (FR-API-1 … FR-API-6): one instance per chart, with no globals and
 * no state shared between instances. Never throws on bad options or data: problems are issues
 * (`onIssues` / `on('issues')`, `getIssues()`, the result of `setOptions`) and their defaults are
 * used. The caller's options, tasks and links are never mutated.
 *
 * **Wiring.** The change controller is created first, then the history (`history` option, off by
 * default), then the edit session on that history. Data from the owner (`setTasks`, `setLinks`,
 * the store's options) goes through `controller.update` as one `setData` command per call, so
 * sessions and the history see it as one owner change and the store derives the model once
 * (`setOptions({ calendar, tasks })` normalizes once).
 * Option handlers (`onX`) are set with `controller.setHandlers`; `on(name, fn)` subscribes to the
 * same emitter. Both receive the public arguments of {@link GanttEventMap}.
 *
 * **`setOptions` and minimal recomputation (FR-API-2).** Each given key is routed by the
 * invalidation matrix (`OPTION_INVALIDATION`):
 *
 * | Option | What is recomputed |
 * | --- | --- |
 * | `tasks`, `links` | store: model → graph → conflicts (tree and rows when the tree changed); bars; range (`'data'`) |
 * | `calendar`, `dates`, `scheduling` (data fields), `dataMode` | store stages per `StoreState`'s table; bars and range when the model changed |
 * | `scheduling.snap`, `.propagation`, `.skipNonWorkingDays`, `hierarchy.moveChildren` | store settings or snap only: no model, no layout |
 * | `hierarchy.childAnchor` / `.expandedKeys` | tree and rows / rows only; row metrics and bars |
 * | `viewModes`, `viewMode` | view mode and snap; scale and range rebased around the centre (`'view-mode'`) |
 * | `layout` | row metrics (`rowHeight`, `headerRowHeight`) or bars (`barHeight`, `barRadius`); no model |
 * | `timeline`, `direction` | range, scale and the infinite timeline's policy |
 * | `now` | as above, and the snapshot's `now` (the minute) |
 * | `locale` | header labels only |
 * | `scroll` | scroll options / interaction context only |
 * | `editing` | the snapshot's `editing` part and the interaction context only |
 * | `interaction` | the interaction machine is recreated (a gesture in progress is cancelled); the snapshot's `handles` part when a size changed |
 * | `history` | `history.configure` only |
 * | `on*` | the handler only, O(1): no model, no layout, no new snapshot |
 *
 * **`updateTask(id, { start, end, progress })`** is a programmatic change with reason `'api'`:
 * `start` alone moves the task (it keeps its length), `end` alone moves the end edge, both put
 * both edges (`'reschedule'`), `progress` sets the progress. It **propagates** through links and
 * children exactly like the same drag (`scheduling.propagation`, `hierarchy.moveChildren`), and it
 * **runs the before-hooks** (`onBeforeTaskChange` sees `reason: 'api'` and may pass, veto or
 * modify it), so the app's rules hold for code and users alike. Values are exact: no snapping
 * to the view mode's step and no rolling onto working days (FR-SNAP-11); a value off the
 * granularity is aligned per `scheduling.alignInput` with a `'misaligned'` issue (`'reject'`
 * refuses the update). A day-precision task's step is a whole day, unless
 * `scheduling.keepDayPrecision: false`: then a value off midnight is aligned to the granularity
 * and makes the task timed, as a drag does (FR-SNAP-7; the change carries `precision`).
 * `end` is read like the task's own `end` (FR-TIME-8) and must come after the start
 * (`'end-before-start'` refuses the update). A locked task is reported with `'locked-task'` for
 * dates as for progress (`'unchanged'`). While the chart is busy (`GanttSnapshot.busy`) the
 * update resolves `'busy'` without reading or reporting anything. Undo restores it like any
 * action.
 *
 * **Renderers** report the viewport (`setViewport`, `scroll`) and send interaction events
 * (`send`); the facade applies previews, commits, link creation, clicks and range growth itself
 * and returns the effects left to the renderer. Scrolls the facade wants (initial scroll,
 * `scrollTo*`, view mode switches, zoom, a range re-resolved for new data) are
 * {@link ScrollRequest}s, returned and kept in the snapshot. A `scrollTo*` call made before the
 * first width is kept (the latest wins) and performed by the mount instead of `scroll.initial`.
 * The renderer's input methods (`setViewport`, `scroll`, `send`, `refreshNow`) do not throw
 * after they changed the chart: what listeners threw reaches `error` listeners, or the host's
 * unhandled-rejection channel, so that the result the renderer needs is never lost with it.
 *
 * @param options - Data, options and handlers; keys this type does not know are ignored.
 * @returns The chart.
 *
 * @example
 * ```ts
 * const gantt = createGanttCore({ tasks, links, viewMode: 'week', onTasksChange: save });
 * gantt.setViewport({ width: 1200, height: 600 });     // from a ResizeObserver
 * const unsubscribe = gantt.subscribe(() => render(gantt.getSnapshot()));
 * gantt.send({ type: 'down', pointerId: 1, x, y, time }); // from the input adapter
 * gantt.scrollToTask('design');                        // → a ScrollRequest for the renderer
 * gantt.destroy();
 * ```
 */
export function createGanttCore<TData = unknown>(
  options: GanttCoreOptions<TData>,
): GanttCore<TData> {
  const created = checkOptions(options, true);
  const optionIssues = new Map<string, readonly OptionIssue[]>();
  let optionIssueList: readonly OptionIssue[] = Object.freeze([]);
  /** Records the issues of the keys checked; the list keeps its identity while they are equal. */
  const recordIssues = (issues: CheckedOptions['issues']): void => {
    let changed = false;
    for (const [key, list] of issues) {
      const known = optionIssues.get(key);
      if (list.length === 0) changed = optionIssues.delete(key) || changed;
      else if (known === undefined || !sameIssues(known, list)) {
        optionIssues.set(key, list);
        changed = true;
      }
    }
    if (changed) optionIssueList = Object.freeze([...optionIssues.values()].flat());
  };
  recordIssues(created.issues);
  const split = splitValues(created.values);
  let current: Current<TData> = mergeOptions<Current<TData>>(Object.freeze({}), split.options);

  const adapter = createFloatingAdapter();
  const store = createStore<TData>({
    tasks: (created.values.tasks ?? []) as readonly Task<TData>[],
    links: created.values.links as readonly Link[] | undefined,
    options: storeOptionsOf(split.options),
    viewMode: current.viewMode,
    expandedKeys: current.hierarchy?.expandedKeys,
  });
  const emitter = createEmitter<CoreEvents>();
  const controller = createChangeController<TData>({ store, emitter });
  const history = createChangeHistory<TData>({
    store,
    controller,
    emitter,
    ...historySettings(current.history),
  });
  const session = createEditSession<TData>({ store, controller, emitter, history });
  let machine = createInteraction(interactionOptions(current.interaction));
  const records = createRecordCache<TData>();

  let destroyed = false;
  /** Nesting of facade operations; the snapshot is published when the outermost one ends. */
  let depth = 0;
  let mounted = false;
  let viewportHeight = 0;
  let scrollTop = 0;
  let timeline: TimelineState | undefined;
  /** The range of the data and the timeline options (`resolveRange`), before any extension. */
  let dataRange: TimeRange | undefined;
  /**
   * A request moved the offset (an instant one, or a jump to `from`) and the renderer has not
   * reported a position since: it may skip that request and apply only a later one.
   */
  let unconfirmed = false;
  /**
   * The latest scroll the application asked for before the first width: the mount performs it
   * instead of `scroll.initial`, which therefore cannot override it.
   */
  let intent: ScrollIntent | undefined;
  /** What a gesture in progress was last placed on. */
  let retimed: {
    readonly timeline: TimelineState | undefined;
    readonly model: NormalizedModel | undefined;
    readonly scrollTop: number;
  } = { timeline: undefined, model: undefined, scrollTop: 0 };
  let synced: Synced | undefined;
  let zoom: { readonly viewMode: ViewMode; readonly pxPerDay: number } | undefined;
  let rebase: PendingRebase | undefined;
  let selection = NO_SELECTION;
  let pruned: readonly unknown[] = [];
  let autoScroll = 0;
  let hovered: TaskId | undefined;
  let scrollRequest: ScrollRequest | undefined;
  let requestCount = 0;
  /**
   * "Now" to the minute as the snapshot shows it: whatever the clock said when it was last read
   * (`readNow`), which happens whenever the timeline is derived, so a new `now` option is read
   * before the snapshot is published. Set by the first sync, before any snapshot is built.
   */
  let nowMinute: DateTimeMs = asDateTimeMs(0);
  let shownViewMode: ViewMode | undefined;
  let shownScroll: { readonly x: number; readonly y: number } | undefined;
  let shownIssues: {
    readonly data: readonly Issue[] | undefined;
    readonly dataKey: string;
    readonly options: readonly Issue[] | undefined;
    readonly optionsKey: string;
  } = { data: undefined, dataKey: '', options: undefined, optionsKey: '' };
  let snapshot: GanttSnapshot<TData> | undefined;
  let listeners: readonly { readonly listener: () => void }[] = [];
  let queued: (readonly [CoreEventName, unknown])[] = [];

  // ---- memoized derivations (by identity of their inputs) ----

  const layoutSettingsOf = memoize(
    (layout: LayoutOptions | undefined, headerRows: number): ResolvedLayoutResult =>
      resolveLayoutOptions(layout, headerRows),
  );
  const rowLayoutOf = memoize(
    (rows: StoreState['derived']['rows'], rowHeight: number, heights: readonly number[]) =>
      layoutRows(rows, { rowHeight, headerRowHeights: heights }),
  );
  const barsOf = memoize(
    (
      rows: RowLayout,
      model: NormalizedModel<TData>,
      draft: Draft | undefined,
      scale: TimeScale,
      barHeight: number,
      barRadius: number,
    ): Layout => createLayout({ rows, tasks: lookupOf(model, draft), scale, barHeight, barRadius }),
  );
  const windowOf = memoize(visibleWindowOf);
  const headerOf = memoize((scale: TimeScale, locale: string) =>
    Object.freeze({ scale, adapter, locale }),
  );
  const timelineSettingsOf = memoize(
    (input: GanttCoreOptions['timeline'], viewMode: ViewMode, endInclusive: boolean | undefined) =>
      resolveTimelineOptions(input, { viewMode, endInclusive }),
  );
  const scrollSettingsOf = memoize((input: GanttCoreOptions['scroll']): ResolvedScrollResult =>
    resolveScrollOptions(input),
  );
  const columnsOf = memoize((viewMode: ViewMode): ColumnGrid => columnGrid(viewMode, adapter));
  const policyOf = memoize(
    (infinite: InfinitePolicy | undefined, columns: ColumnGrid): ExtensionPolicy | undefined =>
      infinite === undefined ? undefined : Object.freeze({ ...infinite, columns, adapter }),
  );
  const dataIssuesOf = memoize(
    (
      model: NormalizedModel,
      hierarchy: { readonly issues: readonly Issue[] },
      graph: {
        readonly issues: readonly Issue[];
      },
    ): readonly Issue[] => Object.freeze([...model.issues, ...hierarchy.issues, ...graph.issues]),
  );
  const optionIssuesOf = memoize((...lists: readonly (readonly Issue[])[]): readonly Issue[] =>
    Object.freeze(lists.flat()),
  );
  /** The issue lists of the modules with group-qualified paths, by the list they come from. */
  const qualified = new WeakMap<readonly Issue[], readonly Issue[]>();
  const qualify = (group: string, issues: readonly Issue[]): readonly Issue[] => {
    let found = qualified.get(issues);
    if (found === undefined) {
      found = qualifyIssues(group, issues);
      qualified.set(issues, found);
    }
    return found;
  };
  // The `editing` and `interaction.handles` options as snapshot parts: resolved once per option
  // object, and the same object while the resolved values are (`true` and `{}` are one).
  let editingPart: ResolvedEditing | undefined;
  const editingOf = memoize((option: GanttCoreOptions['editing']): ResolvedEditing => {
    editingPart = reuse(editingPart, resolveEditing(option));
    return editingPart;
  });
  let handlesPart: ResolvedHandles | undefined;
  const handlesOf = memoize((option: InteractionOptions['handles']): ResolvedHandles => {
    handlesPart = reuse(handlesPart, resolveHandles(option));
    return handlesPart;
  });
  const contextOf = memoize(
    (
      model: NormalizedModel,
      hierarchy: InteractionContext['hierarchy'],
      graph: InteractionContext['graph'],
      layout: Layout,
      state: TimelineState,
      top: number,
      snap: InteractionContext['snap'],
      propagation: InteractionContext['propagation'],
      editing: InteractionContext['editing'],
      scrolling: InteractionContext['autoScroll'],
      busy: boolean,
    ): InteractionContext =>
      Object.freeze({
        model,
        hierarchy,
        graph,
        layout,
        timeline: state,
        scrollTop: top,
        snap,
        adapter,
        propagation,
        editing,
        autoScroll: scrolling,
        busy,
      }),
  );

  /**
   * The machine's feedback, or the one shown while it is equal by value: a recreated machine
   * (`interaction` options) starts with an equal idle feedback, which is no change to draw.
   */
  const feedbackOf = (next: InteractionFeedback): InteractionFeedback =>
    snapshot === undefined || snapshot.feedback === next ? next : reuse(snapshot.feedback, next);

  const viewModeOf = (state: StoreState<TData>): ViewMode => state.derived.viewMode;
  const layoutSettings = (state: StoreState<TData>): ResolvedLayoutResult =>
    layoutSettingsOf(current.layout, viewModeOf(state).headers.length);
  /** The header row heights, the same array while their values are (bar sizes do not move rows). */
  let heights: readonly number[] = [];
  const rowsOf = (state: StoreState<TData>): RowLayout => {
    const { options: sizes } = layoutSettings(state);
    const next = sizes.headerRowHeights;
    if (next.length !== heights.length || next.some((height, i) => height !== heights[i])) {
      heights = next;
    }
    return rowLayoutOf(state.derived.rows, sizes.rowHeight, heights);
  };
  const timelineNow = (): TimelineState => {
    if (timeline === undefined) throw new Error('The timeline is derived when the facade starts.');
    return timeline;
  };
  const layoutOf = (state: StoreState<TData>): Layout => {
    const { options: sizes } = layoutSettings(state);
    const { model } = state.derived;
    const { scale } = timelineNow();
    return barsOf(rowsOf(state), model, state.draft, scale, sizes.barHeight, sizes.barRadius);
  };
  const timelineSettings = (state: StoreState<TData>): ResolvedTimelineOptions =>
    timelineSettingsOf(current.timeline, viewModeOf(state), current.dates?.endInclusive).options;
  const scrollSettings = (): ResolvedScrollResult['options'] =>
    scrollSettingsOf(current.scroll).options;
  const policy = (state: StoreState<TData>): ExtensionPolicy | undefined =>
    policyOf(timelineSettings(state).infinite, columnsOf(viewModeOf(state)));
  const recordSource = (state: StoreState<TData>): RecordSource<TData> => ({
    model: state.derived.model,
    hierarchy: state.derived.hierarchy,
    rows: rowsOf(state),
    expandedKeys: state.expandedKeys,
    conflicts: state.derived.conflicts,
  });
  /**
   * Whether no gesture and no `updateTask` may start (FR-EDIT-7, FR-TX-3): a commit or a link
   * creation awaits a before-hook, or controlled data holds a committed change the owner has not
   * applied yet (`draft.committed`). An edit then would be computed from the owner's old data
   * while the chart shows the commit, and its change set would undo it.
   */
  const isBusy = (state: StoreState<TData>): boolean =>
    controller.pending || state.draft?.committed === true;
  const context = (): InteractionContext => {
    const state = store.getSnapshot();
    const { derived, settings } = state;
    return contextOf(
      derived.model,
      derived.hierarchy,
      derived.graph,
      layoutOf(state),
      timelineNow(),
      scrollTop,
      derived.snap.snap,
      settings.propagation,
      editingOf(current.editing),
      scrollSettings().autoScroll,
      isBusy(state),
    );
  };

  // ---- events ----

  const mapped = new Map<string, { readonly payload: unknown; readonly args: unknown }>();
  /** The public arguments of a core payload; `undefined` when its task or link is gone. */
  const argsOf = (name: GanttEventName, payload: unknown): readonly unknown[] | undefined => {
    const last = mapped.get(name);
    if (last !== undefined && last.payload === payload) {
      return last.args as readonly unknown[] | undefined;
    }
    const args = mapArgs(name, payload);
    mapped.set(name, { payload, args });
    return args;
  };
  const mapArgs = (name: GanttEventName, payload: unknown): readonly unknown[] | undefined => {
    const state = store.getSnapshot();
    const record = (id: TaskId): unknown => records.get(recordSource(state), id);
    const p = payload as Readonly<Record<string, unknown>>;
    switch (name) {
      case 'taskDatesChange': {
        const id = p.id as TaskId;
        const task = state.derived.model.taskById.get(id);
        const found = record(id);
        if (task === undefined || found === undefined) return undefined;
        const { model } = state.derived;
        // The precision the change gives the task (FR-SNAP-7), else the model's: controlled data
        // shows the owner's task until it applies the change.
        const precision = (p.precision as DatePrecision | undefined) ?? task.precision;
        const start = p.start as DateTimeMs;
        const dates = taskDates({ precision }, model, start, p.endExclusive as DateTimeMs);
        return [found, dates];
      }
      case 'taskProgressChange':
      case 'taskClick':
      case 'taskDoubleClick': {
        const found = record(p.id as TaskId);
        const second = name === 'taskProgressChange' ? p.progress : p.event;
        return found === undefined ? undefined : [found, second];
      }
      case 'taskHoverChange': {
        const id = p.id as TaskId | undefined;
        return [id === undefined ? null : (record(id) ?? null), p.event];
      }
      case 'linkCreate':
        return [p.link, p.id];
      case 'linkDelete':
        return [p.link];
      case 'linkClick': {
        const link = state.derived.graph.linkById.get(p.id as string);
        return link === undefined ? undefined : [link, p.event];
      }
      case 'selectionChange':
        return [p.selectedKeys, p.selectedLink];
      case 'viewModeChange':
        return [p.viewMode];
      case 'expandedChange':
        return [p.expandedKeys];
      case 'rangeChange': {
        const range = dateRange(p.start as DateTimeMs, p.end as DateTimeMs);
        return [Object.freeze({ ...range, reason: p.reason })];
      }
      case 'scroll':
        return [Object.freeze({ x: p.x, y: p.y, date: toDate(p.date as DateTimeMs) })];
      case 'tasksChange':
      case 'editRollback':
      case 'dirtyChange':
      case 'historyChange':
      case 'editRefused':
      case 'issues':
      case 'error':
        return [payload];
    }
  };
  const listenerOf =
    (name: GanttEventName, handler: AnyHandler) =>
    (payload: unknown): void => {
      const args = argsOf(name, payload);
      if (args !== undefined) handler(...args);
    };
  const setHandler = (key: string, fn: unknown): void => {
    const name = eventOfHandler(key);
    let value: unknown = fn;
    if (name !== undefined && typeof fn === 'function') value = listenerOf(name, fn as AnyHandler);
    controller.setHandlers({ [key]: value });
  };
  for (const [key, fn] of split.handlers) setHandler(key, fn);

  /** Queues a facade event; queued events are emitted when the operation ends (`flush`). */
  const queue = <K extends CoreEventName>(name: K, payload: CoreEvents[K]): void => {
    queued.push([name, Object.freeze(payload)]);
  };
  const emitQueued = (errors: unknown[]): void => {
    while (queued.length > 0) {
      const events = queued;
      queued = [];
      for (const [name, payload] of events) {
        if (destroyed) return;
        try {
          emitter.emit(name, payload as CoreEvents[CoreEventName]);
        } catch (error) {
          errors.push(error);
        }
      }
    }
  };
  const queueRange = (range: TimeRange, reason: RangeChangeReason): void => {
    queue('rangeChange', { start: range.start, end: range.end, reason });
  };

  // ---- operations and publishing ----

  /**
   * Runs an operation; when the outermost one ends, the facade's derived state is synced with
   * the store (timeline, selection, issues, events) and the snapshot published.
   */
  const batch = <T>(run: () => T, deferred = false): T => {
    depth++;
    let result: T;
    try {
      result = run();
    } catch (error) {
      depth--;
      if (depth === 0) {
        try {
          flush();
        } catch (also) {
          throw new AggregateError([error, also], 'the operation and its listeners threw', {
            cause: also,
          });
        }
      }
      throw error;
    }
    depth--;
    if (depth === 0) flush(deferred);
    return result;
  };

  /**
   * Syncs, emits, publishes. What listeners threw is thrown at the end, or, for `deferred` (the
   * renderer's input methods, whose result must reach the renderer after the state changed),
   * handed to the host's unhandled-rejection channel: nothing is swallowed, and nothing that
   * happened is lost with it.
   */
  const flush = (deferred = false): void => {
    if (destroyed) return;
    const errors: unknown[] = [];
    depth++;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const before = store.getSnapshot();
        const changed = sync();
        emitQueued(errors);
        if (!changed && store.getSnapshot() === before && queued.length === 0) break;
      }
    } finally {
      depth--;
    }
    publish(errors);
    if (errors.length === 0) return;
    if (deferred) reportLater(errors);
    else throwAll(errors);
  };

  /** Brings the facade's own state in line with the store; queues the events. */
  const sync = (): boolean => {
    if (destroyed) return false;
    const state = store.getSnapshot();
    const timelineChanged = syncTimeline(state);
    // A gesture in progress follows a new timeline, a vertical scroll and new data (FR-EDIT-6):
    // its preview is placed again under the still pointer, on the new model.
    if (
      timeline !== retimed.timeline ||
      scrollTop !== retimed.scrollTop ||
      state.derived.model !== retimed.model
    ) {
      retime();
    }
    const viewModeChanged = syncViewMode(state);
    const selectionChanged = syncSelection(state);
    syncIssues(state);
    syncScroll();
    return timelineChanged || viewModeChanged || selectionChanged;
  };

  const publish = (errors: unknown[]): void => {
    if (destroyed) return;
    const next = buildSnapshot();
    if (next === snapshot) return;
    snapshot = next;
    for (const entry of listeners) {
      if (!listeners.includes(entry)) continue;
      try {
        entry.listener();
      } catch (error) {
        errors.push(error);
      }
    }
  };

  const buildSnapshot = (): GanttSnapshot<TData> => {
    const state = store.getSnapshot();
    const shown = timelineNow();
    const { scale, range, scrollLeft, viewportWidth } = shown;
    const rows = rowsOf(state);
    const next: GanttSnapshot<TData> = {
      state,
      viewMode: viewModeOf(state),
      timeline: shown,
      contentWidth: scale.durationToPx(range.end - range.start),
      scrollTop,
      viewportHeight,
      header: headerOf(scale, current.locale ?? 'en'),
      layoutOptions: layoutSettings(state).options,
      layout: layoutOf(state),
      window: windowOf(scrollLeft, scrollTop, viewportWidth, viewportHeight, rows, scale),
      selection,
      feedback: feedbackOf(machine.feedback),
      editing: editingOf(current.editing),
      handles: handlesOf(current.interaction?.handles),
      now: nowMinute,
      autoScroll,
      busy: isBusy(state),
      scrollRequest,
    };
    return reuse(snapshot, next);
  };

  /** Re-publishes after an asynchronous operation of the controller settled. */
  const settled = (): void => {
    if (!destroyed && depth === 0) flush();
  };
  /**
   * Follows an operation of the controller: publishes when it settles. `rethrow`: nobody else
   * holds its promise (a gesture's commit), so a rejection is left unhandled, never swallowed.
   */
  const track = <T>(operation: Promise<T>, rethrow: boolean): void => {
    void operation.then(settled, (error: unknown) => {
      settled();
      if (rethrow) throw error;
    });
  };

  // ---- timeline ----

  /**
   * "Today" from the `now` option, else the system clock; every read also sets the minute the
   * snapshot shows (`GanttSnapshot.now`). A `now` that throws or returns an unreadable date is
   * reported as an option issue (with what it threw or returned) and the system clock is used.
   */
  const readNow = (): DateTimeMs => {
    const t = readClock();
    nowMinute = adapter.startOf(t, 'minute');
    return t;
  };
  const readClock = (): DateTimeMs => {
    const source = current.now;
    if (source !== undefined) {
      let value: unknown;
      let message: string;
      try {
        value = source();
        const parsed = parseDateInput(value as DateInput);
        if (parsed.ok) {
          if (optionIssues.has('now')) recordIssues(new Map([['now', []]]));
          return parsed.value.value;
        }
        message = DEV ? `returned an unreadable date (${parsed.issue.message})` : '';
      } catch (error) {
        value = error;
        message = DEV ? 'threw, the system clock is used' : '';
      }
      recordIssues(new Map([['now', [optionIssue('now', message, value)]]]));
    }
    const today = parseDateInput(new Date());
    return today.ok ? today.value.value : asDateTimeMs(0);
  };

  /**
   * Re-derives the timeline when the data, the view mode, the zoom or the timeline options
   * changed (FR-TL-1, FR-SCALE-6):
   * - before the mount nothing is shown: the range is the data's, the scroll is placed by
   *   `mount`;
   * - a fixed range follows the data and the options, the left edge date kept;
   * - the infinite timeline keeps its range for new data (it follows the viewport: growing it
   *   back to all tasks would undo the trims and feed lazy loading its own range), covers the
   *   new one for new options or a new scale, holds the anchored viewport (`fit`) and settles
   *   (`planExtension`) before anything is requested, so the content stays within `maxWidth`.
   *
   * Queues one `rangeChange` with the cause, and an instant request when the scale or the
   * offset changed.
   */
  const syncTimeline = (state: StoreState<TData>): boolean => {
    const { model } = state.derived;
    const viewMode = viewModeOf(state);
    if (zoom !== undefined && zoom.viewMode !== viewMode) zoom = undefined;
    const pxPerDay = zoom?.pxPerDay ?? viewMode.pxPerDay;
    const settings = timelineSettings(state);
    const direction = current.direction ?? 'ltr';
    const now = current.now;
    const modelOptions = state.settings.model;
    const last = synced;
    if (
      last?.model === model &&
      last.viewMode === viewMode &&
      last.pxPerDay === pxPerDay &&
      last.settings === settings &&
      last.direction === direction &&
      last.now === now
    ) {
      return false;
    }
    synced = { model, modelOptions, viewMode, pxPerDay, settings, direction, now };
    const planned = rebase;
    rebase = undefined;
    const columns = columnsOf(viewMode);
    const resolved = resolveRange({
      spans: spansOf(model),
      now: readNow(),
      explicit: settings.range,
      padding: settings.padding,
      includeToday: settings.includeToday,
      columns,
      adapter,
    });
    dataRange = resolved;
    const previous = timeline;
    if (previous === undefined || last === undefined || !mounted) {
      const scale = createTimeScale({ origin: resolved.start, pxPerDay, direction });
      const viewportWidth = previous?.viewportWidth ?? 0;
      const next = Object.freeze({ range: resolved, scale, scrollLeft: 0, viewportWidth });
      if (previous !== undefined && sameTimeline(next, previous)) return false;
      timeline = next;
      return true;
    }
    const scaled = last.viewMode !== viewMode || last.pxPerDay !== pxPerDay;
    const reason = syncReason(last, scaled, planned, {
      settings,
      direction,
      now,
      modelOptions,
    });
    const { infinite } = settings;
    let range = resolved;
    if (infinite !== undefined)
      range = reason === 'data' ? previous.range : cover(previous.range, resolved);
    let next = rebaseTimeline(previous, {
      range,
      pxPerDay,
      anchorX: scaled ? (planned?.anchorX ?? previous.viewportWidth / 2) : 0,
      columns,
      fit: infinite !== undefined,
      bounds: infinite?.bounds,
    });
    if (next.scale.direction !== direction) {
      const scale = createTimeScale({ origin: next.scale.origin, pxPerDay, direction });
      next = Object.freeze({ ...next, scale });
    }
    if (sameTimeline(next, previous)) return false;
    timeline = next;
    const extension = policy(state);
    settle(extension);
    const reset = planned?.reset === true;
    if (reset) {
      placeInitial();
      settle(extension);
    }
    const shown = timelineNow();
    if (shown.range.start !== previous.range.start || shown.range.end !== previous.range.end) {
      queueRange(shown.range, reason);
    }
    // Nothing to scroll when only the content width changed (a range grown at its end).
    if (reset || scaled || shown.scrollLeft !== previous.scrollLeft) {
      request({
        reason: reset ? 'view-mode' : reason,
        left: shown.scrollLeft,
        behavior: 'instant',
      });
    }
    return true;
  };

  /**
   * Runs the infinite timeline's policy to rest at the current offset (FR-TL-4): after a
   * rebase, a new range or a new viewport width, before anything is requested, so the content
   * never exceeds what the policy allows (`maxSpan`, `maxWidth`) and every edge the viewport is
   * near has grown. Each change keeps the date under the left edge (FR-TL-3).
   */
  const settle = (extension: ExtensionPolicy | undefined): void => {
    if (extension === undefined) return;
    for (let step = 0; step < SETTLE_STEPS; step++) {
      const change = planExtension(timelineNow(), extension);
      if (change === undefined) return;
      adopt(change);
    }
  };

  const syncViewMode = (state: StoreState<TData>): boolean => {
    const viewMode = viewModeOf(state);
    if (shownViewMode === undefined || viewMode === shownViewMode) {
      shownViewMode = viewMode;
      return false;
    }
    shownViewMode = viewMode;
    queue('viewModeChange', { viewMode });
    return true;
  };

  const syncSelection = (state: StoreState<TData>): boolean => {
    const { model, graph } = state.derived;
    if (pruned[0] === model && pruned[1] === graph) return false;
    pruned = [model, graph];
    const { link } = selection;
    return select(
      selection.tasks.filter((id) => model.taskById.has(id)),
      link !== undefined && graph.linkById.has(link) ? link : undefined,
    );
  };

  /**
   * Queues `issues` when a list changed: compared by identity first (O(1) while nothing was
   * recomputed), then by content, so a rebuilt model with the same problems reports nothing.
   */
  const syncIssues = (state: StoreState<TData>): void => {
    const { derived } = state;
    const data = dataIssuesOf(derived.model, derived.hierarchy, derived.graph);
    if (data !== shownIssues.data) {
      const key = keyOfIssues(data);
      if (key !== shownIssues.dataKey) queue('issues', { source: 'data', issues: data });
      shownIssues = { ...shownIssues, data, dataKey: key };
    }
    const options = currentOptionIssues(state);
    if (options !== shownIssues.options) {
      const key = keyOfIssues(options);
      if (key !== shownIssues.optionsKey) queue('issues', { source: 'options', issues: options });
      shownIssues = { ...shownIssues, options, optionsKey: key };
    }
  };

  const currentOptionIssues = (state: StoreState<TData>): readonly Issue[] => {
    const { derived, settings } = state;
    const timelineIssues = timelineSettingsOf(
      current.timeline,
      viewModeOf(state),
      current.dates?.endInclusive,
    ).issues;
    return optionIssuesOf(
      optionIssueList,
      settings.calendar.issues,
      qualify('viewModes', settings.viewModes.issues),
      derived.snap.issues,
      qualify('viewMode', derived.issues),
      qualify('layout', layoutSettings(state).issues),
      qualify('timeline', timelineIssues),
      qualify('scroll', scrollSettingsOf(current.scroll).issues),
    );
  };

  const syncScroll = (): void => {
    if (!mounted) return;
    const { scrollLeft, scale } = timelineNow();
    if (shownScroll?.x === scrollLeft && shownScroll.y === scrollTop) return;
    shownScroll = { x: scrollLeft, y: scrollTop };
    queue('scroll', { x: scrollLeft, y: scrollTop, date: scale.xToDate(scrollLeft) });
  };

  /**
   * Records a scroll request; an instant one is assumed done (the renderer reports it anyway).
   * An instant request has no `from` (its `left` is absolute). A smooth one gets `from` when the
   * range grew at its start (`input.from`), or when an earlier request moved the offset and the
   * renderer has not reported a position since: a renderer that applies only the latest request
   * of a frame then still starts the animation from the offset in the current coordinates.
   */
  const request = (input: RequestInput): ScrollRequest => {
    requestCount++;
    const instant = input.behavior === 'instant';
    const from = instant
      ? undefined
      : (input.from ?? (unconfirmed ? timelineNow().scrollLeft : undefined));
    const made: ScrollRequest = Object.freeze({
      id: requestCount,
      reason: input.reason,
      from,
      left: input.left,
      top: input.top,
      behavior: input.behavior,
    });
    scrollRequest = made;
    const left = instant ? input.left : from;
    if (left !== undefined) {
      timeline = withScrollLeft(timelineNow(), left);
      unconfirmed = true;
    }
    if (instant && input.top !== undefined) scrollTop = input.top;
    return made;
  };

  /** Applies a range change of the viewport math (its scale and compensated offset). */
  const adopt = (change: ViewportChange): void => {
    const { range, scale, scrollLeft, viewportWidth } = change;
    timeline = Object.freeze({ range, scale, scrollLeft, viewportWidth });
  };

  /**
   * Places the scroll of `scroll.initial` (at mount, or after `setViewMode(…, { keepScroll:
   * false })`) on the timeline: the infinite range grown around the target first. `'start'` and
   * `'end'` are the edges of the data range, not of a range the infinite timeline grew or
   * trimmed (FR-SCROLL-1). The caller settles and requests. `false` for `'none'`.
   */
  const placeInitial = (): boolean => {
    const state = store.getSnapshot();
    const scrolling = scrollSettings();
    const plan = resolveInitialScroll(scrolling.initial, {
      state: timelineNow(),
      range: dataRange,
      now: readNow(),
      spans: spansOf(state.derived.model),
      align: scrolling.align,
      infinite: policy(state) ?? false,
    });
    if (plan === undefined) return false;
    if (plan.change !== undefined) adopt(plan.change);
    timeline = withScrollLeft(timelineNow(), plan.scrollLeft);
    return true;
  };

  /**
   * A scroll plan applied: the range grown first (FR-TL-6), then the request. A plan whose
   * change cut the current view away (`jump`) is scrolled to instantly, without `from`: a
   * smooth scroll would start from an unrelated place, and the extensions and trims on its way
   * could cut the target away.
   */
  const scrollBy = (
    plan: ScrollPlan & { readonly scrollTop?: number },
    behavior: ScrollBehaviorOption,
  ): ScrollRequest => {
    const { change, jump } = plan;
    let from: number | undefined;
    if (change !== undefined) {
      adopt(change);
      queueRange(change.range, change.reason);
      if (change.shift !== 0) from = change.scrollLeft;
    }
    return request({
      reason: 'scroll-to',
      from: jump ? undefined : from,
      left: plan.scrollLeft,
      top: plan.scrollTop,
      behavior: jump ? 'instant' : behavior,
    });
  };

  /**
   * Sends a `timeline` event to a gesture in progress, so the dragged bar stays in place and a
   * link preview hit-tests the content under the still pointer (`InteractionContext.scrollTop`).
   */
  const retime = (): void => {
    retimed = { timeline, model: store.getSnapshot().derived.model, scrollTop };
    if (machine.feedback.phase === 'idle') return;
    apply(machine.send({ type: 'timeline' }, context()));
  };

  /**
   * The viewport width changed after the mount: the infinite timeline settles for it (FR-TL-2),
   * so a widened chart is never left half blank; an instant request compensates a grown start.
   */
  const resized = (previous: TimelineState): ScrollRequest | undefined => {
    settle(policy(store.getSnapshot()));
    const shown = timelineNow();
    if (shown.range.start !== previous.range.start || shown.range.end !== previous.range.end) {
      queueRange(shown.range, 'resize');
    }
    if (shown.scrollLeft === previous.scrollLeft) return undefined;
    return request({ reason: 'resize', left: shown.scrollLeft, behavior: 'instant' });
  };

  // ---- interaction ----

  const apply = (effects: readonly InteractionEffect[]): RendererEffect[] => {
    const out: RendererEffect[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case 'preview':
          controller.preview(effect.changeSet);
          break;
        case 'cancel-preview':
          controller.cancelPreview();
          break;
        case 'commit':
          track(controller.commit(effect.changeSet), true);
          break;
        case 'create-link':
          track(controller.createLink(effect.link), true);
          break;
        case 'click':
        case 'double-click':
          click(effect.type, effect.target, effect.event);
          break;
        case 'extend-range':
          extendForDrag(effect.target);
          break;
        case 'refused': {
          const { gesture, id, target, reason, at } = effect;
          queue('editRefused', { gesture, id, target, reason, at });
          break;
        }
        case 'autoscroll':
          autoScroll = effect.velocity;
          out.push(effect);
          break;
        case 'link-preview':
        case 'feedback':
          out.push(effect);
          break;
      }
    }
    return out;
  };

  const click = (type: 'click' | 'double-click', target: HitTarget, event: unknown): void => {
    if (target.kind === 'link') {
      if (type !== 'click') return;
      const { graph } = store.getSnapshot().derived;
      if (!graph.linkById.has(target.id)) return;
      select(selection.tasks, target.id);
      queue('linkClick', { id: target.id, event });
      return;
    }
    select(selection.tasks, undefined);
    if (target.kind === 'task') {
      queue(type === 'click' ? 'taskClick' : 'taskDoubleClick', { id: target.id, event });
    }
  };

  const extendForDrag = (target: TimeRange): void => {
    const extension = policy(store.getSnapshot());
    if (extension === undefined || !mounted) return;
    const change = ensureContains(timelineNow(), target, extension);
    if (change === undefined) return;
    adopt(change);
    queueRange(change.range, 'drag');
    if (change.shift !== 0)
      request({ reason: 'drag', left: change.scrollLeft, behavior: 'instant' });
  };

  const cancelGesture = (): void => {
    if (machine.feedback.phase !== 'idle') apply(machine.send({ type: 'cancel' }, context()));
  };

  const trackHover = (event: InteractionEvent): void => {
    const { hover } = machine.feedback;
    const id = hover.kind === 'task' ? hover.id : undefined;
    if (id === hovered) return;
    hovered = id;
    const source = event.type === 'down' || event.type === 'move' || event.type === 'up';
    queue('taskHoverChange', { id, event: source ? event.event : undefined });
  };

  // ---- selection ----

  /** Sets the selection; queues `selectionChange` and returns `true` when it changed. */
  const select = (tasks: readonly TaskId[], link: string | undefined): boolean => {
    const same =
      link === selection.link &&
      tasks.length === selection.tasks.length &&
      tasks.every((id, i) => id === selection.tasks[i]);
    if (same) return false;
    const selectedKeys = Object.freeze([...tasks]);
    selection = Object.freeze({ tasks: selectedKeys, link });
    queue('selectionChange', { selectedKeys, selectedLink: link });
    return true;
  };

  // ---- rows ----

  const changeExpanded = (
    command:
      | { readonly type: 'setExpanded'; readonly id: TaskId; readonly expanded: boolean }
      | { readonly type: 'expandAll' }
      | { readonly type: 'collapseAll' },
  ): void => {
    if (destroyed) return;
    batch(() => {
      const before = store.getSnapshot().expandedKeys;
      store.dispatch(command);
      queueExpanded(before);
    });
  };
  const queueExpanded = (before: StoreExpandedKeys): void => {
    const expandedKeys = store.getSnapshot().expandedKeys;
    if (expandedKeys !== before) queue('expandedChange', { expandedKeys });
  };

  // ---- options ----

  const applyOptions = (checked: CheckedOptions): void => {
    recordIssues(checked.issues);
    const { values } = checked;
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    const targets = targetsOf(keys);
    const { options: changes, handlers } = splitValues(values);
    const before = current;
    current = mergeOptions(current, changes);
    if (targets.has('interaction') && current.interaction !== before.interaction) {
      cancelGesture();
      machine = createInteraction(interactionOptions(current.interaction));
    }
    if (targets.has('store')) {
      // One command for the data and the data options: the store derives once, and sessions
      // and the history see one owner change.
      const command: { -readonly [K in keyof SetDataCommand<TData>]: SetDataCommand<TData>[K] } = {
        type: 'setData',
      };
      const storePatch = storeOptionsOf(changes);
      if (Object.keys(storePatch).length > 0) command.options = storePatch;
      if ('tasks' in values) command.tasks = values.tasks as readonly Task<TData>[];
      if ('links' in values) command.links = values.links as readonly Link[] | undefined;
      if (Object.keys(command).length > 1) controller.update(command);
    }
    const keysBefore = before.hierarchy?.expandedKeys;
    const keysNow = current.hierarchy?.expandedKeys;
    if (targets.has('rows') && keysNow !== keysBefore) {
      store.dispatch({ type: 'setExpandedKeys', keys: keysNow ?? 'all' });
    }
    if (targets.has('view-mode') && current.viewMode !== before.viewMode) {
      store.dispatch({ type: 'setViewMode', id: current.viewMode ?? 'day' });
    }
    if (targets.has('history') && current.history !== before.history) {
      history.configure(historySettings(current.history));
    }
    for (const [key, fn] of handlers) setHandler(key, fn);
    // The machine reads `editing` and `scroll.autoScroll` from its context on every event: tell
    // a gesture in progress now, so a forbidden edit or a stopped autoscroll takes effect at once
    // rather than with the next pointer event.
    if (current.editing !== before.editing || current.scroll !== before.scroll) retime();
  };

  // ---- updateTask ----

  const prepareUpdate = (
    id: TaskId,
    update: TaskUpdate,
  ):
    | UpdateRejectedResult
    | { readonly changeSet: ChangeSet; readonly issues: readonly ChangeSetIssue[] } => {
    const { derived, settings } = store.getSnapshot();
    const { model, hierarchy, graph } = derived;
    const task = model.taskById.get(id);
    if (task?.span === undefined) return rejectUpdate('unknown-task', NO_ISSUES);
    if (!isRecord(update)) {
      const message = DEV ? `${show(update)} is not an update` : '';
      const found = changeIssue('invalid-change', '', message, update, id);
      return rejectUpdate('invalid-value', [found]);
    }
    const dated = task as TaskModel & { readonly span: TaskSpan };
    const read = readUpdate(dated, update, model, settings.propagation.keepDayPrecision);
    const refused = read.notes.filter((note) => note.severity === 'error');
    if (read.errors.length > 0 || refused.length > 0) {
      return rejectUpdate('invalid-value', Object.freeze([...read.errors, ...read.notes]));
    }
    const { start, endExclusive, progress } = read;
    const { span } = task;
    const before = { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
    /** The edited task's change; values left out keep their current value. */
    const direct = (after: {
      readonly [K in keyof typeof before]?: (typeof before)[K] | undefined;
    }): ChangeSet['changes'][number] =>
      Object.freeze({
        id,
        before: Object.freeze(before),
        after: Object.freeze({
          start: after.start ?? before.start,
          endExclusive: after.endExclusive ?? before.endExclusive,
          progress: after.progress ?? before.progress,
        }),
        cause: 'direct' as const,
      });
    let command: PropagationCommand | undefined;
    if (start !== undefined && endExclusive !== undefined) {
      command = { kind: 'reschedule', id, start, endExclusive };
    } else if (start !== undefined) command = { kind: 'move', id, start };
    else if (endExclusive !== undefined) command = { kind: 'resize-end', id, endExclusive };
    const changes: ChangeSet['changes'][number][] = [];
    let propagated: ChangeSet | undefined;
    if (task.task.locked === true && (command !== undefined || progress !== undefined)) {
      // `propagate` never moves a locked task: the change goes to the commit as given, which
      // drops it with a `'locked-task'` issue, for dates as for progress.
      changes.push(direct({ start, endExclusive, progress }));
    } else {
      const options = {
        ...settings.propagation,
        skipNonWorkingDays: { move: false, resize: false },
      };
      if (command !== undefined) {
        propagated = propagate(command, { model, hierarchy, graph, options });
        changes.push(...propagated.changes);
      }
      if (progress !== undefined) changes[0] = direct({ ...changes[0]?.after, progress });
    }
    const changeSet: ChangeSet = Object.freeze({
      reason: 'api',
      changes: Object.freeze(changes),
      conflicts: propagated?.conflicts ?? Object.freeze([]),
    });
    return { changeSet, issues: read.notes };
  };

  // ---- the instance ----

  // The store changes only inside the facade's own operations, which publish when they end, and
  // inside the controller's asynchronous ones, which `track` follows: no store subscription.
  batch(() => undefined);

  const core: GanttCore<TData> = {
    setTasks: (tasks: readonly Task<TData>[]): void => {
      if (!destroyed) batch(() => applyOptions(checkOptions({ tasks }, false)));
    },
    setLinks: (links: readonly Link[] | undefined): void => {
      if (!destroyed) batch(() => applyOptions(checkOptions({ links }, false)));
    },
    updateTask: (id: TaskId, update: TaskUpdate): Promise<UpdateTaskResult> => {
      if (destroyed) return Promise.resolve(DISPOSED);
      return batch((): Promise<UpdateTaskResult> => {
        // Refused before anything is read or reported, like the controller refuses a commit.
        if (isBusy(store.getSnapshot())) return Promise.resolve(BUSY);
        const prepared = prepareUpdate(id, update);
        if ('status' in prepared) {
          if (prepared.issues.length > 0) {
            queue('issues', { source: 'change-set', issues: prepared.issues });
          }
          return Promise.resolve(prepared);
        }
        const { changeSet, issues } = prepared;
        if (issues.length > 0) queue('issues', { source: 'change-set', issues });
        const operation = controller.commit(changeSet);
        track(operation, false);
        return operation.then((result) => withIssues(result, issues));
      });
    },
    addLink: (link: Link): Promise<LinkCreateResult> => {
      if (destroyed) return Promise.resolve(DISPOSED);
      if (!isRecord(link)) return Promise.resolve(NO_TASK);
      return batch(() => {
        const operation = controller.createLink(link);
        track(operation, false);
        return operation;
      });
    },
    removeLink: (id: string): Promise<LinkDeleteResult> => {
      if (destroyed) return Promise.resolve(DISPOSED);
      return batch(() => {
        const operation = controller.deleteLink(id);
        track(operation, false);
        return operation;
      });
    },
    setOptions: (patch: GanttCoreOptionsPatch<TData>): readonly Issue[] => {
      if (!destroyed) batch(() => applyOptions(checkOptions(patch, false)));
      return currentOptionIssues(store.getSnapshot());
    },
    setViewMode: (id: string, viewOptions: SetViewModeOptions = {}): ScrollRequest | undefined => {
      if (destroyed || typeof id !== 'string') return undefined;
      return batch(() => {
        const made = scrollRequest;
        const anchor = isRecord(viewOptions) ? viewOptions : {};
        rebase = { reason: 'view-mode', anchorX: undefined, reset: anchor.keepScroll === false };
        current = mergeOptions(current, { viewMode: id });
        store.dispatch({ type: 'setViewMode', id });
        syncTimeline(store.getSnapshot());
        rebase = undefined;
        return scrollRequest === made ? undefined : scrollRequest;
      });
    },
    zoomTo: (pxPerDay: number, zoomOptions: ZoomToOptions = {}): ScrollRequest | undefined => {
      if (destroyed || !(isFiniteNumber(pxPerDay) && pxPerDay > 0)) return undefined;
      return batch(() => {
        const made = scrollRequest;
        const state = store.getSnapshot();
        const anchorX = isRecord(zoomOptions) ? zoomOptions.anchor : undefined;
        zoom = { viewMode: viewModeOf(state), pxPerDay };
        rebase = {
          reason: 'zoom',
          anchorX: isFiniteNumber(anchorX) ? anchorX : undefined,
          reset: false,
        };
        syncTimeline(state);
        rebase = undefined;
        return scrollRequest === made ? undefined : scrollRequest;
      });
    },
    scrollToDate: (
      date: DateInput,
      scrollOptions?: ScrollToDateOptions,
    ): ScrollRequest | undefined => {
      if (destroyed) return undefined;
      const parsed = parseDateInput(date);
      if (!parsed.ok) return undefined;
      return scrollTo({ kind: 'date', t: parsed.value.value, options: scrollOptions });
    },
    scrollToToday: (scrollOptions?: ScrollToDateOptions): ScrollRequest | undefined =>
      destroyed ? undefined : scrollTo({ kind: 'date', t: 'today', options: scrollOptions }),
    scrollToTask: (id: TaskId, scrollOptions?: ScrollToTaskOptions): ScrollRequest | undefined =>
      destroyed ? undefined : scrollTo({ kind: 'task', id, options: scrollOptions }),
    expand: (id: TaskId): void => {
      changeExpanded({ type: 'setExpanded', id, expanded: true });
    },
    collapse: (id: TaskId): void => {
      changeExpanded({ type: 'setExpanded', id, expanded: false });
    },
    expandAll: (): void => {
      changeExpanded({ type: 'expandAll' });
    },
    collapseAll: (): void => {
      changeExpanded({ type: 'collapseAll' });
    },
    select: (ids: readonly TaskId[]): void => {
      if (destroyed) return;
      batch(() => {
        const { taskById } = store.getSnapshot().derived.model;
        const list = Array.isArray(ids) ? (ids as readonly unknown[]) : [];
        const known = [...new Set(list)].filter((id): id is TaskId => taskById.has(id as TaskId));
        select(known, selection.link);
      });
    },
    selectLink: (id: string | undefined): void => {
      if (destroyed) return;
      batch(() => {
        const { linkById } = store.getSnapshot().derived.graph;
        select(selection.tasks, id !== undefined && linkById.has(id) ? id : undefined);
      });
    },
    clearSelection: (): void => {
      if (!destroyed) batch(() => select([], undefined));
    },
    edit: Object.freeze({
      begin: () => batch(() => session.begin()),
      commit: () => batch(() => session.commit()),
      rollback: () =>
        batch(() => {
          cancelGesture();
          return session.rollback();
        }),
      getChanges: () => session.getChanges(),
      get isOpen(): boolean {
        return session.isOpen;
      },
      get isDirty(): boolean {
        return session.isDirty;
      },
    }),
    undo: (): HistoryResult => step('undo'),
    redo: (): HistoryResult => step('redo'),
    get canUndo(): boolean {
      return history.canUndo;
    },
    get canRedo(): boolean {
      return history.canRedo;
    },
    on: <K extends GanttEventName>(name: K, handler: GanttEventMap<TData>[K]): Unsubscribe => {
      if (destroyed || typeof handler !== 'function') return () => undefined;
      const off = emitter.on(name, listenerOf(name, handler as AnyHandler));
      return off;
    },
    setViewport: (size: ViewportSize): ScrollRequest | undefined => {
      if (destroyed || !isRecord(size)) return undefined;
      const { width, height } = size;
      if (!isSize(width) || !isSize(height)) return undefined;
      return batch(() => {
        viewportHeight = height;
        const shown = timelineNow();
        if (shown.viewportWidth === width) return undefined;
        timeline = Object.freeze({ ...shown, viewportWidth: width });
        if (mounted) return resized(shown);
        return width > 0 ? mount() : undefined;
      }, true);
    },
    scroll: (position: ScrollPosition): ViewportChange | undefined => {
      if (destroyed || !isRecord(position)) return undefined;
      return batch(() => {
        const { left, top } = position;
        if (isFiniteNumber(top)) scrollTop = top;
        let change: ViewportChange | undefined;
        if (isFiniteNumber(left)) {
          // The renderer's own position: every earlier request is applied or superseded.
          unconfirmed = false;
          timeline = withScrollLeft(timelineNow(), left);
          const extension = mounted ? policy(store.getSnapshot()) : undefined;
          change = extension === undefined ? undefined : planExtension(timelineNow(), extension);
          if (change !== undefined) {
            adopt(change);
            queueRange(change.range, change.reason);
          }
        }
        retime();
        return change;
      }, true);
    },
    send: (event: InteractionEvent): readonly RendererEffect[] => {
      if (destroyed || !isRecord(event)) return NO_EFFECTS;
      return batch(() => {
        const effects = apply(machine.send(event, context()));
        trackHover(event);
        return Object.freeze(effects);
      }, true);
    },
    refreshNow: (): void => {
      if (destroyed) return;
      // The snapshot keeps its identity unless the minute moved (`reuse`), so listeners hear of
      // a tick only when something a renderer shows changed.
      batch(() => {
        readNow();
      }, true);
    },
    getSnapshot: (): GanttSnapshot<TData> => {
      snapshot ??= buildSnapshot();
      return snapshot;
    },
    subscribe: (listener: () => void): Unsubscribe => {
      if (destroyed) return () => undefined;
      const entry = { listener };
      listeners = [...listeners, entry];
      return () => {
        listeners = listeners.filter((other) => other !== entry);
      };
    },
    getTask: (id: TaskId) => records.get(recordSource(store.getSnapshot()), id),
    getLink: (id: string) => store.getSnapshot().derived.graph.linkById.get(id),
    getVisibleRange: (): DateRange => {
      const { scale, scrollLeft, viewportWidth } = timelineNow();
      return dateRange(scale.xToDate(scrollLeft), scale.xToDate(scrollLeft + viewportWidth));
    },
    getRowMetrics: (id: TaskId) => rowsOf(store.getSnapshot()).rowOf(id),
    getBarRect: (id: TaskId) => layoutOf(store.getSnapshot()).getBarRect(id),
    getIssues: (): GanttIssues => {
      const state = store.getSnapshot();
      const { derived } = state;
      return Object.freeze({
        data: dataIssuesOf(derived.model, derived.hierarchy, derived.graph),
        options: currentOptionIssues(state),
      });
    },
    destroy: (): void => {
      if (destroyed) return;
      destroyed = true;
      controller.dispose();
      session.dispose();
      history.dispose();
      emitter.clear();
      listeners = [];
      queued = [];
    },
  };

  /**
   * The first non-zero width (FR-SCROLL-1, FR-TL-2): the initial scroll is placed on the data
   * range as resolved (so `'start'` / `'end'` are the data's edges), then the infinite timeline
   * settles at that offset, and the final picture is requested. `'none'` requests nothing unless
   * settling moved the offset.
   */
  function mount(): ScrollRequest | undefined {
    mounted = true;
    // A scroll the application asked for before the chart had a width takes the place of
    // `scroll.initial`, unless it cannot be placed (a task that is not there).
    const plan = intent === undefined ? undefined : planIntent(intent);
    intent = undefined;
    if (plan?.change !== undefined) adopt(plan.change);
    if (plan !== undefined) timeline = withScrollLeft(timelineNow(), plan.scrollLeft);
    const placed = plan !== undefined || placeInitial();
    settle(policy(store.getSnapshot()));
    const shown = timelineNow();
    queueRange(shown.range, 'initial');
    if (!placed && shown.scrollLeft === 0) return undefined;
    return request({
      reason: 'initial',
      left: shown.scrollLeft,
      top: plan?.scrollTop,
      behavior: 'instant',
    });
  }

  /**
   * A scroll the application asks for (`scrollToDate`, `scrollToToday`, `scrollToTask`): a
   * request now, or, while the chart has no width to place it on, the one scroll the mount
   * performs. The latest call before the mount wins.
   */
  function scrollTo(want: ScrollIntent): ScrollRequest | undefined {
    if (!mounted) {
      intent = want;
      return undefined;
    }
    return batch(() => {
      const plan = planIntent(want);
      const chosen = isRecord(want.options) ? want.options : {};
      return plan && scrollBy(plan, behaviorOf(chosen.behavior, scrollSettings().behavior));
    });
  }

  /** Where a {@link ScrollIntent} goes on the timeline now; `undefined` for a task that is not there. */
  function planIntent(
    want: ScrollIntent,
  ): (ScrollPlan & { readonly scrollTop?: number }) | undefined {
    const settings = scrollSettings();
    if (want.kind === 'date') {
      const given = isRecord(want.options) ? want.options : {};
      return planScrollTo(want.t === 'today' ? readNow() : want.t, timelineNow(), {
        align: alignOf(given.align, settings.align),
        infinite: policy(store.getSnapshot()) ?? false,
      });
    }
    const given = isRecord(want.options) ? want.options : {};
    if (given.expand !== false) expandAncestors(want.id);
    const state = store.getSnapshot();
    const layout = layoutOf(state);
    const align = alignOf(given.align, settings.align);
    return planTaskScroll(want.id, layout, timelineNow(), {
      align,
      alignY: alignOf(given.alignY, align),
      viewportHeight: Math.max(viewportHeight - layout.rows.headerHeight, 0),
      infinite: policy(state) ?? false,
    });
  }

  function expandAncestors(id: TaskId): void {
    const state = store.getSnapshot();
    const { nodeById } = state.derived.hierarchy;
    const ancestors: TaskId[] = [];
    for (let node = nodeById.get(id); node?.parentId !== undefined;) {
      ancestors.unshift(node.parentId);
      node = nodeById.get(node.parentId);
    }
    const before = state.expandedKeys;
    for (const ancestor of ancestors) {
      store.dispatch({ type: 'setExpanded', id: ancestor, expanded: true });
    }
    queueExpanded(before);
  }

  function step(direction: 'undo' | 'redo'): HistoryResult {
    if (destroyed) return DISPOSED;
    return batch(() => {
      cancelGesture();
      return direction === 'undo' ? history.undo() : history.redo();
    });
  }

  return Object.freeze(core);
}

/** Splits checked values into options (without the data) and option-style handlers. */
function splitValues(values: Readonly<Record<string, unknown>>): {
  readonly options: Readonly<Record<string, unknown>>;
  readonly handlers: readonly (readonly [string, unknown])[];
} {
  const options: Record<string, unknown> = {};
  const handlers: [string, unknown][] = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === 'tasks' || key === 'links') continue;
    if (key.startsWith('on')) handlers.push([key, value]);
    else options[key] = value;
  }
  return { options, handlers };
}

/** The store's part of an option patch; only the keys given (a key set to `undefined` resets). */
function storeOptionsOf(values: Readonly<Record<string, unknown>>): StoreOptions {
  const patch: Record<string, unknown> = {};
  for (const key of ['dataMode', 'calendar', 'dates', 'scheduling', 'viewModes'] as const) {
    if (key in values) patch[key] = values[key];
  }
  if ('hierarchy' in values) {
    const group = values.hierarchy;
    if (isRecord(group)) {
      const { expandedKeys: _ui, ...data } = group;
      if (Object.keys(data).length > 0) patch.hierarchy = data;
    } else patch.hierarchy = undefined;
  }
  return patch;
}

/** The history settings of the `history` option. */
function historySettings(option: HistoryOption | undefined): HistorySettings {
  if (option === undefined || typeof option === 'boolean') return { enabled: option === true };
  return { enabled: option.enabled !== false, limit: option.limit };
}

function interactionOptions(option: InteractionOptions | undefined): InteractionOptions {
  return option ?? {};
}

/** The tasks' spans for the range (rows without a bar are skipped by `resolveRange`). */
function spansOf(model: NormalizedModel): readonly (TaskSpan | undefined)[] {
  return model.tasks.map((task) => task.span);
}

/**
 * Why the timeline is re-derived: a new scale (`'view-mode'`, or `'zoom'` from `zoomTo`), new
 * timeline options, `now`, `direction` or model options (`'options'`, also when the data changed
 * with them), else new data.
 */
function syncReason(
  last: Synced,
  scaled: boolean,
  planned: PendingRebase | undefined,
  next: Pick<Synced, 'settings' | 'direction' | 'now' | 'modelOptions'>,
): SyncReason {
  if (scaled) return planned?.reason ?? 'view-mode';
  const options =
    last.settings !== next.settings ||
    last.direction !== next.direction ||
    last.now !== next.now ||
    last.modelOptions !== next.modelOptions;
  return options ? 'options' : 'data';
}

/** The smallest range containing both. */
function cover(a: TimeRange, b: TimeRange): TimeRange {
  if (a.start <= b.start && a.end >= b.end) return a;
  return Object.freeze({
    start: asDateTimeMs(Math.min(a.start, b.start)),
    end: asDateTimeMs(Math.max(a.end, b.end)),
  });
}

function sameTimeline(a: TimelineState, b: TimelineState): boolean {
  return (
    a.range.start === b.range.start &&
    a.range.end === b.range.end &&
    a.scale.origin === b.scale.origin &&
    a.scale.pxPerDay === b.scale.pxPerDay &&
    a.scale.direction === b.scale.direction &&
    a.scrollLeft === b.scrollLeft &&
    a.viewportWidth === b.viewportWidth
  );
}

function withScrollLeft(state: TimelineState, scrollLeft: number): TimelineState {
  return state.scrollLeft === scrollLeft ? state : Object.freeze({ ...state, scrollLeft });
}

function visibleWindowOf(
  scrollLeft: number,
  scrollTop: number,
  width: number,
  height: number,
  rows: RowLayout,
  scale: TimeScale,
): ReturnType<typeof visibleWindow> {
  return visibleWindow({ scrollLeft, scrollTop, width, height }, rows, scale);
}

/** The draft over the model as a bar lookup: a dragged bar is drawn at its preview. */
function lookupOf<TData>(model: NormalizedModel<TData>, draft: Draft | undefined): BarLookup {
  if (draft === undefined) return model.taskById;
  const { calendar, granularity } = model.options;
  return {
    get: (id: TaskId): BarSource | undefined => {
      const task = model.taskById.get(id);
      const patch = draft.patches.get(id);
      if (task?.span === undefined || patch === undefined) return task;
      const { start, endExclusive, progress } = patch;
      const mode = task.durationMode;
      const progressDate = progressToDate({
        start,
        endExclusive,
        progress,
        mode,
        calendar,
        granularity,
      });
      return { type: task.type, span: { start, endExclusive, progressDate } };
    },
  };
}

function alignOf(value: unknown, fallback: ScrollAlign): ScrollAlign {
  if (ALIGN_KEYWORDS.has(value)) return value as ScrollAlign;
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback;
}

function behaviorOf(value: unknown, fallback: ScrollBehaviorOption): ScrollBehaviorOption {
  return BEHAVIORS.has(value) ? (value as ScrollBehaviorOption) : fallback;
}

/**
 * A content key of an issue list, to emit `issues` only when the list changed (`docs/api.md`
 * §5): code, severity, path, the task and link ids, `value` and `suggested` (by content, objects
 * by kind). The message is left out: its text differs between the development and production
 * builds, which must see the same changes, and it says nothing these fields do not.
 *
 * @internal
 */
export function keyOfIssues(issues: readonly Issue[]): string {
  return issues
    .map((found) => {
      const { taskIds, linkIds } = found as {
        readonly taskIds?: readonly unknown[];
        readonly linkIds?: readonly unknown[];
      };
      return [
        found.code,
        found.severity,
        found.path ?? '',
        String(found.taskId ?? ''),
        found.linkId ?? '',
        keyOfValue(found.value),
        keyOfValue(found.suggested),
        keyOfValue(taskIds),
        keyOfValue(linkIds),
      ].join('\u0001');
    })
    .join('\u0002');
}

/**
 * A value in an issue key: primitives and dates by content, the items of an array one level
 * deep (cycle members, anchors), other objects by kind.
 */
function keyOfValue(value: unknown): string {
  if (!Array.isArray(value)) return keyOfItem(value);
  const items: readonly unknown[] = value;
  return `[${items.map((item) => (Array.isArray(item) ? 'array' : keyOfItem(item))).join(',')}]`;
}

function keyOfItem(value: unknown): string {
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (typeof value === 'object' && value !== null) return 'object';
  return typeof value === 'function' ? 'function' : `${typeof value}:${String(value)}`;
}

/**
 * Memoizes a function on the identity of its arguments (the last call only).
 *
 * @internal
 */
export function memoize<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { readonly args: A; readonly result: R } | undefined;
  return (...args: A): R => {
    if (last?.args.length === args.length && last.args.every((arg, i) => Object.is(arg, args[i]))) {
      return last.result;
    }
    const result = fn(...args);
    last = { args, result };
    return result;
  };
}

function throwAll(errors: readonly unknown[]): never {
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, `${errors.length} listeners threw`);
}

/**
 * Hands errors to the host's unhandled-rejection channel instead of throwing them: one as it is
 * (an `Error`), several, or one that is not an `Error`, as an `AggregateError`.
 */
function reportLater(errors: readonly unknown[]): void {
  const [only] = errors;
  void Promise.reject(
    errors.length === 1 && only instanceof Error
      ? only
      : new AggregateError(errors, `${errors.length} listeners threw`),
  );
}

/** The parsed values of an update, or why it is refused. */
interface ReadUpdate {
  /** Unreadable values and an end not after the start (the update is refused with them). */
  readonly errors: readonly Issue[];
  readonly start: DateTimeMs | undefined;
  readonly endExclusive: DateTimeMs | undefined;
  readonly progress: number | undefined;
  /** Corrections (`'misaligned'`), and with `alignInput: 'reject'` the refusals. */
  readonly notes: readonly ChangeSetIssue[];
}

/**
 * Reads `updateTask`'s values for a task the way `normalizeModel` reads the task's own
 * (FR-TIME-8, FR-SNAP-13): dates parsed; a date-only `end` is the inclusive last day with
 * `endInclusive`, unless the task's `precision: 'time'` makes every value a moment; an end that
 * is not after the start (the current start for `end` alone; a milestone may end at its start)
 * is refused with `'end-before-start'`; dates are aligned to the task's step per `alignInput`,
 * with `'misaligned'` issues; progress is checked. The step is a whole day for a day-precision
 * task, unless `keepDayPrecision` is off (FR-SNAP-7): then it is the granularity, and a value off
 * midnight makes the task timed (`propagate` records that in the change), so the suggestion of
 * a misaligned value is written in the precision the task gets.
 */
function readUpdate(
  task: TaskModel & { readonly span: TaskSpan },
  update: TaskUpdate,
  model: NormalizedModel,
  keepDayPrecision: boolean | undefined,
): ReadUpdate {
  const errors: Issue[] = [];
  const notes: ModelIssue[] = [];
  const { options } = model;
  const { precision } = task;
  const free = precision === 'day' && keepDayPrecision === false;
  const step = precision === 'day' && !free ? DEFAULT_GRANULARITY : options.granularity;
  const parse = (value: DateInput | undefined, path: 'start' | 'end'): ParsedDate | undefined => {
    if (value === undefined) return undefined;
    const parsed = parseDateInput(value, { path });
    if (parsed.ok) return parsed.value;
    errors.push(Object.freeze({ ...parsed.issue, taskId: task.id }));
    return undefined;
  };
  /** Reports a misaligned value; suggested in the semantics of the input, as normalization does. */
  const report = (
    t: number,
    aligned: DateTimeMs,
    path: 'start' | 'end',
    value: unknown,
    after: DatePrecision,
  ): void => {
    if (aligned === t) return;
    const inclusive = path === 'end' && after === 'day' && options.endInclusive;
    const suggested = isoText(asDateTimeMs(inclusive ? aligned - DAY : aligned), after);
    const owner = { taskId: task.id };
    reportMisaligned(notes, path, owner, step, options.alignInput, value, suggested);
  };
  const startAt = parse(update.start, 'start');
  const endAt = parse(update.end, 'end');
  let end: number | undefined;
  if (endAt !== undefined) {
    const inclusive =
      options.endInclusive && endAt.precision === 'day' && task.task.precision !== 'time';
    end = inclusive ? endAt.value + DAY : endAt.value;
    const from = startAt?.value ?? task.span.start;
    if (task.type === 'milestone' ? end < from : end <= from) {
      const message = DEV ? `${show(update.end)} is not after the start` : '';
      errors.push(changeIssue('end-before-start', 'end', message, update.end, task.id));
    }
  }
  const { alignInput } = options;
  const start = startAt && alignTo(startAt.value, step, alignInput, true);
  const endExclusive = end === undefined ? undefined : alignTo(end, step, alignInput, false);
  // The precision the task gets: a day task without `keepDayPrecision` is timed off midnight.
  const offMidnight = (t: number | undefined): boolean => t !== undefined && t % DAY !== 0;
  const after = free && (offMidnight(start) || offMidnight(endExclusive)) ? 'time' : precision;
  if (startAt !== undefined && start !== undefined) {
    report(startAt.value, start, 'start', update.start, after);
  }
  if (end !== undefined && endExclusive !== undefined) {
    report(end, endExclusive, 'end', update.end, after);
  }
  let progress: number | undefined;
  const given: unknown = update.progress;
  if (isFiniteNumber(given)) progress = given;
  else if (given !== undefined) {
    const message = DEV ? `${show(given)} is not a number` : '';
    errors.push(changeIssue('invalid-change', 'progress', message, given, task.id));
  }
  // `'misaligned'` is a code of both lists: the notes are change-set issues of the update.
  const changeNotes = notes as readonly Issue[] as readonly ChangeSetIssue[];
  return { errors, start, endExclusive, progress, notes: changeNotes };
}

function changeIssue(
  code: ChangeSetIssueCode,
  path: string,
  message: string,
  value: unknown,
  taskId: TaskId,
): ChangeSetIssue {
  const found: ChangeSetIssue = {
    code,
    severity: 'error',
    message: !DEV ? shortMessage(code, path) : path === '' ? message : `${path}: ${message}`,
    taskId,
    value,
    ...(path === '' ? {} : { path }),
  };
  return Object.freeze(found);
}

function rejectUpdate(
  reason: UpdateRejectedResult['reason'],
  issues: readonly Issue[],
): UpdateRejectedResult {
  return Object.freeze({ status: 'rejected', reason, issues });
}

/** A commit's result with the update's own issues in front of its re-validation issues. */
function withIssues(result: CommitResult, issues: readonly ChangeSetIssue[]): UpdateTaskResult {
  if (issues.length === 0 || !('issues' in result)) return result;
  return Object.freeze({ ...result, issues: Object.freeze([...issues, ...result.issues]) });
}

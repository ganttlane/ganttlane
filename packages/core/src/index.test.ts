import { describe, expect, expectTypeOf, it } from 'vitest';

import * as core from './index';
import {
  alignNearest,
  autoScrollVelocity,
  type BarGeometry,
  barHandles,
  barsInWindow,
  buildHierarchy,
  buildLinkGraph,
  type CalendarIssueCode,
  type ChangeController,
  type ChangeHistory,
  type ChangeSet,
  type ChangeSetIssue,
  collapseAll,
  columnGrid,
  type CommitResult,
  type CoreEvents,
  createChangeController,
  createChangeHistory,
  createEditSession,
  createEmitter,
  createFloatingAdapter,
  createGanttCore,
  createHooks,
  createInteraction,
  createLayout,
  createSelector,
  createStore,
  createStoreState,
  createTimeScale,
  createWorkCalendar,
  currentCell,
  type DateTimeMs,
  dateToProgress,
  DEFAULT_GRANULARITY,
  type EditSession,
  type Emitter,
  expandAll,
  fromDayKey,
  type GanttCore,
  type GanttSnapshot,
  type GridLine,
  gridLines,
  type HeaderCell,
  headerCells,
  type HeaderContext,
  headerRows,
  type Hierarchy,
  type HierarchyIssueCode,
  hitTest,
  type Hooks,
  type Interaction,
  INTERACTION_DEFAULTS,
  type InteractionContext,
  type InteractionEffect,
  type Issue,
  LAYOUT_DEFAULTS,
  type LayoutIssueCode,
  layoutRows,
  type Link,
  linkAnchors,
  linkBBox,
  type LinkGraph,
  type LinkRect,
  type LinkRoute,
  type ModelIssueCode,
  type NormalizedModel,
  normalizeModel,
  parseDateInput,
  parseDuration,
  parseGranularity,
  patchTask,
  patchTasks,
  placeLabel,
  planExtension,
  planScrollTo,
  type ProgressAnchor,
  type ProgressBoundary,
  progressFromDate,
  type ProgressSpan,
  progressToDate,
  propagate,
  type PropagationContext,
  type RangeChange,
  rebaseProgress,
  rebaseTimeline,
  reduceStore,
  type ResolvedSnap,
  type ResolvedViewModes,
  resolveLayoutOptions,
  resolvePermissions,
  resolveRange,
  resolveSnap,
  resolveTimelineOptions,
  resolveViewModes,
  type Result,
  revalidateChangeSet,
  routeLink,
  type Row,
  type RowMetrics,
  type ScaleIssueCode,
  type ScheduleIssueCode,
  selectSessionChanges,
  selectTaskPatch,
  type SessionChanges,
  setExpanded,
  snapTime,
  type Store,
  type StoreState,
  type Task,
  type TaskRecord,
  type TimeIssueCode,
  type TimelineState,
  type TimeRange,
  toDate,
  toDayKey,
  toggleExpanded,
  topoSort,
  type TopoSortResult,
  VERSION,
  VIEW_MODE_PRESETS,
  type ViewportChange,
  type ViewportIssueCode,
  visibleRows,
  visibleWindow,
  type WorkCalendar,
  wouldCreateCycle,
} from './index';

function toDayStart(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

describe('@ganttlane/core', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('exposes exactly the public runtime API', () => {
    expect(Object.keys(core).sort()).toEqual([
      'DEFAULT_GRANULARITY',
      'INTERACTION_DEFAULTS',
      'LAYOUT_DEFAULTS',
      'VERSION',
      'VIEWPORT_DEFAULTS',
      'VIEW_MODE_PRESETS',
      'alignCeil',
      'alignFloor',
      'alignNearest',
      'anchorTime',
      'applyChangeSet',
      'autoScrollVelocity',
      'barGeometry',
      'barHandles',
      'barsInWindow',
      'buildHierarchy',
      'buildLinkGraph',
      'clampResize',
      'collapseAll',
      'columnGrid',
      'createChangeController',
      'createChangeHistory',
      'createEditSession',
      'createEmitter',
      'createFloatingAdapter',
      'createGanttCore',
      'createHooks',
      'createInteraction',
      'createLayout',
      'createSelector',
      'createStore',
      'createStoreState',
      'createTimeScale',
      'createWorkCalendar',
      'currentCell',
      'dateToProgress',
      'detectConflicts',
      'effectiveSnapRule',
      'ensureContains',
      'expandAll',
      'fromDayKey',
      'gridLines',
      'headerCells',
      'headerRows',
      'hitTest',
      'isAligned',
      'keepAnchor',
      'layoutRows',
      'linkAnchors',
      'linkBBox',
      'measureLag',
      'normalizeModel',
      'parseDateInput',
      'parseDuration',
      'parseGranularity',
      'patchTask',
      'patchTasks',
      'placeLabel',
      'planExtension',
      'planScrollTo',
      'progressFromDate',
      'progressToDate',
      'propagate',
      'rebaseProgress',
      'rebaseTimeline',
      'reduceStore',
      'resolveInitialScroll',
      'resolveLayoutOptions',
      'resolvePermissions',
      'resolveRange',
      'resolveScrollOptions',
      'resolveSnap',
      'resolveTimelineOptions',
      'resolveViewModes',
      'revalidateChangeSet',
      'routeLink',
      'scrollLeftFor',
      'scrollToTask',
      'scrollTopFor',
      'selectCommittedPatch',
      'selectSessionChanges',
      'selectSessionDirty',
      'selectSessionRollback',
      'selectTaskPatch',
      'setExpanded',
      'snapTime',
      'toDate',
      'toDayKey',
      'toggleExpanded',
      'topoSort',
      'visibleRows',
      'visibleWindow',
      'wouldCreateCycle',
    ]);
  });

  it('FR-SCALE-4, FR-SCALE-5: exposes header rows and grid lines', () => {
    const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
    const start = toDayStart('2026-03-01');
    const range: TimeRange = { start, end: toDayStart('2026-03-08') };
    const ctx: HeaderContext = {
      scale: createTimeScale({ origin: start, pxPerDay: day.pxPerDay }),
      adapter: createFloatingAdapter(),
      locale: 'en',
    };
    const [months, days] = headerRows(day, range, ctx);
    expect([...months!].map((cell) => cell.label)).toEqual(['March 2026']);
    const firstDay: HeaderCell = [...headerCells(day.headers[1]!, range, ctx)][0]!;
    expect(firstDay).toEqual({ ...[...days!][0], label: '1' });
    expect(currentCell(day.headers[0]!, 0, ctx).label).toBe('March 2026');
    const lines: GridLine[] = [...gridLines(day, range, ctx)];
    expect(lines.map((line) => line.kind)).toEqual([
      'column',
      'major',
      'column',
      'column',
      'column',
      'column',
      'column',
    ]);
  });

  it('FR-SCALE-1, FR-SCALE-2: exposes the time scale and the view mode presets', () => {
    const resolved = resolveViewModes({ day: { pxPerDay: 50 } });
    expectTypeOf(resolved).toEqualTypeOf<ResolvedViewModes>();
    expectTypeOf(resolved.issues).toEqualTypeOf<readonly Issue<ScaleIssueCode>[]>();
    const day = resolved.modes.find((mode) => mode.id === 'day')!;
    const scale = createTimeScale({ origin: toDayStart('2026-03-01'), pxPerDay: day.pxPerDay });
    expect(scale.dateToX(toDayStart('2026-03-03'))).toBe(100);
    expect(VIEW_MODE_PRESETS.map((mode) => mode.id)).toEqual([
      'hour',
      'quarter-day',
      'half-day',
      'day',
      'week',
      'month',
      'year',
    ]);
  });

  it('FR-SNAP-3, FR-SNAP-12, FR-SNAP-14: resolves snap against the granularity and snaps edges', () => {
    const granularity = parseGranularity('1h');
    if (!granularity.ok) throw new Error(granularity.issue.message);
    expect(parseGranularity('5h')).toMatchObject({
      ok: false,
      issue: { code: 'invalid-granularity' },
    });
    const hour = VIEW_MODE_PRESETS.find((mode) => mode.id === 'hour')!;
    const { snap, issues } = resolveSnap({
      viewMode: hour,
      option: { step: '1d', mode: 'relative' },
      granularity: granularity.value,
    });
    expectTypeOf(snap).toEqualTypeOf<ResolvedSnap>();
    expect(issues).toEqual([]);
    const moved = snapTime(toDayStart('2026-03-11T08:00'), {
      rule: snap.move,
      mode: snap.mode,
      origin: alignNearest(toDayStart('2026-03-10T10:00'), granularity.value),
      granularity: snap.granularity,
      precision: 'time',
      adapter: createFloatingAdapter(),
    });
    expect(toDate(moved)).toEqual(new Date(2026, 2, 11, 10));
  });

  it('FR-TIME-1: parses dates and durations into Results with typed issues', () => {
    const date = parseDateInput('2026-03-08T10:00');
    expectTypeOf(date).toEqualTypeOf<
      Result<
        { readonly value: DateTimeMs; readonly precision: 'day' | 'time' },
        Issue<TimeIssueCode>
      >
    >();
    expect(date.ok && toDate(date.value.value).getHours()).toBe(10);
    expect(parseDuration('1d 4h').ok).toBe(true);
    expect(createFloatingAdapter().weekStartsOn).toBe(1);
  });

  it('FR-DATA-2, FR-DATA-5, FR-SNAP-13: normalizes tasks and links into typed models', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task<{ owner: string }>[] = [
      { id: 1, name: 'Design', start: '2026-03-02', duration: 5, data: { owner: 'ann' } },
      {
        id: 2,
        name: 'Build',
        start: '2026-03-09T10:30',
        end: '2026-03-09T12:00',
        dependencies: [1],
      },
    ];
    const links: Link[] = [{ source: 1, target: 2, type: 'SS' }];
    const model = normalizeModel({ tasks, links }, { calendar, granularity: '1h' });
    expectTypeOf(model).toEqualTypeOf<NormalizedModel<{ owner: string }>>();
    expectTypeOf(model.issues[0]!.code).toEqualTypeOf<ModelIssueCode>();
    const design = model.taskById.get(1)!;
    expect(design.task.data?.owner).toBe('ann');
    expect(toDate(design.span!.end)).toEqual(new Date(2026, 2, 6));
    expect(model.links.map((link) => link.id)).toEqual(['1:SS:2', '1:FS:2']);
    expect(model.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['misaligned', 'tasks[1].start'],
    ]);
  });

  it('FR-PROG-1, FR-PROG-2, FR-PROG-3: exposes progress ↔ date, the handle and anchoring', () => {
    const { calendar } = createWorkCalendar({ weekends: [0, 6] });
    const span: ProgressSpan = {
      start: toDayStart('2026-03-02'),
      endExclusive: toDayStart('2026-03-16'),
      mode: 'calendar',
      calendar,
    };
    const granularity = DEFAULT_GRANULARITY;
    expect(toDate(progressToDate({ ...span, progress: 50, granularity }))).toEqual(
      new Date(2026, 2, 9),
    );
    expect(dateToProgress({ ...span, date: toDayStart('2026-03-09') })).toBe(50);
    // Sunday, dragged forward with skipping: the boundary jumps to Monday.
    const handle = progressFromDate({
      ...span,
      t: toDayStart('2026-03-08'),
      direction: 1,
      skipNonWorking: true,
      granularity,
    });
    expectTypeOf(handle).toEqualTypeOf<ProgressBoundary>();
    expect(handle.progress).toBe(50);
    expect(toDate(handle.progressDate)).toEqual(new Date(2026, 2, 9));
    // Two weeks at 50 % shrunk to one: 'end' keeps the 7 days left, so nothing is done.
    const anchor: ProgressAnchor = 'end';
    const rebased = rebaseProgress({
      progress: 50,
      from: span,
      to: { start: span.start, endExclusive: toDayStart('2026-03-09') },
      anchor,
      mode: 'calendar',
      calendar,
      granularity,
    });
    expect(rebased).toEqual({ progress: 0, progressDate: span.start });
  });

  it('FR-LINK-1, FR-LINK-7, FR-LINK-8: builds the link graph of a typed model', () => {
    const { calendar } = createWorkCalendar({ weekends: [0, 6] });
    const tasks: Task<{ owner: string }>[] = [
      { id: 1, name: 'Design', start: '2026-03-02', end: '2026-03-06', data: { owner: 'ann' } },
      { id: 2, name: 'Build', start: '2026-03-09', end: '2026-03-13', durationMode: 'working' },
      { id: 3, name: 'Review', start: '2026-03-16', duration: 1 },
    ];
    const links: Link[] = [
      { source: 1, target: 2 },
      { source: 2, target: 3, lag: 1 },
      { source: 3, target: 2, type: 'SS' },
    ];
    const graph = buildLinkGraph(normalizeModel({ tasks, links }, { calendar }));
    expectTypeOf(graph).toEqualTypeOf<LinkGraph>();
    expectTypeOf(graph.issues[0]!.code).toEqualTypeOf<ScheduleIssueCode>();
    const [design] = graph.successorsOf(1);
    expect(design?.lag).toEqual({ ms: 0, mode: 'working', derived: true, days: 0 });
    expect(linkAnchors(design!.type)).toEqual({ source: 'end', target: 'start' });
    expect(graph.issues.map((issue) => [issue.code, issue.taskIds])).toEqual([['cycle', [2, 3]]]);
    expect(graph.topologicalOrder).toEqual([1, 2, 3]);
    expect(wouldCreateCycle(graph, 2, 1)).toBe(true);
    const order: TopoSortResult<number> = topoSort([3, 2, 1], [[1, 3]]);
    expect(order.order).toEqual([2, 1, 3]);
  });

  it('FR-SCH-1, FR-SCH-2, FR-TX-1: propagates an edit through links and children', () => {
    const { calendar } = createWorkCalendar({ weekends: [0, 6] });
    const tasks: Task[] = [
      { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
      {
        id: 'review',
        name: 'Review',
        parentId: 'design',
        followParent: true,
        start: '2026-03-06',
        duration: 1,
        parentAnchor: 'FF',
      },
      { id: 'build', name: 'Build', start: '2026-03-09', duration: 3, durationMode: 'working' },
    ];
    const model = normalizeModel(
      { tasks, links: [{ source: 'design', target: 'build' }] },
      { calendar },
    );
    const context: PropagationContext = {
      model,
      hierarchy: buildHierarchy(model),
      graph: buildLinkGraph(model),
    };
    const changeSet = propagate(
      { kind: 'move', id: 'design', start: toDayStart('2026-03-09') },
      context,
    );
    expectTypeOf(changeSet).toEqualTypeOf<ChangeSet>();
    expect(changeSet.reason).toBe('move');
    expect(
      changeSet.changes.map((change) => [
        change.id,
        change.cause,
        change.via,
        toDate(change.after.start),
      ]),
    ).toEqual([
      ['design', 'direct', undefined, new Date(2026, 2, 9)],
      ['review', 'parent', 'design', new Date(2026, 2, 13)],
      // A Friday end and an FS lag of 0 working days: the working-mode successor starts on Monday.
      ['build', 'link', 'design', new Date(2026, 2, 16)],
    ]);
  });

  it('FR-LINK-3, FR-SEL-1: routes typed links between bars, with an arrowhead and a box', () => {
    const design: LinkRect = { x: 0, y: 7, width: 120, height: 24 };
    const build: LinkRect = { x: 160, y: 45, width: 80, height: 24 };
    const route = routeLink({ type: 'FF', source: design, target: build, options: { rowGap: 14 } });
    expectTypeOf(route).toEqualTypeOf<LinkRoute>();
    // End → end: out to the right of both bars, down, back left into the target end.
    expect(route.d).toBe('M120 19H247a5 5 0 0 1 5 5V52a5 5 0 0 1 -5 5H240');
    expect(route.arrow).toBe('M240 57l5 -5v10z');
    expect(linkBBox({ type: 'FF', source: design, target: build })).toEqual(route.bbox);
  });

  it('FR-ROW-1, FR-ROW-2, FR-ROW-4: builds the task tree and its visible rows', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task[] = [
      { id: 'child', name: 'Child', parentId: 'phase', parentAnchor: ['FF', 'SS'] },
      { id: 'phase', name: 'Phase' },
      { id: 'other', name: 'Other', parentId: 'ghost' },
    ];
    const tree = buildHierarchy(normalizeModel({ tasks }, { calendar }), { childAnchor: 'FS' });
    expectTypeOf(tree).toEqualTypeOf<Hierarchy>();
    expectTypeOf(tree.issues[0]!.code).toEqualTypeOf<HierarchyIssueCode>();
    expect(tree.issues.map((issue) => issue.code)).toEqual(['unknown-parent']);
    expect(tree.nodeById.get('child')?.parentAnchor).toEqual(['SS', 'FF']);
    const rows: readonly Row[] = visibleRows(tree, expandAll(tree));
    expect(rows.map((row) => [row.id, row.depth, row.groupStripe])).toEqual([
      ['phase', 0, 0],
      ['child', 1, 0],
      ['other', 0, 1],
    ]);
    const keys = toggleExpanded(tree, 'all', 'phase');
    expect(visibleRows(tree, keys).map((row) => row.id)).toEqual(['phase', 'other']);
    expect(setExpanded(tree, collapseAll(), 'phase', true)).toEqual(['phase']);
  });

  it('FR-ROW-5, FR-BAR-1, FR-BAR-2, FR-API-5: lays out rows and bars, and the visible window', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task[] = [
      { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-13', progress: 50 },
      { id: 'design', name: 'Design', parentId: 'phase', start: '2026-03-02', end: '2026-03-03' },
      { id: 'stub', name: 'Stub', type: 'placeholder' },
    ];
    const model = normalizeModel({ tasks }, { calendar });
    const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
    const { options, issues } = resolveLayoutOptions({ barRadius: 40 }, day.headers.length);
    expectTypeOf(issues).toEqualTypeOf<readonly Issue<LayoutIssueCode>[]>();
    expect(options.headerRowHeights).toEqual(LAYOUT_DEFAULTS.headerRowHeights);
    const rows = layoutRows(visibleRows(buildHierarchy(model), 'all'), options);
    expect(rows.headerHeight).toBe(75);
    const scale = createTimeScale({ origin: toDayStart('2026-03-01'), pxPerDay: day.pxPerDay });
    const layout = createLayout({ rows, tasks: model.taskById, scale, ...options });
    expect(layout.getRowMetrics('stub')).toEqual<RowMetrics>({
      id: 'stub',
      index: 2,
      y: 96,
      height: 48,
    });
    expect(layout.getBarRect('stub')).toBeUndefined();
    expect(layout.getBarRect('phase')).toEqual<BarGeometry>({
      id: 'phase',
      rowIndex: 0,
      kind: 'bar',
      x: 40,
      y: 9,
      width: 480,
      height: 30,
      radius: 15,
      progressWidth: 240,
    });
    expect(placeLabel(layout.getBarRect('design')!, 100, 'auto')).toEqual({
      // The bar ends at 120: past the link handle (16 px) and the padding (5 px).
      x: 141,
      y: 48 + 24,
      anchor: 'start',
      inside: false,
    });
    const window = visibleWindow(
      { scrollLeft: 0, scrollTop: 0, width: 200, height: 75 + 48 },
      rows,
      scale,
      { overscanRows: 0, overscanPx: 0 },
    );
    expect(window).toMatchObject({ firstRow: 0, lastRow: 0, end: toDayStart('2026-03-06') });
    expect(barsInWindow(window, layout).map((bar) => bar.id)).toEqual(['phase']);
  });

  it('FR-TX-3, FR-DATA-7: keeps the state in a store and writes change sets back into tasks', () => {
    const tasks: Task<{ owner: string }>[] = [
      {
        id: 'design',
        name: 'Design',
        start: '2026-03-02',
        end: '2026-03-06',
        data: { owner: 'ann' },
      },
      { id: 'build', name: 'Build', start: new Date(2026, 2, 9), duration: 3 },
    ];
    const store: Store<{ owner: string }> = createStore({
      tasks,
      links: [{ source: 'design', target: 'build' }],
    });
    let notified = 0;
    store.subscribe(() => notified++);
    const before: StoreState<{ owner: string }> = store.getSnapshot();
    const { model, hierarchy, graph } = before.derived;
    const changeSet = propagate(
      { kind: 'move', id: 'design', start: toDayStart('2026-03-03') },
      { model, hierarchy, graph },
    );
    store.dispatch({ type: 'setDraft', changeSet });
    expect(selectTaskPatch(store.getSnapshot(), 'build')?.start).toBe(toDayStart('2026-03-10'));
    store.dispatch({ type: 'applyChangeSet', changeSet });
    const after = store.getSnapshot();
    expect(after.tasks[0]).toEqual({ ...tasks[0], start: '2026-03-03', end: '2026-03-07' });
    expect(after.tasks[1]).toEqual({ ...tasks[1], start: new Date(2026, 2, 10) });
    expect(after.lastDataChange.updated).toEqual(['design', 'build']);
    expect(notified).toBe(2);
    const patched = patchTask(tasks[1]!, changeSet.changes[1]!.after, model);
    expect(patched).toEqual(after.tasks[1]);
    expect(patchTasks(tasks, changeSet, model)).toEqual(after.tasks);
    const rows = createSelector([(state: StoreState) => state.derived.rows], (list) => list.length);
    expect(store.select(rows)).toBe(2);
    expect(reduceStore(createStoreState({ tasks }), { type: 'collapseAll' }).expandedKeys).toEqual(
      [],
    );
  });

  it('FR-TL-1 … FR-TL-7, FR-SCROLL-1, FR-SCALE-6: resolves the range and runs the infinite timeline', () => {
    const { calendar } = createWorkCalendar();
    const model = normalizeModel(
      { tasks: [{ id: 'a', name: 'A', start: '2026-03-04', end: '2026-03-06' }] },
      { calendar },
    );
    const day = VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!;
    const columns = columnGrid(day, createFloatingAdapter());
    const { options, issues } = resolveTimelineOptions(
      { infinite: { extendBy: '1w' } },
      { viewMode: day },
    );
    expectTypeOf(issues).toEqualTypeOf<readonly Issue<ViewportIssueCode>[]>();
    expect(issues).toEqual([]);
    const range = resolveRange({
      spans: model.tasks.map((task) => task.span),
      now: toDayStart('2026-03-05'),
      padding: options.padding,
      columns,
    });
    // March 4 … 6 plus 14 days on each side.
    expect(range).toEqual({ start: toDayStart('2026-02-18'), end: toDayStart('2026-03-21') });
    const state: TimelineState = {
      range,
      scale: createTimeScale({ origin: range.start, pxPerDay: day.pxPerDay }),
      scrollLeft: 0,
      viewportWidth: 600,
    };
    const policy = { ...options.infinite, columns };
    const change = planExtension(state, policy);
    expectTypeOf(change).toEqualTypeOf<ViewportChange | undefined>();
    // At the edge, a week is not enough to clear the 600 px threshold: 16 days, compensated, so
    // February 18 stays at the left edge.
    expect(change).toMatchObject({ range: { start: toDayStart('2026-02-02') }, scrollLeft: 640 });
    const event: RangeChange = { ...change!.range, reason: change!.reason };
    expect(event.reason).toBe('extend-start');
    const plan = planScrollTo(toDayStart('2026-06-01'), change!, { infinite: policy });
    expect(plan.change?.reason).toBe('scroll-to');
    expect(autoScrollVelocity(10, 600)).toBe(-15);
    const month = VIEW_MODE_PRESETS.find((mode) => mode.id === 'month')!;
    const rebased = rebaseTimeline(change!, {
      pxPerDay: month.pxPerDay,
      columns: columnGrid(month, createFloatingAdapter()),
      fit: true,
    });
    expect(rebased.scale.xToDate(rebased.scrollLeft)).toBe(toDayStart('2026-02-18'));
  });

  it('FR-EVT-1, FR-EVT-3, FR-TX-1, FR-TX-2: commits through before-hooks and emits typed events', async () => {
    const tasks: Task[] = [
      { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ];
    const store = createStore({ tasks, links: [{ source: 'design', target: 'build' }] });
    const emitter: Emitter<CoreEvents> = createEmitter<CoreEvents>();
    const hooks: Hooks = createHooks();
    const controller: ChangeController = createChangeController({ store, emitter, hooks });
    const committed: ChangeSet[] = [];
    const off = emitter.on('tasksChange', (changeSet) => committed.push(changeSet));
    // A hook that asks the user, then moves the edit a day later.
    hooks.add('beforeTaskChange', async () => {
      await Promise.resolve();
      const { model, hierarchy, graph } = store.getSnapshot().derived;
      const command = { kind: 'move', id: 'design', start: toDayStart('2026-03-04') } as const;
      return propagate(command, { model, hierarchy, graph });
    });
    const { model, hierarchy, graph } = store.getSnapshot().derived;
    const drop = propagate(
      { kind: 'move', id: 'design', start: toDayStart('2026-03-03') },
      { model, hierarchy, graph },
    );
    controller.preview(drop);
    const result: CommitResult = await controller.commit(drop);
    expect(result.status).toBe('committed');
    expect(committed).toHaveLength(1);
    expect(store.getSnapshot().tasks[0]).toMatchObject({ start: '2026-03-04', end: '2026-03-08' });
    off();
    // `before` is re-read from the store's model, now the committed one.
    const revalidated = revalidateChangeSet(drop, store.getSnapshot().derived);
    expectTypeOf(revalidated.issues).toEqualTypeOf<readonly ChangeSetIssue[]>();
    expect(revalidated.changeSet.changes[0]?.before.start).toBe(toDayStart('2026-03-04'));
    expect(await controller.createLink({ source: 'build', target: 'design' })).toEqual({
      status: 'rejected',
      reason: 'cycle',
    });
  });

  it('FR-TX-4, FR-TX-5, FR-TX-6: an edit session with history: undo, aggregate, rollback', async () => {
    const tasks: Task[] = [
      { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ];
    const links: Link[] = [{ source: 'design', target: 'build' }];
    const store = createStore({ tasks, links });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const history: ChangeHistory = createChangeHistory({
      store,
      controller,
      emitter,
      enabled: true,
    });
    const edit: EditSession = createEditSession({ store, controller, emitter, history });
    const dirty: boolean[] = [];
    emitter.on('dirtyChange', ({ isDirty }) => dirty.push(isDirty));
    const rolledBack: SessionChanges[] = [];
    emitter.on('editRollback', (changes) => rolledBack.push(changes));

    expect(edit.begin().status).toBe('begun');
    const drag = (start: string): ChangeSet => {
      const { model, hierarchy, graph } = store.getSnapshot().derived;
      return propagate(
        { kind: 'move', id: 'design', start: toDayStart(start) },
        { model, hierarchy, graph },
      );
    };
    await controller.commit(drag('2026-03-03'));
    await controller.commit(drag('2026-03-04'));
    expect(history.undo().status).toBe('undone');
    const changes = edit.getChanges();
    expect(changes).toBe(edit.getChanges());
    expect(selectSessionChanges(store.getSnapshot())).toEqual(changes);
    expect(changes?.changes.map((change) => [change.id, change.after.start])).toEqual([
      ['design', toDayStart('2026-03-03')],
      ['build', toDayStart('2026-03-10')],
    ]);
    expect(edit.isDirty).toBe(true);

    expect(edit.rollback().status).toBe('rolled-back');
    expect(store.getSnapshot().tasks).toBe(tasks);
    expect(rolledBack[0]?.reason).toBe('rollback');
    expect(dirty).toEqual([true, false]);
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
  });

  it('FR-EDIT-1, FR-EDIT-5, FR-EDIT-7: drives a drag through the interaction machine', async () => {
    const tasks: Task[] = [
      { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ];
    const store = createStore({ tasks, links: [{ source: 'design', target: 'build' }] });
    const controller = createChangeController({ store, emitter: createEmitter<CoreEvents>() });
    const interaction: Interaction = createInteraction();
    const start = toDayStart('2026-03-01');
    const scale = createTimeScale({ origin: start, pxPerDay: 40 });
    const timeline: TimelineState = {
      range: { start, end: toDayStart('2026-04-01') },
      scale,
      scrollLeft: 0,
      viewportWidth: 800,
    };
    // What the facade (plan step 3.8) builds from the store for every event.
    const context = (): InteractionContext => {
      const { derived, settings } = store.getSnapshot();
      const rows = layoutRows(derived.rows);
      return {
        model: derived.model,
        hierarchy: derived.hierarchy,
        graph: derived.graph,
        layout: createLayout({ rows, tasks: derived.model.taskById, scale }),
        timeline,
        snap: derived.snap.snap,
        adapter: createFloatingAdapter(),
        propagation: settings.propagation,
        busy: controller.pending,
      };
    };
    const send = async (effects: readonly InteractionEffect[]): Promise<void> => {
      for (const effect of effects) {
        if (effect.type === 'preview') controller.preview(effect.changeSet);
        else if (effect.type === 'commit') await controller.commit(effect.changeSet);
      }
    };
    const { layout } = context();
    const bar = layout.getBarRect('design')!;
    const y = bar.y + bar.height / 2;
    expect(hitTest({ x: bar.x + 100, y }, { layout })).toEqual({
      kind: 'task',
      id: 'design',
      part: 'body',
    });
    expect(barHandles(bar).resizeEnd?.width).toBe(INTERACTION_DEFAULTS.handles.resize);
    const pointer = { pointerId: 1, y } as const;
    await send(interaction.send({ ...pointer, type: 'down', x: bar.x + 100, time: 0 }, context()));
    await send(interaction.send({ ...pointer, type: 'move', x: bar.x + 180, time: 16 }, context()));
    // The live preview moved the successor too (FR-EDIT-5).
    expect(store.getSnapshot().draft?.changeSet.changes.map((change) => change.id)).toEqual([
      'design',
      'build',
    ]);
    expect(interaction.feedback).toMatchObject({ phase: 'dragging', cursor: 'grabbing' });
    await send(interaction.send({ ...pointer, type: 'up', x: bar.x + 180, time: 32 }, context()));
    expect(store.getSnapshot().tasks[0]).toMatchObject({ start: '2026-03-04', end: '2026-03-08' });
    const design = store.getSnapshot().derived.model.taskById.get('design');
    expect(resolvePermissions(design, { move: false })).toEqual({
      move: false,
      resize: true,
      progress: true,
      link: true,
    });
  });

  it('FR-API-1 … FR-API-6: a whole scenario through createGanttCore', async () => {
    const tasks: Task<{ owner: string }>[] = [
      {
        id: 'design',
        name: 'Design',
        start: '2026-03-02',
        end: '2026-03-06',
        data: { owner: 'ann' },
      },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ];
    let veto = true;
    const committed: ChangeSet[] = [];
    const gantt: GanttCore<{ owner: string }> = createGanttCore({
      tasks,
      links: [{ source: 'design', target: 'build' }],
      calendar: { weekends: [0, 6] },
      history: true,
      now: () => '2026-03-02',
      scroll: { initial: 'start', autoScroll: false },
      onBeforeTaskChange: () => !veto,
      onTasksChange: (changeSet) => committed.push(changeSet),
    });
    let snapshots = 0;
    gantt.subscribe(() => snapshots++);
    expect(gantt.setViewport({ width: 1600, height: 400 })).toMatchObject({ reason: 'initial' });
    const first: GanttSnapshot<{ owner: string }> = gantt.getSnapshot();
    expect(first.layout.getBarRect('design')).toBe(gantt.getBarRect('design'));
    expect(gantt.edit.begin().status).toBe('begun');

    // One day to the right (40 px in the day mode), through the renderer's input path.
    const drag = (): void => {
      const bar = gantt.getBarRect('design')!;
      const y = bar.y + bar.height / 2;
      const x = bar.x + bar.width / 2;
      gantt.send({ type: 'down', pointerId: 1, x, y, time: 0 });
      gantt.send({ type: 'move', pointerId: 1, x: x + 40, y, time: 16 });
      gantt.send({ type: 'up', pointerId: 1, x: x + 40, y, time: 32 });
    };
    drag();
    // The hook cancelled: nothing changed or emitted, the preview is gone.
    expect(committed).toEqual([]);
    expect(gantt.getSnapshot().state.draft).toBeUndefined();
    expect(gantt.getTask('design')?.start).toEqual(new Date(2026, 2, 2));

    veto = false;
    drag();
    await Promise.resolve();
    expect(committed.map((changeSet) => changeSet.changes.map((change) => change.id))).toEqual([
      ['design', 'build'],
    ]);
    const design: TaskRecord<{ owner: string }> = gantt.getTask('design')!;
    expect(design).toMatchObject({ start: new Date(2026, 2, 3), end: new Date(2026, 2, 7) });
    expect(design.task.data?.owner).toBe('ann');
    expect(gantt.edit.isDirty).toBe(true);

    expect(gantt.undo().status).toBe('undone');
    expect(gantt.getTask('design')?.start).toEqual(new Date(2026, 2, 2));
    expect(committed.at(-1)?.reason).toBe('undo');
    drag();
    expect(gantt.getTask('design')?.start).toEqual(new Date(2026, 2, 3));

    expect(gantt.edit.rollback().status).toBe('rolled-back');
    expect(gantt.getSnapshot().state.tasks).toBe(tasks);
    expect(gantt.canUndo).toBe(false);
    expect(snapshots).toBeGreaterThan(0);

    gantt.destroy();
    const after = snapshots;
    gantt.setTasks([]);
    drag();
    expect(snapshots).toBe(after);
    expect(committed).toHaveLength(3);
  });

  it('FR-CAL-6: the work calendar is usable on its own, from Date to Date', () => {
    const { calendar, issues } = createWorkCalendar({
      holidays: [{ date: new Date(2026, 2, 9), name: 'Day off' }],
    });
    expectTypeOf(calendar).toEqualTypeOf<WorkCalendar>();
    expectTypeOf(issues).toEqualTypeOf<readonly Issue<CalendarIssueCode>[]>();
    expect(issues).toEqual([]);

    const parsed = parseDateInput(new Date(2026, 2, 6)); // a Friday
    if (!parsed.ok) throw new Error(parsed.issue.message);
    const friday = toDayKey(parsed.value.value);
    expect(calendar.isWorkingDay(friday)).toBe(true);
    const next = calendar.addWorkingDays(friday, 1)!; // skips the weekend and the Monday holiday
    expect(toDate(fromDayKey(next))).toEqual(new Date(2026, 2, 10));
    const monday = parseDateInput('2026-03-09');
    if (!monday.ok) throw new Error(monday.issue.message);
    expect(calendar.explain(toDayKey(monday.value.value))).toEqual({
      working: false,
      reason: 'holiday',
      label: 'Day off',
    });
  });
});

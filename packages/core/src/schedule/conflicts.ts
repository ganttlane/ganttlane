/**
 * Scheduling conflicts (FR-SCH-6, FR-SCH-7, FR-TX-2): starts and ends on non-working days,
 * children outside their parent and violated links, found in a state of the plan — the model as
 * normalized (the facade's `TaskRecord.issues`, plan step 3.8) or the model with a change set
 * applied (`ChangeSet.conflicts`, read by `onBeforeTaskChange`, plan step 3.2).
 *
 * Conflicts are warnings only: nothing here refuses, moves or corrects a task.
 */

import type { WorkCalendar } from '../calendar';
import type {
  DurationMode,
  NormalizedModel,
  ResolvedModelOptions,
  TaskId,
  TaskModel,
} from '../model';
import {
  asDateTimeMs,
  type DayKey,
  durationToString,
  fromDayKey,
  toDayKey,
  toISODate,
} from '../time';
import type { ChangeSet, Conflict, TaskBounds } from './changeset';
import {
  type ActiveLinkRecord,
  anchorTime,
  linkAnchors,
  type LinkGraph,
  measureLag,
} from './graph';
import type { ScheduleHierarchy } from './hierarchy-view';

/** What {@link detectConflicts} checks against, built from one model; a `PropagationContext` fits. */
export interface ConflictContext {
  /** The normalized tasks; its options give the work calendar and the granularity. */
  readonly model: NormalizedModel;
  /** The task tree of the model (`buildHierarchy`). */
  readonly hierarchy: ScheduleHierarchy;
  /** The link graph of the model (`buildLinkGraph`). */
  readonly graph: LinkGraph;
}

/**
 * Where the bars lie in one state of the plan, by task id. A task it does not list keeps its
 * span from the model, so an empty map is the model as normalized. Tasks without a bar in the
 * model (placeholders, invalid tasks) have none in any state, whatever the map says.
 */
export type ScheduleState = ReadonlyMap<TaskId, TaskBounds>;

/**
 * The state of the plan after a change set (FR-TX-1): every task with a bar, in model order, at
 * its change's `after` or else at its model span. Changes of unknown tasks and of tasks without a
 * bar are ignored; of two changes of one task the later wins. Pure: the model and the change set
 * are not touched, and the values are their own (frozen) objects.
 *
 * @param model - The normalized model the change set was computed on.
 * @param changeSet - The changes to apply, e.g. from `propagate` or a before-hook.
 * @returns A new map of the bars.
 *
 * @example
 * ```ts
 * const changeSet = propagate(command, context);
 * const state = applyChangeSet(context.model, changeSet);
 * state.get('build'); // { start, endExclusive, … } after the edit
 * ```
 */
export function applyChangeSet(
  model: NormalizedModel,
  changeSet: Pick<ChangeSet, 'changes'>,
): ScheduleState {
  const after = new Map<TaskId, TaskBounds>();
  for (const change of changeSet.changes) after.set(change.id, change.after);
  const state = new Map<TaskId, TaskBounds>();
  for (const task of model.tasks) {
    if (task.span !== undefined) state.set(task.id, after.get(task.id) ?? task.span);
  }
  return state;
}

/**
 * Finds the scheduling conflicts of a state of the plan (FR-SCH-6). Pure, never throws on bad
 * data, deterministic. Only tasks with a bar take part; a bar with an edge that is not a finite
 * time within the range of a `Date` (and of the work calendar) counts as none.
 *
 * Rules (every conflict is a `'warning'` on the task `id`):
 * - **`'non-working-start'`**: the day of `start` is a non-working day of the model's work
 *   calendar. **`'non-working-end'`**: the day of the bar's last instant (`endExclusive - 1 ms`)
 *   is; milestones and other zero-length bars only have a start. A one-day bar on a Saturday has
 *   both. These are exactly the edges `skipNonWorkingDays` rolls onto working time, so an edit
 *   that rolled its edges has none (FR-SCH-7: "start on Saturday + ignore" keeps the conflict,
 *   "+ accept" has none). Every task is checked, whatever its `durationMode`.
 * - **`'outside-parent'`**: a child starts before its parent's start or ends after its parent's
 *   end (`edges`). Only the resolved direct parent counts and it must have a bar: children of a
 *   placeholder row are never outside it. A milestone child may sit on either edge.
 * - **`'link-violated'`**: an active link that is not on a cycle (FR-LINK-7) has a gap between its
 *   anchors, measured like its lag (`measureLag` in the target's `durationMode`), below the
 *   minimum it requires: the lag itself for an explicit `Link.lag`; `min(lag, 0)` for a lag
 *   derived from the initial gap (ADR-007). So a link without a lag only conflicts when its
 *   successor now overlaps its predecessor (an `FS` successor starts before the predecessor's
 *   end, …) by more than it did when the model was loaded; widening the gap never does. With
 *   `'preserve-lag'` propagation keeps the lag of every link it travels, so this flags the others:
 *   links into a `locked` successor, every link under `'none'`, links ignored on a cycle through
 *   parents, pins that lost to another pin of the same edge, and links from predecessors that did
 *   not move into a successor that an edit **earlier** pulled towards them (propagation only
 *   follows changed tasks, so it never pushes back).
 *
 * **Scope.** Without `scope` every task is checked (the initial state, shown as
 * `TaskRecord.issues`). With it, only conflicts that **involve** a task of the scope are
 * reported: its own non-working days, it against its parent and its children against it, links
 * into and out of it. Passing the changed tasks of an edit thus reports the conflicts the edit
 * can have caused, also on neighbours that did not move (a child left outside its moved parent, a
 * locked successor), and none of the conflicts elsewhere in the plan. `propagate` fills
 * `ChangeSet.conflicts` this way. Unknown ids are ignored.
 *
 * **Order**: by the model order of the conflict's task, then by type (`'non-working-start'`,
 * `'non-working-end'`, `'outside-parent'`, `'link-violated'`), links in model order. Runs in
 * O(V + E) over the model with amortized O(1) calendar lookups.
 *
 * @param state - Where the bars lie, e.g. {@link applyChangeSet}; an empty map is the model.
 * @param context - The model, its tree and its link graph.
 * @param scope - Tasks whose conflicts to report; all tasks when omitted.
 * @returns The frozen conflicts.
 *
 * @example
 * ```ts
 * const context = { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) };
 * detectConflicts(new Map(), context); // every conflict of the loaded plan
 * const changeSet = propagate({ kind: 'resize-start', id: 'design', start: saturday }, context);
 * changeSet.conflicts; // [{ type: 'non-working-start', id: 'design', date: saturday, … }]
 * ```
 */
export function detectConflicts(
  state: ScheduleState,
  context: ConflictContext,
  scope?: Iterable<TaskId>,
): readonly Conflict[] {
  const { tasks, taskById } = context.model;
  const bounds = tasks.map((task): TaskBounds | undefined => {
    if (task.span === undefined) return undefined;
    const at = state.get(task.id) ?? task.span;
    return isTime(at.start) && isTime(at.endExclusive) ? at : undefined;
  });
  let marks: Uint8Array | undefined;
  if (scope !== undefined) {
    marks = new Uint8Array(tasks.length);
    for (const id of scope) {
      const task = taskById.get(id);
      if (task !== undefined) marks[task.index] = IN_SCOPE;
    }
  }
  return collectConflicts(context, (index) => bounds[index], marks);
}

/** ±8.64e15 ms around 1970: the range of a `Date`, and of the work calendar's day keys. */
const MAX_TIME = 8.64e15;

/** Whether a value can be a bar edge: a finite time a `Date` can represent. */
function isTime(t: number): boolean {
  return Math.abs(t) <= MAX_TIME;
}

/** Mark of a task of the scope in the `scope` array of {@link collectConflicts}. */
export const IN_SCOPE = 1;
/** Mark of a child or link successor of a task of the scope, which may have conflicts with it. */
const NEIGHBOUR = 2;

const NO_IDS: readonly TaskId[] = /* @__PURE__ */ Object.freeze([]);
const START_EDGE: readonly ('start' | 'end')[] = /* @__PURE__ */ Object.freeze(['start'] as const);
const END_EDGE: readonly ('start' | 'end')[] = /* @__PURE__ */ Object.freeze(['end'] as const);
const BOTH_EDGES: readonly ('start' | 'end')[] = /* @__PURE__ */ Object.freeze([
  'start',
  'end',
] as const);

/**
 * {@link detectConflicts} over bars by model index, for `propagate`. `scope` holds
 * {@link IN_SCOPE} at the model index of every task of the scope (`undefined`: all tasks); it is
 * used as scratch space and changed.
 *
 * @internal
 */
export function collectConflicts(
  context: ConflictContext,
  boundsAt: (index: number) => TaskBounds | undefined,
  scope: Uint8Array | undefined,
): readonly Conflict[] {
  const { model, hierarchy, graph } = context;
  const { tasks, taskById, options } = model;
  // Which tasks to visit: with a small scope only its tasks and their neighbours (children, link
  // successors), found from the scope; with a large one every task, as finding them costs more.
  const all = scope === undefined || !markNeighbours(context, scope);
  const inScope = (index: number): boolean => scope === undefined || scope[index] === IN_SCOPE;
  const conflicts: Conflict[] = [];
  const out: Output = { conflicts, dayMessages: new Map() };
  for (const task of tasks) {
    const { index } = task;
    if (!all && scope[index] === 0) continue;
    const bounds = boundsAt(index);
    if (bounds === undefined) continue;
    const own = inScope(index);
    if (own) nonWorkingDays(task, bounds, options.calendar, out);

    const parentId = hierarchy.nodeById.get(task.id)?.parentId;
    const parent = parentId === undefined ? undefined : taskById.get(parentId);
    if (parent !== undefined && (own || inScope(parent.index))) {
      const parentBounds = boundsAt(parent.index);
      if (parentBounds !== undefined) outsideParent(task, bounds, parent, parentBounds, out);
    }

    for (const link of graph.predecessorsOf(task.id)) {
      if (link.inCycle) continue;
      const source = taskById.get(link.source);
      if (source === undefined || !(own || inScope(source.index))) continue;
      const sourceBounds = boundsAt(source.index);
      if (sourceBounds !== undefined) {
        linkViolated(link, sourceBounds, bounds, options, out);
      }
    }
  }
  return Object.freeze(conflicts);
}

/**
 * Marks the children and link successors of the tasks of the scope as {@link NEIGHBOUR}s, unless
 * more than half of the model is in the scope (then visiting every task is cheaper).
 *
 * @returns Whether it marked them.
 */
function markNeighbours(context: ConflictContext, scope: Uint8Array): boolean {
  const { model, hierarchy, graph } = context;
  let size = 0;
  for (const mark of scope) if (mark === IN_SCOPE) size++;
  if (size * 2 > scope.length) return false;
  const mark = (id: TaskId): void => {
    const index = model.taskById.get(id)?.index;
    if (index !== undefined && scope[index] === 0) scope[index] = NEIGHBOUR;
  };
  for (const task of model.tasks) {
    if (scope[task.index] !== IN_SCOPE) continue;
    for (const childId of hierarchy.nodeById.get(task.id)?.childIds ?? NO_IDS) mark(childId);
    for (const link of graph.successorsOf(task.id)) mark(link.target);
  }
  return true;
}

/** Where one detection writes its conflicts. */
interface Output {
  readonly conflicts: Conflict[];
  /** Messages of non-working-day conflicts by `day * 2 + (end ? 1 : 0)`: many bars share a day. */
  readonly dayMessages: Map<number, string>;
}

function nonWorkingDays(
  task: TaskModel,
  bounds: TaskBounds,
  calendar: WorkCalendar,
  out: Output,
): void {
  const startDay = toDayKey(bounds.start);
  if (!calendar.isWorkingDay(startDay)) nonWorkingDay('non-working-start', task.id, startDay, out);
  if (task.type === 'milestone' || bounds.endExclusive <= bounds.start) return;
  const lastDay = toDayKey(asDateTimeMs(bounds.endExclusive - 1));
  if (!calendar.isWorkingDay(lastDay)) nonWorkingDay('non-working-end', task.id, lastDay, out);
}

function nonWorkingDay(
  type: 'non-working-start' | 'non-working-end',
  id: TaskId,
  day: DayKey,
  out: Output,
): void {
  const date = fromDayKey(day);
  const key = day * 2 + (type === 'non-working-end' ? 1 : 0);
  let message = out.dayMessages.get(key);
  if (message === undefined) {
    const verb = type === 'non-working-start' ? 'starts' : 'ends';
    message = `${verb} on non-working day ${toISODate(date)}`;
    out.dayMessages.set(key, message);
  }
  out.conflicts.push(Object.freeze({ type, severity: 'warning', id, message, date }));
}

function outsideParent(
  task: TaskModel,
  bounds: TaskBounds,
  parent: TaskModel,
  parentBounds: TaskBounds,
  out: Output,
): void {
  const before = bounds.start < parentBounds.start;
  const after = bounds.endExclusive > parentBounds.endExclusive;
  if (!before && !after) return;
  const edges = before ? (after ? BOTH_EDGES : START_EDGE) : END_EDGE;
  const what = before ? (after ? 'starts before and ends after' : 'starts before') : 'ends after';
  const message = `${what} its parent ${JSON.stringify(parent.id)}`;
  out.conflicts.push(
    Object.freeze({
      type: 'outside-parent',
      severity: 'warning',
      id: task.id,
      message,
      parentId: parent.id,
      edges,
    }),
  );
}

function linkViolated(
  link: ActiveLinkRecord,
  sourceBounds: TaskBounds,
  targetBounds: TaskBounds,
  options: ResolvedModelOptions,
  out: Output,
): void {
  const { lag } = link;
  const anchors = linkAnchors(link.type);
  const from = anchorTime(sourceBounds, anchors.source);
  const to = anchorTime(targetBounds, anchors.target);
  const required = lag.derived ? Math.min(lag.ms, 0) : lag.ms;
  if (enoughGap(to - from, required, lag.mode)) return;
  const actual = measureLag(from, to, lag.mode, options);
  // `NaN` (a gap outside the calendar) is no conflict.
  if (!(actual < required)) return;
  const requiredMs = withoutNegativeZero(required);
  const actualMs = withoutNegativeZero(actual);
  const unit = lag.mode === 'working' ? ' of working time' : '';
  const message =
    `link ${JSON.stringify(link.id)} needs a gap of at least ${gapText(requiredMs)}${unit}, ` +
    `it has ${gapText(actualMs)}`;
  out.conflicts.push(
    Object.freeze({
      type: 'link-violated',
      severity: 'warning',
      id: link.target,
      message,
      linkId: link.id,
      requiredMs,
      actualMs,
    }),
  );
}

/**
 * Whether a link's gap is surely at least `required` (a multiple of the granularity), judged from
 * the plain gap `raw` without measuring it: aligning to the nearest multiple never crosses a
 * multiple, a calendar-mode gap is `raw` aligned, and a working-mode gap lies between `0` and
 * `raw` (working time is part of all time). Most links pass here, so the calendar is rarely asked.
 */
function enoughGap(raw: number, required: number, mode: DurationMode): boolean {
  if (mode === 'calendar' || raw < 0) return raw >= required;
  return required <= 0;
}

function gapText(ms: number): string {
  return durationToString({ months: 0, ms });
}

/** `-0` as `0`, so that conflicts compare equal however the gap was rounded. */
function withoutNegativeZero(ms: number): number {
  return ms === 0 ? 0 : ms;
}

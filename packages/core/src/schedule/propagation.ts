/**
 * Propagation of an edit: a move or resize of one task becomes a {@link ChangeSet} with every
 * task the edit moves through links and the hierarchy: rigid links that keep their lag in both
 * directions, edge pins, locked tasks (`locked`), tasks that keep their duration
 * (`fixedDuration`) and `moveChildren`. It never mutates its input and makes a single
 * topological pass instead of recursing without bound.
 */

import type { WorkCalendar } from '../calendar';
import {
  addTaskDuration,
  type DurationMode,
  type NormalizedModel,
  type ResolvedModelOptions,
  type TaskId,
  type TaskModel,
  type TaskSpan,
} from '../model';
import { rebaseProgress } from '../progress';
import { assertNever } from '../shared';
import {
  alignNearest,
  asDateTimeMs,
  type DatePrecision,
  type DateTimeMs,
  DAY,
  DEFAULT_GRANULARITY,
  type Granularity,
} from '../time';
import type {
  Change,
  ChangeCause,
  ChangeReason,
  ChangeSet,
  Conflict,
  TaskBounds,
} from './changeset';
import { collectConflicts, IN_SCOPE } from './conflicts';
import { anchorTime, type LinkAnchor, linkAnchors, type LinkGraph, measureLag } from './graph';
import type { ScheduleHierarchy } from './hierarchy-view';
import { cyclicComponents, sortIndexes } from './topo-sort';

/**
 * How an edit spreads along links (`scheduling.propagation`):
 * - `'preserve-lag'` (default): successors move in both
 *   directions so that every link keeps its lag;
 * - `'none'`: links are only drawn; children still follow their parent per {@link MoveChildren}.
 */
export type PropagationPolicy = 'none' | 'preserve-lag';

/**
 * Which children move with their parent (`hierarchy.moveChildren`):
 * - `'all'` (default): children with `followParent` follow their
 *   `parentAnchor`; the others shift with the parent's start (keeping their start-to-start offset)
 *   when it changes;
 * - `'following'`: only children with `followParent`;
 * - `'none'`: no child moves.
 */
export type MoveChildren = 'all' | 'following' | 'none';

/** Whether the edited edge skips non-working days (`scheduling.skipNonWorkingDays`). */
export interface SkipNonWorkingDays {
  /** For `'move'`; default `true`. */
  readonly move?: boolean | undefined;
  /** For `'resize-start'` and `'resize-end'`; default `false`. */
  readonly resize?: boolean | undefined;
  /**
   * For the progress handle, read by the interaction layer (`progressFromDate`);
   * default `true` there. {@link propagate} ignores it.
   */
  readonly progress?: boolean | undefined;
}

/** Scheduling options of {@link propagate}; every field has a default. */
export interface PropagationOptions {
  /** Default `'preserve-lag'`. */
  readonly propagation?: PropagationPolicy | undefined;
  /** Default `'all'`. */
  readonly moveChildren?: MoveChildren | undefined;
  /** Default `{ move: true, resize: false, progress: true }`. */
  readonly skipNonWorkingDays?: SkipNonWorkingDays | undefined;
  /**
   * `scheduling.keepDayPrecision`, default `true`: a day-precision edited task stays
   * on whole days. With `false` its command is aligned to the granularity instead, and an edge off
   * midnight turns it into a time-precision task: its change carries `before.precision: 'day'`
   * and `after.precision: 'time'`. Propagated tasks keep their own precision.
   */
  readonly keepDayPrecision?: boolean | undefined;
  /**
   * Whether to compute `ChangeSet.conflicts`. Default `true`. Drag previews, which
   * call {@link propagate} on every pointer move and only need the new bounds, pass `false` and
   * get `conflicts: []`; the commit uses the default, so `onBeforeTaskChange` sees the conflicts.
   */
  readonly conflicts?: boolean | undefined;
}

/** What {@link propagate} schedules against. Built from the same model; also a `ConflictContext`. */
export interface PropagationContext {
  /** The normalized tasks; its options give the work calendar and the granularity. */
  readonly model: NormalizedModel;
  /** The task tree of the model (`buildHierarchy`). */
  readonly hierarchy: ScheduleHierarchy;
  /** The link graph of the model (`buildLinkGraph`). */
  readonly graph: LinkGraph;
  /** Scheduling options. */
  readonly options?: PropagationOptions | undefined;
}

/** Drags the whole bar so that it starts at `start`. */
export interface MoveCommand {
  /** Discriminant, also the {@link ChangeSet.reason}. */
  readonly kind: 'move';
  /** The task. */
  readonly id: TaskId;
  /** The new start, already snapped. */
  readonly start: DateTimeMs;
}

/** Drags the start edge to `start`; the end stays. */
export interface ResizeStartCommand {
  /** Discriminant, also the {@link ChangeSet.reason}. */
  readonly kind: 'resize-start';
  /** The task. */
  readonly id: TaskId;
  /** The new start, already snapped. */
  readonly start: DateTimeMs;
}

/** Drags the end edge to `endExclusive`; the start stays. */
export interface ResizeEndCommand {
  /** Discriminant, also the {@link ChangeSet.reason}. */
  readonly kind: 'resize-end';
  /** The task. */
  readonly id: TaskId;
  /** The new exclusive end, already snapped. */
  readonly endExclusive: DateTimeMs;
}

/**
 * Puts both edges at once (a programmatic change, `updateTask` with `start` and `end`): no UI
 * gesture does this, so the change set's reason is `'api'`.
 */
export interface RescheduleCommand {
  /** Discriminant. */
  readonly kind: 'reschedule';
  /** The task. */
  readonly id: TaskId;
  /** The new start. */
  readonly start: DateTimeMs;
  /** The new exclusive end. */
  readonly endExclusive: DateTimeMs;
}

/** An edit of one task's dates, see {@link propagate}. */
export type PropagationCommand =
  MoveCommand | ResizeStartCommand | ResizeEndCommand | RescheduleCommand;

/**
 * Applies an edit to one task and propagates it through links and the hierarchy. Pure: reads the
 * model, graph and tree, never changes them, and returns a new frozen {@link ChangeSet} (`reason` =
 * `command.kind`, `'api'` for `'reschedule'`).
 *
 * Times are floating date-times. Every value in the result is a multiple of the model's
 * granularity, and of a whole day for day-precision tasks. The calendar
 * and the granularity are the model's (`model.options`), the ones its lengths and lags were
 * measured with.
 *
 * **The edited task** (`cause: 'direct'`). The command's date is expected to be snapped already;
 * a misaligned one is aligned to the nearest boundary of the task's step (a day
 * for day-precision tasks, else the granularity) and a non-finite one is ignored. With
 * `options.keepDayPrecision: false` a day-precision task's step is the granularity too:
 * when its new start or end is off midnight it becomes a time-precision task (its
 * lengths below then follow the time rules) and its change has `before.precision: 'day'` and
 * `after.precision: 'time'`; on whole days it stays a day task.
 * - `move`: the task starts at `start` and keeps its length in its `durationMode`: calendar time,
 *   or working time with the model's end-from-duration rule (day precision: `start` counts when it
 *   is a working day, the end is the day after the last working day). A working-mode task without
 *   working time keeps its calendar length. A milestone stays zero-length.
 * - `resize-start` keeps the end, `resize-end` keeps the start; the task stays at least one step
 *   long. Milestones and `fixedDuration` tasks cannot be resized (no-op).
 * - `reschedule` puts the start at `start` and the end at `endExclusive` (at least one step
 *   later); milestones and `fixedDuration` tasks keep their length, as in a move. Neither edge
 *   skips non-working days: the values are explicit.
 * - With `skipNonWorkingDays.move` (`move`) or `.resize` (resizes), a start on a non-working day
 *   moves **forward** to the next working day at the same time of day, and an exclusive end inside
 *   a non-working stretch (the instant before it lies on a non-working day) moves **back** to the
 *   end of the last working day ("start on Saturday + accept → Monday";
 *   `WorkCalendar.rollToWorking`). A resize is first clamped to the minimum length, then rolled:
 *   when the roll carries the dragged edge past that minimum (a start rolled forward beyond
 *   `endExclusive - step`, an end rolled back before `start + step`), the edit is a no-op rather
 *   than a task shrunk onto non-working time.
 * - Unknown ids, tasks without a bar and `locked` tasks give an empty change set, as does an edit
 *   that changes nothing. The edit is **forward** when either edge moves later and backward when
 *   neither does: a widening edit (start earlier, end later) is forward by its end, a narrowing
 *   one forward by its start.
 *
 * **Propagation.** Tasks are visited in **one topological pass** over the edges an edit can
 * travel: active links that are not on a cycle (with `'preserve-lag'` only) and parent → child
 * edges (per `moveChildren`), restricted to the tasks the edited task reaches. Every task is
 * visited at most once, after all its predecessors in that pass, so cycles cannot loop. Links
 * alone are acyclic here, but with parent → child edges they can still form a cycle (e.g. a link
 * from a child to its own parent): like the links of a cycle of links, every link of
 * such a cycle (of its strongly connected component) is ignored. Tasks without a bar and `locked`
 * tasks never move and **stop** the propagation: a change does not travel through them.
 *
 * A visited task collects **pins** from its predecessors that changed:
 * - a link pins the target's edge of its type (`FS`, `SS`: the start; `FF`, `SF`: the
 *   end) at `anchorTime(newSourceSpan, sourceAnchor) + lag`, the lag counted in the target's
 *   `durationMode` (working time with `addWorkingTime`, else plain milliseconds);
 * - a parent pins a `followParent` child per `parentAnchor` (`SS` / `FS` the start, `FF` / `SF`
 *   the end) at the parent's new edge + the offset measured from the parent's **old** span to the
 *   child's edge in the child's mode (`measureLag`); with `moveChildren: 'all'` it pins the start
 *   of any other child at the parent's new start + their old start-to-start offset, when the
 *   parent's start changed.
 *
 * When several pins hit the same edge, the one **furthest in the direction of the edit** wins (the
 * latest after a forward edit, the earliest after a backward one); on equal times the parent comes
 * before links, and links keep the graph's model order. As an edit that moves any edge later is
 * forward, the latest pin wins whenever one may come from an edge that moved later: a successor
 * never keeps an earlier pin that breaks the link of such an edge. Then:
 * - only the start pinned → the task **moves** there, keeping its length as above;
 * - only the end pinned → it moves so that it ends there, keeping its length (working time is
 *   counted back from the end);
 * - both pinned (`FS` + `FF`; `parentAnchor: ['SS', 'FF']`) → it **stretches** to both
 *   pins, unless it is `fixedDuration` or a milestone, or the pins leave less than one step: then
 *   it moves by the start pin. (Both pins of an `FS` + `FF` pair hang on the predecessor's end, so
 *   with the current gaps as lags they move together and the successor keeps its length; it
 *   stretches when the lags ask for another length, or when its pins come from different edges or
 *   tasks, e.g. `SS` + `FF` after a resize.)
 *
 * Pins of a day-precision task are aligned to the nearest day (ties in the direction of the edit),
 * so day tasks in a chain of time tasks stay on day boundaries. Pins of a working-mode
 * task are then rolled onto working time: a start on a non-working day moves forward to the next
 * working day at the same time of day; an end inside a non-working stretch moves back to the end of
 * the last working day (a predecessor ending on Friday with an `FS` lag of 0 starts its successor
 * on Monday, not on Saturday). A task whose new span equals its old one is unchanged and moves
 * nothing further. When the calendar has no working time to place a task, it stays.
 *
 * A changed task's change has `cause: 'link'` or `'parent'` and `via`, the predecessor of the pin
 * that placed it (the start pin when there is one).
 *
 * **Progress**: each changed task's progress is rebased with `rebaseProgress` from the
 * old to the new span, keeping the done part (`progressAnchor: 'start'`, default) or the remainder
 * (`'end'`); a move keeps the percentage.
 *
 * **Order**: the edited task first, then the other changed tasks in the pass's topological order
 * (ties in model order).
 *
 * **Conflicts**: `conflicts` are those of the model with the changes applied that
 * involve a changed task — `detectConflicts(applyChangeSet(model, changeSet), context, changedIds)`:
 * its own non-working start or end, it outside its parent or its children outside it, and violated
 * links into or out of it (e.g. into a `locked` successor, or any link under `'none'`). Conflicts
 * elsewhere in the plan, which the edit cannot have caused, are left out. An empty change set has
 * none, and neither has any change set with `options.conflicts: false` (drag previews), which
 * skips the check.
 *
 * Runs in O((V + E) log V) over the tasks and edges the edit reaches, plus O(V) scans of scratch
 * arrays the size of the model and the conflict checks of the changed tasks and their
 * neighbours.
 *
 * @param command - The edit.
 * @param context - The model, its tree and link graph, and the options.
 * @returns The change set; `changes` is empty when nothing changes.
 *
 * @example
 * ```ts
 * const model = normalizeModel({ tasks, links }, { calendar });
 * const context = { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) };
 * const { changes } = propagate({ kind: 'move', id: 'design', start: nextMonday }, context);
 * // [{ id: 'design', cause: 'direct', … }, { id: 'build', cause: 'link', via: 'design', … }]
 * ```
 */
export function propagate(command: PropagationCommand, context: PropagationContext): ChangeSet {
  const { model, hierarchy, graph } = context;
  const options = context.options ?? {};
  const reason = command.kind === 'reschedule' ? 'api' : command.kind;
  const task = model.taskById.get(command.id);
  if (task === undefined || !isMovable(task)) return emptyChangeSet(reason);
  const settings = model.options;
  const next = directBounds(command, task, settings, options);
  if (next === undefined) return emptyChangeSet(reason);
  const { span } = task;
  if (next.start === span.start && next.endExclusive === span.endExclusive) {
    return emptyChangeSet(reason);
  }
  // Forward when either edge moves later (a widening edit by its end).
  const later = next.start > span.start || next.endExclusive > span.endExclusive;

  const scope: Scope = {
    tasks: model.tasks,
    taskById: model.taskById,
    hierarchy,
    graph,
    links: (options.propagation ?? 'preserve-lag') === 'preserve-lag',
    moveChildren: options.moveChildren ?? 'all',
  };
  const { order, ignored } = passOrder(scope, task.index);
  const run: Run = { ...scope, settings, forward: later, ignored, moved: [] };
  run.moved[task.index] = next;
  const changed = new Uint8Array(model.tasks.length);
  changed[task.index] = IN_SCOPE;
  const changes: Change[] = [changeOf(task, next, 'direct', undefined, settings, next.precision)];
  for (const index of order) {
    const other = model.tasks[index];
    if (other === undefined || !isMovable(other)) continue;
    const placed = follow(run, other);
    if (placed === undefined) continue;
    run.moved[index] = placed.bounds;
    changed[index] = IN_SCOPE;
    changes.push(changeOf(other, placed.bounds, placed.pin.cause, placed.pin.via, settings));
  }
  const { tasks } = model;
  const conflicts =
    options.conflicts === false
      ? NO_CONFLICTS
      : collectConflicts(context, (index) => run.moved[index] ?? tasks[index]?.span, changed);
  return Object.freeze({ reason, changes: Object.freeze(changes), conflicts });
}

/** Start and exclusive end of a span. */
type Bounds = TaskBounds;

/** The edited task's new bounds and its precision after the edit. */
interface DirectBounds extends Bounds {
  readonly precision: DatePrecision;
}

/** A task with a bar. */
type Dated = TaskModel & { readonly span: TaskSpan };

/** Where a predecessor puts one edge of a task. */
interface Pin {
  readonly time: DateTimeMs;
  readonly cause: Exclude<ChangeCause, 'direct'>;
  readonly via: TaskId;
}

/** What the pass travels over. */
interface Scope {
  readonly tasks: readonly TaskModel[];
  readonly taskById: ReadonlyMap<TaskId, TaskModel>;
  readonly hierarchy: ScheduleHierarchy;
  readonly graph: LinkGraph;
  /** Whether links propagate (`'preserve-lag'`). */
  readonly links: boolean;
  readonly moveChildren: MoveChildren;
}

/** State of one {@link propagate} call. */
interface Run extends Scope {
  readonly settings: ResolvedModelOptions;
  /** Direction of the edit: later (`true`) or earlier. */
  readonly forward: boolean;
  /** Links ignored because they close a cycle with parent → child edges. */
  readonly ignored: ReadonlySet<string>;
  /** New bounds by model index, for the changed tasks only. */
  readonly moved: (Bounds | undefined)[];
}

const NO_CHANGES: readonly Change[] = /* @__PURE__ */ Object.freeze([]);
const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);
const NO_LINKS: ReadonlySet<string> = /* @__PURE__ */ new Set();

function emptyChangeSet(reason: ChangeReason): ChangeSet {
  return Object.freeze({ reason, changes: NO_CHANGES, conflicts: NO_CONFLICTS });
}

/** Whether a task can move: it has a bar and is not locked. */
function isMovable(task: TaskModel): task is Dated {
  return task.span !== undefined && task.task.locked !== true;
}

/** The data step of a task: a whole day for day precision, else the granularity. */
function stepOf(task: TaskModel, granularity: Granularity): Granularity {
  return task.precision === 'day' ? DEFAULT_GRANULARITY : granularity;
}

/**
 * The edited task's new bounds and precision, or `undefined` for a no-op command. Without
 * `keepDayPrecision` a day-precision task is edited at the granularity and becomes timed when an
 * edge leaves midnight.
 */
function directBounds(
  command: PropagationCommand,
  task: Dated,
  settings: ResolvedModelOptions,
  options: PropagationOptions,
): DirectBounds | undefined {
  const { span } = task;
  const { calendar } = settings;
  const skip = options.skipNonWorkingDays;
  const free = task.precision === 'day' && options.keepDayPrecision === false;
  const step = free ? settings.granularity : stepOf(task, settings.granularity);
  const rigid = task.type === 'milestone' || task.task.fixedDuration === true;
  const precisionOf = (start: DateTimeMs, end: DateTimeMs): DatePrecision =>
    free && (start % DAY !== 0 || end % DAY !== 0) ? 'time' : task.precision;
  /** A move: the start decides the precision, and with it the rule for the end. */
  const movedTo = (start: DateTimeMs): DirectBounds | undefined => {
    const precision = precisionOf(start, start);
    const endExclusive = endAfter(task, start, settings, precision);
    return endExclusive === undefined ? undefined : { start, endExclusive, precision };
  };
  const between = (start: DateTimeMs, endExclusive: DateTimeMs): DirectBounds => ({
    start,
    endExclusive,
    precision: precisionOf(start, endExclusive),
  });
  switch (command.kind) {
    case 'move': {
      if (!Number.isFinite(command.start)) return undefined;
      let start = alignNearest(command.start, step);
      if (skip?.move ?? true) start = rollStart(start, calendar);
      return movedTo(start);
    }
    case 'resize-start': {
      if (rigid || !Number.isFinite(command.start)) return undefined;
      // Clamp to the minimum length first, then roll: a start rolled past it is a no-op.
      const latest = asDateTimeMs(span.endExclusive - step.ms);
      const aligned = alignNearest(command.start, step);
      let start = aligned > latest ? latest : aligned;
      if (skip?.resize === true) start = rollStart(start, calendar);
      return start > latest ? undefined : between(start, span.endExclusive);
    }
    case 'resize-end': {
      if (rigid || !Number.isFinite(command.endExclusive)) return undefined;
      const earliest = asDateTimeMs(span.start + step.ms);
      const aligned = alignNearest(command.endExclusive, step);
      let endExclusive = aligned < earliest ? earliest : aligned;
      if (skip?.resize === true) endExclusive = rollEnd(endExclusive, calendar);
      return endExclusive < earliest ? undefined : between(span.start, endExclusive);
    }
    case 'reschedule': {
      const finite = Number.isFinite(command.start) && Number.isFinite(command.endExclusive);
      if (!finite) return undefined;
      const start = alignNearest(command.start, step);
      if (rigid) return movedTo(start);
      const earliest = asDateTimeMs(start + step.ms);
      const aligned = alignNearest(command.endExclusive, step);
      return between(start, aligned < earliest ? earliest : aligned);
    }
    default:
      return assertNever(command, 'Unknown propagation command');
  }
}

/**
 * The tasks the edit can reach, in the order of the pass (without the edited task), and the links
 * ignored because they close a cycle with parent → child edges.
 */
function passOrder(
  scope: Scope,
  root: number,
): { readonly order: readonly number[]; readonly ignored: ReadonlySet<string> } {
  let reach = reachable(scope, root, NO_LINKS);
  let sorted = sortIndexes(reach.adjacency);
  let ignored = NO_LINKS;
  if (sorted.blocked.length > 0) {
    ignored = linksOnCycles(scope, reach);
    reach = reachable(scope, root, ignored);
    sorted = sortIndexes(reach.adjacency);
  }
  const order: number[] = [];
  for (const local of sorted.order) {
    const index = reach.nodes[local];
    if (index !== undefined && index !== root) order.push(index);
  }
  return { order, ignored };
}

/** The part of the pass's graph the edited task reaches, over local node numbers. */
interface Reach {
  /** Model indexes of the reached tasks, ascending (model order breaks ties of the sort). */
  readonly nodes: Int32Array;
  /** Local number (position in `nodes`) by model index; meaningful for reached tasks only. */
  readonly local: Int32Array;
  /** Successors by local number. */
  readonly adjacency: readonly (readonly number[])[];
}

/** Breadth-first search from `root` over the pass's edges (see {@link stepsFrom}). */
function reachable(scope: Scope, root: number, ignored: ReadonlySet<string>): Reach {
  const size = scope.tasks.length;
  const seen = new Uint8Array(size);
  const queue: number[] = [root];
  const from: number[] = [];
  const to: number[] = [];
  seen[root] = 1;
  let current = root;
  const visit = (target: number): void => {
    from.push(current);
    to.push(target);
    if (seen[target] === 1) return;
    seen[target] = 1;
    queue.push(target);
  };
  // `queue` grows while it is iterated: the array iterator reads the length on every step.
  for (const index of queue) {
    current = index;
    stepsFrom(scope, index, ignored, visit);
  }
  const nodes = Int32Array.from(queue).sort();
  const local = new Int32Array(size);
  const adjacency: number[][] = [];
  for (let i = 0; i < nodes.length; i++) {
    local[nodes[i] ?? 0] = i;
    adjacency.push([]);
  }
  for (let e = 0; e < from.length; e++) {
    adjacency[local[from[e] ?? 0] ?? 0]?.push(local[to[e] ?? 0] ?? 0);
  }
  return { nodes, local, adjacency };
}

/**
 * Calls `visit` for every edge of the pass out of a task, to a task that can move: active links
 * that are not on a cycle (with `'preserve-lag'`, minus `ignored`) and parent → child edges (per
 * `moveChildren`).
 */
function stepsFrom(
  scope: Scope,
  index: number,
  ignored: ReadonlySet<string>,
  visit: (target: number, linkId: string | undefined) => void,
): void {
  const task = scope.tasks[index];
  if (task === undefined) return;
  const { taskById, hierarchy, moveChildren } = scope;
  if (scope.links) {
    for (const link of scope.graph.successorsOf(task.id)) {
      if (link.inCycle || ignored.has(link.id)) continue;
      const target = taskById.get(link.target);
      if (target !== undefined && isMovable(target)) visit(target.index, link.id);
    }
  }
  if (moveChildren === 'none') return;
  for (const childId of hierarchy.nodeById.get(task.id)?.childIds ?? NO_IDS) {
    if (moveChildren === 'following' && hierarchy.nodeById.get(childId)?.followParent !== true) {
      continue;
    }
    const child = taskById.get(childId);
    if (child !== undefined && isMovable(child)) visit(child.index, undefined);
  }
}

/**
 * The links inside the cycles of a reach. Links alone are acyclic there (`inCycle` links are
 * skipped), so every cycle mixes links with parent → child edges; without the links inside each
 * strongly connected component only tree edges are left there, which cannot form a cycle.
 */
function linksOnCycles(scope: Scope, reach: Reach): ReadonlySet<string> {
  const { nodes, local } = reach;
  const component = new Int32Array(nodes.length).fill(-1);
  cyclicComponents(reach.adjacency).forEach((members, k) => {
    for (const member of members) component[member] = k;
  });
  const ignored = new Set<string>();
  for (const index of nodes) {
    const k = component[local[index] ?? 0] ?? -1;
    if (k === -1) continue;
    stepsFrom(scope, index, NO_LINKS, (target, linkId) => {
      if (linkId !== undefined && component[local[target] ?? 0] === k) ignored.add(linkId);
    });
  }
  return ignored;
}

const NO_IDS: readonly TaskId[] = /* @__PURE__ */ Object.freeze([]);

/** The new bounds of a visited task and the pin that placed it, or `undefined` if it stays. */
function follow(run: Run, task: Dated): { readonly bounds: Bounds; readonly pin: Pin } | undefined {
  const { forward, settings } = run;
  const mode = task.durationMode;
  let start: Pin | undefined;
  let end: Pin | undefined;

  const node = run.moveChildren === 'none' ? undefined : run.hierarchy.nodeById.get(task.id);
  const parent = node?.parentId === undefined ? undefined : run.taskById.get(node.parentId);
  const parentMoved = parent === undefined ? undefined : run.moved[parent.index];
  if (node !== undefined && parent?.span !== undefined && parentMoved !== undefined) {
    const old = parent.span;
    if (node.followParent) {
      for (const type of node.parentAnchor) {
        const anchors = linkAnchors(type);
        const from = anchorTime(old, anchors.source);
        const offset = measureLag(from, anchorTime(task.span, anchors.target), mode, settings);
        const time = shift(settings, anchorTime(parentMoved, anchors.source), offset, mode);
        if (time === undefined) continue;
        if (anchors.target === 'start') start = further(forward, start, time, 'parent', parent.id);
        else end = further(forward, end, time, 'parent', parent.id);
      }
    } else if (run.moveChildren === 'all' && parentMoved.start !== old.start) {
      const offset = measureLag(old.start, task.span.start, mode, settings);
      const time = shift(settings, parentMoved.start, offset, mode);
      if (time !== undefined) start = further(forward, start, time, 'parent', parent.id);
    }
  }

  if (run.links) {
    for (const link of run.graph.predecessorsOf(task.id)) {
      if (link.inCycle || run.ignored.has(link.id)) continue;
      const source = run.taskById.get(link.source);
      const moved = source === undefined ? undefined : run.moved[source.index];
      if (moved === undefined) continue;
      const anchors = linkAnchors(link.type);
      const time = shift(settings, anchorTime(moved, anchors.source), link.lag.ms, link.lag.mode);
      if (time === undefined) continue;
      if (anchors.target === 'start') start = further(forward, start, time, 'link', link.source);
      else end = further(forward, end, time, 'link', link.source);
    }
  }

  const by = start ?? end;
  if (by === undefined) return undefined;
  const bounds = place(run, task, start?.time, end?.time);
  if (bounds === undefined) return undefined;
  if (bounds.start === task.span.start && bounds.endExclusive === task.span.endExclusive) {
    return undefined;
  }
  return { bounds, pin: by };
}

/**
 * Of the current pin of an edge and a new candidate, the one further in the direction of the edit;
 * on equal times the current one stays.
 */
function further(
  forward: boolean,
  current: Pin | undefined,
  time: DateTimeMs,
  cause: Pin['cause'],
  via: TaskId,
): Pin {
  if (current !== undefined && !(forward ? time > current.time : time < current.time)) {
    return current;
  }
  return { time, cause, via };
}

/** A task's new bounds from its start and end pins (see {@link propagate}). */
function place(
  run: Run,
  task: Dated,
  startPin: DateTimeMs | undefined,
  endPin: DateTimeMs | undefined,
): Bounds | undefined {
  const { settings } = run;
  const step = stepOf(task, settings.granularity);
  if (startPin !== undefined) {
    const start = fit(run, task, step, startPin, 'start');
    const rigid = task.type === 'milestone' || task.task.fixedDuration === true;
    if (endPin !== undefined && !rigid) {
      const endExclusive = fit(run, task, step, endPin, 'end');
      if (endExclusive - start >= step.ms) return { start, endExclusive };
    }
    const endExclusive = endAfter(task, start, settings);
    return endExclusive === undefined ? undefined : { start, endExclusive };
  }
  if (endPin === undefined) return undefined;
  const endExclusive = fit(run, task, step, endPin, 'end');
  const start = startBefore(task, endExclusive, settings);
  return start === undefined ? undefined : { start, endExclusive };
}

/**
 * A pin of a propagated task made a valid edge: aligned to the nearest step (ties in the direction
 * of the edit), then, in working mode, rolled onto working time.
 */
function fit(
  run: Run,
  task: Dated,
  step: Granularity,
  t: DateTimeMs,
  edge: LinkAnchor,
): DateTimeMs {
  const aligned = alignNearest(t, step, run.forward ? 'up' : 'down');
  if (task.durationMode !== 'working') return aligned;
  const { calendar } = run.settings;
  return edge === 'start' ? rollStart(aligned, calendar) : rollEnd(aligned, calendar);
}

/** `t` moved by `ms` of `mode` time; `undefined` when the calendar runs out of working days. */
function shift(
  settings: ResolvedModelOptions,
  t: DateTimeMs,
  ms: number,
  mode: DurationMode,
): DateTimeMs | undefined {
  return mode === 'working' ? settings.calendar.addWorkingTime(t, ms) : asDateTimeMs(t + ms);
}

/**
 * The end of a task moved to `start`, keeping its length: working time with the model's rule for
 * `precision` (`addTaskDuration`; the task's own by default), calendar time otherwise or when it
 * has no working time.
 */
function endAfter(
  task: Dated,
  start: DateTimeMs,
  settings: ResolvedModelOptions,
  precision: DatePrecision = task.precision,
): DateTimeMs | undefined {
  const { ms, workingMs } = task.span.duration;
  if (task.durationMode !== 'working' || workingMs <= 0) return asDateTimeMs(start + ms);
  return addTaskDuration(start, { months: 0, ms: workingMs }, precision, 'working', settings);
}

/** The start of a task moved to end at `endExclusive`, keeping its length (see {@link endAfter}). */
function startBefore(
  task: Dated,
  endExclusive: DateTimeMs,
  settings: ResolvedModelOptions,
): DateTimeMs | undefined {
  const { ms, workingMs } = task.span.duration;
  if (task.durationMode !== 'working' || workingMs <= 0) return asDateTimeMs(endExclusive - ms);
  return settings.calendar.addWorkingTime(endExclusive, -workingMs);
}

/**
 * A start on a non-working day moved forward to the next working day, same time of day; kept when
 * the calendar has none.
 */
function rollStart(t: DateTimeMs, calendar: WorkCalendar): DateTimeMs {
  return calendar.rollToWorking(t, 1, { keepTimeOfDay: true }) ?? t;
}

/**
 * An exclusive end inside a non-working stretch (its previous instant lies on a non-working day)
 * moved back to the end of the last working day; kept when the calendar has none.
 */
function rollEnd(t: DateTimeMs, calendar: WorkCalendar): DateTimeMs {
  return calendar.rollToWorking(t, -1, { edge: 'end' }) ?? t;
}

/**
 * The progress of a task on its new span: `rebaseProgress`. A span of the same
 * measured length (any move) keeps the percentage exactly, as `rebaseProgress` guarantees; that
 * common case is answered here without it, since its progress date is not needed.
 */
function progressOn(task: Dated, to: Bounds, settings: ResolvedModelOptions): number {
  const { duration } = task.span;
  const ms = to.endExclusive - to.start;
  if (ms > 0 && duration.ms > 0) {
    // The lengths `rebaseProgress` compares: working time when both spans have some.
    let same = ms === duration.ms;
    if (task.durationMode === 'working' && duration.workingMs > 0) {
      const working = settings.calendar.countWorkingTime(to.start, to.endExclusive);
      if (working > 0) same = working === duration.workingMs;
    }
    if (same) return task.progress;
  }
  return rebaseProgress({
    progress: task.progress,
    from: task.span,
    to,
    anchor: task.task.progressAnchor,
    mode: task.durationMode,
    calendar: settings.calendar,
    granularity: settings.granularity,
  }).progress;
}

/**
 * The frozen change of a task, with its progress rebased onto the new span; a
 * `precision` other than the task's is recorded on both sides (`TaskPatch.precision`).
 */
function changeOf(
  task: Dated,
  after: Bounds,
  cause: ChangeCause,
  via: TaskId | undefined,
  settings: ResolvedModelOptions,
  precision: DatePrecision = task.precision,
): Change {
  const { span } = task;
  const progress = progressOn(task, after, settings);
  const was = { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
  const now = { start: after.start, endExclusive: after.endExclusive, progress };
  const same = precision === task.precision;
  const before = Object.freeze(same ? was : { ...was, precision: task.precision });
  const patch = Object.freeze(same ? now : { ...now, precision });
  const change = { id: task.id, before, after: patch, cause };
  return Object.freeze(via === undefined ? change : { ...change, via });
}

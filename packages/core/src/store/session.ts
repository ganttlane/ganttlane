/**
 * Edit sessions in the store: the base a session starts
 * from, the aggregated diff from it to the current data, its inverse for a rollback, and the
 * committed values of a task. Pure functions over snapshots.
 */

import { buildHierarchy } from '../hierarchy';
import { type LinkModel, normalizeModel, type TaskId, type TaskModel } from '../model';
import {
  buildLinkGraph,
  type Change,
  type ChangeSet,
  type Conflict,
  type ConflictContext,
  detectConflicts,
  type ScheduleState,
  type TaskPatch,
} from '../schedule';
import type { DatePrecision } from '../time';
import type { EditSessionBase, SessionChanges, StoreSettings, StoreState } from './types';

/** What changed between the base of a session and a state. */
interface SessionDiff {
  readonly changes: readonly Change[];
  readonly added: readonly LinkModel[];
  readonly removed: readonly LinkModel[];
}

const NO_STATE: ScheduleState = /* @__PURE__ */ new Map();
const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);
const NO_LINKS: readonly LinkModel[] = /* @__PURE__ */ Object.freeze([]);

/**
 * The base of a session opened on `state` (`beginSession`).
 *
 * @internal
 */
export function createSessionBase<TData>(state: StoreState<TData>): EditSessionBase<TData> {
  const { tasks, links, draft, derived } = state;
  return Object.freeze({
    token: Object.freeze({}),
    tasks,
    links,
    pending: draft?.committedLayer?.patches,
    model: derived.model,
    hierarchy: derived.hierarchy,
    graph: derived.graph,
  });
}

/**
 * The base for new settings: its model (with the graph) and its tree rebuilt when the options
 * they were built with changed; `base` itself when none did.
 *
 * @internal
 */
export function rebaseSession<TData>(
  base: EditSessionBase<TData>,
  prev: StoreSettings,
  settings: StoreSettings,
): EditSessionBase<TData> {
  const same = prev.model === settings.model;
  if (same && prev.hierarchy === settings.hierarchy) return base;
  const model = same
    ? base.model
    : normalizeModel<TData>({ tasks: base.tasks, links: base.links }, settings.model);
  const hierarchy = buildHierarchy(model, settings.hierarchy);
  const graph = same ? base.graph : buildLinkGraph(model);
  return Object.freeze({ ...base, model, hierarchy, graph });
}

/**
 * A task's committed values: for controlled data, the `after` of the draft's
 * committed layer when it changes the task (a change the owner has not applied yet is part of the
 * data), else the values of the model. Unlike `selectTaskPatch`, the preview layer is ignored.
 * Tasks without a bar have none.
 *
 * @param state - A store snapshot.
 * @param id - The task.
 * @returns The values, or `undefined` for a task without a bar.
 */
export function selectCommittedPatch(state: StoreState, id: TaskId): TaskPatch | undefined {
  const task = state.derived.model.taskById.get(id);
  const own = task && patchOf(task);
  return own && (committedPatches(state)?.get(id) ?? own);
}

/**
 * The aggregated diff of the open edit session: from its base to the current data,
 * see {@link SessionChanges}. Runs in O(tasks + links) plus the conflict check of the changed
 * tasks.
 *
 * @param state - A store snapshot.
 * @returns The changes (`reason: 'session'`), or `undefined` without an open session.
 */
export function selectSessionChanges(state: StoreState): SessionChanges | undefined {
  const base = state.session;
  if (base === undefined) return undefined;
  const current = committedPatches(state);
  const diff = diffSession(state, base, current, false);
  const conflicts = conflictsOf(diff, current, state.derived);
  return freezeChanges('session', diff.changes, diff.added, diff.removed, conflicts);
}

/**
 * What a rollback of the open edit session reverts: the inverse of
 * {@link selectSessionChanges} (`reason: 'rollback'`): each change goes from the current value
 * back to the base value, `links.added` lists the links to restore and `links.removed` the links
 * to drop, `conflicts` are those of the base. This is what controlled data has to apply.
 *
 * @param state - A store snapshot.
 * @returns The inverse, or `undefined` without an open session.
 */
export function selectSessionRollback(state: StoreState): SessionChanges | undefined {
  const base = state.session;
  if (base === undefined) return undefined;
  const diff = diffSession(state, base, committedPatches(state), false);
  const changes = diff.changes.map(invert);
  const inverse = { changes, added: diff.removed, removed: diff.added };
  const conflicts = conflictsOf(inverse, base.pending, base);
  return freezeChanges('rollback', changes, diff.removed, diff.added, conflicts);
}

/**
 * Whether the open edit session has changes: `selectSessionChanges` would list a task
 * or a link. Stops at the first difference; O(1) while the data is the base itself.
 *
 * @param state - A store snapshot.
 * @returns `false` without an open session.
 */
export function selectSessionDirty(state: StoreState): boolean {
  const base = state.session;
  if (base === undefined) return false;
  const current = committedPatches(state);
  if (state.derived.model === base.model && current === base.pending) return false;
  const diff = diffSession(state, base, current, true);
  return diff.changes.length > 0 || diff.added.length > 0 || diff.removed.length > 0;
}

/**
 * The draft that shows the base of a session over controlled data after a rollback: the base
 * value of every task whose model value differs (the owner's data, without the committed layer
 * that the rollback replaces); `undefined` when none does.
 *
 * @internal
 */
export function rollbackDraft<TData>(
  state: StoreState<TData>,
  base: EditSessionBase<TData>,
): ChangeSet | undefined {
  const { changes } = diffSession(state, base, undefined, false);
  if (changes.length === 0) return undefined;
  const inverse = changes.map(invert);
  const after = new Map<TaskId, TaskPatch>(inverse.map((change) => [change.id, change.after]));
  const ids = inverse.map((change) => change.id);
  const conflicts = detectConflicts(after, state.derived, ids);
  return Object.freeze({ reason: 'rollback', changes: Object.freeze(inverse), conflicts });
}

/** The patches of the committed layer (controlled data the owner has not applied yet). */
function committedPatches(state: StoreState): ReadonlyMap<TaskId, TaskPatch> | undefined {
  return state.draft?.committedLayer?.patches;
}

/**
 * Tasks whose value differs between the base (with its pending patches) and the state (with
 * `current`), then links added and removed; with `first`, stops at the first difference. A task
 * whose precision differs is changed even with the same dates: its change carries
 * the precision on both sides (`TaskPatch.precision`), so that its inverse restores it.
 */
function diffSession(
  state: StoreState,
  base: EditSessionBase,
  current: ReadonlyMap<TaskId, TaskPatch> | undefined,
  first: boolean,
): SessionDiff {
  const { model } = state.derived;
  const changes: Change[] = [];
  for (const task of model.tasks) {
    const old = base.model.taskById.get(task.id);
    if (old === undefined) continue;
    const now = patchOf(task);
    const then = patchOf(old);
    if (now === undefined || then === undefined) continue;
    const pendingBefore = base.pending?.get(task.id);
    const pendingAfter = current?.get(task.id);
    const before = pendingBefore ?? then;
    const after = pendingAfter ?? now;
    // A pending patch carries the precision when its change set changed it.
    const from = pendingBefore?.precision ?? old.precision;
    const to = pendingAfter?.precision ?? task.precision;
    if (from === to && samePatch(before, after)) continue;
    const flipped = from !== to;
    changes.push(
      Object.freeze({
        id: task.id,
        before: withPrecision(before, flipped ? from : undefined),
        after: withPrecision(after, flipped ? to : undefined),
        cause: 'direct',
      }),
    );
    if (first) return { changes, added: NO_LINKS, removed: NO_LINKS };
  }
  const added: LinkModel[] = [];
  for (const link of model.links) {
    const old = base.model.linkById.get(link.id);
    if (old !== undefined && sameLink(old, link)) continue;
    added.push(link);
    if (first) return { changes, added, removed: NO_LINKS };
  }
  const removed: LinkModel[] = [];
  for (const link of base.model.links) {
    const now = model.linkById.get(link.id);
    if (now === undefined || !sameLink(link, now)) removed.push(link);
  }
  return { changes, added, removed };
}

/** Conflicts of a state that involve a changed task or the ends of a changed link. */
function conflictsOf(
  diff: SessionDiff,
  patches: ReadonlyMap<TaskId, TaskPatch> | undefined,
  context: ConflictContext,
): readonly Conflict[] {
  const scope: TaskId[] = diff.changes.map((change) => change.id);
  for (const link of [...diff.added, ...diff.removed]) scope.push(link.source, link.target);
  return scope.length === 0 ? NO_CONFLICTS : detectConflicts(patches ?? NO_STATE, context, scope);
}

function freezeChanges(
  reason: SessionChanges['reason'],
  changes: readonly Change[],
  added: readonly LinkModel[],
  removed: readonly LinkModel[],
  conflicts: readonly Conflict[],
): SessionChanges {
  return Object.freeze({
    reason,
    changes: Object.freeze([...changes]),
    conflicts,
    links: Object.freeze({
      added: Object.freeze([...added]),
      removed: Object.freeze([...removed]),
    }),
  });
}

function invert(change: Change): Change {
  return Object.freeze({
    id: change.id,
    before: change.after,
    after: change.before,
    cause: 'direct',
  });
}

/** A task's values in the model; `undefined` for a task without a bar. */
function patchOf(task: TaskModel): TaskPatch | undefined {
  const { span, progress } = task;
  return span && Object.freeze({ start: span.start, endExclusive: span.endExclusive, progress });
}

/** Whether two values are equal in their dates and progress (the precision is compared apart). */
function samePatch(a: TaskPatch, b: TaskPatch): boolean {
  return a.start === b.start && a.endExclusive === b.endExclusive && a.progress === b.progress;
}

/**
 * `patch` with `precision` set, or without one for `undefined` (a change that keeps the
 * precision does not list it); `patch` itself when it already is so.
 */
function withPrecision(patch: TaskPatch, precision: DatePrecision | undefined): TaskPatch {
  if (patch.precision === precision) return patch;
  const { precision: _old, ...values } = patch;
  return Object.freeze(precision === undefined ? values : { ...values, precision });
}

/** Whether two links schedule alike: same ends, type and lag (`editable` is not compared). */
function sameLink(a: LinkModel, b: LinkModel): boolean {
  return a.source === b.source && a.target === b.target && a.type === b.type && a.lag === b.lag;
}

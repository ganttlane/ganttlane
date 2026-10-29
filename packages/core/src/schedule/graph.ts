/**
 * The dependency graph: the
 * normalized links checked against the tasks, with typed anchors, resolved lags, adjacency,
 * cycles and a stable topological order for propagation.
 */

import type {
  DurationMode,
  LinkModel,
  LinkType,
  NormalizedModel,
  ResolvedModelOptions,
  TaskId,
  TaskModel,
  TaskSpan,
} from '../model';
import { assertNever, DEV } from '../shared';
import { alignDurationMs, type DateTimeMs, DAY } from '../time';
import { type ScheduleIssue, scheduleIssue } from './issues';
import { cyclicComponents, sortIndexes } from './topo-sort';

/** Edge of a bar a link attaches to: its `start` or its `end` (the exclusive end). */
export type LinkAnchor = 'start' | 'end';

/** The anchors a link type connects, from the source's edge to the target's edge. */
export interface LinkAnchors {
  /** Edge of the predecessor. */
  readonly source: LinkAnchor;
  /** Edge of the successor. */
  readonly target: LinkAnchor;
}

/**
 * The lag of a link: the gap from the source anchor to the target
 * anchor that propagation keeps. Positive: the target anchor lies later; negative: a lead
 * (overlap).
 */
export interface LinkLag {
  /** The gap in milliseconds of `mode` time, a multiple of the granularity. */
  readonly ms: number;
  /** How it is counted: the successor's `durationMode`. */
  readonly mode: DurationMode;
  /** `true` when `Link.lag` was omitted and this is the current gap. */
  readonly derived: boolean;
  /** `ms` in days (`ms / 1d`, fractional for sub-day lags). */
  readonly days: number;
}

/** Fields shared by active and inactive {@link LinkRecord}s. */
export interface LinkRecordBase {
  /** `LinkModel.id`. */
  readonly id: string;
  /** Predecessor. */
  readonly source: TaskId;
  /** Successor. */
  readonly target: TaskId;
  /** Link type. */
  readonly type: LinkType;
  /** Whether the UI offers to delete the link; `removeLink()` ignores it, see {@link Link.editable}. */
  readonly editable: boolean;
  /** The normalized link (its caller's `Link`, path and model issues). */
  readonly model: LinkModel;
  /** Schedule issues of this link (`'inactive-link'`, `'cycle'`), also in `LinkGraph.issues`. */
  readonly issues: readonly ScheduleIssue[];
}

/** A link between two tasks with bars: drawn and, unless it is on a cycle, propagated. */
export interface ActiveLinkRecord extends LinkRecordBase {
  /** Always `true`. */
  readonly active: true;
  /** `true` when the link is on a cycle: drawn, but ignored by scheduling. */
  readonly inCycle: boolean;
  /** The explicit or derived lag. */
  readonly lag: LinkLag;
}

/**
 * A link that touches a task without a bar (a placeholder or an invalid task): kept as data,
 * neither drawn nor propagated (`'inactive-link'` warning).
 */
export interface InactiveLinkRecord extends LinkRecordBase {
  /** Always `false`. */
  readonly active: false;
  /** Always `false`: inactive links are not part of the graph. */
  readonly inCycle: false;
  /** The explicit lag; `undefined` when it was omitted (there is no gap to measure). */
  readonly lag: LinkLag | undefined;
}

/**
 * A link checked against the tasks, with its anchors resolved into a lag. Narrow
 * with `active`. Deeply frozen.
 */
export type LinkRecord = ActiveLinkRecord | InactiveLinkRecord;

/**
 * Result of {@link buildLinkGraph}: deeply frozen (maps are read-only views), never changed after
 * it is built.
 */
export interface LinkGraph {
  /**
   * The kept links, active and inactive, in model order. Links with an unknown task, self-links
   * and duplicates are dropped and only reported in `issues`.
   */
  readonly links: readonly LinkRecord[];
  /** Kept links by id. */
  readonly linkById: ReadonlyMap<string, LinkRecord>;
  /**
   * Active links whose source is the task, in model order, in O(1). Includes links on cycles
   * (check `inCycle`); empty for unknown ids.
   */
  readonly successorsOf: (id: TaskId) => readonly ActiveLinkRecord[];
  /** Active links whose target is the task, like {@link LinkGraph.successorsOf}. */
  readonly predecessorsOf: (id: TaskId) => readonly ActiveLinkRecord[];
  /**
   * Every task of the model once, ordered so that each active link that is not on a cycle goes
   * from an earlier to a later task. Stable: of the tasks whose predecessors are
   * placed, the one first in model order comes first, so unlinked tasks keep their order.
   */
  readonly topologicalOrder: readonly TaskId[];
  /** Issues of the links in model order, then one `'cycle'` issue per cycle. */
  readonly issues: readonly ScheduleIssue[];
}

const ANCHORS: Readonly<Record<LinkType, LinkAnchors>> = /* @__PURE__ */ Object.freeze({
  FS: /* @__PURE__ */ Object.freeze({ source: 'end', target: 'start' }),
  SS: /* @__PURE__ */ Object.freeze({ source: 'start', target: 'start' }),
  FF: /* @__PURE__ */ Object.freeze({ source: 'end', target: 'end' }),
  SF: /* @__PURE__ */ Object.freeze({ source: 'start', target: 'end' }),
});

/**
 * The edges a link type connects: `FS` end → start, `SS` start → start, `FF` end →
 * end, `SF` start → end. Two links between the same tasks pin both edges of the successor: with
 * `FS` + `FF` and no lags both pins hang from the predecessor's end, so the successor moves
 * rigidly; `SS` + `FF` stretches it, as do explicit lags that ask for another length (see
 * {@link LinkType}).
 *
 * @param type - The link type.
 * @returns Shared, frozen anchors.
 */
export function linkAnchors(type: LinkType): LinkAnchors {
  switch (type) {
    case 'FS':
    case 'SS':
    case 'FF':
    case 'SF':
      return ANCHORS[type];
    default:
      return assertNever(type, 'Unknown link type');
  }
}

/**
 * The moment of a bar edge: `start`, or `endExclusive` for `'end'` (the half-open interval).
 *
 * @param span - The bar, or just its bounds (e.g. a span after propagation).
 * @param anchor - Which edge.
 * @returns The date-time of the edge.
 */
export function anchorTime(
  span: Pick<TaskSpan, 'start' | 'endExclusive'>,
  anchor: LinkAnchor,
): DateTimeMs {
  return anchor === 'start' ? span.start : span.endExclusive;
}

/**
 * Measures the gap between two moments as a lag counted in `mode`: working time of
 * the calendar (signed) or plain time, aligned to the nearest multiple of the granularity.
 *
 * @param from - The source anchor.
 * @param to - The target anchor.
 * @param mode - The successor's duration mode.
 * @param options - Calendar and granularity of the model.
 * @returns The lag in milliseconds; negative when `to` lies before `from`.
 */
export function measureLag(
  from: DateTimeMs,
  to: DateTimeMs,
  mode: DurationMode,
  options: Pick<ResolvedModelOptions, 'calendar' | 'granularity'>,
): number {
  const gap = mode === 'working' ? options.calendar.countWorkingTime(from, to) : to - from;
  return alignDurationMs(gap, options.granularity, 'nearest');
}

/**
 * Builds the dependency graph of a normalized model.
 * Never throws on bad data and never mutates the model.
 *
 * 1. **References**: a link whose source or target matches no task is dropped
 *    (`'unknown-link-task'`, one issue per missing end), as are a link from a task to itself
 *    (`'self-link'`) and a link with the same source, target and type as an earlier one
 *    (`'duplicate-link'`). A link that touches a task without a bar (a placeholder or an invalid
 *    task) is kept but inactive (`'inactive-link'` warning): not drawn, not propagated.
 * 2. **Lags**: an explicit `Link.lag` is kept as normalized (already aligned). An omitted lag is
 *    the current gap between the anchors ({@link linkAnchors}), measured in the successor's
 *    `durationMode` with {@link measureLag}.
 * 3. **Cycles**: every strongly connected component of the active links is one
 *    `'cycle'` issue listing its tasks and links; those links are flagged `inCycle` and left
 *    out of the topological order.
 * 4. **Order**: a stable topological order of all tasks over the remaining active
 *    links, and O(1) adjacency of the active links.
 *
 * @param model - The normalized tasks and links.
 * @returns The frozen graph.
 *
 * @example
 * ```ts
 * const graph = buildLinkGraph(normalizeModel({ tasks, links }, { calendar }));
 * for (const id of graph.topologicalOrder) {
 *   for (const link of graph.successorsOf(id)) if (!link.inCycle) shift(link.target, link.lag);
 * }
 * ```
 */
export function buildLinkGraph(model: NormalizedModel): LinkGraph {
  const { tasks } = model;
  const issues: ScheduleIssue[] = [];
  const candidates = checkLinks(model, issues);

  // Cycles: strongly connected components of the active links.
  const adjacency: number[][] = tasks.map(() => []);
  for (const c of candidates) if (c.active) adjacency[c.source]?.push(c.target);
  const components = cyclicComponents(adjacency);
  const componentOf: number[] = tasks.map(() => -1);
  components.forEach((nodes, k) => {
    for (const node of nodes) componentOf[node] = k;
  });
  // The component a link lies in, or -1 (the link joins two components or none).
  const cycleOf = (c: Candidate): number => {
    const k = c.active ? (componentOf[c.source] ?? -1) : -1;
    return k !== -1 && componentOf[c.target] === k ? k : -1;
  };
  const cycleLinks: string[][] = components.map(() => []);
  for (const c of candidates) {
    const k = cycleOf(c);
    if (k !== -1) cycleLinks[k]?.push(c.link.id);
  }
  const cycles = components.map((nodes, k) =>
    cycleIssue(
      nodes.map((node) => idAt(tasks, node)),
      cycleLinks[k] ?? [],
    ),
  );

  // Records, adjacency, and the order over the active links that are not on a cycle.
  const links: LinkRecord[] = [];
  const linkById = new Map<string, LinkRecord>();
  const successors: (ActiveLinkRecord[] | undefined)[] = [];
  const predecessors: (ActiveLinkRecord[] | undefined)[] = [];
  const acyclic: number[][] = tasks.map(() => []);
  for (const c of candidates) {
    const k = cycleOf(c);
    const record = toRecord(c, k === -1 ? undefined : cycles[k]);
    links.push(record);
    linkById.set(record.id, record);
    if (!record.active) continue;
    (successors[c.source] ??= []).push(record);
    (predecessors[c.target] ??= []).push(record);
    if (!record.inCycle) acyclic[c.source]?.push(c.target);
  }
  for (const issue of cycles) issues.push(issue);
  const lookup = (
    lists: (ActiveLinkRecord[] | undefined)[],
  ): ((id: TaskId) => readonly ActiveLinkRecord[]) => {
    for (const list of lists) if (list !== undefined) Object.freeze(list);
    return (id) => {
      const index = model.taskById.get(id)?.index;
      return (index === undefined ? undefined : lists[index]) ?? NO_LINKS;
    };
  };

  return Object.freeze({
    links: Object.freeze(links),
    linkById,
    successorsOf: lookup(successors),
    predecessorsOf: lookup(predecessors),
    topologicalOrder: Object.freeze(sortIndexes(acyclic).order.map((i) => idAt(tasks, i))),
    issues: Object.freeze(issues),
  });
}

/**
 * Whether adding an active link from `source` to `target` would close a cycle: `target` already
 * reaches `source` through active links, or both are the same task. The link type does not matter.
 * O(V + E) in the worst case.
 *
 * @param graph - The current graph.
 * @param source - Predecessor of the new link.
 * @param target - Successor of the new link.
 * @returns `true` when the new link would be on a cycle.
 */
export function wouldCreateCycle(graph: LinkGraph, source: TaskId, target: TaskId): boolean {
  if (source === target) return true;
  const queue: TaskId[] = [target];
  const seen = new Set<TaskId>(queue);
  for (const id of queue) {
    for (const link of graph.successorsOf(id)) {
      if (link.target === source) return true;
      if (seen.has(link.target)) continue;
      seen.add(link.target);
      queue.push(link.target);
    }
  }
  return false;
}

/** A link that passed the reference checks, before cycles are known; tasks by model index. */
type Candidate =
  | {
      readonly active: true;
      readonly link: LinkModel;
      readonly source: number;
      readonly target: number;
      readonly lag: LinkLag;
    }
  | {
      readonly active: false;
      readonly link: LinkModel;
      readonly source: number;
      readonly target: number;
      readonly lag: LinkLag | undefined;
      readonly issue: ScheduleIssue;
    };

const NO_LINKS: readonly ActiveLinkRecord[] = /* @__PURE__ */ Object.freeze([]);
const NO_ISSUES: readonly ScheduleIssue[] = /* @__PURE__ */ Object.freeze([]);
const TYPE_INDEX: Readonly<Record<LinkType, number>> = { FS: 0, SS: 1, FF: 2, SF: 3 };

/** Step 1 and 2: reference checks, inactive links and lags. Issues go to `issues`. */
function checkLinks(model: NormalizedModel, issues: ScheduleIssue[]): Candidate[] {
  const { tasks, taskById, options } = model;
  // (source, target, type) → id of the first such link.
  const firstOf = new Map<number, string>();
  const candidates: Candidate[] = [];
  for (const link of model.links) {
    // Issues of a `Task.dependencies` entry also belong to the task that lists it (as in `model`).
    const owner = {
      path: link.path,
      linkId: link.id,
      taskId: link.link === undefined ? link.target : undefined,
    };
    const source = taskById.get(link.source);
    const target = taskById.get(link.target);
    if (source === undefined || target === undefined) {
      if (source === undefined) issues.push(unknownTask('source', link.source, owner));
      if (target === undefined) issues.push(unknownTask('target', link.target, owner));
      continue;
    }
    if (source === target) {
      const message = DEV ? `links task ${JSON.stringify(source.id)} to itself, dropped` : '';
      issues.push(scheduleIssue('self-link', 'error', message, owner));
      continue;
    }
    const key = (source.index * tasks.length + target.index) * 4 + TYPE_INDEX[link.type];
    const first = firstOf.get(key);
    if (first !== undefined) {
      const message = DEV
        ? `same source, target and type as link ${JSON.stringify(first)}, dropped`
        : '';
      issues.push(scheduleIssue('duplicate-link', 'error', message, owner));
      continue;
    }
    firstOf.set(key, link.id);

    const mode = target.durationMode;
    const explicit = link.lag === undefined ? undefined : lagOf(link.lag, mode, false);
    const ends = { link, source: source.index, target: target.index };
    if (source.span === undefined || target.span === undefined) {
      const message = DEV
        ? `no bar on task ${[source, target]
            .filter((task) => task.span === undefined)
            .map((task) => JSON.stringify(task.id))
            .join(' and ')}, the link is inactive`
        : '';
      const issue = scheduleIssue('inactive-link', 'warning', message, owner);
      issues.push(issue);
      candidates.push({ ...ends, active: false, lag: explicit, issue });
      continue;
    }
    const anchors = linkAnchors(link.type);
    const lag =
      explicit ??
      lagOf(
        measureLag(
          anchorTime(source.span, anchors.source),
          anchorTime(target.span, anchors.target),
          mode,
          options,
        ),
        mode,
        true,
      );
    candidates.push({ ...ends, active: true, lag });
  }
  return candidates;
}

function lagOf(ms: number, mode: DurationMode, derived: boolean): LinkLag {
  return Object.freeze({ ms, mode, derived, days: ms / DAY });
}

function toRecord(c: Candidate, cycle: ScheduleIssue | undefined): LinkRecord {
  const { link } = c;
  const { id, source, target, type, editable } = link;
  const base = { id, source, target, type, editable, model: link };
  if (!c.active) {
    const issues = Object.freeze([c.issue]);
    return Object.freeze({ ...base, active: false, inCycle: false, lag: c.lag, issues });
  }
  const issues = cycle === undefined ? NO_ISSUES : Object.freeze([cycle]);
  return Object.freeze({ ...base, active: true, inCycle: cycle !== undefined, lag: c.lag, issues });
}

function unknownTask(
  end: 'source' | 'target',
  id: TaskId,
  owner: { readonly path: string; readonly linkId: string; readonly taskId: TaskId | undefined },
): ScheduleIssue {
  const message = DEV ? `unknown ${end} task ${JSON.stringify(id)}, dropped` : '';
  return scheduleIssue('unknown-link-task', 'error', message, { ...owner, value: id });
}

/** Tasks named in the message of a `'cycle'` issue; all of them are in `taskIds`. */
const CYCLE_NAMES = 5;

function cycleIssue(taskIds: TaskId[], linkIds: string[]): ScheduleIssue {
  const message = DEV
    ? `tasks ${cycleNames(taskIds)} form a cycle, its links are not scheduled`
    : '';
  return scheduleIssue('cycle', 'error', message, { taskIds, linkIds });
}

/** The first {@link CYCLE_NAMES} task ids of a cycle for its message, and how many more. */
function cycleNames(taskIds: readonly TaskId[]): string {
  const names = taskIds
    .slice(0, CYCLE_NAMES)
    .map((id) => JSON.stringify(id))
    .join(', ');
  return taskIds.length > CYCLE_NAMES ? `${names} and ${taskIds.length - CYCLE_NAMES} more` : names;
}

/** The id of the task at a model index that exists. */
function idAt(tasks: readonly TaskModel[], index: number): TaskId {
  return itemAt(tasks, index).id;
}

/** An item at an index known to exist; the cast only satisfies `noUncheckedIndexedAccess`. */
function itemAt<T>(list: readonly T[], index: number): T {
  return list[index] as T;
}

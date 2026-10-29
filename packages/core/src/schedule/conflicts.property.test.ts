import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import { type Link, type LinkType, normalizeModel, type Task, type TaskId } from '../model';
import {
  addDays,
  asDateTimeMs,
  DAY,
  MINUTE,
  parseDateInput,
  toISODate,
  toISODateTime,
} from '../time';
import {
  anchorTime,
  applyChangeSet,
  buildLinkGraph,
  type Conflict,
  type ConflictType,
  detectConflicts,
  linkAnchors,
  measureLag,
  type MoveChildren,
  propagate,
  type PropagationContext,
  type ScheduleState,
  type TaskBounds,
} from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });
const ORIGIN = (() => {
  const parsed = parseDateInput('2026-03-02');
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
})();
const GRANULARITIES = { '1d': 1440, '1h': 60, '30min': 30 } as const;
type GranularityName = keyof typeof GRANULARITIES;
const ANCHORS: readonly (LinkType | LinkType[])[] = [
  'SS',
  'FS',
  'FF',
  'SF',
  ['SS', 'FF'],
  ['FS', 'FF'],
];
const TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];
const TYPE_RANK: Record<ConflictType, number> = {
  'non-working-start': 0,
  'non-working-end': 1,
  'outside-parent': 2,
  'link-violated': 3,
};

const idOf = (i: number): TaskId => (i % 2 === 0 ? i : `t${i}`);

const taskSpec = fc.record({
  day: fc.integer({ min: 0, max: 25 }),
  slot: fc.nat({ max: 47 }),
  length: fc.integer({ min: 0, max: 6 }),
  time: fc.boolean(),
  working: fc.boolean(),
  parent: fc.option(fc.nat({ max: 40 }), { nil: undefined }),
  follow: fc.boolean(),
  anchor: fc.constantFrom(...ANCHORS),
  locked: fc.nat({ max: 5 }).map((n) => n === 0),
  fixed: fc.nat({ max: 3 }).map((n) => n === 0),
  kind: fc.constantFrom('task', 'task', 'task', 'task', 'task', 'milestone', 'placeholder'),
});

const linkSpec = fc.record({
  source: fc.nat({ max: 40 }),
  target: fc.nat({ max: 40 }),
  type: fc.constantFrom(...TYPES),
  lag: fc.option(fc.integer({ min: -2, max: 3 }), { nil: undefined }),
});

type TaskSpec = typeof taskSpec extends fc.Arbitrary<infer T> ? T : never;
type LinkSpec = typeof linkSpec extends fc.Arbitrary<infer T> ? T : never;

interface Shape {
  /** Parents before children and links forward only. */
  readonly acyclic: boolean;
  readonly granularity: GranularityName;
  /** Day precision, one duration mode, derived lags, no locked tasks or placeholders. */
  readonly rigid?: 'calendar' | 'working';
}

function buildTask(spec: TaskSpec, i: number, shape: Shape): Task {
  const minutes = GRANULARITIES[shape.granularity];
  const rigid = shape.rigid !== undefined;
  const time = !rigid && spec.time;
  const startAt = addDays(ORIGIN, spec.day);
  const start = time
    ? toISODateTime(asDateTimeMs(startAt + (spec.slot % (1440 / minutes)) * minutes * MINUTE))
    : toISODate(startAt);
  const parentIndex =
    spec.parent === undefined
      ? undefined
      : shape.acyclic
        ? i === 0
          ? undefined
          : spec.parent % i
        : spec.parent;
  const kind = rigid && spec.kind === 'placeholder' ? 'task' : spec.kind;
  return {
    id: idOf(i),
    name: `T${i}`,
    ...(kind === 'placeholder'
      ? { type: 'placeholder' as const }
      : kind === 'milestone'
        ? { type: 'milestone' as const, start }
        : { start, duration: time ? `${spec.length * 3 * minutes}min` : spec.length }),
    durationMode: shape.rigid ?? (spec.working ? 'working' : 'calendar'),
    ...(parentIndex === undefined ? {} : { parentId: idOf(parentIndex) }),
    followParent: spec.follow,
    parentAnchor: spec.anchor,
    locked: !rigid && spec.locked,
    fixedDuration: spec.fixed,
  };
}

function buildLinks(specs: readonly LinkSpec[], size: number, shape: Shape): Link[] {
  const links: Link[] = [];
  for (const [i, spec] of specs.entries()) {
    let source = spec.source % size;
    let target = spec.target % size;
    if (shape.acyclic) {
      if (source === target) continue;
      if (source > target) [source, target] = [target, source];
    }
    const lag = shape.rigid === undefined ? spec.lag : undefined;
    links.push({ id: `l${i}`, source: idOf(source), target: idOf(target), type: spec.type, lag });
  }
  return links;
}

function contextOf(
  tasks: readonly TaskSpec[],
  links: readonly LinkSpec[],
  shape: Shape,
  moveChildren: MoveChildren = 'all',
): PropagationContext {
  const model = normalizeModel(
    {
      tasks: tasks.map((spec, i) => buildTask(spec, i, shape)),
      links: buildLinks(links, tasks.length, shape),
    },
    { calendar, granularity: shape.granularity },
  );
  return {
    model,
    hierarchy: buildHierarchy(model),
    graph: buildLinkGraph(model),
    options: {
      propagation: 'preserve-lag',
      moveChildren,
      skipNonWorkingDays: { move: false, resize: false },
    },
  };
}

/**
 * A random state: some bars shifted by whole steps or by raw milliseconds (then misaligned),
 * some with odd values (inverted, non-finite, beyond the calendar).
 */
const stateSpec = fc.array(
  fc.record({
    task: fc.nat({ max: 40 }),
    start: fc.integer({ min: -20, max: 20 }),
    end: fc.integer({ min: -20, max: 20 }),
    raw: fc.boolean(),
    odd: fc.nat({ max: 15 }),
  }),
  { maxLength: 12 },
);

type StateSpec = typeof stateSpec extends fc.Arbitrary<infer T> ? T : never;

const ODD = [Number.NaN, Number.POSITIVE_INFINITY, -1e17, 1e17];

function stateOf(context: PropagationContext, specs: StateSpec): ScheduleState {
  const { tasks, options } = context.model;
  const state = new Map<TaskId, TaskBounds>();
  for (const spec of specs) {
    const task = tasks[spec.task % tasks.length]!;
    const span = state.get(task.id) ?? task.span ?? { start: ORIGIN, endExclusive: ORIGIN };
    const unit = spec.raw
      ? 7 * MINUTE + 13
      : task.precision === 'day'
        ? DAY
        : options.granularity.ms;
    const odd = ODD[spec.odd];
    state.set(task.id, {
      start: asDateTimeMs(odd ?? span.start + spec.start * unit),
      endExclusive: asDateTimeMs(span.endExclusive + spec.end * unit),
    });
  }
  return state;
}

/** Whether a conflict involves a task of the scope (see `detectConflicts`). */
function involves(
  context: PropagationContext,
  conflict: Conflict,
  scope: ReadonlySet<TaskId>,
): boolean {
  if (scope.has(conflict.id)) return true;
  switch (conflict.type) {
    case 'non-working-start':
    case 'non-working-end':
      return false;
    case 'outside-parent':
      return scope.has(conflict.parentId);
    case 'link-violated':
      return scope.has(context.graph.linkById.get(conflict.linkId)!.source);
  }
}

const general = fc.record({
  granularity: fc.constantFrom<GranularityName>('1d', '1h', '30min'),
  tasks: fc.array(taskSpec, { minLength: 1, maxLength: 14 }),
  links: fc.array(linkSpec, { maxLength: 24 }),
  state: stateSpec,
  scope: fc.array(fc.nat({ max: 40 }), { maxLength: 14 }),
});

describe('detectConflicts properties', () => {
  it('FR-SCH-6, FR-DATA-4: never throws, deterministic, frozen, ordered by task then type', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, state: stateSpecs, scope }) => {
        const context = contextOf(tasks, links, { acyclic: false, granularity });
        const state = stateOf(context, stateSpecs);
        const ids = scope.map((i) => idOf(i % tasks.length));
        for (const conflicts of [
          detectConflicts(state, context),
          detectConflicts(state, context, ids),
        ]) {
          expect(Object.isFrozen(conflicts)).toBe(true);
          let previous: [number, number] = [-1, -1];
          for (const conflict of conflicts) {
            expect(Object.isFrozen(conflict)).toBe(true);
            expect(conflict.severity).toBe('warning');
            expect(conflict.message).not.toBe('');
            expect(conflict.message).not.toContain('NaN');
            if (conflict.type === 'outside-parent')
              expect(conflict.edges.length).toBeGreaterThan(0);
            if (conflict.type === 'link-violated') {
              expect(conflict.actualMs).toBeLessThan(conflict.requiredMs);
            }
            const key: [number, number] = [
              context.model.taskById.get(conflict.id)!.index,
              TYPE_RANK[conflict.type],
            ];
            expect(key[0] > previous[0] || (key[0] === previous[0] && key[1] >= previous[1])).toBe(
              true,
            );
            previous = key;
          }
        }
        expect(detectConflicts(state, context, ids)).toEqual(detectConflicts(state, context, ids));
      }),
      { numRuns: 400 },
    );
  });

  it('FR-SCH-6: a scope keeps exactly the conflicts that involve one of its tasks', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, state: stateSpecs, scope }) => {
        const context = contextOf(tasks, links, { acyclic: false, granularity });
        const state = stateOf(context, stateSpecs);
        // Small and large scopes take different paths.
        const ids = new Set(scope.map((i) => idOf(i % tasks.length)));
        const all = detectConflicts(state, context);
        expect(detectConflicts(state, context, ids)).toEqual(
          all.filter((conflict) => involves(context, conflict, ids)),
        );
      }),
      { numRuns: 400 },
    );
  });

  it('FR-SCH-6, FR-SCH-9: a link conflicts exactly when its measured gap is below the minimum', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, state: stateSpecs }) => {
        const context = contextOf(tasks, links, { acyclic: false, granularity });
        const { model, graph } = context;
        const state = applyChangeSet(model, {
          changes: [...stateOf(context, stateSpecs)]
            .filter(([, bounds]) => Number.isFinite(bounds.start + bounds.endExclusive))
            .filter(([, bounds]) => Math.abs(bounds.start) < 1e16)
            .map(([id, bounds]) => {
              const before = { start: ORIGIN, endExclusive: ORIGIN, progress: 0 };
              return { id, before, after: { ...bounds, progress: 0 }, cause: 'direct' as const };
            }),
        });
        // Brute force: measure every link, no shortcut.
        const expected: string[] = [];
        for (const task of model.tasks) {
          for (const link of graph.predecessorsOf(task.id)) {
            const from = state.get(link.source);
            const to = state.get(link.target);
            if (link.inCycle || from === undefined || to === undefined) continue;
            const anchors = linkAnchors(link.type);
            const gap = measureLag(
              anchorTime(from, anchors.source),
              anchorTime(to, anchors.target),
              link.lag.mode,
              model.options,
            );
            const required = link.lag.derived ? Math.min(link.lag.ms, 0) : link.lag.ms;
            if (gap < required) expected.push(`${link.id} ${gap} < ${required}`);
          }
        }
        const actual = detectConflicts(state, context).flatMap((conflict) =>
          conflict.type === 'link-violated'
            ? [`${conflict.linkId} ${conflict.actualMs} < ${conflict.requiredMs}`]
            : [],
        );
        expect(actual).toEqual(expected);
      }),
      { numRuns: 400 },
    );
  });

  // Derived lags, no locked tasks, no rolls of the edited task: `'preserve-lag'` moves every
  // successor rigidly with the edit, so no link between moved tasks, nor from a moved task, loses
  // gap. A move later can only widen the other links; a move earlier pulls a successor towards
  // predecessors that did not move (the edit reaches only what it moves), which can overlap them.
  it.each(['calendar', 'working'] as const)(
    'FR-SCH-6, FR-SCH-1: rigid moves keep links; only a move earlier can break links from tasks that stay (%s)',
    (mode) => {
      const rigid = fc.record({
        tasks: fc.array(taskSpec, { minLength: 1, maxLength: 14 }),
        links: fc.array(linkSpec, { minLength: 4, maxLength: 30 }),
        task: fc.nat({ max: 40 }),
        days: fc.integer({ min: -12, max: 12 }).filter((days) => days !== 0),
        moveChildren: fc.constantFrom<MoveChildren>('all', 'following', 'none'),
      });
      fc.assert(
        fc.property(rigid, ({ tasks, links, task, days, moveChildren }) => {
          const shape: Shape = { acyclic: true, granularity: '1d', rigid: mode };
          const context = contextOf(tasks, links, shape, moveChildren);
          const edited = context.model.tasks[task % tasks.length]!;
          const changeSet = propagate(
            { kind: 'move', id: edited.id, start: asDateTimeMs(edited.span!.start + days * DAY) },
            context,
          );
          const moved = new Set(changeSet.changes.map((change) => change.id));
          const violated = changeSet.conflicts.filter(
            (conflict) => conflict.type === 'link-violated',
          );
          if (days > 0) expect(violated).toEqual([]);
          for (const conflict of violated) {
            const link = context.graph.linkById.get(conflict.linkId)!;
            expect(moved.has(link.source)).toBe(false);
            expect(moved.has(link.target)).toBe(true);
          }
        }),
        { numRuns: 400 },
      );
    },
  );
});

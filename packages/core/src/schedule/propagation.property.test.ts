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
  parseGranularity,
  toISODate,
  toISODateTime,
} from '../time';
import {
  anchorTime,
  applyChangeSet,
  buildLinkGraph,
  type ChangeSet,
  detectConflicts,
  linkAnchors,
  measureLag,
  type MoveChildren,
  propagate,
  type PropagationCommand,
  type PropagationContext,
  type PropagationPolicy,
  type TaskPatch,
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
  ['SS', 'SF'],
  ['FS', 'SF'],
];
const TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

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
  milestone: fc.nat({ max: 7 }).map((n) => n === 0),
  progress: fc.integer({ min: 0, max: 100 }),
  progressAnchor: fc.constantFrom('start' as const, 'end' as const, undefined),
});

const linkSpec = fc.record({
  source: fc.nat({ max: 40 }),
  target: fc.nat({ max: 40 }),
  type: fc.constantFrom(...TYPES),
  lag: fc.option(fc.integer({ min: -2, max: 3 }), { nil: undefined }),
});

const commandSpec = fc.record({
  task: fc.nat({ max: 40 }),
  kind: fc.constantFrom('move' as const, 'resize-start' as const, 'resize-end' as const),
  steps: fc.integer({ min: -12, max: 12 }),
  jitter: fc.option(fc.integer({ min: 1, max: 59 }), { nil: undefined }),
});

const optionsSpec = fc.record({
  propagation: fc.constantFrom<PropagationPolicy>('preserve-lag', 'none'),
  moveChildren: fc.constantFrom<MoveChildren>('all', 'following', 'none'),
  skipMove: fc.boolean(),
  skipResize: fc.boolean(),
});

type TaskSpec = typeof taskSpec extends fc.Arbitrary<infer T> ? T : never;
type LinkSpec = typeof linkSpec extends fc.Arbitrary<infer T> ? T : never;
type CommandSpec = typeof commandSpec extends fc.Arbitrary<infer T> ? T : never;
type OptionsSpec = typeof optionsSpec extends fc.Arbitrary<infer T> ? T : never;

interface Shape {
  /** Parents before children and links forward only: the pass's graph is acyclic. */
  readonly acyclic: boolean;
  readonly granularity: GranularityName;
  /** Force every task into one precision / duration mode. */
  readonly precision?: 'day';
  readonly mode?: 'calendar' | 'working';
  /** Keep only derived lags (the current gaps). */
  readonly derivedLags?: boolean;
}

function buildTask(spec: TaskSpec, i: number, shape: Shape): Task {
  const minutes = GRANULARITIES[shape.granularity];
  const time = shape.precision === undefined && spec.time;
  const startAt = addDays(ORIGIN, spec.day);
  const slots = 1440 / minutes;
  const start = time
    ? toISODateTime(asDateTimeMs(startAt + (spec.slot % slots) * minutes * MINUTE))
    : toISODate(startAt);
  const parentIndex =
    spec.parent === undefined
      ? undefined
      : shape.acyclic
        ? i === 0
          ? undefined
          : spec.parent % i
        : spec.parent;
  return {
    id: idOf(i),
    name: `T${i}`,
    start,
    ...(spec.milestone
      ? { type: 'milestone' as const }
      : { duration: time ? `${spec.length * 3 * minutes}min` : spec.length }),
    durationMode: shape.mode ?? (spec.working ? 'working' : 'calendar'),
    ...(parentIndex === undefined ? {} : { parentId: idOf(parentIndex) }),
    followParent: spec.follow,
    parentAnchor: spec.anchor,
    locked: spec.locked,
    fixedDuration: spec.fixed,
    progress: spec.progress,
    progressAnchor: spec.progressAnchor,
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
    const lag = shape.derivedLags === true ? undefined : spec.lag;
    links.push({ id: `l${i}`, source: idOf(source), target: idOf(target), type: spec.type, lag });
  }
  return links;
}

function contextOf(
  tasks: readonly TaskSpec[],
  links: readonly LinkSpec[],
  options: OptionsSpec,
  shape: Shape,
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
      propagation: options.propagation,
      moveChildren: options.moveChildren,
      skipNonWorkingDays: { move: options.skipMove, resize: options.skipResize },
    },
  };
}

function commandOf(context: PropagationContext, spec: CommandSpec): PropagationCommand {
  const { tasks, options } = context.model;
  const task = tasks[spec.task % tasks.length]!;
  const step = task.precision === 'day' ? DAY : options.granularity.ms;
  const span = task.span ?? { start: ORIGIN, endExclusive: ORIGIN };
  const shift = spec.steps * step + (spec.jitter ?? 0) * MINUTE;
  if (spec.kind === 'resize-end') {
    return { kind: spec.kind, id: task.id, endExclusive: asDateTimeMs(span.endExclusive + shift) };
  }
  return { kind: spec.kind, id: task.id, start: asDateTimeMs(span.start + shift) };
}

/** New bounds of every task after the change set (the model's for unchanged ones). */
function boundsAfter(context: PropagationContext, changeSet: ChangeSet): Map<TaskId, TaskPatch> {
  const after = new Map<TaskId, TaskPatch>();
  for (const change of changeSet.changes) after.set(change.id, change.after);
  return after;
}

/** Ids of the descendants of a task. */
function subtree(context: PropagationContext, id: TaskId): Set<TaskId> {
  const ids = new Set<TaskId>();
  const queue = [id];
  for (const at of queue) {
    for (const child of context.hierarchy.nodeById.get(at)?.childIds ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
}

const general = fc.record({
  granularity: fc.constantFrom<GranularityName>('1d', '1h', '30min'),
  tasks: fc.array(taskSpec, { minLength: 1, maxLength: 14 }),
  links: fc.array(linkSpec, { maxLength: 24 }),
  command: commandSpec,
  options: optionsSpec,
});

describe('propagate properties', () => {
  it('FR-SNAP-12, FR-SCH-9: every result is aligned to the granularity, day tasks to whole days', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, command, options }) => {
        const context = contextOf(tasks, links, options, { acyclic: false, granularity });
        const changeSet = propagate(commandOf(context, command), context);
        const step = context.model.options.granularity.ms;
        for (const { id, after } of changeSet.changes) {
          const task = context.model.taskById.get(id)!;
          const unit = task.precision === 'day' ? DAY : step;
          expect(after.start % unit).toBe(0);
          expect(after.endExclusive % unit).toBe(0);
          expect(after.endExclusive).toBeGreaterThanOrEqual(after.start);
          expect(after.progress).toBeGreaterThanOrEqual(0);
          expect(after.progress).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('FR-SCH-5, FR-SCH-6: each task changes at most once, the edited one first, with a cause', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, command, options }) => {
        const context = contextOf(tasks, links, options, { acyclic: false, granularity });
        const edit = commandOf(context, command);
        const changeSet = propagate(edit, context);
        expect(changeSet.reason).toBe(edit.kind);
        // FR-SCH-6: the conflicts of the result that involve a changed task.
        expect(changeSet.conflicts).toEqual(
          detectConflicts(
            applyChangeSet(context.model, changeSet),
            context,
            changeSet.changes.map((change) => change.id),
          ),
        );
        const ids = changeSet.changes.map((change) => change.id);
        expect(new Set(ids).size).toBe(ids.length);
        changeSet.changes.forEach((change, i) => {
          const task = context.model.taskById.get(change.id)!;
          expect(task.task.locked).not.toBe(true);
          expect(change.before).toEqual({
            start: task.span!.start,
            endExclusive: task.span!.endExclusive,
            progress: task.progress,
          });
          const moved =
            change.after.start !== change.before.start ||
            change.after.endExclusive !== change.before.endExclusive;
          expect(moved).toBe(true);
          if (i === 0) {
            expect(change).toMatchObject({ id: edit.id, cause: 'direct' });
            expect(change.via).toBeUndefined();
          } else {
            expect(['link', 'parent']).toContain(change.cause);
            expect(change.via).toBeDefined();
          }
        });
        // Pure and deterministic.
        expect(propagate(edit, context)).toEqual(changeSet);
      }),
      { numRuns: 400 },
    );
  });

  it('FR-SCH-1: propagation "none" changes only the edited task and its subtree', () => {
    fc.assert(
      fc.property(general, ({ granularity, tasks, links, command, options }) => {
        const none = { ...options, propagation: 'none' as const };
        const context = contextOf(tasks, links, none, { acyclic: false, granularity });
        const edit = commandOf(context, command);
        const { changes } = propagate(edit, context);
        const allowed =
          none.moveChildren === 'none' ? new Set<TaskId>() : subtree(context, edit.id);
        for (const change of changes.slice(1)) {
          expect(allowed.has(change.id)).toBe(true);
          expect(change.cause).toBe('parent');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('FR-SCH-5: dense random links with cycles through parents never loop', () => {
    const dense = fc.record({
      tasks: fc.array(taskSpec, { minLength: 2, maxLength: 10 }),
      links: fc.array(linkSpec, { minLength: 10, maxLength: 60 }),
      command: commandSpec,
      options: optionsSpec,
    });
    fc.assert(
      fc.property(dense, ({ tasks, links, command, options }) => {
        const context = contextOf(
          tasks,
          links,
          { ...options, propagation: 'preserve-lag' },
          {
            acyclic: false,
            granularity: '1d',
          },
        );
        const { changes } = propagate(commandOf(context, command), context);
        expect(changes.length).toBeLessThanOrEqual(context.model.tasks.length);
        expect(new Set(changes.map((change) => change.id)).size).toBe(changes.length);
      }),
      { numRuns: 300 },
    );
  });

  // Day-precision moves with derived lags in one duration mode are rigid translations (in calendar
  // time, or in working time), so every link out of a moved task keeps its lag exactly; the only
  // exception is a locked target. (Rolls of a day start to Monday 00:00 add no working time.)
  it.each(['calendar', 'working'] as const)(
    'FR-SCH-1, FR-LINK-1: with preserve-lag a move keeps the lag of every link out of a moved task (%s)',
    (mode) => {
      const acyclic = fc.record({
        tasks: fc.array(taskSpec, { minLength: 1, maxLength: 14 }),
        links: fc.array(linkSpec, { minLength: 4, maxLength: 30 }),
        command: commandSpec.map((spec) => ({ ...spec, kind: 'move' as const, jitter: undefined })),
        options: optionsSpec.map((spec) => ({ ...spec, propagation: 'preserve-lag' as const })),
      });
      fc.assert(
        fc.property(acyclic, ({ tasks, links, command, options }) => {
          const shape: Shape = {
            acyclic: true,
            granularity: '1d',
            precision: 'day',
            mode,
            derivedLags: true,
          };
          const context = contextOf(tasks, links, options, shape);
          const changeSet = propagate(commandOf(context, command), context);
          const after = boundsAfter(context, changeSet);
          const { model, graph } = context;
          const delta =
            changeSet.changes[0] === undefined
              ? 0
              : changeSet.changes[0].after.start - changeSet.changes[0].before.start;
          if (mode === 'calendar') {
            for (const change of changeSet.changes) {
              expect(change.after.start - change.before.start).toBe(delta);
              expect(change.after.endExclusive - change.before.endExclusive).toBe(delta);
            }
          }
          for (const link of graph.links) {
            if (!link.active || link.inCycle || !after.has(link.source)) continue;
            const target = model.taskById.get(link.target)!;
            if (target.task.locked === true) {
              expect(after.has(link.target)).toBe(false);
              continue;
            }
            const anchors = linkAnchors(link.type);
            const from = anchorTime(after.get(link.source)!, anchors.source);
            const to = anchorTime(after.get(link.target) ?? target.span!, anchors.target);
            expect(measureLag(from, to, link.lag.mode, model.options)).toBe(link.lag.ms);
          }
        }),
        { numRuns: 400 },
      );
    },
  );
});

it('the generated granularities are valid', () => {
  for (const name of Object.keys(GRANULARITIES)) expect(parseGranularity(name).ok).toBe(true);
});

import {
  deepFreeze,
  edgeCases,
  type Fixture,
  sampleProject,
  workingDayScenarios,
} from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import {
  type Link,
  type LinkType,
  normalizeModel,
  type NormalizeModelOptions,
  type Task,
} from '../model';
import {
  asDateTimeMs,
  type DateTimeMs,
  DAY,
  durationToString,
  HOUR,
  parseDateInput,
  toISODate,
} from '../time';
import {
  applyChangeSet,
  buildLinkGraph,
  type ChangeSet,
  type Conflict,
  detectConflicts,
  propagate,
  type PropagationCommand,
  type PropagationContext,
  type PropagationOptions,
  type ScheduleState,
  type TaskBounds,
} from './index';

// Saturday, Sunday and Wednesday 2026-03-11 are off.
const { calendar } = createWorkCalendar({ weekends: [0, 6], holidays: ['2026-03-11'] });

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

interface Setup {
  readonly links?: readonly Link[];
  readonly model?: Partial<NormalizeModelOptions>;
  readonly childAnchor?: LinkType | readonly LinkType[];
  readonly options?: PropagationOptions;
  /** Graph and hierarchy issues are expected (cycles, inactive links). */
  readonly withIssues?: boolean;
}

/** A context over frozen input; the model must be clean (no issues). */
function contextOf(tasks: readonly Task[], setup: Setup = {}): PropagationContext {
  const model = normalizeModel(
    { tasks: deepFreeze([...tasks]), links: deepFreeze([...(setup.links ?? [])]) },
    { calendar, ...setup.model },
  );
  expect(model.issues).toEqual([]);
  const graph = buildLinkGraph(model);
  const hierarchy = buildHierarchy(model, { childAnchor: setup.childAnchor });
  if (setup.withIssues !== true) {
    expect(graph.issues).toEqual([]);
    expect(hierarchy.issues).toEqual([]);
  }
  return { model, graph, hierarchy, options: setup.options };
}

/** A conflict as one line: `id type details`. */
function text(conflict: Conflict): string {
  const id = String(conflict.id);
  switch (conflict.type) {
    case 'non-working-start':
    case 'non-working-end':
      return `${id} ${conflict.type} ${toISODate(conflict.date)}`;
    case 'outside-parent':
      return `${id} outside-parent ${String(conflict.parentId)} ${conflict.edges.join('+')}`;
    case 'link-violated': {
      const gap = (ms: number): string => durationToString({ months: 0, ms });
      return `${id} link-violated ${conflict.linkId} ${gap(conflict.actualMs)} < ${gap(conflict.requiredMs)}`;
    }
  }
}

/** Every conflict of the model as it is. */
function whole(context: PropagationContext): string[] {
  return detectConflicts(new Map(), context).map(text);
}

/** The conflicts of the change set of an edit. */
function after(context: PropagationContext, command: PropagationCommand): string[] {
  return propagate(command, context).conflicts.map(text);
}

/** Moves a task by whole days from its current start. */
function moveBy(context: PropagationContext, id: string, days: number): PropagationCommand {
  const span = context.model.taskById.get(id)!.span!;
  return { kind: 'move', id, start: asDateTimeMs(span.start + days * DAY) };
}

const NONE: Setup['options'] = { propagation: 'none' };

describe('detectConflicts: non-working days', () => {
  it('FR-SCH-6: a start or a last day on a non-working day, whatever the duration mode', () => {
    const context = contextOf([
      { id: 'weekdays', name: 'Mon–Fri', start: '2026-03-02', end: '2026-03-06' },
      { id: 'from-saturday', name: 'Sat–Tue', start: '2026-03-07', end: '2026-03-10' },
      { id: 'to-sunday', name: 'Thu–Sun', start: '2026-03-05', end: '2026-03-08' },
      { id: 'to-holiday', name: 'Mon–Wed', start: '2026-03-09', end: '2026-03-11' },
      {
        id: 'saturday',
        name: 'One working-mode Saturday',
        start: '2026-03-07',
        end: '2026-03-07',
        durationMode: 'working',
      },
      { id: 'over-weekend', name: 'Fri–Mon', start: '2026-03-06', end: '2026-03-09' },
    ]);
    expect(whole(context)).toEqual([
      'from-saturday non-working-start 2026-03-07',
      'to-sunday non-working-end 2026-03-08',
      'to-holiday non-working-end 2026-03-11',
      // A one-day bar on a non-working day has both.
      'saturday non-working-start 2026-03-07',
      'saturday non-working-end 2026-03-07',
    ]);
  });

  it('FR-SCH-6: milestones and zero-length bars only have a start', () => {
    const context = contextOf([
      { id: 'milestone', name: 'Saturday', type: 'milestone', start: '2026-03-07' },
      { id: 'monday', name: 'Monday', type: 'milestone', start: '2026-03-09' },
      { id: 'empty', name: 'Zero length', start: '2026-03-09', duration: 0 },
    ]);
    // Without the exception, the "last day" of the Monday ones would be the Sunday before.
    expect(whole(context)).toEqual(['milestone non-working-start 2026-03-07']);
  });

  it('FR-SCH-6, FR-SCH-9: a time-precision bar ends on the day of its last instant', () => {
    const context = contextOf(
      [
        {
          id: 'to-midnight',
          name: 'Fri 10:00 → Mon 00:00',
          start: '2026-03-06T10:00',
          end: '2026-03-09T00:00',
        },
        {
          id: 'into-monday',
          name: 'Fri 10:00 → Mon 01:00',
          start: '2026-03-06T10:00',
          end: '2026-03-09T01:00',
        },
        {
          id: 'saturday',
          name: 'Sat 10:00 → 12:00',
          start: '2026-03-07T10:00',
          end: '2026-03-07T12:00',
        },
      ],
      { model: { granularity: '1h' } },
    );
    expect(whole(context)).toEqual([
      // Runs through Sunday: the edge `skipNonWorkingDays` would roll back to Friday's end.
      'to-midnight non-working-end 2026-03-08',
      'saturday non-working-start 2026-03-07',
      'saturday non-working-end 2026-03-07',
    ]);
  });

  it('FR-SCH-6: a conflict is a frozen warning with a message and the day at midnight', () => {
    const context = contextOf(
      [{ id: 'a', name: 'A', start: '2026-03-07T10:00', end: '2026-03-07T12:00' }],
      { model: { granularity: '1h' } },
    );
    const conflicts = detectConflicts(new Map(), context);
    expect(conflicts[0]).toEqual({
      type: 'non-working-start',
      severity: 'warning',
      id: 'a',
      message: 'starts on non-working day 2026-03-07',
      date: at('2026-03-07'),
    });
    expect(Object.isFrozen(conflicts)).toBe(true);
    expect(conflicts.every((conflict) => Object.isFrozen(conflict))).toBe(true);
  });
});

describe('FR-SCH-7: working-day scenarios of a project plan', () => {
  // (a)–(d) leave every edge on a working day; (e) "ignore" keeps the Saturday start.
  const expected: Record<string, string[]> = {
    'move-to-previous-friday': [],
    'resize-start-to-previous-friday': [],
    'resize-end-to-thursday': [],
    'resize-start-to-saturday-accept': [],
    'resize-start-to-saturday-ignore': ['task non-working-start 2026-04-11'],
  };

  it.each(workingDayScenarios)('FR-SCH-7 ($id): conflicts of "$title"', (scenario) => {
    const { given, action } = scenario;
    const { calendar: weekends } = createWorkCalendar(given.calendar);
    const scheduling = given.options?.scheduling;
    const model = normalizeModel(
      { tasks: [given.task] },
      { calendar: weekends, durationMode: scheduling?.durationMode },
    );
    const skip = scheduling?.skipNonWorkingDays;
    const resize = action.onConflict === undefined ? skip?.resize : action.onConflict === 'accept';
    const context: PropagationContext = {
      model,
      hierarchy: buildHierarchy(model),
      graph: buildLinkGraph(model),
      options: { skipNonWorkingDays: { move: skip?.move, resize } },
    };
    const id = given.task.id;
    const command: PropagationCommand =
      action.kind === 'resize-end'
        ? { kind: 'resize-end', id, endExclusive: asDateTimeMs(at(action.to) + DAY) }
        : { kind: action.kind, id, start: at(action.to) };
    const conflicts = propagate(command, context).conflicts;
    expect(conflicts.map(text)).toEqual(expected[scenario.id]);
  });

  it('FR-SCH-7 (e): exactly one non-working-start, which accepting (d) resolves', () => {
    const [task] = workingDayScenarios.map((scenario) => scenario.given.task);
    const context = contextOf([task!], { model: { durationMode: 'working' } });
    const command: PropagationCommand = {
      kind: 'resize-start',
      id: 'task',
      start: at('2026-04-11'),
    };
    const ignore = propagate(command, {
      ...context,
      options: { skipNonWorkingDays: { resize: false } },
    });
    expect(ignore.conflicts).toEqual([
      {
        type: 'non-working-start',
        severity: 'warning',
        id: 'task',
        message: 'starts on non-working day 2026-04-11',
        date: at('2026-04-11'),
      },
    ]);
    const accept = propagate(command, {
      ...context,
      options: { skipNonWorkingDays: { resize: true } },
    });
    expect(toISODate(accept.changes[0]!.after.start)).toBe('2026-04-13');
    expect(accept.conflicts).toEqual([]);
  });
});

describe('detectConflicts: outside the parent', () => {
  const parent: Task = { id: 'p', name: 'Parent', start: '2026-03-02', end: '2026-03-13' };

  it('FR-SCH-6: a child that starts before, ends after, or both', () => {
    const context = contextOf([
      parent,
      { id: 'inside', name: 'Inside', parentId: 'p', start: '2026-03-03', end: '2026-03-05' },
      { id: 'flush', name: 'Same edges', parentId: 'p', start: '2026-03-02', end: '2026-03-13' },
      { id: 'early', name: 'Starts before', parentId: 'p', start: '2026-02-27', end: '2026-03-03' },
      { id: 'late', name: 'Ends after', parentId: 'p', start: '2026-03-12', end: '2026-03-16' },
      { id: 'both', name: 'Both', parentId: 'p', start: '2026-02-27', end: '2026-03-16' },
      { id: 'away', name: 'Entirely after', parentId: 'p', start: '2026-03-17', end: '2026-03-18' },
    ]);
    expect(whole(context)).toEqual([
      'early outside-parent p start',
      'late outside-parent p end',
      'both outside-parent p start+end',
      'away outside-parent p end',
    ]);
    const conflict = detectConflicts(new Map(), context)[0];
    expect(conflict).toEqual({
      type: 'outside-parent',
      severity: 'warning',
      id: 'early',
      message: 'starts before its parent "p"',
      parentId: 'p',
      edges: ['start'],
    });
    const edges = detectConflicts(new Map(), context).flatMap((other) =>
      other.type === 'outside-parent' ? [other.edges] : [],
    );
    expect(edges.every((list) => Object.isFrozen(list) && Array.isArray(list))).toBe(true);
    expect(detectConflicts(new Map(), context)[2]?.message).toBe(
      'starts before and ends after its parent "p"',
    );
  });

  it('FR-SCH-6: a milestone child may sit on either edge of its parent', () => {
    const context = contextOf([
      parent,
      { id: 'on-start', name: 'On start', parentId: 'p', type: 'milestone', start: '2026-03-02' },
      { id: 'on-end', name: 'On end', parentId: 'p', type: 'milestone', start: '2026-03-14T00:00' },
      { id: 'before', name: 'Before', parentId: 'p', type: 'milestone', start: '2026-03-01' },
    ]);
    expect(whole(context)).toEqual([
      'on-end non-working-start 2026-03-14',
      'before non-working-start 2026-03-01',
      'before outside-parent p start',
    ]);
  });

  it('FR-SCH-6, FR-ROW-3: children of a placeholder or invalid parent, and roots, have none', () => {
    const context = contextOf(
      [
        { id: 'group', name: 'Placeholder', type: 'placeholder' },
        { id: 'a', name: 'A', parentId: 'group', start: '2026-03-02', end: '2026-03-03' },
        {
          id: 'orphan',
          name: 'Unknown parent',
          parentId: 'ghost',
          start: '2026-03-02',
          duration: 1,
        },
      ],
      { withIssues: true },
    );
    expect(whole(context)).toEqual([]);
  });

  it('FR-SCH-6, FR-ROW-1: only the direct parent counts, at every depth', () => {
    const context = contextOf([
      { id: 'root', name: 'Root', start: '2026-03-02', end: '2026-03-20' },
      // Inside the root, sticks out of nothing.
      { id: 'mid', name: 'Mid', parentId: 'root', start: '2026-03-09', end: '2026-03-13' },
      // Outside mid, inside root.
      { id: 'leaf', name: 'Leaf', parentId: 'mid', start: '2026-03-04', end: '2026-03-10' },
      // Outside root; its own child is inside it.
      { id: 'wide', name: 'Wide', parentId: 'root', start: '2026-03-16', end: '2026-03-27' },
      { id: 'deep', name: 'Deep', parentId: 'wide', start: '2026-03-23', end: '2026-03-26' },
    ]);
    expect(whole(context)).toEqual([
      'leaf outside-parent mid start',
      'wide outside-parent root end',
    ]);
  });
});

describe('detectConflicts: violated links', () => {
  // A Mon–Tue, B Thu–Fri: an FS gap of one day (Wednesday is a holiday in working mode).
  const A: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' };
  const B: Task = { id: 'b', name: 'B', start: '2026-03-05', end: '2026-03-06' };

  it("FR-SCH-6, FR-SCH-1: under 'none', a successor moved before its predecessor", () => {
    const context = contextOf([A, B], { links: [{ source: 'a', target: 'b' }], options: NONE });
    expect(whole(context)).toEqual([]);
    // Closer, right after A: no conflict (the derived lag of 1 day only asks for no overlap).
    expect(after(context, moveBy(context, 'b', -1))).toEqual([]);
    expect(after(context, moveBy(context, 'b', -2))).toEqual(['b link-violated a:FS:b -1d < 0d']);
    // Or the predecessor moved past it.
    expect(after(context, moveBy(context, 'a', 3))).toEqual(['b link-violated a:FS:b -2d < 0d']);
    const [conflict] = propagate(moveBy(context, 'b', -2), context).conflicts;
    expect(conflict).toEqual({
      type: 'link-violated',
      severity: 'warning',
      id: 'b',
      message: 'link "a:FS:b" needs a gap of at least 0d, it has -1d',
      linkId: 'a:FS:b',
      requiredMs: 0,
      actualMs: -DAY,
    });
  });

  it("FR-SCH-6, FR-SCH-3: under 'preserve-lag', a locked successor that cannot move", () => {
    const context = contextOf([A, { ...B, locked: true }], {
      links: [{ source: 'a', target: 'b' }],
    });
    // A moves, B stays: the conflict is on the unchanged successor.
    const changeSet = propagate(moveBy(context, 'a', 3), context);
    expect(changeSet.changes.map((change) => change.id)).toEqual(['a']);
    expect(changeSet.conflicts.map(text)).toEqual(['b link-violated a:FS:b -2d < 0d']);
    // Away from it, nothing.
    expect(after(context, moveBy(context, 'a', -7))).toEqual([]);
  });

  it('FR-SCH-6, FR-LINK-1: an explicit lag is the minimum, also for a lead', () => {
    const context = contextOf(
      [
        A,
        B,
        { id: 'e', name: 'E', start: '2026-03-05', end: '2026-03-06' },
        { id: 'f', name: 'F', start: '2026-03-05', end: '2026-03-06' },
      ],
      {
        links: [
          { source: 'a', target: 'b', lag: 2 },
          { source: 'e', target: 'f', type: 'SS', lag: -1 },
        ],
        options: NONE,
      },
    );
    // The data already breaks the 2-day lag; the next Monday keeps it.
    expect(whole(context)).toEqual(['b link-violated a:FS:b 1d < 2d']);
    expect(after(context, moveBy(context, 'b', 4))).toEqual([]);
    // A lead of one day: F may start up to a day before E.
    expect(after(context, moveBy(context, 'f', -1))).toEqual([]);
    expect(after(context, moveBy(context, 'f', -2))).toEqual(['f link-violated e:SS:f -2d < -1d']);
  });

  it('FR-SCH-6, FR-LINK-8: a derived lag allows the original overlap, not more', () => {
    // A Mon–Fri, B Wed–Tue: B starts three days before A ends.
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
        { id: 'b', name: 'B', start: '2026-03-04', end: '2026-03-10' },
      ],
      { links: [{ source: 'a', target: 'b' }], options: NONE },
    );
    expect(context.graph.links[0]?.lag?.days).toBe(-3);
    expect(whole(context)).toEqual([]);
    expect(after(context, moveBy(context, 'b', 2))).toEqual([]);
    expect(after(context, moveBy(context, 'a', -7))).toEqual([]);
    expect(after(context, moveBy(context, 'b', -1))).toEqual(['b link-violated a:FS:b -4d < -3d']);
  });

  it('FR-SCH-6, FR-LINK-1: every link type compares its own anchors', () => {
    // Successors of A (Tue–Wed) with derived lags of 0: SS starts with it, FF ends with it, SF
    // ends when it starts.
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-03', end: '2026-03-04' },
        { id: 'ss', name: 'SS', start: '2026-03-03', end: '2026-03-05' },
        { id: 'ff', name: 'FF', start: '2026-02-27', end: '2026-03-04' },
        { id: 'sf', name: 'SF', start: '2026-02-26', end: '2026-03-02' },
      ],
      {
        links: [
          { source: 'a', target: 'ss', type: 'SS' },
          { source: 'a', target: 'ff', type: 'FF' },
          { source: 'a', target: 'sf', type: 'SF' },
        ],
        options: NONE,
      },
    );
    expect(context.graph.links.map((link) => link.lag?.days)).toEqual([0, 0, 0]);
    expect(whole(context)).toEqual([]);
    expect(after(context, moveBy(context, 'ss', -1))).toEqual([
      'ss link-violated a:SS:ss -1d < 0d',
    ]);
    expect(
      after(context, { kind: 'resize-end', id: 'ff', endExclusive: at('2026-03-04') }),
    ).toEqual(['ff link-violated a:FF:ff -1d < 0d']);
    expect(after(context, moveBy(context, 'a', 1))).toEqual([
      'ss link-violated a:SS:ss -1d < 0d',
      'ff link-violated a:FF:ff -1d < 0d',
      'sf link-violated a:SF:sf -1d < 0d',
    ]);
    // Moving the successors later never conflicts.
    expect(after(context, moveBy(context, 'sf', 7))).toEqual([]);
  });

  it('FR-SCH-6, FR-SCH-9: working-mode links are measured in working time', () => {
    const context = contextOf(
      [
        // A Mon–Fri, B the Monday after: an FS gap of 0 working days over the weekend.
        { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
        { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-10' },
        // C Mon–Tue, D Fri: the 1-day lag is Thursday, as Wednesday 03-11 is a holiday.
        { id: 'c', name: 'C', start: '2026-03-09', end: '2026-03-10' },
        { id: 'd', name: 'D', start: '2026-03-13', end: '2026-03-13' },
      ],
      {
        links: [
          { source: 'a', target: 'b' },
          { source: 'c', target: 'd', lag: '1d' },
        ],
        model: { durationMode: 'working' },
        options: { propagation: 'none', skipNonWorkingDays: { move: false } },
      },
    );
    expect(context.graph.links.map((link) => link.lag?.days)).toEqual([0, 1]);
    expect(whole(context)).toEqual([]);
    // Saturday adds no working time: still a gap of 0.
    expect(after(context, { kind: 'move', id: 'b', start: at('2026-03-07') })).toEqual([
      'b non-working-start 2026-03-07',
    ]);
    expect(after(context, moveBy(context, 'b', -3))).toEqual(['b link-violated a:FS:b -1d < 0d']);
    const [conflict] = propagate(moveBy(context, 'b', -3), context).conflicts;
    expect(conflict?.message).toBe(
      'link "a:FS:b" needs a gap of at least 0d of working time, it has -1d',
    );
    // Thursday or the holiday before it: no working day left between C and D.
    expect(after(context, moveBy(context, 'd', -1))).toEqual(['d link-violated c:FS:d 0d < 1d']);
    expect(after(context, moveBy(context, 'd', -2))).toEqual([
      'd non-working-start 2026-03-11',
      'd link-violated c:FS:d 0d < 1d',
    ]);
  });

  it('FR-SCH-6, FR-SCH-9: sub-day lags are compared in milliseconds', () => {
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-02T08:00', end: '2026-03-02T12:00' },
        { id: 'b', name: 'B', start: '2026-03-02T16:00', end: '2026-03-02T18:00' },
      ],
      {
        links: [{ source: 'a', target: 'b', lag: '4h' }],
        model: { granularity: '1h' },
        options: NONE,
      },
    );
    expect(whole(context)).toEqual([]);
    const command: PropagationCommand = { kind: 'move', id: 'b', start: at('2026-03-02T15:00') };
    expect(after(context, command)).toEqual(['b link-violated a:FS:b 3h < 4h']);
    expect(propagate(command, context).conflicts[0]).toMatchObject({
      requiredMs: 4 * HOUR,
      actualMs: 3 * HOUR,
    });
  });

  it('FR-SCH-6, FR-LINK-7: links on a cycle and inactive links are never checked', () => {
    const context = contextOf([A, B, { id: 'p', name: 'Placeholder', type: 'placeholder' }], {
      links: [
        { source: 'a', target: 'b', lag: 5 },
        { source: 'b', target: 'a', lag: 5 },
        { source: 'p', target: 'b', lag: 9 },
      ],
      withIssues: true,
    });
    expect(context.graph.issues.map((issue) => issue.code)).toEqual(['inactive-link', 'cycle']);
    expect(whole(context)).toEqual([]);
  });
});

describe('detectConflicts: scope', () => {
  // P (Mon–Fri) with children C1, C2; A → P → S; every relation broken on purpose.
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-07' },
    { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-06' },
    { id: 'c1', name: 'C1', parentId: 'p', start: '2026-03-05', end: '2026-03-09' },
    { id: 'c2', name: 'C2', parentId: 'p', start: '2026-03-07', end: '2026-03-07' },
    { id: 's', name: 'S', start: '2026-03-03', end: '2026-03-04' },
    { id: 'x', name: 'X', start: '2026-03-08', end: '2026-03-08' },
  ];
  const links: Link[] = [
    { source: 'a', target: 'p', lag: 0 },
    { source: 'p', target: 's', lag: 0 },
  ];
  const context = contextOf(tasks, { links, options: NONE });
  const all = [
    'a non-working-end 2026-03-07',
    'p link-violated a:FS:p -6d < 0d',
    'c1 outside-parent p end',
    'c2 non-working-start 2026-03-07',
    'c2 non-working-end 2026-03-07',
    'c2 outside-parent p end',
    's link-violated p:FS:s -4d < 0d',
    'x non-working-start 2026-03-08',
    'x non-working-end 2026-03-08',
  ];
  const scoped = (ids: (string | number)[]): string[] =>
    detectConflicts(new Map(), context, ids).map(text);

  it('FR-SCH-6: without a scope, every conflict in model order, then by type', () => {
    expect(whole(context)).toEqual(all);
  });

  it('FR-SCH-6: with a scope, the conflicts that involve one of its tasks', () => {
    // P: links into and out of it, its children outside it; not their own non-working days.
    expect(scoped(['p'])).toEqual([
      'p link-violated a:FS:p -6d < 0d',
      'c1 outside-parent p end',
      'c2 outside-parent p end',
      's link-violated p:FS:s -4d < 0d',
    ]);
    // A child: its own conflicts only (it has no link, its parent is checked through it).
    expect(scoped(['c2'])).toEqual([
      'c2 non-working-start 2026-03-07',
      'c2 non-working-end 2026-03-07',
      'c2 outside-parent p end',
    ]);
    // A source: its own days and the link out of it.
    expect(scoped(['a'])).toEqual([
      'a non-working-end 2026-03-07',
      'p link-violated a:FS:p -6d < 0d',
    ]);
    expect(scoped(['x', 'ghost'])).toEqual([
      'x non-working-start 2026-03-08',
      'x non-working-end 2026-03-08',
    ]);
    expect(scoped([])).toEqual([]);
    // More than half of the model: every task is visited, with the same result.
    expect(scoped(['a', 'p', 'c1', 's'])).toEqual(all.filter((line) => !/^(c2 non|x )/.test(line)));
    expect(scoped(tasks.map((task) => task.id))).toEqual(all);
    expect(detectConflicts(new Map(), context, new Set(['s']))).toEqual(
      detectConflicts(new Map(), context, ['s']),
    );
  });

  it('FR-SCH-6, FR-TX-1: a change set reports what the edit involves, also on unmoved neighbours', () => {
    // Moving P a week later under 'none' (children follow): P's link from A is fixed, the one
    // to S gets worse; C1 and C2 move along; X's conflicts are none of the edit's business.
    const changeSet = propagate(moveBy(context, 'p', 7), {
      ...context,
      options: { propagation: 'none', moveChildren: 'all' },
    });
    expect(changeSet.changes.map((change) => change.id)).toEqual(['p', 'c1', 'c2']);
    expect(changeSet.conflicts.map(text)).toEqual([
      'c1 outside-parent p end',
      'c2 non-working-start 2026-03-14',
      'c2 non-working-end 2026-03-14',
      'c2 outside-parent p end',
      's link-violated p:FS:s -11d < 0d',
    ]);
  });
});

describe('applyChangeSet', () => {
  const context = contextOf(
    [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' },
      { id: 'group', name: 'Placeholder', type: 'placeholder' },
      { id: 'b', name: 'B', start: '2026-03-05', end: '2026-03-06' },
    ],
    { links: [{ source: 'a', target: 'b' }] },
  );

  it('FR-TX-1: the model spans with the changes applied, in model order', () => {
    const changeSet = propagate(moveBy(context, 'a', 7), context);
    const state = applyChangeSet(context.model, changeSet);
    expect([...state.keys()]).toEqual(['a', 'b']);
    expect(state.get('a')).toBe(changeSet.changes[0]?.after);
    expect(state.get('b')).toBe(changeSet.changes[1]?.after);
    // Unchanged tasks keep their span object.
    const none = applyChangeSet(context.model, { changes: [] });
    expect(none.get('a')).toBe(context.model.taskById.get('a')?.span);
  });

  it('FR-DATA-1: ignores unknown tasks and tasks without a bar; the later change wins', () => {
    const patch = (start: string): TaskBounds & { progress: number } => ({
      start: at(start),
      endExclusive: asDateTimeMs(at(start) + DAY),
      progress: 0,
    });
    const before = { ...patch('2026-03-02'), endExclusive: at('2026-03-04') };
    const changeSet: ChangeSet = deepFreeze({
      reason: 'api',
      changes: [
        { id: 'a', before, after: patch('2026-03-10'), cause: 'direct' },
        { id: 'ghost', before, after: patch('2026-03-10'), cause: 'direct' },
        { id: 'group', before, after: patch('2026-03-10'), cause: 'direct' },
        { id: 'a', before, after: patch('2026-03-12'), cause: 'direct' },
      ],
      conflicts: [],
    });
    const state = applyChangeSet(context.model, changeSet);
    expect([...state.keys()]).toEqual(['a', 'b']);
    expect(state.get('a')?.start).toBe(at('2026-03-12'));
    expect(context.model.taskById.get('a')?.span?.start).toBe(at('2026-03-02'));
  });
});

describe('detectConflicts: robustness', () => {
  const context = contextOf(
    [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' },
      { id: 'b', name: 'B', start: '2026-03-05', end: '2026-03-06' },
      { id: 'group', name: 'Placeholder', type: 'placeholder' },
    ],
    { links: [{ source: 'a', target: 'b' }] },
  );

  it('FR-DATA-4: never throws on a state with non-finite bounds or bars for placeholders', () => {
    const state: ScheduleState = new Map<string, TaskBounds>([
      ['a', { start: asDateTimeMs(Number.NaN), endExclusive: at('2026-03-03') }],
      ['b', { start: at('2026-03-01'), endExclusive: asDateTimeMs(Number.POSITIVE_INFINITY) }],
      ['group', { start: at('2026-03-07'), endExclusive: at('2026-03-08') }],
    ]);
    expect(detectConflicts(state, context)).toEqual([]);
    // Beyond the range of a `Date` (and of the work calendar): no bar either.
    const far = new Map<string, TaskBounds>([
      ['a', { start: asDateTimeMs(1e17), endExclusive: asDateTimeMs(1e17 + DAY) }],
      ['b', { start: asDateTimeMs(-1e16), endExclusive: at('2026-03-06') }],
    ]);
    expect(detectConflicts(far, context)).toEqual([]);
  });

  it('FR-SCH-6: an empty state is the model; the input is not changed', () => {
    const state = new Map<string, TaskBounds>();
    expect(detectConflicts(state, context)).toEqual(
      detectConflicts(applyChangeSet(context.model, { changes: [] }), context),
    );
    expect(state.size).toBe(0);
  });
});

describe('fixtures', () => {
  /** A context for a fixture with its calendar and options; input issues are allowed. */
  function fixtureContext<TData>(fixture: Fixture<TData>): PropagationContext {
    const { calendar: fixtureCalendar } = createWorkCalendar(fixture.calendar);
    const { scheduling, hierarchy } = fixture.options ?? {};
    const model = normalizeModel(fixture, {
      calendar: fixtureCalendar,
      granularity: scheduling?.granularity,
      durationMode: scheduling?.durationMode,
      defaultLinkType: scheduling?.defaultLinkType,
    });
    return {
      model,
      hierarchy: buildHierarchy(model, { childAnchor: hierarchy?.childAnchor }),
      graph: buildLinkGraph(model),
      options: {
        // `'push-forward'` is P1 (FR-SCH-1); no fixture uses it.
        propagation: scheduling?.propagation === 'none' ? 'none' : 'preserve-lag',
        moveChildren: hierarchy?.moveChildren,
        skipNonWorkingDays: scheduling?.skipNonWorkingDays,
      },
    };
  }

  const sample = fixtureContext(sampleProject);

  it('FR-SCH-6: sample-project has a child outside its parent and deliverables after their group', () => {
    expect(sample.model.issues).toEqual([]);
    expect(whole(sample)).toEqual([
      // Deliverables anchored to their group's end (FS) lie just after it.
      'deliverable-1 outside-parent group-1 end',
      'deliverable-2 outside-parent group-2 end',
      // The deliberate one: manual dates past the end of "Build".
      'task-7 outside-parent group-3 end',
      'deliverable-4 outside-parent group-4 end',
      'deliverable-5 outside-parent group-5 end',
      'deliverable-6 outside-parent group-6 end',
    ]);
  });

  it('FR-SCH-6, FR-SCH-3: moving a group leaves locked checkpoints and blocks outside the next groups', () => {
    const changeSet = propagate({ kind: 'move', id: 'group-3', start: at('2026-04-06') }, sample);
    expect(changeSet.changes).toHaveLength(17);
    expect(changeSet.conflicts.map(text)).toEqual([
      'task-7 outside-parent group-3 end',
      'checkpoint-4 outside-parent group-4 start',
      'block-3 outside-parent group-4 start',
      'deliverable-4 outside-parent group-4 end',
      'checkpoint-5 outside-parent group-5 start',
      'block-5 outside-parent group-5 start',
      'deliverable-5 outside-parent group-5 end',
      'checkpoint-6 outside-parent group-6 start',
      'block-6 outside-parent group-6 start',
      'deliverable-6 outside-parent group-6 end',
    ]);
  });

  it('FR-SCH-6, FR-SCH-1: in manual mode a group moved earlier overlaps its locked predecessors', () => {
    const changeSet = propagate(
      { kind: 'move', id: 'group-2', start: at('2026-03-09') },
      { ...sample, options: { ...sample.options, propagation: 'none' } },
    );
    expect(changeSet.changes.map((change) => change.id)).toEqual([
      'group-2',
      'task-4',
      'deliverable-2',
    ]);
    expect(changeSet.conflicts.map(text)).toEqual([
      'group-2 link-violated group-1:FS:group-2 -5d < 0d',
      'task-4 link-violated task-3:FS:task-4 -5d < 0d',
      'deliverable-2 outside-parent group-2 end',
    ]);
  });

  // Edge cases without a calendar get the default one (Saturday and Sunday off).
  const expected: Record<string, string[]> = {
    'link-cycle': ['C non-working-end 2026-03-07'],
    'numeric-ids': ['2 non-working-end 2026-03-07'],
    'one-day': [
      'saturday-working non-working-start 2026-03-07',
      'saturday-working non-working-end 2026-03-07',
    ],
    // New Year's Day is a holiday.
    'across-new-year': ['duration non-working-end 2027-01-01', 'time non-working-end 2027-01-01'],
    'leap-day': ['non-leap non-working-start 2027-02-28'],
    // Every DST switch is on a weekend.
    'dst-crossing': [
      'eu-spring non-working-start 2026-03-28',
      'eu-spring non-working-end 2026-03-29',
      'eu-gap non-working-start 2026-03-29',
      'eu-gap non-working-end 2026-03-29',
      'eu-autumn non-working-start 2026-10-25',
      'eu-autumn non-working-end 2026-10-25',
      'us-spring non-working-start 2026-03-07',
      'us-spring non-working-end 2026-03-08',
      'us-gap non-working-start 2026-03-08',
      'us-gap non-working-end 2026-03-08',
      'us-autumn non-working-start 2026-11-01',
      'us-autumn non-working-end 2026-11-01',
    ],
    'link-types': ['sf non-working-end 2026-03-01'],
  };

  it.each(edgeCases.map((fixture) => [fixture.name, fixture] as const))(
    'FR-SCH-6, FR-DATA-4: edge case %s',
    (name, fixture) => {
      expect(whole(fixtureContext(fixture))).toEqual(expected[name] ?? []);
    },
  );
});

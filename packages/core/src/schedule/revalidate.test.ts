import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import { type AlignInput, type Link, normalizeModel, type Task } from '../model';
import { type DateTimeMs, parseDateInput } from '../time';
import {
  buildLinkGraph,
  type Change,
  type ChangeSet,
  type Conflict,
  type ConflictContext,
  propagate,
  revalidateChangeSet,
  type TaskPatch,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

// 2026-03-02 is a Monday; 03-07 / 03-08 are a weekend.
const TASKS: readonly Task[] = deepFreeze([
  { id: 'meet', name: 'Meeting', start: '2026-03-02T09:00', end: '2026-03-02T12:00', progress: 50 },
  { id: 'build', name: 'Build', start: '2026-03-03', end: '2026-03-05' },
  { id: 'next', name: 'Next', start: '2026-03-06', end: '2026-03-06' },
  { id: 'frozen', name: 'Frozen', start: '2026-03-02', end: '2026-03-03', locked: true },
  { id: 'stub', name: 'Stub', type: 'placeholder' },
  { id: 'pin', name: 'Pin', type: 'milestone', start: '2026-03-06' },
  { id: 'zero', name: 'Zero', start: '2026-03-04T10:00', end: '2026-03-04T10:00' },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'build', target: 'next' }]);

function contextOf(alignInput?: AlignInput): ConflictContext {
  const { calendar } = createWorkCalendar({ weekends: [0, 6] });
  const model = normalizeModel(
    { tasks: TASKS, links: LINKS },
    { calendar, granularity: '1h', alignInput },
  );
  expect(model.issues).toEqual([]);
  return { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) };
}

/** A change set of plain (unfrozen) changes, as a hook might build it. */
function changeSetOf(...changes: { id: Change['id']; after: Partial<TaskPatch> }[]): ChangeSet {
  return {
    reason: 'api',
    changes: changes.map(({ id, after }) => ({
      id,
      before: { start: 0 as DateTimeMs, endExclusive: 0 as DateTimeMs, progress: 0 },
      after: after as TaskPatch,
      cause: 'direct',
    })),
    conflicts: [],
  };
}

const MEET = { start: at('2026-03-02T09:00'), endExclusive: at('2026-03-02T12:00'), progress: 50 };

describe('revalidateChangeSet', () => {
  it('FR-SNAP-13, FR-TX-2: returns a change set of propagate on the same model as it is', () => {
    const context = contextOf();
    const changeSet = propagate({ kind: 'move', id: 'build', start: at('2026-03-04') }, context);
    expect(changeSet.changes.map((change) => change.id)).toEqual(['build', 'next']);
    const result = revalidateChangeSet(changeSet, context);
    expect(result.changeSet).toBe(changeSet);
    expect(result.issues).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("FR-SNAP-13: aligns misaligned values with alignInput 'expand' (start down, end up)", () => {
    const context = contextOf();
    const changeSet = changeSetOf({
      id: 'meet',
      after: { start: at('2026-03-02T10:30'), endExclusive: at('2026-03-02T12:15'), progress: 50 },
    });
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes).toEqual([
      {
        id: 'meet',
        before: MEET,
        after: {
          start: at('2026-03-02T10:00'),
          endExclusive: at('2026-03-02T13:00'),
          progress: 50,
        },
        cause: 'direct',
      },
    ]);
    expect(Object.isFrozen(result.changes[0]!.after)).toBe(true);
    expect(issues).toEqual([
      {
        code: 'misaligned',
        severity: 'warning',
        message:
          'changes[0].after.start: not a multiple of the step 1h, aligned to 2026-03-02T10:00',
        path: 'changes[0].after.start',
        taskId: 'meet',
        value: at('2026-03-02T10:30'),
        suggested: at('2026-03-02T10:00'),
      },
      {
        code: 'misaligned',
        severity: 'warning',
        message:
          'changes[0].after.endExclusive: not a multiple of the step 1h, aligned to 2026-03-02T13:00',
        path: 'changes[0].after.endExclusive',
        taskId: 'meet',
        value: at('2026-03-02T12:15'),
        suggested: at('2026-03-02T13:00'),
      },
    ]);
  });

  it("FR-SNAP-13: aligns with alignInput 'nearest' (ties widen the bar)", () => {
    const context = contextOf('nearest');
    const changeSet = changeSetOf({
      id: 'meet',
      after: { start: at('2026-03-02T10:30'), endExclusive: at('2026-03-02T12:20'), progress: 50 },
    });
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes[0]?.after).toEqual({
      start: at('2026-03-02T10:00'),
      endExclusive: at('2026-03-02T12:00'),
      progress: 50,
    });
    expect(issues.map((issue) => [issue.code, issue.severity, issue.suggested])).toEqual([
      ['misaligned', 'warning', at('2026-03-02T10:00')],
      ['misaligned', 'warning', at('2026-03-02T12:00')],
    ]);
  });

  it("FR-SNAP-13: alignInput 'reject' drops a misaligned change with errors", () => {
    const context = contextOf('reject');
    const changeSet = changeSetOf(
      {
        id: 'meet',
        after: {
          start: at('2026-03-02T10:30'),
          endExclusive: at('2026-03-02T12:15'),
          progress: 50,
        },
      },
      {
        id: 'build',
        after: { start: at('2026-03-04'), endExclusive: at('2026-03-07'), progress: 0 },
      },
    );
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes.map((change) => change.id)).toEqual(['build']);
    expect(issues.map((issue) => [issue.code, issue.severity, issue.path])).toEqual([
      ['misaligned', 'error', 'changes[0].after.start'],
      ['misaligned', 'error', 'changes[0].after.endExclusive'],
    ]);
    expect(issues[0]?.message).toBe(
      'changes[0].after.start: not a multiple of the step 1h, rejected, suggested 2026-03-02T10:00',
    );
  });

  it('FR-SNAP-12, FR-SNAP-13: day-precision tasks are aligned to whole days at a sub-day granularity', () => {
    const context = contextOf();
    const changeSet = changeSetOf({
      id: 'build',
      after: { start: at('2026-03-04T06:00'), endExclusive: at('2026-03-06T01:00'), progress: 0 },
    });
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes[0]?.after).toEqual({
      start: at('2026-03-04'),
      endExclusive: at('2026-03-07'),
      progress: 0,
    });
    expect(issues.map((issue) => issue.message)).toEqual([
      'changes[0].after.start: not a multiple of the step 1d, aligned to 2026-03-04T00:00',
      'changes[0].after.endExclusive: not a multiple of the step 1d, aligned to 2026-03-07T00:00',
    ]);
  });

  it('FR-SNAP-7: after.precision time aligns a day task to the granularity instead of whole days', () => {
    const context = contextOf();
    const changeSet = changeSetOf({
      id: 'build',
      after: {
        start: at('2026-03-03T10:00'),
        endExclusive: at('2026-03-06T10:30'),
        progress: 0,
        precision: 'time',
      },
    });
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes).toEqual([
      {
        id: 'build',
        before: {
          start: at('2026-03-03'),
          endExclusive: at('2026-03-06'),
          progress: 0,
          precision: 'day',
        },
        after: {
          start: at('2026-03-03T10:00'),
          endExclusive: at('2026-03-06T11:00'),
          progress: 0,
          precision: 'time',
        },
        cause: 'direct',
      },
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'changes[0].after.endExclusive: not a multiple of the step 1h, aligned to 2026-03-06T11:00',
    ]);
  });

  it('FR-SNAP-7: after.precision day brings a time task back to whole days', () => {
    const context = contextOf();
    const back = changeSetOf({
      id: 'meet',
      after: {
        start: at('2026-03-02'),
        endExclusive: at('2026-03-03'),
        progress: 50,
        precision: 'day',
      },
    });
    const { changeSet: result, issues } = revalidateChangeSet(back, context);
    expect(issues).toEqual([]);
    expect(result.changes[0]).toMatchObject({
      before: { ...MEET, precision: 'time' },
      after: { start: at('2026-03-02'), endExclusive: at('2026-03-03'), precision: 'day' },
    });
    // Its values are aligned to whole days then.
    const misaligned = changeSetOf({ id: 'meet', after: { ...MEET, precision: 'day' } });
    const aligned = revalidateChangeSet(misaligned, context);
    expect(aligned.changeSet.changes[0]?.after).toEqual({
      start: at('2026-03-02'),
      endExclusive: at('2026-03-03'),
      progress: 50,
      precision: 'day',
    });
    expect(aligned.issues.map((issue) => issue.code)).toEqual(['misaligned', 'misaligned']);
  });

  it('FR-SNAP-7: a precision the task already has is left out; an unknown one is an invalid change', () => {
    const context = contextOf();
    const same = changeSetOf({
      id: 'build',
      after: {
        start: at('2026-03-04'),
        endExclusive: at('2026-03-07'),
        progress: 0,
        precision: 'day',
      },
    });
    const { changeSet: result, issues } = revalidateChangeSet(same, context);
    expect(issues).toEqual([]);
    expect(result.changes[0]?.after).toEqual({
      start: at('2026-03-04'),
      endExclusive: at('2026-03-07'),
      progress: 0,
    });
    expect(result.changes[0]?.before).not.toHaveProperty('precision');
    // Only the precision changes: still a change.
    const timed = changeSetOf({
      id: 'build',
      after: {
        start: at('2026-03-03'),
        endExclusive: at('2026-03-06'),
        progress: 0,
        precision: 'time',
      },
    });
    expect(revalidateChangeSet(timed, context).changeSet.changes).toHaveLength(1);
    const unknown = changeSetOf({
      id: 'build',
      after: { ...MEET, precision: 'hour' as never },
    });
    const dropped = revalidateChangeSet(unknown, context);
    expect(dropped.changeSet.changes).toEqual([]);
    expect(dropped.issues).toMatchObject([
      { code: 'invalid-change', severity: 'error', path: 'changes[0].after.precision' },
    ]);
  });

  it('FR-SNAP-7: a change set of propagate that turns a day task into a timed one is returned as it is', () => {
    const context = contextOf();
    const changeSet = propagate(
      { kind: 'move', id: 'build', start: at('2026-03-03T10:00') },
      { ...context, options: { keepDayPrecision: false } },
    );
    expect(changeSet.changes[0]?.after.precision).toBe('time');
    expect(revalidateChangeSet(changeSet, context).changeSet).toBe(changeSet);
  });

  it('FR-SNAP-13: a bar that is not a milestone keeps at least one step', () => {
    const context = contextOf('nearest');
    // 10:40 … 10:50 rounds to 11:00 … 11:00: the end is extended, as part of `misaligned`.
    const collapsed = changeSetOf({
      id: 'meet',
      after: { start: at('2026-03-02T10:40'), endExclusive: at('2026-03-02T10:50'), progress: 50 },
    });
    const first = revalidateChangeSet(collapsed, context);
    expect(first.changeSet.changes[0]?.after).toMatchObject({
      start: at('2026-03-02T11:00'),
      endExclusive: at('2026-03-02T12:00'),
    });
    expect(first.issues.map((issue) => [issue.code, issue.suggested])).toEqual([
      ['misaligned', at('2026-03-02T11:00')],
      ['misaligned', at('2026-03-02T12:00')],
    ]);
    // An aligned zero length: `'too-short'`.
    const zero = changeSetOf({
      id: 'meet',
      after: { start: at('2026-03-02T10:00'), endExclusive: at('2026-03-02T10:00'), progress: 50 },
    });
    const second = revalidateChangeSet(zero, context);
    expect(second.changeSet.changes[0]?.after.endExclusive).toBe(at('2026-03-02T11:00'));
    expect(second.issues).toMatchObject([
      {
        code: 'too-short',
        severity: 'warning',
        path: 'changes[0].after.endExclusive',
        message:
          'changes[0].after.endExclusive: a bar keeps at least one step (1h), extended to 2026-03-02T11:00',
        value: at('2026-03-02T10:00'),
        suggested: at('2026-03-02T11:00'),
      },
    ]);
  });

  it('FR-SNAP-13: zero-length bars stay zero-length; a milestone ends where it starts', () => {
    const context = contextOf();
    const changeSet = changeSetOf(
      {
        id: 'zero',
        after: { start: at('2026-03-05T10:00'), endExclusive: at('2026-03-05T10:00'), progress: 0 },
      },
      {
        id: 'pin',
        after: { start: at('2026-03-09T12:00'), endExclusive: at('2026-03-10'), progress: 0 },
      },
    );
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(result.changes.map((change) => [change.id, change.after])).toEqual([
      [
        'zero',
        { start: at('2026-03-05T10:00'), endExclusive: at('2026-03-05T10:00'), progress: 0 },
      ],
      ['pin', { start: at('2026-03-09'), endExclusive: at('2026-03-09'), progress: 0 }],
    ]);
    // Only the milestone's start was misaligned (day precision); its end is not checked.
    expect(issues.map((issue) => issue.path)).toEqual(['changes[1].after.start']);
  });

  it('FR-TX-2: drops what cannot be applied, with error issues', () => {
    const context = contextOf();
    const valid = { start: at('2026-03-04'), endExclusive: at('2026-03-06'), progress: 0 };
    const changeSet: ChangeSet = {
      ...changeSetOf(
        { id: 'ghost', after: valid },
        { id: 'stub', after: valid },
        { id: 'frozen', after: valid },
        { id: 'build', after: { ...valid, start: Number.NaN as DateTimeMs } },
        { id: 'build', after: { ...valid, endExclusive: at('2026-03-03') } },
        { id: 'build', after: { ...valid, progress: Number.POSITIVE_INFINITY } },
        { id: 'build', after: { ...valid, start: 9e15 as DateTimeMs } },
        { id: 'build', after: valid },
      ),
    };
    const junk = [...changeSet.changes, null, { id: 'meet' }, 'meet'] as unknown as Change[];
    const { changeSet: result, issues } = revalidateChangeSet(
      { ...changeSet, changes: junk },
      context,
    );
    expect(result.changes.map((change) => [change.id, change.after])).toEqual([['build', valid]]);
    expect(issues.map((issue) => [issue.code, issue.severity, issue.path])).toEqual([
      ['unknown-task', 'error', 'changes[0]'],
      ['unknown-task', 'error', 'changes[1]'],
      ['locked-task', 'error', 'changes[2]'],
      ['duplicate-change', 'error', 'changes[3]'],
      ['duplicate-change', 'error', 'changes[4]'],
      ['duplicate-change', 'error', 'changes[5]'],
      ['duplicate-change', 'error', 'changes[6]'],
      ['invalid-change', 'error', 'changes[8]'],
      ['invalid-change', 'error', 'changes[9]'],
      ['invalid-change', 'error', 'changes[10]'],
    ]);
    expect(issues.slice(0, 3).map((issue) => issue.message)).toEqual([
      'changes[0]: no task has this id, the change is dropped',
      'changes[1]: the task has no bar, the change is dropped',
      'changes[2]: the task is locked, the change is dropped',
    ]);
  });

  it('FR-TX-2: rejects non-finite values, an end before the start and clamps progress', () => {
    const context = contextOf();
    const valid = { start: at('2026-03-04'), endExclusive: at('2026-03-06'), progress: 0 };
    const cases: [Partial<TaskPatch>, string][] = [
      [{ ...valid, start: Number.NaN as DateTimeMs }, 'invalid-change'],
      [{ ...valid, endExclusive: Number.POSITIVE_INFINITY as DateTimeMs }, 'invalid-change'],
      [{ ...valid, start: -9e15 as DateTimeMs }, 'invalid-change'],
      [{ ...valid, progress: Number.NaN }, 'invalid-change'],
      [{ start: valid.start, endExclusive: valid.endExclusive }, 'invalid-change'],
      [{ ...valid, endExclusive: at('2026-03-03') }, 'end-before-start'],
    ];
    for (const [after, code] of cases) {
      const { changeSet, issues } = revalidateChangeSet(
        changeSetOf({ id: 'build', after }),
        context,
      );
      expect(changeSet.changes).toEqual([]);
      expect(issues.map((issue) => issue.code)).toEqual([code]);
    }
    const { changeSet, issues } = revalidateChangeSet(
      changeSetOf({ id: 'build', after: { ...valid, progress: 140 } }),
      context,
    );
    expect(changeSet.changes[0]?.after.progress).toBe(100);
    expect(issues).toMatchObject([
      {
        code: 'progress-out-of-range',
        severity: 'warning',
        path: 'changes[0].after.progress',
        value: 140,
        suggested: 100,
      },
    ]);
    expect(
      revalidateChangeSet(changeSetOf({ id: 'build', after: { ...valid, progress: -5 } }), context)
        .changeSet.changes[0]?.after.progress,
    ).toBe(0);
  });

  it('FR-TX-1: takes `before` from the model, drops no-ops, keeps `cause` and `via`', () => {
    const context = contextOf();
    const moved = { start: at('2026-03-09'), endExclusive: at('2026-03-10'), progress: 0 };
    const changeSet: ChangeSet = {
      reason: 'move',
      changes: [
        { ...changeSetOf({ id: 'next', after: moved }).changes[0]!, cause: 'link', via: 'build' },
        {
          ...changeSetOf({ id: 'meet', after: MEET }).changes[0]!,
          cause: 'parent',
        },
        {
          ...changeSetOf({
            id: 'build',
            after: { start: at('2026-03-03'), endExclusive: at('2026-03-06'), progress: 20 },
          }).changes[0]!,
          cause: 'bogus' as 'direct',
        },
      ],
      conflicts: [],
    };
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(issues).toEqual([]);
    expect(result.reason).toBe('move');
    expect(result.changes).toEqual([
      {
        id: 'next',
        before: { start: at('2026-03-06'), endExclusive: at('2026-03-07'), progress: 0 },
        after: moved,
        cause: 'link',
        via: 'build',
      },
      {
        id: 'build',
        before: { start: at('2026-03-03'), endExclusive: at('2026-03-06'), progress: 0 },
        after: { start: at('2026-03-03'), endExclusive: at('2026-03-06'), progress: 20 },
        cause: 'direct',
      },
    ]);
    expect(Object.isFrozen(result.changes)).toBe(true);
  });

  it('FR-SCH-6: conflicts with lists (outside-parent edges) compare by value', () => {
    const { calendar } = createWorkCalendar();
    const tasks: Task[] = [
      { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-06' },
      { id: 'child', name: 'Child', parentId: 'phase', start: '2026-03-03', end: '2026-03-04' },
    ];
    const model = normalizeModel({ tasks }, { calendar });
    const context = { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) };
    const changeSet = propagate(
      { kind: 'resize-end', id: 'child', endExclusive: at('2026-03-10') },
      context,
    );
    expect(changeSet.conflicts).toMatchObject([{ type: 'outside-parent', edges: ['end'] }]);
    const copies: ChangeSet = Object.freeze({
      ...changeSet,
      conflicts: Object.freeze(
        changeSet.conflicts.map((conflict) =>
          Object.freeze({
            ...conflict,
            ...('edges' in conflict ? { edges: Object.freeze([...conflict.edges]) } : {}),
          }),
        ),
      ),
    });
    expect(revalidateChangeSet(copies, context).changeSet).toBe(copies);
    const other: ChangeSet = Object.freeze({
      ...changeSet,
      conflicts: Object.freeze(
        changeSet.conflicts.map((conflict): Conflict =>
          conflict.type === 'outside-parent'
            ? Object.freeze({ ...conflict, edges: Object.freeze(['start', 'end'] as const) })
            : conflict,
        ),
      ),
    });
    expect(revalidateChangeSet(other, context).changeSet).toEqual(changeSet);
  });

  it('FR-SCH-6, FR-SNAP-13: recomputes the conflicts of the result', () => {
    const context = contextOf();
    // A hook moved 'build' onto Saturday and copied the (empty) conflicts of the preview.
    const changeSet = changeSetOf({
      id: 'build',
      after: { start: at('2026-03-07'), endExclusive: at('2026-03-10'), progress: 0 },
    });
    const { changeSet: result, issues } = revalidateChangeSet(changeSet, context);
    expect(issues).toEqual([]);
    expect(result.conflicts.map((conflict) => [conflict.type, conflict.id])).toEqual([
      ['non-working-start', 'build'],
      // The unmoved successor now starts before 'build' ends.
      ['link-violated', 'next'],
    ]);
    expect(result.conflicts[0]).toMatchObject({ date: at('2026-03-07') });
    // Revalidating the result again changes nothing.
    expect(revalidateChangeSet(result, context).changeSet).toBe(result);
  });

  it('FR-TX-2: a copy of a valid change set is replaced by a frozen equal one', () => {
    const context = contextOf();
    const original = propagate(
      { kind: 'move', id: 'build', start: at('2026-03-07') },
      { ...context, options: { skipNonWorkingDays: { move: false } } },
    );
    expect(original.conflicts.map((conflict) => conflict.type)).toEqual(['non-working-start']);
    const copy: ChangeSet = { ...original, changes: [...original.changes] };
    const result = revalidateChangeSet(copy, context);
    expect(result.changeSet).not.toBe(copy);
    expect(result.changeSet).toEqual(original);
    expect(result.changeSet.changes[0]).toBe(original.changes[0]);
    expect(Object.isFrozen(result.changeSet)).toBe(true);
    // Stale conflicts make a new change set too.
    const stale: ChangeSet = Object.freeze({ ...original, conflicts: Object.freeze([]) });
    expect(revalidateChangeSet(stale, context).changeSet.conflicts).toEqual(original.conflicts);
    // Equal frozen conflicts given as copies keep the input.
    const copies: ChangeSet = Object.freeze({
      ...original,
      conflicts: Object.freeze(
        original.conflicts.map((conflict) => Object.freeze({ ...conflict })),
      ),
    });
    expect(revalidateChangeSet(copies, context).changeSet).toBe(copies);
    // An empty change set has no conflicts.
    const empty = revalidateChangeSet({ reason: 'api', changes: [], conflicts: [] }, context);
    expect(empty.changeSet).toEqual({ reason: 'api', changes: [], conflicts: [] });
  });
});

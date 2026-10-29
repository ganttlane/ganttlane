import { sampleProject, workingDayScenarios } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import { normalizeModel } from '../model';
import { asDateTimeMs, type DateTimeMs, DAY, parseDateInput, toISODate } from '../time';
import {
  buildLinkGraph,
  type ChangeSet,
  type MoveChildren,
  propagate,
  type PropagationCommand,
  type PropagationContext,
  type PropagationPolicy,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

function rows(changeSet: ChangeSet): string[] {
  return changeSet.changes.map((change) => {
    const { start, endExclusive } = change.after;
    const last = toISODate(asDateTimeMs(endExclusive - DAY));
    const via = change.via === undefined ? '' : ` ${String(change.via)}`;
    return `${String(change.id)} ${toISODate(start)}..${last} (${change.cause}${via})`;
  });
}

describe('FR-SCH-7: working-day scenarios of a project plan', () => {
  it.each(workingDayScenarios)('FR-SCH-7 ($id): $title', (scenario) => {
    const { given, action, expected } = scenario;
    const { calendar } = createWorkCalendar(given.calendar);
    const scheduling = given.options?.scheduling;
    const model = normalizeModel(
      { tasks: [given.task] },
      { calendar, durationMode: scheduling?.durationMode },
    );
    expect(model.issues).toEqual([]);
    // "Accept" on the non-working-day prompt is what `skipNonWorkingDays.resize` does; "ignore"
    // keeps the edge (the conflict itself is plan step 2.5).
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

    const { changes } = propagate(command, context);
    expect(changes).toHaveLength(1);
    const { start, endExclusive } = changes[0]!.after;
    expect(toISODate(start)).toBe(expected.start);
    expect(toISODate(asDateTimeMs(endExclusive - DAY))).toBe(expected.end);
    expect(calendar.countWorkingTime(start, endExclusive) / DAY).toBe(expected.workingDays);
    expect((endExclusive - start) / DAY).toBe(expected.calendarDays);
  });
});

describe('sample project', () => {
  const { calendar } = createWorkCalendar(sampleProject.calendar);
  const { scheduling, hierarchy } = sampleProject.options ?? {};
  const model = normalizeModel(sampleProject, {
    calendar,
    durationMode: scheduling?.durationMode,
    defaultLinkType: scheduling?.defaultLinkType,
  });
  const contextFor = (
    moveChildren: MoveChildren | undefined,
    propagation: PropagationPolicy = 'preserve-lag',
  ): PropagationContext => ({
    model,
    hierarchy: buildHierarchy(model, { childAnchor: hierarchy?.childAnchor }),
    graph: buildLinkGraph(model),
    options: { propagation, moveChildren, skipNonWorkingDays: scheduling?.skipNonWorkingDays },
  });
  const moveBuild: PropagationCommand = { kind: 'move', id: 'group-3', start: at('2026-04-06') };

  it('FR-SCH-1, FR-SCH-2, FR-SCH-3, FR-SCH-9: moving a group a week later moves the rest of the plan', () => {
    expect(model.issues).toEqual([]);
    expect(scheduling?.propagation).toBe('preserve-lag');
    expect(hierarchy?.moveChildren).toBe('following');
    expect(rows(propagate(moveBuild, contextFor(hierarchy?.moveChildren)))).toEqual([
      // 15 working days around the 04-24 holiday.
      'group-3 2026-04-06..2026-04-27 (direct)',
      'task-5 2026-04-06..2026-04-27 (parent group-3)',
      'task-6 2026-04-20..2026-04-27 (parent group-3)',
      // A manual date, but linked (not editable from the UI) to a moving task.
      'task-7 2026-04-28..2026-04-29 (link task-6)',
      'deliverable-3 2026-04-06..2026-04-06 (parent group-3)',
      // FS with a 1-working-day lag.
      'group-4 2026-04-29..2026-05-14 (link group-3)',
      'task-8 2026-04-29..2026-05-05 (parent group-4)',
      'task-9 2026-05-06..2026-05-12 (link task-8)',
      'task-10 2026-04-29..2026-05-14 (parent group-4)',
      'deliverable-4 2026-05-15..2026-05-15 (parent group-4)',
      // Fixed duration: two working days over a weekend.
      'group-5 2026-05-15..2026-05-18 (link group-4)',
      'task-11 2026-05-18..2026-05-18 (parent group-5)',
      'deliverable-5 2026-05-19..2026-05-19 (parent group-5)',
      'group-6 2026-05-19..2026-07-01 (link group-5)',
      'task-12 2026-05-19..2026-07-01 (parent group-6)',
      'task-13 2026-07-01..2026-07-01 (parent group-6)',
      'deliverable-6 2026-07-02..2026-07-02 (parent group-6)',
    ]);
    // Locked checkpoints and blocks and the placeholder row are not in the change set.
  });

  it('FR-SCH-1, FR-SCH-2: manual mode moves the group with its children, "all" also the manual ones', () => {
    const following = [
      'group-3 2026-04-06..2026-04-27 (direct)',
      'task-5 2026-04-06..2026-04-27 (parent group-3)',
      'task-6 2026-04-20..2026-04-27 (parent group-3)',
      'deliverable-3 2026-04-06..2026-04-06 (parent group-3)',
    ];
    expect(rows(propagate(moveBuild, contextFor('following', 'none')))).toEqual(following);
    expect(rows(propagate(moveBuild, contextFor('all', 'none')))).toEqual([
      ...following.slice(0, 3),
      // Keeps its 15-working-day start-to-start offset.
      'task-7 2026-04-28..2026-04-29 (parent group-3)',
      following[3],
    ]);
  });

  it('FR-SCH-9: a group that now ends before a holiday pushes its deliverable past it', () => {
    // Group 2 a week later: group 6 ends on Thursday 07-02, the next day is a holiday.
    const command: PropagationCommand = { kind: 'move', id: 'group-2', start: at('2026-03-23') };
    const changed = rows(propagate(command, contextFor('following')));
    expect(changed.at(-2)).toBe('task-13 2026-07-02..2026-07-02 (parent group-6)');
    expect(changed.at(-1)).toBe('deliverable-6 2026-07-06..2026-07-06 (parent group-6)');
  });

  it('FR-SCH-3: the locked first group does not move', () => {
    const command: PropagationCommand = { kind: 'move', id: 'group-1', start: at('2026-03-09') };
    expect(propagate(command, contextFor('all')).changes).toEqual([]);
  });
});

import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
// The schedule module does not depend on the hierarchy (docs/architecture.md §3.1); the tree is
// built through the public entry point, as a caller would.
import { buildHierarchy } from '../index';
import {
  type DurationMode,
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
  HOUR,
  MINUTE,
  parseDateInput,
  toISODate,
  toISODateTime,
} from '../time';
import {
  buildLinkGraph,
  type ChangeSet,
  propagate,
  type PropagationCommand,
  type PropagationContext,
  type PropagationOptions,
  type RescheduleCommand,
} from './index';

const { calendar } = createWorkCalendar({ weekends: [0, 6] });

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
  /** Graph and hierarchy issues are expected (cycles). */
  readonly withIssues?: boolean;
}

/** A context over frozen input; the input must be clean (no issues). */
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

/** A span as text: `first..last` day for day precision, `start..endExclusive` for time. */
function spanText(precision: 'day' | 'time', start: DateTimeMs, endExclusive: DateTimeMs): string {
  if (precision === 'time') return `${toISODateTime(start)}..${toISODateTime(endExclusive)}`;
  if (endExclusive === start) return toISODate(start);
  return `${toISODate(start)}..${toISODate(asDateTimeMs(endExclusive - DAY))}`;
}

/** The changes as `id span (cause via)` rows, in change-set order. */
function rows(context: PropagationContext, changeSet: ChangeSet): string[] {
  return changeSet.changes.map((change) => {
    const precision = change.after.precision ?? context.model.taskById.get(change.id)!.precision;
    const via = change.via === undefined ? '' : ` ${String(change.via)}`;
    const { start, endExclusive } = change.after;
    return `${String(change.id)} ${spanText(precision, start, endExclusive)} (${change.cause}${via})`;
  });
}

function run(context: PropagationContext, command: PropagationCommand): string[] {
  return rows(context, propagate(command, context));
}

/** Drags the start of task `a` to a date. */
function startAt(iso: string): PropagationCommand {
  return { kind: 'resize-start', id: 'a', start: at(iso) };
}

/** Moves a task by whole days from its current start. */
function moveBy(context: PropagationContext, id: string, days: number): PropagationCommand {
  const span = context.model.taskById.get(id)!.span!;
  return { kind: 'move', id, start: asDateTimeMs(span.start + days * DAY) };
}

// 2026-03-02 is a Monday; Saturday and Sunday are off.
const A: Task = { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-04' };

describe('propagate: the edited task', () => {
  it('FR-SCH-3: move keeps the calendar length, resizes keep the other edge', () => {
    const context = contextOf([A]);
    expect(run(context, { kind: 'move', id: 'a', start: at('2026-03-10') })).toEqual([
      'a 2026-03-10..2026-03-12 (direct)',
    ]);
    expect(run(context, { kind: 'resize-start', id: 'a', start: at('2026-02-26') })).toEqual([
      'a 2026-02-26..2026-03-04 (direct)',
    ]);
    expect(run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-07') })).toEqual([
      'a 2026-03-02..2026-03-06 (direct)',
    ]);
  });

  it('FR-SCH-3: move keeps the working-day count of a working-mode task', () => {
    const context = contextOf([{ ...A, end: '2026-03-06', durationMode: 'working' }]);
    // Thursday + 5 working days: Thu, Fri, Mon, Tue, Wed.
    expect(run(context, { kind: 'move', id: 'a', start: at('2026-03-05') })).toEqual([
      'a 2026-03-05..2026-03-11 (direct)',
    ]);
  });

  it('FR-SNAP-6: a resize keeps at least one step', () => {
    const context = contextOf([A]);
    expect(run(context, { kind: 'resize-start', id: 'a', start: at('2026-03-20') })).toEqual([
      'a 2026-03-04..2026-03-04 (direct)',
    ]);
    expect(run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-02-01') })).toEqual([
      'a 2026-03-02..2026-03-02 (direct)',
    ]);
    const hourly = contextOf(
      [{ id: 't', name: 'T', start: '2026-03-02T09:00', end: '2026-03-02T12:00' }],
      { model: { granularity: '1h' } },
    );
    expect(
      run(hourly, { kind: 'resize-end', id: 't', endExclusive: at('2026-03-02T08:00') }),
    ).toEqual(['t 2026-03-02T09:00..2026-03-02T10:00 (direct)']);
  });

  it('FR-SCH-4: skipNonWorkingDays.move rolls a start on a weekend forward to Monday', () => {
    const context = contextOf([A]);
    const saturday: PropagationCommand = { kind: 'move', id: 'a', start: at('2026-03-07') };
    expect(run(context, saturday)).toEqual(['a 2026-03-09..2026-03-11 (direct)']);
    const off = contextOf([A], { options: { skipNonWorkingDays: { move: false } } });
    expect(run(off, saturday)).toEqual(['a 2026-03-07..2026-03-09 (direct)']);
  });

  it('FR-SCH-4: skipNonWorkingDays.resize rolls an end inside a weekend back to Friday', () => {
    // The last day dragged to Sunday: the exclusive end is Monday.
    const command: PropagationCommand = {
      kind: 'resize-end',
      id: 'a',
      endExclusive: at('2026-03-09'),
    };
    expect(run(contextOf([A]), command)).toEqual(['a 2026-03-02..2026-03-08 (direct)']);
    const skip = contextOf([A], { options: { skipNonWorkingDays: { resize: true } } });
    expect(run(skip, command)).toEqual(['a 2026-03-02..2026-03-06 (direct)']);
    // A start dragged back to a Saturday goes forward to Monday (FR-SCH-7 "accept").
    const start: PropagationCommand = { kind: 'resize-start', id: 'a', start: at('2026-02-21') };
    expect(run(skip, start)).toEqual(['a 2026-02-23..2026-03-04 (direct)']);
    expect(run(contextOf([A]), start)).toEqual(['a 2026-02-21..2026-03-04 (direct)']);
  });

  it('FR-SCH-4, FR-SNAP-6: skipNonWorkingDays.resize never rolls a start past the minimum length', () => {
    const skip = { options: { skipNonWorkingDays: { resize: true } } } as const;
    // Monday … Sunday (calendar mode): the latest start is Sunday, a non-working day.
    const week = contextOf([{ ...A, end: '2026-03-08' }], skip);
    // Saturday rolls to Monday, past the end: a no-op instead of a one-day task on Sunday.
    expect(run(week, { kind: 'resize-start', id: 'a', start: at('2026-03-07') })).toEqual([]);
    // Dragged past the end: clamped to Sunday, which rolls past the end too.
    expect(run(week, { kind: 'resize-start', id: 'a', start: at('2026-03-20') })).toEqual([]);
    expect(run(contextOf([{ ...A, end: '2026-03-08' }]), startAt('2026-03-07'))).toEqual([
      'a 2026-03-07..2026-03-08 (direct)',
    ]);
    // A roll that stays within the minimum length still applies.
    const longer = contextOf([{ ...A, end: '2026-03-10' }], skip);
    expect(run(longer, startAt('2026-03-07'))).toEqual(['a 2026-03-09..2026-03-10 (direct)']);
    expect(run(longer, startAt('2026-03-20'))).toEqual(['a 2026-03-10..2026-03-10 (direct)']);
  });

  it('FR-SCH-4, FR-SNAP-6: skipNonWorkingDays.resize never rolls an end past the minimum length', () => {
    const skip = { options: { skipNonWorkingDays: { resize: true } } } as const;
    // Saturday … Friday (calendar mode): the earliest end is the end of Saturday.
    const task: Task = { id: 'a', name: 'A', start: '2026-03-07', end: '2026-03-13' };
    const context = contextOf([task], skip);
    const endAt = (iso: string): PropagationCommand => ({
      kind: 'resize-end',
      id: 'a',
      endExclusive: at(iso),
    });
    // The last day dragged to Sunday rolls back to the end of Friday, before the start.
    expect(run(context, endAt('2026-03-09'))).toEqual([]);
    // Dragged before the start: clamped to the end of Saturday, which rolls back before it too.
    expect(run(context, endAt('2026-03-01'))).toEqual([]);
    expect(run(contextOf([task]), endAt('2026-03-09'))).toEqual([
      'a 2026-03-07..2026-03-08 (direct)',
    ]);
    // A roll that stays within the minimum length still applies.
    expect(run(context, endAt('2026-03-23'))).toEqual(['a 2026-03-07..2026-03-20 (direct)']);
  });

  it('FR-SCH-3: milestones move as a point and cannot be resized', () => {
    const context = contextOf([{ id: 'm', name: 'M', type: 'milestone', start: '2026-03-04' }]);
    expect(run(context, { kind: 'move', id: 'm', start: at('2026-03-10') })).toEqual([
      'm 2026-03-10 (direct)',
    ]);
    expect(run(context, { kind: 'resize-start', id: 'm', start: at('2026-03-01') })).toEqual([]);
    expect(run(context, { kind: 'resize-end', id: 'm', endExclusive: at('2026-03-10') })).toEqual(
      [],
    );
  });

  it('FR-SCH-3: fixedDuration tasks move but cannot be resized', () => {
    const context = contextOf([{ ...A, fixedDuration: true }]);
    expect(run(context, { kind: 'resize-start', id: 'a', start: at('2026-03-03') })).toEqual([]);
    expect(run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-10') })).toEqual(
      [],
    );
    expect(run(context, moveBy(context, 'a', 1))).toEqual(['a 2026-03-03..2026-03-05 (direct)']);
  });

  it('FR-SCH-3: reschedule puts both edges at once, with reason api', () => {
    const context = contextOf([A, { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-10' }], {
      links: [{ source: 'a', target: 'b' }],
    });
    const reschedule = (start: string, end: string): RescheduleCommand => ({
      kind: 'reschedule',
      id: 'a',
      start: at(start),
      endExclusive: at(end),
    });
    const changeSet = propagate(reschedule('2026-03-03', '2026-03-07'), context);
    expect(changeSet.reason).toBe('api');
    // The end moved by two days, so does the FS successor; no edge skips the weekend.
    expect(rows(context, changeSet)).toEqual([
      'a 2026-03-03..2026-03-06 (direct)',
      'b 2026-03-11..2026-03-12 (link a)',
    ]);
    // At least one step long; non-finite edges are ignored.
    expect(run(context, reschedule('2026-03-05', '2026-03-01'))).toEqual([
      'a 2026-03-05..2026-03-05 (direct)',
      'b 2026-03-10..2026-03-11 (link a)',
    ]);
    expect(
      run(context, { ...reschedule('2026-03-05', '2026-03-06'), endExclusive: asDateTimeMs(NaN) }),
    ).toEqual([]);
    // Milestones and fixedDuration tasks keep their length, as in a move.
    const rigid = contextOf([
      { ...A, fixedDuration: true },
      { id: 'm', name: 'M', type: 'milestone', start: '2026-03-04' },
    ]);
    expect(run(rigid, reschedule('2026-03-10', '2026-03-20'))).toEqual([
      'a 2026-03-10..2026-03-12 (direct)',
    ]);
    expect(
      run(rigid, {
        kind: 'reschedule',
        id: 'm',
        start: at('2026-03-10'),
        endExclusive: at('2026-03-12'),
      }),
    ).toEqual(['m 2026-03-10 (direct)']);
  });

  it('FR-SCH-3: locked tasks, tasks without a bar and unknown ids are not edited', () => {
    const context = contextOf([
      { ...A, locked: true },
      { id: 'p', name: 'Placeholder', type: 'placeholder' },
    ]);
    for (const id of ['a', 'p', 'ghost']) {
      const changeSet = propagate({ kind: 'move', id, start: at('2026-03-10') }, context);
      expect(changeSet).toEqual({ reason: 'move', changes: [], conflicts: [] });
    }
  });

  it('FR-SNAP-12: a misaligned or non-finite date is aligned or ignored', () => {
    const context = contextOf([A]);
    expect(run(context, { kind: 'move', id: 'a', start: at('2026-03-10T13:00') })).toEqual([
      'a 2026-03-11..2026-03-13 (direct)',
    ]);
    expect(run(context, { kind: 'move', id: 'a', start: asDateTimeMs(NaN) })).toEqual([]);
    expect(
      run(context, { kind: 'resize-end', id: 'a', endExclusive: asDateTimeMs(Infinity) }),
    ).toEqual([]);
    // No change at all: the same start.
    expect(run(context, { kind: 'move', id: 'a', start: at('2026-03-02') })).toEqual([]);
  });
});

/**
 * Fork parity of `update_nested_bars_dates` for one link: the predecessor A (Mon 03-02 … Wed
 * 03-04) moves 2 days later or 3 days earlier, the 3-day successor B keeps the lag in both
 * directions. Columns: type, lag (days), B before, B after +2, B after −3.
 */
const LINK_CASES: readonly (readonly [LinkType, number, string, string, string])[] = [
  ['FS', 2, '2026-03-07', '2026-03-09..2026-03-11', '2026-03-04..2026-03-06'],
  ['FS', 0, '2026-03-05', '2026-03-07..2026-03-09', '2026-03-02..2026-03-04'],
  ['FS', -1, '2026-03-04', '2026-03-06..2026-03-08', '2026-03-01..2026-03-03'],
  ['SS', 2, '2026-03-04', '2026-03-06..2026-03-08', '2026-03-01..2026-03-03'],
  ['SS', 0, '2026-03-02', '2026-03-04..2026-03-06', '2026-02-27..2026-03-01'],
  ['SS', -1, '2026-03-01', '2026-03-03..2026-03-05', '2026-02-26..2026-02-28'],
  ['FF', 2, '2026-03-04', '2026-03-06..2026-03-08', '2026-03-01..2026-03-03'],
  ['FF', 0, '2026-03-02', '2026-03-04..2026-03-06', '2026-02-27..2026-03-01'],
  ['FF', -1, '2026-03-01', '2026-03-03..2026-03-05', '2026-02-26..2026-02-28'],
  ['SF', 2, '2026-03-01', '2026-03-03..2026-03-05', '2026-02-26..2026-02-28'],
  ['SF', 0, '2026-02-27', '2026-03-01..2026-03-03', '2026-02-24..2026-02-26'],
  ['SF', -1, '2026-02-26', '2026-02-28..2026-03-02', '2026-02-23..2026-02-25'],
];

describe('propagate: links (fork parity)', () => {
  it.each(LINK_CASES)(
    'FR-SCH-1, FR-LINK-1: %s lag %i keeps the lag forward and backward',
    (type, lag, start, forward, backward) => {
      const b: Task = { id: 'b', name: 'B', start, duration: 3 };
      const context = contextOf([A, b], { links: [{ source: 'a', target: 'b', type, lag }] });
      expect(run(context, moveBy(context, 'a', 2))).toEqual([
        'a 2026-03-04..2026-03-06 (direct)',
        `b ${forward} (link a)`,
      ]);
      expect(run(context, moveBy(context, 'a', -3))).toEqual([
        'a 2026-02-27..2026-03-01 (direct)',
        `b ${backward} (link a)`,
      ]);
    },
  );

  it('FR-SCH-1: a derived lag is the current gap and is kept along a chain', () => {
    const context = contextOf(
      [
        A,
        { id: 'b', name: 'B', start: '2026-03-09', duration: 2 },
        { id: 'c', name: 'C', start: '2026-03-12', duration: 1 },
      ],
      {
        links: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
        ],
      },
    );
    expect(run(context, moveBy(context, 'a', 7))).toEqual([
      'a 2026-03-09..2026-03-11 (direct)',
      'b 2026-03-16..2026-03-17 (link a)',
      'c 2026-03-19..2026-03-19 (link b)',
    ]);
  });

  it('FR-SCH-1: propagation "none" leaves links visual only', () => {
    const tasks = [A, { id: 'b', name: 'B', start: '2026-03-05', duration: 3 }];
    const links: Link[] = [{ source: 'a', target: 'b' }];
    const context = contextOf(tasks, { links, options: { propagation: 'none' } });
    expect(run(context, moveBy(context, 'a', 2))).toEqual(['a 2026-03-04..2026-03-06 (direct)']);
  });

  it('FR-LINK-2: an FS + FF pair pins both edges, the successor stretches to them', () => {
    // B is 3 days long, but its FF lag asks for 4: the pair stretches it.
    const b: Task = { id: 'b', name: 'B', start: '2026-03-05', duration: 3 };
    const links: Link[] = [
      { source: 'a', target: 'b', type: 'FS', lag: 0 },
      { source: 'a', target: 'b', type: 'FF', lag: 4 },
    ];
    const context = contextOf([A, b], { links });
    expect(run(context, moveBy(context, 'a', 2))).toEqual([
      'a 2026-03-04..2026-03-06 (direct)',
      'b 2026-03-07..2026-03-10 (link a)',
    ]);
    // fixedDuration (legacy duration_as_constant): moved by the start pin, length kept.
    const fixed = contextOf([A, { ...b, fixedDuration: true }], { links });
    expect(run(fixed, moveBy(fixed, 'a', 2))).toEqual([
      'a 2026-03-04..2026-03-06 (direct)',
      'b 2026-03-07..2026-03-09 (link a)',
    ]);
  });

  it('FR-LINK-2, FR-SCH-3: SS + FF follow a resize of either edge; fixedDuration does not stretch', () => {
    const links: Link[] = [
      { source: 'a', target: 'b', type: 'SS' },
      { source: 'a', target: 'b', type: 'FF' },
    ];
    const b: Task = { id: 'b', name: 'B', start: '2026-03-03', end: '2026-03-04' };
    const context = contextOf([A, b], { links });
    expect(run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-07') })).toEqual([
      'a 2026-03-02..2026-03-06 (direct)',
      'b 2026-03-03..2026-03-06 (link a)',
    ]);
    expect(run(context, { kind: 'resize-start', id: 'a', start: at('2026-02-25') })).toEqual([
      'a 2026-02-25..2026-03-04 (direct)',
      'b 2026-02-26..2026-03-04 (link a)',
    ]);
    const fixed = contextOf([A, { ...b, fixedDuration: true }], { links });
    // Moved by its start pin, which a resize of the end does not change.
    expect(run(fixed, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-07') })).toEqual([
      'a 2026-03-02..2026-03-06 (direct)',
    ]);
    expect(run(fixed, { kind: 'resize-start', id: 'a', start: at('2026-02-25') })).toEqual([
      'a 2026-02-25..2026-03-04 (direct)',
      'b 2026-02-26..2026-02-27 (link a)',
    ]);
  });

  it('FR-SCH-3: a locked successor neither moves nor passes the change on', () => {
    const context = contextOf(
      [
        A,
        { id: 'b', name: 'B', start: '2026-03-05', duration: 2, locked: true },
        { id: 'c', name: 'C', start: '2026-03-09', duration: 2 },
        { id: 'd', name: 'D', start: '2026-03-05', duration: 1 },
        { id: 'e', name: 'E', start: '2026-03-06', duration: 1 },
      ],
      {
        links: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
          { source: 'a', target: 'd' },
          { source: 'd', target: 'e' },
        ],
      },
    );
    expect(run(context, moveBy(context, 'a', 1))).toEqual([
      'a 2026-03-03..2026-03-05 (direct)',
      'd 2026-03-06..2026-03-06 (link a)',
      'e 2026-03-07..2026-03-07 (link d)',
    ]);
  });

  it('FR-SCH-5: several changed predecessors on one edge: the furthest in the edit direction wins', () => {
    // X has FS links from A (gap 0) and from B (lag 0, gap 1 day); B follows A's start.
    const context = contextOf(
      [
        A,
        { id: 'b', name: 'B', start: '2026-03-02', end: '2026-03-03' },
        { id: 'x', name: 'X', start: '2026-03-05', duration: 2 },
      ],
      {
        links: [
          { source: 'a', target: 'b', type: 'SS', lag: 0 },
          { source: 'a', target: 'x', type: 'FS' },
          { source: 'b', target: 'x', type: 'FS', lag: 0 },
        ],
      },
    );
    // Forward: the latest pin (A's, Sat 03-07) beats B's (Fri 03-06).
    expect(run(context, moveBy(context, 'a', 2))).toEqual([
      'a 2026-03-04..2026-03-06 (direct)',
      'b 2026-03-04..2026-03-05 (link a)',
      'x 2026-03-07..2026-03-08 (link a)',
    ]);
    // Backward: the earliest pin (B's, Sun 03-01) beats A's (Mon 03-02).
    expect(run(context, moveBy(context, 'a', -3))).toEqual([
      'a 2026-02-27..2026-03-01 (direct)',
      'b 2026-02-27..2026-02-28 (link a)',
      'x 2026-03-01..2026-03-02 (link b)',
    ]);
  });

  it('FR-SCH-5: a widening reschedule propagates forward, by its end', () => {
    // A Mon 03-09 … Fri 03-13; B starts with A (SS); T follows A (FS, gap 2 days) and B (FS, lag
    // 3 days).
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-09', end: '2026-03-13' },
        { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-10' },
        { id: 't', name: 'T', start: '2026-03-16', end: '2026-03-17' },
      ],
      {
        links: [
          { source: 'a', target: 'b', type: 'SS', lag: 0 },
          { source: 'a', target: 't', type: 'FS' },
          { source: 'b', target: 't', type: 'FS', lag: 3 },
        ],
      },
    );
    const widen: RescheduleCommand = {
      kind: 'reschedule',
      id: 'a',
      start: at('2026-03-08'),
      endExclusive: at('2026-03-19'),
    };
    // The start moved back a day and the end on five: T takes the latest pin (A's, 03-21), as
    // when only the end moves; the earliest (B's, 03-13) would violate A → T.
    const changeSet = propagate(widen, context);
    expect(rows(context, changeSet)).toEqual([
      'a 2026-03-08..2026-03-18 (direct)',
      'b 2026-03-08..2026-03-09 (link a)',
      't 2026-03-21..2026-03-22 (link a)',
    ]);
    expect(changeSet.conflicts.filter((conflict) => conflict.type === 'link-violated')).toEqual([]);
    expect(
      run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-19') }).at(-1),
    ).toBe('t 2026-03-21..2026-03-22 (link a)');
    // Narrowing (start later, end earlier) is forward by its start, as before.
    const narrow: RescheduleCommand = {
      ...widen,
      start: at('2026-03-10'),
      endExclusive: at('2026-03-12'),
    };
    expect(run(context, narrow)).toEqual([
      'a 2026-03-10..2026-03-11 (direct)',
      'b 2026-03-10..2026-03-11 (link a)',
      't 2026-03-15..2026-03-16 (link b)',
    ]);
  });

  it('FR-LINK-7, FR-SCH-5: links on a cycle are not propagated and nothing loops', () => {
    const context = contextOf([A, { id: 'b', name: 'B', start: '2026-03-05', duration: 2 }], {
      links: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
      withIssues: true,
    });
    expect(context.graph.links.every((link) => link.inCycle)).toBe(true);
    expect(run(context, moveBy(context, 'a', 2))).toEqual(['a 2026-03-04..2026-03-06 (direct)']);
  });
});

/** A two-week parent (Mon 03-02 … Fri 03-13) with a child for every kind of parent anchor. */
const FAMILY: readonly Task[] = [
  { id: 'p', name: 'Parent', start: '2026-03-02', end: '2026-03-13' },
  {
    id: 'ss',
    name: 'SS',
    parentId: 'p',
    followParent: true,
    parentAnchor: 'SS',
    start: '2026-03-04',
    end: '2026-03-05',
  },
  {
    id: 'ff',
    name: 'FF',
    parentId: 'p',
    followParent: true,
    parentAnchor: 'FF',
    start: '2026-03-11',
    end: '2026-03-13',
  },
  {
    id: 'ssff',
    name: 'SS+FF',
    parentId: 'p',
    followParent: true,
    parentAnchor: ['SS', 'FF'],
    start: '2026-03-03',
    end: '2026-03-12',
  },
  {
    id: 'fs',
    name: 'FS',
    parentId: 'p',
    followParent: true,
    parentAnchor: 'FS',
    start: '2026-03-16',
    end: '2026-03-16',
  },
  { id: 'free', name: 'Free', parentId: 'p', start: '2026-03-09', end: '2026-03-10' },
];

const MOVE_P: PropagationCommand = { kind: 'move', id: 'p', start: at('2026-03-09') };
const RESIZE_END_P: PropagationCommand = {
  kind: 'resize-end',
  id: 'p',
  endExclusive: at('2026-03-17'),
};
const RESIZE_START_P: PropagationCommand = {
  kind: 'resize-start',
  id: 'p',
  start: at('2026-02-23'),
};

const CHILD_CASES: readonly (readonly [
  string,
  PropagationOptions['moveChildren'],
  PropagationCommand,
  string[],
])[] = [
  [
    'move, all',
    'all',
    MOVE_P,
    [
      'p 2026-03-09..2026-03-20 (direct)',
      'ss 2026-03-11..2026-03-12 (parent p)',
      'ff 2026-03-18..2026-03-20 (parent p)',
      'ssff 2026-03-10..2026-03-19 (parent p)',
      'fs 2026-03-23..2026-03-23 (parent p)',
      'free 2026-03-16..2026-03-17 (parent p)',
    ],
  ],
  [
    'move, following',
    'following',
    MOVE_P,
    [
      'p 2026-03-09..2026-03-20 (direct)',
      'ss 2026-03-11..2026-03-12 (parent p)',
      'ff 2026-03-18..2026-03-20 (parent p)',
      'ssff 2026-03-10..2026-03-19 (parent p)',
      'fs 2026-03-23..2026-03-23 (parent p)',
    ],
  ],
  ['move, none', 'none', MOVE_P, ['p 2026-03-09..2026-03-20 (direct)']],
  [
    'resize-end, all',
    'all',
    RESIZE_END_P,
    [
      'p 2026-03-02..2026-03-16 (direct)',
      'ff 2026-03-14..2026-03-16 (parent p)',
      'ssff 2026-03-03..2026-03-15 (parent p)',
      'fs 2026-03-19..2026-03-19 (parent p)',
    ],
  ],
  [
    'resize-start, all',
    'all',
    RESIZE_START_P,
    [
      'p 2026-02-23..2026-03-13 (direct)',
      'ss 2026-02-25..2026-02-26 (parent p)',
      'ssff 2026-02-24..2026-03-12 (parent p)',
      'free 2026-03-02..2026-03-03 (parent p)',
    ],
  ],
  [
    'resize-start, following',
    'following',
    RESIZE_START_P,
    [
      'p 2026-02-23..2026-03-13 (direct)',
      'ss 2026-02-25..2026-02-26 (parent p)',
      'ssff 2026-02-24..2026-03-12 (parent p)',
    ],
  ],
];

describe('propagate: children (fork parity)', () => {
  it.each(CHILD_CASES)('FR-SCH-2: %s', (_name, moveChildren, command, expected) => {
    const context = contextOf(FAMILY, { options: { moveChildren } });
    expect(run(context, command)).toEqual(expected);
  });

  it('FR-SCH-2: fixedDuration and locked children', () => {
    const tasks = FAMILY.map((task) =>
      task.id === 'ssff'
        ? { ...task, fixedDuration: true }
        : task.id === 'ff'
          ? { ...task, locked: true }
          : task,
    );
    const context = contextOf(tasks);
    // ssff keeps its 10 days and follows its start pin; ff is locked.
    expect(run(context, RESIZE_START_P)).toEqual([
      'p 2026-02-23..2026-03-13 (direct)',
      'ss 2026-02-25..2026-02-26 (parent p)',
      'ssff 2026-02-24..2026-03-05 (parent p)',
      'free 2026-03-02..2026-03-03 (parent p)',
    ]);
    expect(run(context, RESIZE_END_P)).toEqual([
      'p 2026-03-02..2026-03-16 (direct)',
      'fs 2026-03-19..2026-03-19 (parent p)',
    ]);
  });

  it('FR-SCH-2: nested parent → child → grandchild', () => {
    const context = contextOf([
      { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-13' },
      {
        id: 'c',
        name: 'C',
        parentId: 'p',
        followParent: true,
        start: '2026-03-03',
        end: '2026-03-06',
      },
      {
        id: 'g',
        name: 'G',
        parentId: 'c',
        followParent: true,
        start: '2026-03-04',
        end: '2026-03-05',
      },
      {
        id: 'locked',
        name: 'L',
        parentId: 'p',
        followParent: true,
        locked: true,
        start: '2026-03-02',
        duration: 1,
      },
      {
        id: 'under-locked',
        name: 'U',
        parentId: 'locked',
        followParent: true,
        start: '2026-03-02',
        duration: 1,
      },
    ]);
    expect(run(context, MOVE_P)).toEqual([
      'p 2026-03-09..2026-03-20 (direct)',
      'c 2026-03-10..2026-03-13 (parent p)',
      'g 2026-03-11..2026-03-12 (parent c)',
    ]);
  });

  it('FR-SCH-2, FR-SCH-5: a child linked to another phase moves that phase and its children', () => {
    const context = contextOf(
      [
        { id: 'p1', name: 'Phase 1', start: '2026-03-02', end: '2026-03-06' },
        {
          id: 'c1',
          name: 'C1',
          parentId: 'p1',
          followParent: true,
          parentAnchor: 'FF',
          start: '2026-03-05',
          end: '2026-03-06',
        },
        { id: 'p2', name: 'Phase 2', start: '2026-03-09', end: '2026-03-13' },
        {
          id: 'c2',
          name: 'C2',
          parentId: 'p2',
          followParent: true,
          start: '2026-03-10',
          end: '2026-03-11',
        },
      ],
      { links: [{ source: 'c1', target: 'p2' }] },
    );
    expect(run(context, { kind: 'move', id: 'p1', start: at('2026-03-09') })).toEqual([
      'p1 2026-03-09..2026-03-13 (direct)',
      'c1 2026-03-12..2026-03-13 (parent p1)',
      'p2 2026-03-16..2026-03-20 (link c1)',
      'c2 2026-03-17..2026-03-18 (parent p2)',
    ]);
    // Links only: the children of p1 stay and nothing reaches p2.
    const none = { ...context, options: { moveChildren: 'none' } } as const;
    expect(run(none, { kind: 'move', id: 'p1', start: at('2026-03-09') })).toEqual([
      'p1 2026-03-09..2026-03-13 (direct)',
    ]);
    // Children only: p1's child moves, the link is not followed.
    const manual = { ...context, options: { propagation: 'none' } } as const;
    expect(run(manual, { kind: 'move', id: 'p1', start: at('2026-03-09') })).toEqual([
      'p1 2026-03-09..2026-03-13 (direct)',
      'c1 2026-03-12..2026-03-13 (parent p1)',
    ]);
  });

  it('FR-SCH-5: a link from a child to its own parent is ignored instead of looping', () => {
    const context = contextOf(
      [
        { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-13' },
        {
          id: 'c',
          name: 'C',
          parentId: 'p',
          followParent: true,
          start: '2026-03-02',
          end: '2026-03-03',
        },
      ],
      { links: [{ source: 'c', target: 'p', type: 'SS' }] },
    );
    expect(run(context, MOVE_P)).toEqual([
      'p 2026-03-09..2026-03-20 (direct)',
      'c 2026-03-09..2026-03-10 (parent p)',
    ]);
    expect(run(context, { kind: 'move', id: 'c', start: at('2026-03-04') })).toEqual([
      'c 2026-03-04..2026-03-05 (direct)',
    ]);
  });

  it('FR-LINK-7, FR-SCH-5: every link of a cycle through a parent is ignored, as on a link cycle', () => {
    // p → c (parent), c → q → p (links): one cycle; both of its links are ignored.
    const context = contextOf(
      [
        { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-13' },
        {
          id: 'c',
          name: 'C',
          parentId: 'p',
          followParent: true,
          start: '2026-03-02',
          end: '2026-03-03',
        },
        { id: 'q', name: 'Q', start: '2026-03-04', end: '2026-03-05' },
        { id: 'r', name: 'R', start: '2026-03-06', end: '2026-03-06' },
      ],
      {
        links: [
          { source: 'c', target: 'q' },
          { source: 'q', target: 'p', type: 'SS' },
          { source: 'q', target: 'r' },
        ],
      },
    );
    expect(context.graph.links.some((link) => link.inCycle)).toBe(false);
    expect(run(context, MOVE_P)).toEqual([
      'p 2026-03-09..2026-03-20 (direct)',
      'c 2026-03-09..2026-03-10 (parent p)',
    ]);
    // Without children the links form no cycle and propagate.
    const linksOnly = { ...context, options: { moveChildren: 'none' } } as const;
    expect(run(linksOnly, { kind: 'move', id: 'c', start: at('2026-03-03') })).toEqual([
      'c 2026-03-03..2026-03-04 (direct)',
      'q 2026-03-05..2026-03-06 (link c)',
      'p 2026-03-03..2026-03-14 (link q)',
      'r 2026-03-07..2026-03-07 (link q)',
    ]);
  });
});

describe('propagate: working time', () => {
  it('FR-SCH-9: a Friday end and an FS lag of 0 start a working-mode successor on Monday', () => {
    const b: Task = {
      id: 'b',
      name: 'B',
      start: '2026-03-05',
      duration: 3,
      durationMode: 'working',
    };
    const context = contextOf([A, b], { links: [{ source: 'a', target: 'b', lag: 0 }] });
    // Thu, Fri, Mon before; A now ends on Friday, so B starts on Monday (not on Saturday).
    expect(run(context, moveBy(context, 'a', 2))).toEqual([
      'a 2026-03-04..2026-03-06 (direct)',
      'b 2026-03-09..2026-03-11 (link a)',
    ]);
    expect(run(context, moveBy(context, 'a', -3))).toEqual([
      'a 2026-02-27..2026-03-01 (direct)',
      'b 2026-03-02..2026-03-04 (link a)',
    ]);
  });

  it('FR-SCH-9: a working lag skips the weekend', () => {
    const context = contextOf(
      [
        { ...A, durationMode: 'working' },
        { id: 'b', name: 'B', start: '2026-03-06', duration: 2, durationMode: 'working' },
      ],
      { links: [{ source: 'a', target: 'b', lag: 1 }] },
    );
    expect(run(context, moveBy(context, 'a', 1))).toEqual([
      'a 2026-03-03..2026-03-05 (direct)',
      'b 2026-03-09..2026-03-10 (link a)',
    ]);
  });

  it('FR-SCH-9: an end pinned inside a weekend goes back to the end of Friday', () => {
    // A runs Mon–Sat (calendar), B Mon–Fri (working) with an FF lag of 0 working days.
    const context = contextOf(
      [
        { ...A, end: '2026-03-07' },
        { id: 'b', name: 'B', start: '2026-03-02', end: '2026-03-06', durationMode: 'working' },
      ],
      { links: [{ source: 'a', target: 'b', type: 'FF' }] },
    );
    expect(context.graph.links[0]?.lag?.ms).toBe(0);
    // A ends on Sunday: B's end lands in the weekend and stays on Friday.
    expect(run(context, moveBy(context, 'a', 1))).toEqual(['a 2026-03-03..2026-03-08 (direct)']);
    // A ends on Monday: B ends on Monday and keeps its 5 working days.
    expect(run(context, moveBy(context, 'a', 2))).toEqual([
      'a 2026-03-04..2026-03-09 (direct)',
      'b 2026-03-03..2026-03-09 (link a)',
    ]);
  });

  it('FR-SCH-2, FR-SCH-9: a working-mode child keeps its working-day offset from the parent', () => {
    const context = contextOf([
      { id: 'p', name: 'P', start: '2026-03-02', end: '2026-03-13', durationMode: 'working' },
      {
        id: 'c',
        name: 'C',
        parentId: 'p',
        followParent: true,
        start: '2026-03-04',
        duration: 2,
        durationMode: 'working',
      },
    ]);
    // Two working days after the parent's start: Thursday + 2 = Monday.
    expect(run(context, { kind: 'move', id: 'p', start: at('2026-03-05') })).toEqual([
      'p 2026-03-05..2026-03-18 (direct)',
      'c 2026-03-09..2026-03-10 (parent p)',
    ]);
  });
});

describe('propagate: progress', () => {
  const durations: readonly (readonly [string, 'start' | 'end' | undefined, number])[] = [
    ['keeps the done part', undefined, 25],
    ['keeps the done part', 'start', 25],
    ['keeps the remainder', 'end', 75],
  ];

  it.each(durations)('FR-PROG-2: a resized task %s (%s)', (_name, progressAnchor, expected) => {
    const context = contextOf([{ ...A, end: '2026-03-05', progress: 50, progressAnchor }]);
    const { changes } = propagate(
      { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-10') },
      context,
    );
    expect(changes[0]?.before.progress).toBe(50);
    expect(changes[0]?.after.progress).toBe(expected);
  });

  it('FR-PROG-2: a stretched successor rebases, a moved one keeps its percentage', () => {
    const context = contextOf(
      [
        A,
        {
          id: 'b',
          name: 'B',
          start: '2026-03-03',
          end: '2026-03-04',
          progress: 50,
          progressAnchor: 'end',
        },
        { id: 'c', name: 'C', start: '2026-03-05', duration: 2, progress: 40 },
      ],
      {
        links: [
          { source: 'a', target: 'b', type: 'SS' },
          { source: 'a', target: 'b', type: 'FF' },
          { source: 'a', target: 'c' },
        ],
      },
    );
    const { changes } = propagate(
      { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-07') },
      context,
    );
    expect(changes.map((change) => [change.id, change.after.progress])).toEqual([
      ['a', 0],
      ['b', 75], // 2 → 4 days, 1 day left
      ['c', 40],
    ]);
  });
});

describe('propagate: sub-day chains', () => {
  it('FR-SCH-9: an FS lag of 4h is kept to the hour', () => {
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-02T09:00', end: '2026-03-02T13:00' },
        { id: 'b', name: 'B', start: '2026-03-02T17:00', duration: '2h' },
      ],
      { model: { granularity: '1h' }, links: [{ source: 'a', target: 'b', lag: '4h' }] },
    );
    expect(run(context, { kind: 'move', id: 'a', start: at('2026-03-02T12:00') })).toEqual([
      'a 2026-03-02T12:00..2026-03-02T16:00 (direct)',
      'b 2026-03-02T20:00..2026-03-02T22:00 (link a)',
    ]);
  });

  it.each([
    [
      'working',
      'a 2026-03-06T21:30..2026-03-09T00:30 (direct)',
      'b 2026-03-09T04:30..2026-03-09T06:30 (link a)',
    ],
    [
      'calendar',
      'a 2026-03-06T21:30..2026-03-07T00:30 (direct)',
      'b 2026-03-07T04:30..2026-03-07T06:30 (link a)',
    ],
  ] as const)('FR-SCH-9: a 90-minute move across the weekend (%s time)', (mode, a, b) => {
    const durationMode: DurationMode = mode;
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-06T20:00', duration: '3h', durationMode },
        {
          id: 'b',
          name: 'B',
          start: mode === 'working' ? '2026-03-09T03:00' : '2026-03-07T03:00',
          duration: '2h',
          durationMode,
        },
      ],
      { model: { granularity: '30min' }, links: [{ source: 'a', target: 'b', lag: '4h' }] },
    );
    const start = asDateTimeMs(context.model.taskById.get('a')!.span!.start + 90 * MINUTE);
    expect(run(context, { kind: 'move', id: 'a', start })).toEqual([a, b]);
  });

  it('FR-SCH-9, FR-SNAP-7: day-precision tasks in a chain of timed tasks stay on day boundaries', () => {
    const context = contextOf(
      [
        { id: 'a', name: 'A', start: '2026-03-02T09:00', end: '2026-03-02T17:00' },
        { id: 'b', name: 'B', start: '2026-03-03', end: '2026-03-04' },
        { id: 'c', name: 'C', start: '2026-03-05T02:00', duration: '3h' },
      ],
      {
        model: { granularity: '1h' },
        links: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c', lag: '2h' },
        ],
      },
    );
    // B's lag is 7 h (Mon 17:00 → Tue 00:00); its pins are rounded to the nearest day.
    expect(context.graph.links[0]?.lag?.ms).toBe(7 * HOUR);
    const moveA = (hours: number): PropagationCommand => ({
      kind: 'move',
      id: 'a',
      start: asDateTimeMs(at('2026-03-02T09:00') + hours * HOUR),
    });
    expect(run(context, moveA(24))).toEqual([
      'a 2026-03-03T09:00..2026-03-03T17:00 (direct)',
      'b 2026-03-04..2026-03-05 (link a)',
      'c 2026-03-06T02:00..2026-03-06T05:00 (link b)',
    ]);
    // Tue 05:00 rounds back to Tuesday: B and C stay.
    expect(run(context, moveA(5))).toEqual(['a 2026-03-02T14:00..2026-03-02T22:00 (direct)']);
    // Tue 13:00 rounds up to Wednesday.
    expect(run(context, moveA(13))).toEqual([
      'a 2026-03-02T22:00..2026-03-03T06:00 (direct)',
      'b 2026-03-04..2026-03-05 (link a)',
      'c 2026-03-06T02:00..2026-03-06T05:00 (link b)',
    ]);
  });
});

describe('propagate: keepDayPrecision: false (FR-SNAP-7)', () => {
  /** A (day) → B (day), granularity 1 h. */
  function hourly(options: PropagationOptions = { keepDayPrecision: false }): PropagationContext {
    return contextOf([A, { id: 'b', name: 'B', start: '2026-03-05', end: '2026-03-06' }], {
      model: { granularity: '1h' },
      links: [{ source: 'a', target: 'b' }],
      options,
    });
  }

  it('FR-SNAP-7, FR-SCH-9: the edited day task becomes timed, its day successor stays on whole days', () => {
    const context = hourly();
    const changeSet = propagate({ kind: 'move', id: 'a', start: at('2026-03-02T14:00') }, context);
    // A's end, Thu 14:00, pins B; B rounds it to the nearest day.
    expect(rows(context, changeSet)).toEqual([
      'a 2026-03-02T14:00..2026-03-05T14:00 (direct)',
      'b 2026-03-06..2026-03-07 (link a)',
    ]);
    const [direct, successor] = changeSet.changes;
    expect(direct).toMatchObject({ before: { precision: 'day' }, after: { precision: 'time' } });
    expect(successor!.before).not.toHaveProperty('precision');
    expect(successor!.after).not.toHaveProperty('precision');
  });

  it('FR-SNAP-7: with keepDayPrecision (the default) the same move is aligned to a whole day', () => {
    expect(run(hourly({}), { kind: 'move', id: 'a', start: at('2026-03-02T14:00') })).toEqual([
      'a 2026-03-03..2026-03-05 (direct)',
      'b 2026-03-06..2026-03-07 (link a)',
    ]);
  });

  it('FR-SNAP-7: a result on whole days keeps the day precision', () => {
    const changeSet = propagate({ kind: 'move', id: 'a', start: at('2026-03-03') }, hourly());
    expect(changeSet.changes[0]!.before).not.toHaveProperty('precision');
    expect(changeSet.changes[0]!.after).not.toHaveProperty('precision');
  });

  it('FR-SNAP-7, FR-SNAP-6: resizes and reschedules convert by their edges, one granularity step at least', () => {
    const context = hourly();
    expect(
      run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-03-04T10:00') }),
    ).toEqual([
      'a 2026-03-02T00:00..2026-03-04T10:00 (direct)',
      'b 2026-03-04..2026-03-05 (link a)',
    ]);
    expect(run(context, { kind: 'resize-start', id: 'a', start: at('2026-03-02T10:00') })).toEqual([
      'a 2026-03-02T10:00..2026-03-05T00:00 (direct)',
    ]);
    expect(run(context, { kind: 'resize-end', id: 'a', endExclusive: at('2026-02-20') })).toEqual([
      'a 2026-03-02T00:00..2026-03-02T01:00 (direct)',
      'b 2026-03-02..2026-03-03 (link a)',
    ]);
    const reschedule: RescheduleCommand = {
      kind: 'reschedule',
      id: 'a',
      start: at('2026-03-02T06:00'),
      endExclusive: at('2026-03-03T18:00'),
    };
    expect(run(context, reschedule)).toEqual([
      'a 2026-03-02T06:00..2026-03-03T18:00 (direct)',
      'b 2026-03-04..2026-03-05 (link a)',
    ]);
  });

  it('FR-SNAP-7: time-precision tasks are not affected', () => {
    const context = contextOf(
      [{ id: 't', name: 'T', start: '2026-03-02T09:00', end: '2026-03-02T12:00' }],
      { model: { granularity: '1h' }, options: { keepDayPrecision: false } },
    );
    const changeSet = propagate({ kind: 'move', id: 't', start: at('2026-03-02T10:00') }, context);
    expect(changeSet.changes[0]!.after).not.toHaveProperty('precision');
  });
});

describe('propagate: change set', () => {
  it('FR-TX-1, FR-SCH-5: a frozen, deterministic change set with before and after', () => {
    const context = contextOf(
      [
        { ...A, progress: 30 },
        { id: 'b', name: 'B', start: '2026-03-05', duration: 3 },
      ],
      { links: [{ source: 'a', target: 'b' }] },
    );
    const command = deepFreeze(moveBy(context, 'a', 7));
    const changeSet = propagate(command, context);
    expect(changeSet).toEqual({
      reason: 'move',
      changes: [
        {
          id: 'a',
          before: { start: at('2026-03-02'), endExclusive: at('2026-03-05'), progress: 30 },
          after: { start: at('2026-03-09'), endExclusive: at('2026-03-12'), progress: 30 },
          cause: 'direct',
        },
        {
          id: 'b',
          before: { start: at('2026-03-05'), endExclusive: at('2026-03-08'), progress: 0 },
          after: { start: at('2026-03-12'), endExclusive: at('2026-03-15'), progress: 0 },
          cause: 'link',
          via: 'a',
        },
      ],
      // B now ends on a Saturday, as it did before (FR-SCH-6).
      conflicts: [
        {
          type: 'non-working-end',
          severity: 'warning',
          id: 'b',
          message: 'ends on non-working day 2026-03-14',
          date: at('2026-03-14'),
        },
      ],
    });
    expect('via' in changeSet.changes[0]!).toBe(false);
    expect(Object.isFrozen(changeSet)).toBe(true);
    expect(Object.isFrozen(changeSet.changes)).toBe(true);
    expect(Object.isFrozen(changeSet.conflicts)).toBe(true);
    expect(changeSet.conflicts.every((conflict) => Object.isFrozen(conflict))).toBe(true);
    expect(changeSet.changes.every((c) => Object.isFrozen(c) && Object.isFrozen(c.after))).toBe(
      true,
    );
    expect(propagate(command, context)).toEqual(changeSet);
    // The model is untouched.
    expect(context.model.taskById.get('a')?.span?.start).toBe(at('2026-03-02'));
  });
});

describe('propagate: options.conflicts', () => {
  it('FR-SCH-6: conflicts: false (drag previews) gives the same changes without conflicts', () => {
    const context = contextOf([A]);
    // A start dragged to a Saturday without skipping: a non-working start.
    const command = startAt('2026-02-28');
    const commit = propagate(command, context);
    expect(commit.conflicts.map((conflict) => conflict.type)).toEqual(['non-working-start']);
    const preview = propagate(command, { ...context, options: { conflicts: false } });
    expect(preview).toEqual({ ...commit, conflicts: [] });
    expect(Object.isFrozen(preview.conflicts)).toBe(true);
    expect(propagate(command, { ...context, options: { conflicts: true } })).toEqual(commit);
  });
});

describe('propagate: a calendar that runs out of working days', () => {
  // Working days only in 2026: searches give up after 100 years without one.
  const { calendar: finite } = createWorkCalendar({
    weekends: [0, 6],
    isWorkingDay: (day) => (day.year === 2026 ? undefined : false),
  });
  const model = { calendar: finite };

  it('FR-CAL-5, FR-SCH-3: the edited task stays when its working time cannot be placed', () => {
    const context = contextOf([{ ...A, durationMode: 'working' }], { model });
    expect(run(context, { kind: 'move', id: 'a', start: at('2200-01-06') })).toEqual([]);
    // No working day before 1900 to roll the end back to: the minimum length decides.
    const skip = { ...context, options: { skipNonWorkingDays: { resize: true } } };
    expect(run(skip, { kind: 'resize-end', id: 'a', endExclusive: at('1900-01-02') })).toEqual([
      'a 2026-03-02..2026-03-02 (direct)',
    ]);
  });

  it('FR-CAL-5, FR-SCH-9: working-mode successors and children stay where no working time is left', () => {
    const working = { durationMode: 'working' } as const;
    const context = contextOf(
      [
        A,
        { id: 'b', name: 'B', start: '2026-03-06', duration: 1, ...working },
        { id: 'c', name: 'C', start: '2026-03-05', duration: 1, ...working },
        {
          id: 'e',
          name: 'E',
          parentId: 'a',
          followParent: true,
          start: '2026-03-03',
          duration: 1,
          ...working,
        },
        { id: 'f', name: 'F', parentId: 'a', start: '2026-03-03', duration: 1, ...working },
      ],
      {
        model,
        links: [
          { source: 'a', target: 'b', lag: 1 },
          { source: 'a', target: 'c', lag: 0 },
        ],
        options: { skipNonWorkingDays: { move: false } },
      },
    );
    expect(run(context, { kind: 'move', id: 'a', start: at('2200-01-06') })).toEqual([
      'a 2200-01-06..2200-01-08 (direct)',
    ]);
  });

  it('FR-CAL-5, FR-SCH-9: a task without enough working time before its end pin stays', () => {
    // A single working week, 2026-03-02 … 03-06.
    const { calendar: week } = createWorkCalendar({
      isWorkingDay: (day) => day.year === 2026 && day.month === 3 && day.day >= 2 && day.day <= 6,
    });
    const context = contextOf(
      [A, { id: 'd', name: 'D', start: '2026-03-02', end: '2026-03-04', durationMode: 'working' }],
      {
        model: { calendar: week },
        links: [{ source: 'a', target: 'd', type: 'FF' }],
        options: { skipNonWorkingDays: { move: false } },
      },
    );
    // D would have to end on Tuesday with 3 working days, but only Monday and Tuesday precede it.
    expect(run(context, moveBy(context, 'a', -1))).toEqual(['a 2026-03-01..2026-03-03 (direct)']);
  });
});

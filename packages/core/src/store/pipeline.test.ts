import { deepFreeze } from '@ganttlane/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CalendarModule from '../calendar';
import { createWorkCalendar } from '../calendar';
import type * as HierarchyModule from '../hierarchy';
import { buildHierarchy, visibleRows } from '../hierarchy';
import type * as ModelModule from '../model';
import { type Link, normalizeModel, type Task } from '../model';
import type * as ScaleModule from '../scale';
import { resolveSnap, resolveViewModes } from '../scale';
import type * as ScheduleModule from '../schedule';
import { buildLinkGraph, type ChangeSet, detectConflicts, propagate } from '../schedule';
import { type DateTimeMs, parseDateInput } from '../time';
import { createStoreState, reduceStore, type StoreCommand, type StoreState } from './index';

// Every stage of the pipeline is spied on, so the tests count what a command recomputes.
vi.mock('../calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof CalendarModule>();
  return { ...actual, createWorkCalendar: vi.fn(actual.createWorkCalendar) };
});
vi.mock('../model', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelModule>();
  return { ...actual, normalizeModel: vi.fn(actual.normalizeModel) };
});
vi.mock('../hierarchy', async (importOriginal) => {
  const actual = await importOriginal<typeof HierarchyModule>();
  return {
    ...actual,
    buildHierarchy: vi.fn(actual.buildHierarchy),
    visibleRows: vi.fn(actual.visibleRows),
  };
});
vi.mock('../schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof ScheduleModule>();
  return {
    ...actual,
    buildLinkGraph: vi.fn(actual.buildLinkGraph),
    detectConflicts: vi.fn(actual.detectConflicts),
  };
});
vi.mock('../scale', async (importOriginal) => {
  const actual = await importOriginal<typeof ScaleModule>();
  return {
    ...actual,
    resolveViewModes: vi.fn(actual.resolveViewModes),
    resolveSnap: vi.fn(actual.resolveSnap),
  };
});

const STAGES = {
  calendar: createWorkCalendar,
  model: normalizeModel,
  hierarchy: buildHierarchy,
  graph: buildLinkGraph,
  conflicts: detectConflicts,
  rows: visibleRows,
  viewModes: resolveViewModes,
  snap: resolveSnap,
};
type Stage = keyof typeof STAGES;

/** The stages that ran since the last reset. */
function recomputed(): Stage[] {
  return (Object.keys(STAGES) as Stage[]).filter(
    (stage) => vi.mocked(STAGES[stage]).mock.calls.length > 0,
  );
}

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

const TASKS: readonly Task[] = deepFreeze([
  { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-13' },
  { id: 'design', name: 'Design', parentId: 'phase', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', parentId: 'phase', start: '2026-03-09', duration: 5 },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'design', target: 'build' }]);
const WEEKENDS = deepFreeze([0, 6]);

function initial(): StoreState {
  return createStoreState({
    tasks: TASKS,
    links: LINKS,
    options: { calendar: { weekends: WEEKENDS }, scheduling: { granularity: '1d' } },
  });
}

function moveDesign(state: StoreState): ChangeSet {
  const { model, hierarchy, graph } = state.derived;
  return propagate(
    { kind: 'move', id: 'design', start: at('2026-03-03') },
    { model, hierarchy, graph },
  );
}

const DATA: Stage[] = ['model', 'graph', 'conflicts'];
const TREE: Stage[] = ['model', 'hierarchy', 'graph', 'conflicts', 'rows'];

describe('store pipeline: what a command recomputes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FR-TX-3: the first state runs every stage once', () => {
    initial();
    expect(recomputed()).toEqual(Object.keys(STAGES));
    for (const stage of Object.values(STAGES)) expect(vi.mocked(stage)).toHaveBeenCalledTimes(1);
  });

  it.each<[string, (state: StoreState) => StoreCommand, Stage[]]>([
    ['setTasks', () => ({ type: 'setTasks', tasks: [...TASKS] }), DATA],
    [
      'setTasks with another tree',
      () => ({
        type: 'setTasks',
        tasks: [TASKS[0]!, { ...TASKS[1]!, parentId: undefined }, TASKS[2]!],
      }),
      TREE,
    ],
    [
      'setTasks with another order',
      () => ({ type: 'setTasks', tasks: [...TASKS].reverse() }),
      TREE,
    ],
    ['setLinks', () => ({ type: 'setLinks', links: [] }), DATA],
    [
      'applyChangeSet (uncontrolled)',
      (state) => ({ type: 'applyChangeSet', changeSet: moveDesign(state) }),
      DATA,
    ],
    [
      'calendar',
      () => ({ type: 'setOptions', options: { calendar: { weekends: [0] } } }),
      ['calendar', ...DATA],
    ],
    [
      'the same calendar values',
      () => ({ type: 'setOptions', options: { calendar: { weekends: WEEKENDS } } }),
      [],
    ],
    [
      'granularity',
      () => ({ type: 'setOptions', options: { scheduling: { granularity: '1h' } } }),
      [...DATA, 'snap'],
    ],
    [
      'dates.endInclusive',
      () => ({ type: 'setOptions', options: { dates: { endInclusive: false } } }),
      DATA,
    ],
    [
      'scheduling.durationMode',
      () => ({ type: 'setOptions', options: { scheduling: { durationMode: 'working' } } }),
      DATA,
    ],
    [
      'hierarchy.childAnchor',
      () => ({ type: 'setOptions', options: { hierarchy: { childAnchor: 'FF' } } }),
      ['hierarchy', 'conflicts', 'rows'],
    ],
    ['toggleExpanded', () => ({ type: 'toggleExpanded', id: 'phase' }), ['rows']],
    ['setExpandedKeys', () => ({ type: 'setExpandedKeys', keys: [] }), ['rows']],
    ['setViewMode', () => ({ type: 'setViewMode', id: 'week' }), ['snap']],
    [
      'viewModes',
      () => ({ type: 'setOptions', options: { viewModes: { day: { pxPerDay: 50 } } } }),
      ['viewModes', 'snap'],
    ],
    [
      'scheduling.snap',
      () => ({ type: 'setOptions', options: { scheduling: { snap: '1w' } } }),
      ['snap'],
    ],
    [
      'scheduling.keepDayPrecision',
      () => ({ type: 'setOptions', options: { scheduling: { keepDayPrecision: false } } }),
      ['snap'],
    ],
    [
      'propagation options',
      () => ({
        type: 'setOptions',
        options: {
          scheduling: { propagation: 'none', skipNonWorkingDays: { move: false } },
          hierarchy: { moveChildren: 'none' },
        },
      }),
      [],
    ],
    ['dataMode', () => ({ type: 'setOptions', options: { dataMode: 'controlled' } }), []],
    ['setDraft', (state) => ({ type: 'setDraft', changeSet: moveDesign(state) }), []],
  ])('FR-API-2, FR-DATA-7: %s recomputes only what it invalidates', (_, commandOf, expected) => {
    const state = initial();
    const command = commandOf(state);
    vi.clearAllMocks();
    const next = reduceStore(state, command);
    expect(recomputed()).toEqual(expected);
    // Stages that did not run keep their results.
    if (!expected.includes('model')) expect(next.derived.model).toBe(state.derived.model);
    if (!expected.includes('rows')) expect(next.derived.rows).toBe(state.derived.rows);
    if (expected.length === 0) expect(next.derived).toBe(state.derived);
  });

  it('FR-TX-3: controlled applyChangeSet and setTasks with the same array recompute nothing', () => {
    const state = reduceStore(initial(), {
      type: 'setOptions',
      options: { dataMode: 'controlled' },
    });
    const changeSet = moveDesign(state);
    vi.clearAllMocks();
    const committed = reduceStore(state, { type: 'applyChangeSet', changeSet });
    const rejected = reduceStore(committed, { type: 'setTasks', tasks: TASKS });
    expect(recomputed()).toEqual([]);
    expect(rejected.draft).toBeUndefined();
    expect(rejected.derived).toBe(state.derived);
  });
});

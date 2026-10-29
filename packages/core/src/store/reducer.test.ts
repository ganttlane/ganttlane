import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Link, Task } from '../model';
import { type ChangeSet, propagate, type PropagationCommand } from '../schedule';
import { type DateTimeMs, parseDateInput } from '../time';
import {
  createStoreState,
  reduceStore,
  selectTaskPatch,
  type StoreCommand,
  type StoreInit,
  type StoreOptions,
  type StoreSchedulingOptions,
  type StoreState,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

const TASKS: readonly Task[] = deepFreeze([
  { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-13' },
  { id: 'design', name: 'Design', parentId: 'phase', start: '2026-03-02', end: '2026-03-06' },
  {
    id: 'build',
    name: 'Build',
    parentId: 'phase',
    start: '2026-03-09',
    duration: 5,
    durationMode: 'working',
  },
  { id: 'later', name: 'Later', start: new Date(2026, 2, 16), end: new Date(2026, 2, 20) },
  { id: 'sat', name: 'Saturday', start: '2026-03-07', end: '2026-03-07' },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'design', target: 'build' }]);

function initial(init: Partial<StoreInit> = {}): StoreState {
  return createStoreState({ tasks: TASKS, links: LINKS, ...init });
}

function run(state: StoreState, ...commands: StoreCommand[]): StoreState {
  return commands.reduce(reduceStore, state);
}

/** A change set computed on the state, as the interaction layer will (plan step 3.7). */
function changeSetOf(state: StoreState, command: PropagationCommand): ChangeSet {
  const { model, hierarchy, graph } = state.derived;
  return propagate(command, { model, hierarchy, graph, options: state.settings.propagation });
}

const MOVE_DESIGN: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-05') };

describe('createStoreState', () => {
  it('FR-TX-3: derives the model, tree, graph, conflicts, rows and view mode', () => {
    const state = initial();
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.derived.model.tasks.map((task) => task.id)).toEqual([
      'phase',
      'design',
      'build',
      'later',
      'sat',
    ]);
    expect(state.derived.rows.map((row) => [row.id, row.depth])).toEqual([
      ['phase', 0],
      ['design', 1],
      ['build', 1],
      ['later', 0],
      ['sat', 0],
    ]);
    expect(state.derived.graph.links.map((link) => link.id)).toEqual(['design:FS:build']);
    expect([...state.derived.conflicts.keys()]).toEqual(['sat']);
    expect(state.derived.conflicts.get('sat')?.map((conflict) => conflict.type)).toEqual([
      'non-working-start',
      'non-working-end',
    ]);
    expect(state.derived.viewMode.id).toBe('day');
    expect(state.derived.issues).toEqual([]);
    expect(state.settings.dataMode).toBe('uncontrolled');
    expect(state.expandedKeys).toBe('all');
    expect([state.draft, state.session]).toEqual([undefined, undefined]);
  });

  it('FR-ROW-2, FR-SCALE-3: takes the initial view mode and expanded keys', () => {
    const state = initial({ viewMode: 'week', expandedKeys: [] });
    expect(state.derived.viewMode.id).toBe('week');
    expect(state.derived.rows.map((row) => row.id)).toEqual(['phase', 'later', 'sat']);
  });
});

describe('reduceStore', () => {
  it('FR-TX-3: is pure and keeps untouched branches by reference', () => {
    const state = initial();
    const week = reduceStore(state, { type: 'setViewMode', id: 'week' });
    expect(week).not.toBe(state);
    expect(Object.isFrozen(week)).toBe(true);
    for (const key of ['tasks', 'links', 'options', 'settings', 'expandedKeys', 'draft'] as const) {
      expect(week[key]).toBe(state[key]);
    }
    for (const key of ['model', 'hierarchy', 'graph', 'conflicts', 'rows'] as const) {
      expect(week.derived[key]).toBe(state.derived[key]);
    }
    expect(week.lastDataChange).toBe(state.lastDataChange);
    expect(week.derived.viewMode.id).toBe('week');
    // The same command on the same state gives an equal state.
    expect(reduceStore(state, { type: 'setViewMode', id: 'week' })).toEqual(week);
    // The input state is untouched.
    expect(state.viewModeId).toBe('day');
  });

  it.each<[string, StoreCommand]>([
    ['setTasks with the same array', { type: 'setTasks', tasks: TASKS }],
    ['setLinks with the same array', { type: 'setLinks', links: LINKS }],
    ['setOptions without options', { type: 'setOptions', options: {} }],
    ['setViewMode with the current id', { type: 'setViewMode', id: 'day' }],
    ['setExpandedKeys with the current keys', { type: 'setExpandedKeys', keys: 'all' }],
    ['setExpanded of an expanded task', { type: 'setExpanded', id: 'phase', expanded: true }],
    ['setDraft without a draft', { type: 'setDraft', changeSet: undefined }],
    [
      'applyChangeSet without changes',
      { type: 'applyChangeSet', changeSet: { reason: 'api', changes: [], conflicts: [] } },
    ],
  ])('FR-TX-3: returns the same state for %s', (_, command) => {
    const state = initial();
    expect(reduceStore(state, command)).toBe(state);
  });

  it('FR-ROW-2: expands and collapses rows without touching the data pipeline', () => {
    const state = initial();
    const collapsed = reduceStore(state, { type: 'setExpanded', id: 'phase', expanded: false });
    expect(collapsed.expandedKeys).toEqual([]);
    expect(collapsed.derived.rows.map((row) => row.id)).toEqual(['phase', 'later', 'sat']);
    expect(collapsed.derived.hierarchy).toBe(state.derived.hierarchy);
    expect(collapsed.derived.conflicts).toBe(state.derived.conflicts);

    const toggled = reduceStore(collapsed, { type: 'toggleExpanded', id: 'phase' });
    expect(toggled.expandedKeys).toEqual(['phase']);
    expect(toggled.derived.rows).toHaveLength(5);
    expect(reduceStore(toggled, { type: 'expandAll' })).toBe(toggled);
    expect(run(toggled, { type: 'collapseAll' }).derived.rows).toHaveLength(3);
    expect(run(toggled, { type: 'setExpandedKeys', keys: ['phase'] })).toBe(toggled);
    expect(run(toggled, { type: 'setExpandedKeys', keys: 'all' }).expandedKeys).toBe('all');
  });

  it('FR-SCALE-3: resolves the view mode, its snap and view mode overrides', () => {
    const state = initial({ options: { scheduling: { granularity: '1h' } } });
    const hour = reduceStore(state, { type: 'setViewMode', id: 'hour' });
    expect(hour.derived.viewMode.id).toBe('hour');
    expect(hour.derived.snap.snap.move).toEqual({ kind: 'fixed', ms: 3_600_000 });
    const zoomed = reduceStore(state, {
      type: 'setOptions',
      options: { viewModes: { day: { pxPerDay: 99 } } },
    });
    expect(zoomed.derived.viewMode.pxPerDay).toBe(99);
    expect(zoomed.derived.model).toBe(state.derived.model);

    const unknown = reduceStore(state, { type: 'setViewMode', id: 'decade' });
    expect(unknown.viewModeId).toBe('decade');
    expect(unknown.derived.viewMode.id).toBe('day');
    expect(unknown.derived.issues).toMatchObject([
      { code: 'unknown-view-mode', severity: 'warning', value: 'decade' },
    ]);
    // FR-DATA-4: with the option's path, also at the start of the message.
    expect(unknown.derived.issues[0]?.path).toBe('viewMode');
    expect(unknown.derived.issues[0]?.message).toMatch(/^viewMode: /);
    const custom = initial({
      viewMode: 'decade',
      options: {
        viewModes: [
          {
            id: 'sprint',
            unit: 'week',
            pxPerDay: 10,
            headers: [{ unit: 'week', format: { day: 'numeric' } }],
          },
        ],
      },
    });
    expect(custom.derived.viewMode.id).toBe('sprint');
  });

  it('FR-API-2: merges options field by field within each group', () => {
    const state = initial({
      options: { scheduling: { granularity: '1h' }, dataMode: 'controlled' },
    });
    const next = run(
      state,
      { type: 'setOptions', options: { scheduling: { alignInput: 'nearest' } } },
      { type: 'setOptions', options: { hierarchy: { moveChildren: 'none' }, dataMode: undefined } },
    );
    expect(next.options.scheduling).toEqual({ granularity: '1h', alignInput: 'nearest' });
    expect(next.settings.model).toMatchObject({ granularity: '1h', alignInput: 'nearest' });
    expect(next.settings.propagation).toEqual({
      propagation: undefined,
      moveChildren: 'none',
      skipNonWorkingDays: undefined,
    });
    expect(next.settings.dataMode).toBe('uncontrolled');
    // Propagation options do not touch the model.
    const model = run(next, {
      type: 'setOptions',
      options: { scheduling: { propagation: 'none' } },
    });
    expect(model.derived).toBe(next.derived);
    expect(model.settings.propagation.propagation).toBe('none');
    // `undefined` returns to the default.
    const reset = run(next, {
      type: 'setOptions',
      options: { scheduling: { granularity: undefined } },
    });
    expect(reset.settings.granularity.ms).toBe(86_400_000);
    expect(reset.derived.model).not.toBe(next.derived.model);
    // A group with the same values keeps its identity.
    const same = run(next, {
      type: 'setOptions',
      options: { scheduling: { alignInput: 'nearest' } },
    });
    expect(same).toBe(next);
  });

  it('FR-API-2, FR-DATA-7: an option value equal to the current one keeps the state', () => {
    const rule = (): undefined => undefined;
    const options = (): StoreOptions => ({
      calendar: {
        weekends: [0, 6],
        holidays: [{ date: '2026-03-10', name: 'Off' }, new Date(2026, 2, 12)],
        isWorkingDay: rule,
      },
      scheduling: { granularity: { hours: 1 }, skipNonWorkingDays: { move: true, resize: false } },
      viewModes: { day: { pxPerDay: 40 } },
      dataMode: 'controlled',
    });
    const state = initial({ options: options() });
    // New objects and arrays with equal values: nothing is rebuilt, no new model.
    expect(reduceStore(state, { type: 'setOptions', options: options() })).toBe(state);
    const equal = run(
      state,
      { type: 'setOptions', options: { calendar: { weekends: [0, 6] } } },
      { type: 'setOptions', options: { scheduling: { granularity: { hours: 1 } } } },
      { type: 'setOptions', options: { viewModes: { day: { pxPerDay: 40 } } } },
    );
    expect(equal).toBe(state);
    // Different values are changes; functions are compared by identity.
    const weekends = reduceStore(state, {
      type: 'setOptions',
      options: { calendar: { weekends: [0] } },
    });
    expect(weekends.derived.model).not.toBe(state.derived.model);
    expect(weekends.lastDataChange.version).toBe(state.lastDataChange.version + 1);
    const holidays = reduceStore(state, {
      type: 'setOptions',
      options: { calendar: { holidays: [{ date: '2026-03-10' }, new Date(2026, 2, 12)] } },
    });
    expect(holidays.settings.calendar).not.toBe(state.settings.calendar);
    const ruled = reduceStore(state, {
      type: 'setOptions',
      options: { calendar: { isWorkingDay: () => undefined } },
    });
    expect(ruled.settings.calendar).not.toBe(state.settings.calendar);
  });

  it('FR-CAL-7: a calendar change recomputes every derived duration', () => {
    const state = initial();
    const allWorking = reduceStore(state, {
      type: 'setOptions',
      options: { calendar: { weekends: [] } },
    });
    expect(allWorking.settings.calendar).not.toBe(state.settings.calendar);
    expect(allWorking.derived.conflicts.size).toBe(0);
    expect(allWorking.lastDataChange.updated).toEqual(['phase', 'sat']);
    const invalid = reduceStore(state, {
      type: 'setOptions',
      options: { calendar: { weekends: [9] } },
    });
    expect(invalid.settings.calendar.issues).toMatchObject([{ severity: 'error' }]);
  });
  it('FR-SNAP-12: an invalid granularity falls back to one day, reported by the model', () => {
    const state = reduceStore(initial(), {
      type: 'setOptions',
      options: { scheduling: { granularity: '5h' } },
    });
    expect(state.settings.granularity.ms).toBe(86_400_000);
    expect(state.derived.model.issues.map((issue) => issue.code)).toContain('invalid-granularity');
  });

  it('FR-SCH-1: the planned push-forward propagation resolves like the facade’s fallback, preserve-lag', () => {
    expectTypeOf<'push-forward'>().toExtend<StoreSchedulingOptions['propagation']>();
    const state = initial({ options: { scheduling: { propagation: 'push-forward' } } });
    // The default, as when the facade replaces the value with `undefined`.
    expect(state.settings.propagation).toEqual(initial().settings.propagation);
    expect(state.settings.propagation.propagation).toBeUndefined();
    // Successors follow along their links, as with `'preserve-lag'` (not as with `'none'`).
    const moved = changeSetOf(state, MOVE_DESIGN).changes.map((change) => change.id);
    expect(moved).toEqual(changeSetOf(initial(), MOVE_DESIGN).changes.map((change) => change.id));
    expect(moved).toContain('build');
  });

  it('throws for a command untyped callers made up', () => {
    const command = { type: 'nope' } as unknown as StoreCommand;
    expect(() => reduceStore(initial(), command)).toThrow(TypeError);
  });
});

describe('reduceStore: lastDataChange', () => {
  it('FR-DATA-7: diffs tasks by id', () => {
    const state = initial();
    expect(state.lastDataChange).toMatchObject({
      version: 0,
      added: ['phase', 'design', 'build', 'later', 'sat'],
      removed: [],
      updated: [],
      links: { added: ['design:FS:build'], removed: [], updated: [] },
    });
    const [phase, design, build, later] = TASKS;
    const tasks = [
      phase!,
      { ...design!, name: 'Design 2' },
      build!,
      later!,
      { id: 'new', name: 'New' },
    ];
    const next = reduceStore(state, { type: 'setTasks', tasks });
    expect(next.lastDataChange).toEqual({
      version: 1,
      added: ['new'],
      removed: ['sat'],
      updated: ['design'],
      links: { added: [], removed: [], updated: [] },
    });
    // The same objects in a new array: nothing to redraw.
    const copy = reduceStore(next, { type: 'setTasks', tasks: [...tasks] });
    expect(copy.lastDataChange).toMatchObject({ version: 2, added: [], removed: [], updated: [] });
    // No new model, no new diff.
    expect(reduceStore(copy, { type: 'collapseAll' }).lastDataChange).toBe(copy.lastDataChange);
  });

  it('FR-DATA-7: an option change reports the tasks whose values changed', () => {
    const tasks: Task[] = [
      { id: 'odd', name: 'Odd', start: '2026-03-02T10:30', end: '2026-03-02T12:00' },
      { id: 'even', name: 'Even', start: '2026-03-02T10:00', end: '2026-03-02T12:00' },
    ];
    const state = initial({ tasks, options: { scheduling: { granularity: '1h' } } });
    const rejected = reduceStore(state, {
      type: 'setOptions',
      options: { scheduling: { alignInput: 'reject' } },
    });
    expect(rejected.derived.model.taskById.get('odd')?.valid).toBe(false);
    expect(rejected.lastDataChange.updated).toEqual(['odd']);
  });

  it('FR-DATA-7: an option change that only moves the shown end or the duration mode updates the task', () => {
    const tasks: Task[] = [
      { id: 'dated', name: 'Dated', start: '2026-03-02', end: '2026-03-06' },
      { id: 'long', name: 'Long', start: '2026-03-02', duration: 5 },
      { id: 'open', name: 'Open', type: 'placeholder' },
    ];
    const state = initial({ tasks });
    // `end` of a task with a duration moves from the last day to the exclusive end.
    const exclusive = reduceStore(state, {
      type: 'setOptions',
      options: { dates: { endInclusive: false } },
    });
    const before = state.derived.model.taskById.get('long')!.span!;
    const after = exclusive.derived.model.taskById.get('long')!.span!;
    expect([after.start, after.endExclusive]).toEqual([before.start, before.endExclusive]);
    expect(after.end).not.toBe(before.end);
    expect(exclusive.lastDataChange.updated).toEqual(['dated', 'long']);
    // Working time of tasks without weekends: only their duration mode changes.
    const working = reduceStore(state, {
      type: 'setOptions',
      options: { scheduling: { durationMode: 'working' } },
    });
    for (const id of ['dated', 'long']) {
      expect(working.derived.model.taskById.get(id)!.span).toEqual(
        state.derived.model.taskById.get(id)!.span,
      );
    }
    expect(working.lastDataChange.updated).toEqual(['dated', 'long', 'open']);
  });

  it('FR-DATA-7: diffs links by id', () => {
    const state = initial();
    const next = reduceStore(state, {
      type: 'setLinks',
      links: [
        { source: 'design', target: 'build', lag: 1 },
        { source: 'build', target: 'later' },
      ],
    });
    expect(next.lastDataChange).toEqual({
      version: 1,
      added: [],
      removed: [],
      updated: [],
      links: { added: ['build:FS:later'], removed: [], updated: ['design:FS:build'] },
    });
    const none = reduceStore(next, { type: 'setLinks', links: undefined });
    expect(none.lastDataChange.links.removed).toEqual(['design:FS:build', 'build:FS:later']);
  });
});

describe('reduceStore: draft and change sets', () => {
  it('FR-EDIT-5: a draft is overlaid without touching committed data', () => {
    const state = initial();
    const changeSet = changeSetOf(state, MOVE_DESIGN);
    expect(changeSet.changes.map((change) => change.id)).toEqual(['design', 'build']);
    const preview = reduceStore(state, { type: 'setDraft', changeSet });
    expect(preview.draft?.changeSet).toBe(changeSet);
    expect(preview.tasks).toBe(state.tasks);
    expect(preview.derived).toBe(state.derived);
    expect(selectTaskPatch(preview, 'design')).toBe(changeSet.changes[0]!.after);
    expect(selectTaskPatch(preview, 'later')).toEqual({
      start: at('2026-03-16'),
      endExclusive: at('2026-03-21'),
      progress: 0,
    });
    expect(selectTaskPatch(preview, 'ghost')).toBeUndefined();
    expect(reduceStore(preview, { type: 'setDraft', changeSet })).toBe(preview);
    const cleared = reduceStore(preview, { type: 'setDraft', changeSet: undefined });
    expect(cleared.draft).toBeUndefined();
    expect(cleared.derived).toBe(state.derived);
  });

  it('FR-TX-3: uncontrolled, a committed change set patches the tasks in their own form', () => {
    const state = initial();
    const changeSet = changeSetOf(state, MOVE_DESIGN);
    const preview = reduceStore(state, { type: 'setDraft', changeSet });
    const next = reduceStore(preview, { type: 'applyChangeSet', changeSet });
    expect(next.draft).toBeUndefined();
    expect(Object.isFrozen(next.tasks)).toBe(true);
    expect(next.tasks).not.toBe(TASKS);
    expect(next.tasks[1]).toEqual({ ...TASKS[1], start: '2026-03-05', end: '2026-03-09' });
    expect(next.tasks[2]).toMatchObject({ start: '2026-03-10', duration: 5 });
    for (const index of [0, 3, 4]) expect(next.tasks[index]).toBe(TASKS[index]);
    for (const change of changeSet.changes) {
      const span = next.derived.model.taskById.get(change.id)?.span;
      expect([span?.start, span?.endExclusive]).toEqual([
        change.after.start,
        change.after.endExclusive,
      ]);
    }
    expect(next.lastDataChange.updated).toEqual(['design', 'build']);
  });

  it('FR-TX-3: uncontrolled, changes of unknown tasks and dropped duplicates are ignored', () => {
    const duplicate: Task = {
      id: 'design',
      name: 'Duplicate',
      start: '2026-03-02',
      end: '2026-03-03',
    };
    const state = initial({ tasks: [...TASKS, duplicate, null as unknown as Task] });
    const changeSet = changeSetOf(state, MOVE_DESIGN);
    const ghost = { ...changeSet.changes[0]!, id: 'ghost' };
    const next = reduceStore(state, {
      type: 'applyChangeSet',
      changeSet: { ...changeSet, changes: [...changeSet.changes, ghost] },
    });
    expect(next.tasks[5]).toBe(duplicate);
    expect(next.tasks[6]).toBeNull();
    expect(next.tasks[1]).not.toBe(TASKS[1]);
  });

  it('FR-TX-3, FR-REACT-1: controlled, the tasks stay and the change set is shown until setTasks', () => {
    const state = initial({ options: { dataMode: 'controlled' } });
    const changeSet = changeSetOf(state, MOVE_DESIGN);
    const committed = reduceStore(state, { type: 'applyChangeSet', changeSet });
    expect(committed.tasks).toBe(TASKS);
    expect(committed.derived).toBe(state.derived);
    expect(committed.draft?.changeSet).toBe(changeSet);
    expect(selectTaskPatch(committed, 'build')).toBe(changeSet.changes[1]!.after);
    expect(reduceStore(committed, { type: 'applyChangeSet', changeSet })).toBe(committed);

    // The owner rejects the change: the same tasks again clear the draft.
    const rejected = reduceStore(committed, { type: 'setTasks', tasks: TASKS });
    expect(rejected.draft).toBeUndefined();
    expect(rejected.derived).toBe(state.derived);

    // The owner applies it: new tasks, and the draft goes too.
    const uncontrolled = reduceStore(initial(), { type: 'applyChangeSet', changeSet });
    const accepted = reduceStore(committed, { type: 'setTasks', tasks: uncontrolled.tasks });
    expect(accepted.draft).toBeUndefined();
    expect(selectTaskPatch(accepted, 'build')).toEqual(changeSet.changes[1]!.after);
  });

  it('FR-TX-3, FR-EDIT-5: controlled, a committed change stays under previews until the owner’s setTasks', () => {
    const state = initial({ options: { dataMode: 'controlled' } });
    const changeSet = changeSetOf(state, MOVE_DESIGN);
    const committed = reduceStore(state, { type: 'applyChangeSet', changeSet });
    const layer = committed.draft!.committedLayer!;
    expect(committed.draft).toMatchObject({ changeSet, committed: true, previewLayer: undefined });
    expect(layer.changeSet).toBe(changeSet);
    expect(committed.draft!.patches).toBe(layer.patches);

    // A preview lies over it: the committed change still shows where the preview has nothing.
    const later = changeSetOf(state, { kind: 'move', id: 'later', start: at('2026-03-23') });
    const preview = reduceStore(committed, { type: 'setDraft', changeSet: later });
    expect(preview.draft).toMatchObject({ changeSet: later, committed: true });
    expect(preview.draft!.committedLayer).toBe(layer);
    expect(preview.draft!.previewLayer?.changeSet).toBe(later);
    expect(selectTaskPatch(preview, 'design')).toBe(changeSet.changes[0]!.after);
    expect(selectTaskPatch(preview, 'later')).toBe(later.changes[0]!.after);
    // Where both change a task, the preview wins.
    const again = changeSetOf(state, { kind: 'move', id: 'design', start: at('2026-03-04') });
    const over = reduceStore(committed, { type: 'setDraft', changeSet: again });
    expect(selectTaskPatch(over, 'design')).toBe(again.changes[0]!.after);
    expect(selectTaskPatch(over, 'build')).toBe(changeSet.changes[1]!.after);

    // Removing the preview leaves the committed change.
    const cancelled = reduceStore(preview, { type: 'setDraft', changeSet: undefined });
    expect(cancelled.draft).toMatchObject({ changeSet, committed: true, previewLayer: undefined });
    expect(cancelled.draft!.committedLayer).toBe(layer);
    // Links and options of the owner keep it.
    const linked = run(
      cancelled,
      { type: 'setLinks', links: [] },
      { type: 'setOptions', options: { scheduling: { propagation: 'none' } } },
    );
    expect(linked.draft!.committedLayer).toBe(layer);

    // Another commit adds to it (of two changes of a task the later wins) and ends the preview.
    const both = reduceStore(over, { type: 'applyChangeSet', changeSet: later });
    expect(both.draft).toMatchObject({ committed: true, previewLayer: undefined });
    expect(both.draft!.changeSet.changes.map((change) => change.id)).toEqual([
      'design',
      'build',
      'later',
    ]);
    expect(selectTaskPatch(both, 'design')).toBe(changeSet.changes[0]!.after);
    expect(selectTaskPatch(both, 'later')).toBe(later.changes[0]!.after);
    // Only the owner's tasks clear it.
    expect(reduceStore(both, { type: 'setTasks', tasks: TASKS }).draft).toBeUndefined();
  });
});

describe('reduceStore: setData', () => {
  it('FR-API-2, FR-DATA-7: replaces tasks and links and merges options in one derivation', () => {
    const state = initial();
    const tasks: readonly Task[] = [
      ...TASKS.slice(0, 4),
      { id: 'new', name: 'New', start: '2026-03-23', end: '2026-03-24' },
    ];
    const links: readonly Link[] = [{ source: 'phase', target: 'later' }];
    const options: StoreOptions = {
      calendar: { weekends: [0, 6] },
      scheduling: { granularity: '1h' },
    };
    const combined = reduceStore(state, { type: 'setData', tasks, links, options });
    // One new model for all three: the version grows by one, the diff covers everything.
    expect(combined.lastDataChange).toMatchObject({
      version: state.lastDataChange.version + 1,
      added: ['new'],
      removed: ['sat'],
      links: { added: ['phase:FS:later'], removed: ['design:FS:build'] },
    });
    const sequential = run(
      state,
      { type: 'setOptions', options },
      { type: 'setTasks', tasks },
      { type: 'setLinks', links },
    );
    expect(sequential.lastDataChange.version).toBe(state.lastDataChange.version + 3);
    expect(combined.tasks).toBe(tasks);
    expect(combined.links).toBe(links);
    expect(combined.options).toEqual(sequential.options);
    expect(combined.settings.granularity).toEqual(sequential.settings.granularity);
    expect(combined.derived.model.tasks.map((task) => [task.id, task.span])).toEqual(
      sequential.derived.model.tasks.map((task) => [task.id, task.span]),
    );
    expect(combined.derived.rows).toEqual(sequential.derived.rows);
  });

  it('FR-DATA-7, FR-TX-3: keys left out stay; tasks clear the draft like setTasks; links may be removed', () => {
    const state = initial({ options: { dataMode: 'controlled' } });
    const committed = reduceStore(state, {
      type: 'applyChangeSet',
      changeSet: changeSetOf(state, MOVE_DESIGN),
    });
    expect(reduceStore(committed, { type: 'setData' })).toBe(committed);
    const optionsOnly = reduceStore(committed, {
      type: 'setData',
      options: { scheduling: { propagation: 'none' } },
    });
    expect(optionsOnly.draft).toBe(committed.draft);
    expect(optionsOnly.tasks).toBe(TASKS);
    expect(optionsOnly.links).toBe(LINKS);
    const answered = reduceStore(committed, { type: 'setData', tasks: TASKS, links: undefined });
    expect(answered.draft).toBeUndefined();
    expect(answered.links).toBeUndefined();
    expect(answered.derived.graph.links).toEqual([]);
  });
});

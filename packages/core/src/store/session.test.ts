import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import type { Link, Task } from '../model';
import { type ChangeSet, propagate, type PropagationCommand, type TaskPatch } from '../schedule';
import { type DateTimeMs, parseDateInput } from '../time';
import {
  createStoreState,
  reduceStore,
  selectCommittedPatch,
  selectSessionChanges,
  selectSessionDirty,
  selectSessionRollback,
  selectTaskPatch,
  type SessionChanges,
  type StoreCommand,
  type StoreOptions,
  type StoreState,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

// 2026-03-02 is a Monday.
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 50 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'review', name: 'Review', start: '2026-03-16', duration: 2, dependencies: ['build'] },
  { id: 'docs', name: 'Docs', start: '2026-03-02', end: '2026-03-03' },
  { id: 'ops', name: 'Ops', start: '2026-03-04', duration: 3, durationMode: 'working' },
  { id: 'stub', name: 'Stub', type: 'placeholder' },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'design', target: 'build' }]);

/** Design a week later: build and review follow through their links. */
const MOVE: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-09') };
const BACK: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-02') };
const DOCS: PropagationCommand = { kind: 'move', id: 'docs', start: at('2026-03-04') };

function initial(options: StoreOptions = {}): StoreState {
  return createStoreState({
    tasks: TASKS,
    links: LINKS,
    options: { calendar: { weekends: [0, 6] }, ...options },
  });
}

function run(state: StoreState, ...commands: StoreCommand[]): StoreState {
  return commands.reduce(reduceStore, state);
}

function changeSetOf(state: StoreState, command: PropagationCommand): ChangeSet {
  const { model, hierarchy, graph } = state.derived;
  return propagate(command, { model, hierarchy, graph, options: state.settings.propagation });
}

/** Applies a change set: `applyChangeSet` computed on the state. */
function commit(state: StoreState, command: PropagationCommand): StoreState {
  return reduceStore(state, { type: 'applyChangeSet', changeSet: changeSetOf(state, command) });
}

/** The task's values in the model of the state. */
function valuesOf(state: StoreState, id: string): TaskPatch | undefined {
  const task = state.derived.model.taskById.get(id);
  const span = task?.span;
  return span && { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
}

/** What an owner of controlled data does with a change set: patch its own tasks. */
function ownerApplies(state: StoreState, changeSet: Pick<ChangeSet, 'changes'>): StoreState {
  const uncontrolled = reduceStore(
    createStoreState({
      tasks: state.tasks,
      links: state.links,
      options: { ...state.options, dataMode: 'uncontrolled' },
    }),
    {
      type: 'applyChangeSet',
      changeSet: { reason: 'api', changes: changeSet.changes, conflicts: [] },
    },
  );
  return reduceStore(state, { type: 'setTasks', tasks: uncontrolled.tasks });
}

function ids(changes: SessionChanges | undefined): unknown[] {
  return (changes?.changes ?? []).map((change) => change.id);
}

describe('reduceStore: session commands', () => {
  it('FR-TX-4: beginSession takes the data as the base; commitSession closes and keeps the data', () => {
    const state = initial();
    const open = reduceStore(state, { type: 'beginSession' });
    const base = open.session!;
    expect(Object.isFrozen(base)).toBe(true);
    expect(base.tasks).toBe(TASKS);
    expect(base.links).toBe(LINKS);
    expect(base.pending).toBeUndefined();
    expect([base.model, base.hierarchy, base.graph]).toEqual([
      state.derived.model,
      state.derived.hierarchy,
      state.derived.graph,
    ]);
    expect(base.model).toBe(state.derived.model);
    expect(open.derived).toBe(state.derived);
    expect(open.lastDataChange).toBe(state.lastDataChange);
    // A session is already open: nothing changes.
    expect(reduceStore(open, { type: 'beginSession' })).toBe(open);

    const moved = commit(open, MOVE);
    expect(moved.session).toBe(base);
    const closed = reduceStore(moved, { type: 'commitSession' });
    expect(closed.session).toBeUndefined();
    expect(closed.tasks).toBe(moved.tasks);
    expect(closed.derived).toBe(moved.derived);
  });

  it.each<[string, StoreCommand]>([
    ['commitSession', { type: 'commitSession' }],
    ['rollbackSession', { type: 'rollbackSession' }],
  ])('FR-TX-4: %s without a session changes nothing', (_, command) => {
    const state = initial();
    expect(reduceStore(state, command)).toBe(state);
    expect(selectSessionChanges(state)).toBeUndefined();
    expect(selectSessionRollback(state)).toBeUndefined();
    expect(selectSessionDirty(state)).toBe(false);
  });

  it('FR-TX-4: uncontrolled, rollbackSession brings back the very base arrays', () => {
    const open = reduceStore(initial(), { type: 'beginSession' });
    const edited = run(
      commit(open, MOVE),
      { type: 'setLinks', links: [{ source: 'docs', target: 'ops' }] },
      { type: 'setDraft', changeSet: changeSetOf(open, DOCS) },
    );
    expect(edited.tasks).not.toBe(TASKS);
    const back = reduceStore(edited, { type: 'rollbackSession' });
    expect(back.tasks).toBe(TASKS);
    expect(back.links).toBe(LINKS);
    expect(back.draft).toBeUndefined();
    expect(back.session).toBeUndefined();
    for (const id of ['design', 'build', 'review']) {
      expect(valuesOf(back, id)).toEqual(valuesOf(open, id));
    }
    expect([...back.derived.graph.linkById.keys()]).toEqual(['design:FS:build', 'build:FS:review']);
  });
});

describe('selectSessionChanges', () => {
  it('FR-TX-4: one change per task from the base to now; a task changed back drops out', () => {
    const open = reduceStore(initial(), { type: 'beginSession' });
    expect(selectSessionChanges(open)).toEqual({
      reason: 'session',
      changes: [],
      conflicts: [],
      links: { added: [], removed: [] },
    });
    const moved = commit(open, MOVE);
    const later = commit(moved, { ...MOVE, start: at('2026-03-16') });
    const changes = selectSessionChanges(later)!;
    expect(Object.isFrozen(changes)).toBe(true);
    expect(Object.isFrozen(changes.changes)).toBe(true);
    expect(changes.changes).toEqual(
      ['design', 'build', 'review'].map((id) => ({
        id,
        before: valuesOf(open, id),
        after: valuesOf(later, id),
        cause: 'direct',
      })),
    );
    expect(changes.changes[0]!.after.start).toBe(at('2026-03-16'));
    expect(selectSessionDirty(later)).toBe(true);
    // Back where it began: nothing left.
    const back = commit(later, BACK);
    expect(ids(selectSessionChanges(back))).toEqual([]);
    expect(selectSessionDirty(back)).toBe(false);
    // A preview is not a change.
    const previewed = reduceStore(back, { type: 'setDraft', changeSet: changeSetOf(back, DOCS) });
    expect(ids(selectSessionChanges(previewed))).toEqual([]);
    expect(selectSessionDirty(previewed)).toBe(false);
  });

  it('FR-TX-4, FR-SCH-6: the conflicts of the current state that involve a change', () => {
    const open = reduceStore(initial(), { type: 'beginSession' });
    // Docs ends on a Saturday (a resize keeps non-working days by default).
    const moved = commit(open, { kind: 'resize-end', id: 'docs', endExclusive: at('2026-03-08') });
    const { conflicts } = selectSessionChanges(moved)!;
    expect(conflicts.map((conflict) => [conflict.type, conflict.id])).toEqual([
      ['non-working-end', 'docs'],
    ]);
    expect(selectSessionRollback(moved)!.conflicts).toEqual([]);
  });

  it('FR-TX-4: links added and removed by id; a changed link is in both lists', () => {
    const open = reduceStore(initial(), { type: 'beginSession' });
    const added: Link = { source: 'docs', target: 'ops' };
    const changed: Link = { source: 'design', target: 'build', lag: 1 };
    const edited = reduceStore(open, { type: 'setLinks', links: [changed, added] });
    const { links, changes } = selectSessionChanges(edited)!;
    expect(changes).toEqual([]);
    expect(links.added.map((link) => [link.id, link.link])).toEqual([
      ['design:FS:build', changed],
      ['docs:FS:ops', added],
    ]);
    expect(links.removed.map((link) => [link.id, link.link])).toEqual([
      ['design:FS:build', LINKS[0]],
    ]);
    expect(selectSessionDirty(edited)).toBe(true);
    // The rollback restores what was removed and drops what was added.
    const inverse = selectSessionRollback(edited)!;
    expect(inverse.reason).toBe('rollback');
    expect(inverse.links.added.map((link) => link.link)).toEqual([LINKS[0]]);
    expect(inverse.links.removed.map((link) => link.link)).toEqual([changed, added]);
    // A shorthand link that is gone.
    const tasks = TASKS.map((task) =>
      task.id === 'review' ? { ...task, dependencies: [] } : task,
    );
    const unlinked = reduceStore(open, { type: 'setTasks', tasks });
    expect(selectSessionChanges(unlinked)!.links.removed.map((link) => link.id)).toEqual([
      'build:FS:review',
    ]);
    // An equal link in another place (from the shorthand into `links`) is no change.
    const moved = reduceStore(unlinked, {
      type: 'setLinks',
      links: [...LINKS, { source: 'build', target: 'review' }],
    });
    expect(selectSessionDirty(moved)).toBe(false);
  });

  it('FR-TX-4: options that change normalization rebuild the base: only data changes count', () => {
    const open = reduceStore(initial(), { type: 'beginSession' });
    // Ops lasts 3 working days from Wednesday: to Friday; with Fridays off, to Monday.
    const options: StoreOptions = { calendar: { weekends: [0, 5, 6] } };
    const rescheduled = reduceStore(open, { type: 'setOptions', options });
    expect(valuesOf(rescheduled, 'ops')).not.toEqual(valuesOf(open, 'ops'));
    expect(rescheduled.session).not.toBe(open.session);
    expect(rescheduled.session!.tasks).toBe(TASKS);
    expect(rescheduled.session!.model).not.toBe(open.session!.model);
    expect(selectSessionDirty(rescheduled)).toBe(false);
    expect(ids(selectSessionChanges(rescheduled))).toEqual([]);
    // The tree is rebuilt for its own option, the base is kept for others.
    const anchored = reduceStore(rescheduled, {
      type: 'setOptions',
      options: { hierarchy: { childAnchor: 'FF' } },
    });
    expect(anchored.session!.hierarchy).not.toBe(rescheduled.session!.hierarchy);
    expect(anchored.session!.model).toBe(rescheduled.session!.model);
    const viewed = reduceStore(anchored, { type: 'setViewMode', id: 'week' });
    expect(viewed.session).toBe(anchored.session);
  });
});

describe('sessions over controlled data', () => {
  it('FR-TX-3: a committed change set is a committed draft, a preview is not', () => {
    const state = initial({ dataMode: 'controlled' });
    const changeSet = changeSetOf(state, MOVE);
    const preview = reduceStore(state, { type: 'setDraft', changeSet });
    expect(preview.draft?.committed).toBe(false);
    expect(selectCommittedPatch(preview, 'design')).toEqual(valuesOf(state, 'design'));
    expect(selectTaskPatch(preview, 'design')).toBe(changeSet.changes[0]!.after);
    const committed = reduceStore(preview, { type: 'applyChangeSet', changeSet });
    expect(committed).not.toBe(preview);
    expect(committed.draft).toMatchObject({ changeSet, committed: true });
    expect(selectCommittedPatch(committed, 'design')).toBe(changeSet.changes[0]!.after);
    expect(selectCommittedPatch(committed, 'stub')).toBeUndefined();
    expect(selectCommittedPatch(committed, 'ghost')).toBeUndefined();
    // Uncontrolled data never has a committed draft.
    const own = reduceStore(initial(), { type: 'setDraft', changeSet });
    expect(own.draft?.committed).toBe(false);
  });

  it('FR-TX-4: a preview over a committed change leaves the session’s data as it is', () => {
    const open = reduceStore(initial({ dataMode: 'controlled' }), { type: 'beginSession' });
    const committed = commit(open, DOCS);
    const docs = committed.draft!.patches.get('docs');
    const changes = selectSessionChanges(committed);
    expect(ids(changes)).toEqual(['docs']);
    const moved = changeSetOf(committed, MOVE);
    const preview = reduceStore(committed, { type: 'setDraft', changeSet: moved });
    expect(selectCommittedPatch(preview, 'docs')).toBe(docs);
    expect(selectCommittedPatch(preview, 'design')).toEqual(valuesOf(open, 'design'));
    expect(selectTaskPatch(preview, 'design')).toBe(moved.changes[0]!.after);
    expect(selectSessionChanges(preview)).toEqual(changes);
    const cancelled = reduceStore(preview, { type: 'setDraft', changeSet: undefined });
    expect(selectSessionDirty(cancelled)).toBe(true);
    expect(ids(selectSessionChanges(cancelled))).toEqual(['docs']);
    // A session begun over both has the committed change in its base, not the preview.
    const again = run(preview, { type: 'commitSession' }, { type: 'beginSession' });
    expect(again.session!.pending).toBe(committed.draft!.committedLayer!.patches);
    expect(selectSessionDirty(again)).toBe(false);
  });

  it('FR-TX-4: a change the owner has not applied yet counts, before and after it is applied', () => {
    const open = reduceStore(initial({ dataMode: 'controlled' }), { type: 'beginSession' });
    const changeSet = changeSetOf(open, MOVE);
    const committed = reduceStore(open, { type: 'applyChangeSet', changeSet });
    expect(committed.tasks).toBe(TASKS);
    const pending = selectSessionChanges(committed)!;
    expect(pending.changes.map((change) => change.after)).toEqual(
      changeSet.changes.map((change) => change.after),
    );
    expect(selectSessionDirty(committed)).toBe(true);
    const applied = ownerApplies(committed, changeSet);
    expect(applied.draft).toBeUndefined();
    expect(selectSessionChanges(applied)).toEqual(pending);
    // The owner rejects it: no change left.
    const rejected = reduceStore(committed, { type: 'setTasks', tasks: TASKS });
    expect(selectSessionDirty(rejected)).toBe(false);
  });

  it('FR-TX-4: the base includes a committed draft the owner had not applied at begin', () => {
    const state = initial({ dataMode: 'controlled' });
    const changeSet = changeSetOf(state, MOVE);
    const committed = reduceStore(state, { type: 'applyChangeSet', changeSet });
    const open = reduceStore(committed, { type: 'beginSession' });
    expect(open.session!.pending).toBe(committed.draft!.patches);
    expect(selectSessionDirty(open)).toBe(false);
    // The owner applies it: still the base.
    const applied = ownerApplies(open, changeSet);
    expect(selectSessionDirty(applied)).toBe(false);
    // Rolled back before the owner applied it: the draft keeps showing it.
    const back = reduceStore(open, { type: 'rollbackSession' });
    expect(back.draft?.committed).toBe(true);
    expect(selectTaskPatch(back, 'review')).toEqual(changeSet.changes[2]!.after);
    expect(selectSessionRollback(open)!.changes).toEqual([]);
  });

  it('FR-TX-4: rollback shows the base and its inverse reverts an unapplied change too', () => {
    const open = reduceStore(initial({ dataMode: 'controlled' }), { type: 'beginSession' });
    const first = changeSetOf(open, MOVE);
    const applied = ownerApplies(
      reduceStore(open, { type: 'applyChangeSet', changeSet: first }),
      first,
    );
    const second = changeSetOf(applied, DOCS);
    const pending = reduceStore(applied, { type: 'applyChangeSet', changeSet: second });

    const inverse = selectSessionRollback(pending)!;
    expect(Object.isFrozen(inverse)).toBe(true);
    expect(inverse.changes).toEqual(
      ['design', 'build', 'review', 'docs'].map((id) => ({
        id,
        before: selectCommittedPatch(pending, id),
        after: valuesOf(open, id),
        cause: 'direct',
      })),
    );

    const back = reduceStore(pending, { type: 'rollbackSession' });
    expect(back.session).toBeUndefined();
    expect(back.tasks).toBe(applied.tasks);
    expect(back.draft?.committed).toBe(true);
    expect(back.draft?.changeSet.reason).toBe('rollback');
    // The owner's data has the first change: the draft shows the base over it.
    expect([...back.draft!.patches.keys()]).toEqual(['design', 'build', 'review']);
    for (const id of ['design', 'build', 'review', 'docs']) {
      expect(selectTaskPatch(back, id)).toEqual(valuesOf(open, id));
    }
    // The owner applies the second change and the inverse: the base again.
    const owner = ownerApplies(ownerApplies(back, second), inverse);
    for (const id of ['design', 'build', 'review', 'docs']) {
      expect(valuesOf(owner, id)).toEqual(valuesOf(open, id));
    }
    // Nothing to show: no draft.
    const clean = reduceStore(
      reduceStore(initial({ dataMode: 'controlled' }), { type: 'beginSession' }),
      {
        type: 'rollbackSession',
      },
    );
    expect(clean.draft).toBeUndefined();
  });
});

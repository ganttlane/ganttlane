import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { type Link, normalizeModel, patchTask, type Task } from '../model';
import { type Change, propagate, type PropagationCommand, type TaskPatch } from '../schedule';
import {
  createStore,
  selectTaskPatch,
  type SessionChanges,
  type Store,
  type StoreOptions,
  type StoreState,
} from '../store';
import { type DateTimeMs, parseDateInput } from '../time';
import {
  type ChangeController,
  type CoreEventName,
  type CoreEvents,
  createChangeController,
  createChangeHistory,
  createEditSession,
  createEmitter,
  type Emitter,
  type SessionRollbackResult,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 2026-03-02 is a Monday.
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 50 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'review', name: 'Review', start: '2026-03-16', duration: 2, dependencies: ['build'] },
  { id: 'docs', name: 'Docs', start: '2026-03-02', end: '2026-03-03' },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'design', target: 'build' }]);
const ALL = ['design', 'build', 'review', 'docs'] as const;

/** Design a week later: build and review follow through their links. */
const MOVE: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-09') };
const BACK: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-02') };
const DOCS: PropagationCommand = { kind: 'move', id: 'docs', start: at('2026-03-04') };
const DOCS_BACK: PropagationCommand = { kind: 'move', id: 'docs', start: at('2026-03-02') };

type Logged = { [K in CoreEventName]: readonly [K, CoreEvents[K]] }[CoreEventName];

const EVENTS: readonly CoreEventName[] = [
  'tasksChange',
  'linkCreate',
  'linkDelete',
  'editRollback',
  'dirtyChange',
  'historyChange',
  'error',
];

function setup(options: StoreOptions = {}, withHistory = true) {
  const store = createStore({
    tasks: TASKS,
    links: LINKS,
    options: { calendar: { weekends: [0, 6] }, ...options },
  });
  const emitter = createEmitter<CoreEvents>();
  const controller = createChangeController({ store, emitter });
  const history = withHistory
    ? createChangeHistory({ store, controller, emitter, enabled: true })
    : undefined;
  const edit = createEditSession({ store, controller, emitter, history });
  const events: Logged[] = [];
  for (const name of EVENTS) {
    emitter.on(name, (payload) => events.push([name, payload] as unknown as Logged));
  }
  const initial = store.getSnapshot();
  return {
    store,
    emitter,
    controller,
    history,
    edit,
    events,
    initial,
    names: (): CoreEventName[] => events.map(([name]) => name),
    dirty: (): boolean[] =>
      events.flatMap(([name, payload]) => (name === 'dirtyChange' ? [payload.isDirty] : [])),
    commit: (command: PropagationCommand) => controller.commit(changeSetOn(store, command)),
  };
}

function changeSetOn(store: Store, command: PropagationCommand) {
  const { derived, settings } = store.getSnapshot();
  const { model, hierarchy, graph } = derived;
  return propagate(command, { model, hierarchy, graph, options: settings.propagation });
}

function valuesOf(state: StoreState, id: string): TaskPatch | undefined {
  const task = state.derived.model.taskById.get(id);
  const span = task?.span;
  return span && { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
}

function ids(changes: SessionChanges | undefined): unknown[] {
  return (changes?.changes ?? []).map((change) => change.id);
}

function swapped(changes: readonly Change[]): unknown[] {
  return changes.map(({ id, before, after }) => ({ id, before: after, after: before }));
}

/**
 * The owner of controlled data: queues what the events ask for and applies it to its own tasks
 * and links with `flush()` (as a React state update would, one render later).
 */
function createOwner(store: Store, controller: ChangeController, emitter: Emitter<CoreEvents>) {
  let tasks = store.getSnapshot().tasks;
  let links = store.getSnapshot().links ?? [];
  let queue: (() => void)[] = [];
  const patch = (changes: readonly Change[]): void => {
    const model = normalizeModel({ tasks, links }, store.getSnapshot().settings.model);
    const after = new Map(changes.map((change) => [change.id, change.after]));
    tasks = tasks.map((task) => {
      const values = after.get(task.id);
      return values ? patchTask(task, values, model) : task;
    });
  };
  emitter.on('tasksChange', ({ changes }) => queue.push(() => patch(changes)));
  emitter.on('linkCreate', ({ link }) => queue.push(() => (links = [...links, link])));
  emitter.on('linkDelete', ({ link }) =>
    queue.push(() => (links = links.filter((own) => own !== link.model.link))),
  );
  emitter.on('editRollback', (changes) =>
    queue.push(() => {
      patch(changes.changes);
      const dropped = new Set(changes.links.removed.map((model) => model.link));
      const restored = changes.links.added.map((model) => model.link!);
      links = [...links.filter((own) => !dropped.has(own)), ...restored];
    }),
  );
  return {
    flush: (): void => {
      for (const step of queue) step();
      queue = [];
      controller.update({ type: 'setTasks', tasks });
      controller.update({ type: 'setLinks', links });
    },
    /** Answers without applying anything: the owner's way to reject. */
    reject: (): void => {
      queue = [];
      controller.update({ type: 'setTasks', tasks });
    },
  };
}

describe('createEditSession: uncontrolled data', () => {
  it('FR-TX-4, FR-TX-1: changes accumulate, one tasksChange per action; commit returns the aggregate', async () => {
    const { store, edit, names, commit, initial } = setup();
    expect(edit.isOpen).toBe(false);
    expect(edit.getChanges()).toBeUndefined();
    expect(edit.begin()).toEqual({ status: 'begun' });
    expect(edit.isOpen).toBe(true);
    await commit(MOVE);
    expect(names().filter((name) => name === 'tasksChange')).toHaveLength(1);
    await commit(DOCS);
    expect(names().filter((name) => name === 'tasksChange')).toHaveLength(2);
    const changes = edit.getChanges()!;
    expect(changes.reason).toBe('session');
    expect(changes.changes).toEqual(
      ALL.map((id) => ({
        id,
        before: valuesOf(initial, id),
        after: valuesOf(store.getSnapshot(), id),
        cause: 'direct',
      })),
    );
    expect(edit.getChanges()).toBe(changes);
    const tasks = store.getSnapshot().tasks;

    const result = edit.commit();
    expect(result).toEqual({ status: 'committed', changes });
    expect(Object.isFrozen(result)).toBe(true);
    expect(edit.isOpen).toBe(false);
    expect(edit.getChanges()).toBeUndefined();
    expect(store.getSnapshot().tasks).toBe(tasks);
    expect(edit.commit()).toEqual({ status: 'no-session' });
    expect(edit.rollback()).toEqual({ status: 'no-session' });
  });

  it('FR-TX-4: rollback after mixed task and link edits brings back the very base objects', async () => {
    const { store, controller, edit, events, names, commit } = setup();
    edit.begin();
    await commit(MOVE);
    const link: Link = { source: 'docs', target: 'build', type: 'SS' };
    expect((await controller.createLink(link)).status).toBe('created');
    expect((await controller.deleteLink('design:FS:build')).status).toBe('deleted');
    // A link of the shorthand: deleting it edits the review task.
    expect((await controller.deleteLink('build:FS:review')).status).toBe('deleted');
    await commit(DOCS);
    const aggregate = edit.getChanges()!;
    expect(ids(aggregate)).toEqual(ALL);
    expect(aggregate.links.added.map((model) => model.id)).toEqual(['docs:SS:build']);
    expect(aggregate.links.removed.map((model) => model.id)).toEqual([
      'design:FS:build',
      'build:FS:review',
    ]);

    events.length = 0;
    const veto = vi.fn(() => false);
    controller.hooks.add('beforeTaskChange', veto);
    const result: SessionRollbackResult = edit.rollback();
    expect(veto).not.toHaveBeenCalled();
    const state = store.getSnapshot();
    expect(state.tasks).toBe(TASKS);
    expect(state.links).toBe(LINKS);
    expect(state.session).toBeUndefined();
    expect([...state.derived.graph.linkById.keys()]).toEqual([
      'design:FS:build',
      'build:FS:review',
    ]);
    // One event describes the whole rollback; no tasksChange or link events.
    expect(names()).toEqual(['historyChange', 'dirtyChange', 'editRollback']);
    const [, payload] = events[2] as readonly ['editRollback', SessionChanges];
    expect(result).toEqual({ status: 'rolled-back', changes: payload });
    expect(payload.reason).toBe('rollback');
    expect(swapped(payload.changes)).toEqual(
      aggregate.changes.map(({ id, before, after }) => ({ id, before, after })),
    );
    expect(payload.links.added).toEqual(aggregate.links.removed);
    expect(payload.links.removed).toEqual(aggregate.links.added);
    expect(edit.isDirty).toBe(false);
  });

  it('FR-TX-4: the owner’s data keeps the session and is reverted by a rollback too', async () => {
    const { store, controller, edit, history, commit } = setup();
    await commit(MOVE);
    const moved = store.getSnapshot();
    edit.begin();
    const tasks = moved.tasks.map((task) =>
      task.id === 'docs' ? { ...task, end: '2026-03-04' } : task,
    );
    const base = store.getSnapshot().session;
    controller.update({ type: 'setTasks', tasks });
    expect(store.getSnapshot().session).toBe(base);
    expect(edit.isOpen).toBe(true);
    expect(ids(edit.getChanges())).toEqual(['docs']);
    expect(edit.isDirty).toBe(true);
    // Uncontrolled data replaced from outside: its history is gone…
    expect(history!.canUndo).toBe(false);
    edit.rollback();
    expect(store.getSnapshot().tasks).toBe(moved.tasks);
    // … and back with the data of the session's start.
    expect(history!.canUndo).toBe(true);
    expect(history!.undo().status).toBe('undone');
    expect(store.getSnapshot().tasks.slice(0, 3)).toEqual(TASKS.slice(0, 3));
  });
});

describe('createEditSession: controlled data', () => {
  it('FR-TX-4, FR-TX-3: one editRollback reverts everything, also a change not applied yet', async () => {
    const { store, controller, emitter, edit, events, names, commit, initial } = setup({
      dataMode: 'controlled',
    });
    const owner = createOwner(store, controller, emitter);
    edit.begin();
    await commit(MOVE);
    owner.flush();
    const link: Link = { source: 'docs', target: 'build', type: 'SS' };
    await controller.createLink(link);
    owner.flush();
    expect(store.getSnapshot().links).toEqual([...LINKS, link]);
    await commit(DOCS); // not applied by the owner yet
    expect(store.getSnapshot().draft?.committed).toBe(true);
    expect(ids(edit.getChanges())).toEqual(ALL);
    expect(edit.getChanges()!.links.added.map((model) => model.link)).toEqual([link]);

    events.length = 0;
    const result = edit.rollback();
    expect(result.status).toBe('rolled-back');
    expect(names()).toEqual(['historyChange', 'dirtyChange', 'editRollback']);
    const [, payload] = events[2] as readonly ['editRollback', SessionChanges];
    expect(ids(payload)).toEqual(ALL);
    expect(payload.changes.map((change) => change.after)).toEqual(
      ALL.map((id) => valuesOf(initial, id)),
    );
    expect(payload.links.removed.map((model) => model.link)).toEqual([link]);
    // Until the owner answers, the chart shows the base.
    const shown = store.getSnapshot();
    expect(shown.session).toBeUndefined();
    for (const id of ALL) expect(selectTaskPatch(shown, id)).toEqual(valuesOf(initial, id));

    // The owner applies the pending change, then the rollback: the base again.
    owner.flush();
    const state = store.getSnapshot();
    expect(state.draft).toBeUndefined();
    for (const id of ALL) expect(valuesOf(state, id)).toEqual(valuesOf(initial, id));
    expect(state.links).toEqual(LINKS);
  });

  it('FR-TX-4, FR-TX-6: previews over a change the owner has not applied keep it in the session', async () => {
    const { store, controller, edit, commit, dirty } = setup({ dataMode: 'controlled' });
    edit.begin();
    await commit(DOCS);
    const docs = selectTaskPatch(store.getSnapshot(), 'docs');
    expect(edit.isDirty).toBe(true);
    expect(controller.preview(changeSetOn(store, MOVE))).toBe(true);
    expect(controller.cancelPreview()).toBe(true);
    expect(selectTaskPatch(store.getSnapshot(), 'docs')).toEqual(docs);
    expect(edit.isDirty).toBe(true);
    expect(ids(edit.getChanges())).toEqual(['docs']);
    // A second change waits for the owner, so the first one is not lost.
    expect(await commit(MOVE)).toEqual({ status: 'busy' });
    expect(ids(edit.getChanges())).toEqual(['docs']);
    expect(dirty()).toEqual([true]);
  });

  it('FR-TX-4, FR-TX-6: a change the owner rejects leaves the session clean', async () => {
    const { store, controller, emitter, edit, commit, dirty } = setup({ dataMode: 'controlled' });
    const owner = createOwner(store, controller, emitter);
    edit.begin();
    await commit(DOCS);
    expect(edit.isDirty).toBe(true);
    owner.reject();
    expect(edit.isDirty).toBe(false);
    expect(dirty()).toEqual([true, false]);
  });

  it('FR-TX-4, FR-SNAP-7: a controlled rollback restores the day precision of a task the session made timed', async () => {
    const { store, controller, emitter, edit, events, initial } = setup({
      dataMode: 'controlled',
      scheduling: { granularity: '1h' },
    });
    const owner = createOwner(store, controller, emitter);
    edit.begin();
    const { derived, settings } = store.getSnapshot();
    const timed = propagate(
      { kind: 'move', id: 'docs', start: at('2026-03-02T10:00') },
      { ...derived, options: { ...settings.propagation, keepDayPrecision: false } },
    );
    expect(timed.changes[0]?.after.precision).toBe('time');
    await controller.commit(timed);
    owner.flush();
    expect(store.getSnapshot().derived.model.taskById.get('docs')?.precision).toBe('time');
    const [change] = edit.getChanges()!.changes;
    expect(change).toMatchObject({
      id: 'docs',
      before: { precision: 'day' },
      after: { precision: 'time' },
    });

    events.length = 0;
    edit.rollback();
    const [, payload] = events.find(([name]) => name === 'editRollback') as readonly [
      'editRollback',
      SessionChanges,
    ];
    expect(payload.changes).toEqual([
      {
        id: 'docs',
        before: { ...valuesOf(store.getSnapshot(), 'docs'), precision: 'time' },
        after: { ...valuesOf(initial, 'docs'), precision: 'day' },
        cause: 'direct',
      },
    ]);
    // The owner applies the rollback: the task is a day task on its old days again.
    owner.flush();
    const docs = store.getSnapshot().derived.model.taskById.get('docs');
    expect(docs?.precision).toBe('day');
    expect(valuesOf(store.getSnapshot(), 'docs')).toEqual(valuesOf(initial, 'docs'));
    expect(store.getSnapshot().tasks.find((task) => task.id === 'docs')).toMatchObject({
      start: '2026-03-02',
    });
  });

  it('FR-TX-4, FR-TX-6: a change of the precision alone is a change of the session', () => {
    const { store, controller, edit, initial } = setup({ dataMode: 'controlled' });
    edit.begin();
    const tasks = TASKS.map((task) =>
      task.id === 'docs'
        ? {
            ...task,
            start: '2026-03-02T00:00',
            end: '2026-03-04T00:00',
            precision: 'time' as const,
          }
        : task,
    );
    controller.update({ type: 'setTasks', tasks });
    expect(valuesOf(store.getSnapshot(), 'docs')).toEqual(valuesOf(initial, 'docs'));
    expect(edit.isDirty).toBe(true);
    expect(edit.getChanges()?.changes).toEqual([
      {
        id: 'docs',
        before: { ...valuesOf(initial, 'docs'), precision: 'day' },
        after: { ...valuesOf(initial, 'docs'), precision: 'time' },
        cause: 'direct',
      },
    ]);
    expect(edit.rollback()).toMatchObject({
      status: 'rolled-back',
      changes: { changes: [{ id: 'docs', after: { precision: 'day' } }] },
    });
    // The store shows the base as a committed draft, in the base precision.
    expect(store.getSnapshot().draft?.patches.get('docs')).toEqual({
      ...valuesOf(initial, 'docs'),
      precision: 'day',
    });
  });
});

describe('createEditSession: hooks, dirty state, lock', () => {
  it('FR-TX-2, FR-TX-4: a hook that cancels inside a session changes nothing; one that modifies counts', async () => {
    const { store, controller, edit, names, commit } = setup();
    edit.begin();
    const veto = controller.hooks.add('beforeTaskChange', () => false);
    expect((await commit(MOVE)).status).toBe('cancelled');
    expect(edit.isDirty).toBe(false);
    expect(ids(edit.getChanges())).toEqual([]);
    expect(names()).toEqual([]);
    veto();
    controller.hooks.add('beforeTaskChange', () =>
      changeSetOn(store, { ...MOVE, start: at('2026-03-16') }),
    );
    expect((await commit(MOVE)).status).toBe('committed');
    expect(edit.getChanges()!.changes[0]!.after.start).toBe(at('2026-03-16'));
    // The history was created first, so it reports first.
    expect(names()).toEqual(['historyChange', 'dirtyChange', 'tasksChange']);
  });

  it('FR-TX-6: dirtyChange is emitted only when the dirty state flips, before the action’s events', async () => {
    const { controller, edit, names, commit, dirty, events } = setup({}, false);
    expect(edit.isDirty).toBe(false);
    edit.begin();
    expect(dirty()).toEqual([]);
    await commit(MOVE);
    expect(dirty()).toEqual([true]);
    expect(names()).toEqual(['dirtyChange', 'tasksChange']);
    await commit(DOCS);
    await commit(BACK);
    expect(dirty()).toEqual([true]);
    await commit(DOCS_BACK);
    expect(dirty()).toEqual([true, false]);
    expect(edit.isDirty).toBe(false);
    // Links count too.
    await controller.createLink({ source: 'docs', target: 'build' });
    expect(dirty()).toEqual([true, false, true]);
    await controller.deleteLink('docs:FS:build');
    expect(dirty()).toEqual([true, false, true, false]);
    await commit(MOVE);
    events.length = 0;
    edit.commit();
    expect(events).toEqual([['dirtyChange', { isDirty: false }]]);
    // A clean session closes without an event.
    edit.begin();
    edit.rollback();
    expect(names()).toEqual(['dirtyChange', 'editRollback']);
  });

  it('FR-TX-5, FR-TX-6, FR-EVT-1: historyChange and dirtyChange of a nested operation wait in the outbox', async () => {
    const { emitter, history, edit, events, commit } = setup();
    emitter.on('taskDatesChange', (payload) =>
      events.push(['taskDatesChange', payload] as unknown as Logged),
    );
    edit.begin();
    // A listener of the drop undoes it at once: a nested operation.
    let undone: unknown;
    const off = emitter.on('tasksChange', () => {
      off();
      undone = history!.undo();
    });
    await commit(MOVE);
    expect(undone).toMatchObject({ status: 'undone' });
    const label = ([name, payload]: Logged): string =>
      name === 'tasksChange' ? `tasksChange:${payload.reason}` : name;
    // The drop's events all go out first, then the undo's, its own history and dirty state first.
    expect(events.map(label)).toEqual([
      'historyChange',
      'dirtyChange',
      'tasksChange:move',
      ...['taskDatesChange', 'taskDatesChange', 'taskDatesChange'],
      'historyChange',
      'dirtyChange',
      'tasksChange:undo',
      ...['taskDatesChange', 'taskDatesChange', 'taskDatesChange'],
    ]);
    expect(events.filter(([name]) => name === 'historyChange').map(([, p]) => p)).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
    ]);
    expect(edit.isDirty).toBe(false);
  });

  it('FR-TX-4, FR-EVT-1: a rollback started by a listener reports after the running operation', async () => {
    const { emitter, edit, events, commit } = setup();
    emitter.on('taskDatesChange', (payload) =>
      events.push(['taskDatesChange', payload] as unknown as Logged),
    );
    edit.begin();
    const off = emitter.on('tasksChange', () => {
      off();
      expect(edit.rollback()).toMatchObject({ status: 'rolled-back' });
    });
    await commit(DOCS);
    expect(events.map(([name]) => name)).toEqual([
      'historyChange',
      'dirtyChange',
      'tasksChange',
      'taskDatesChange',
      'historyChange',
      'dirtyChange',
      'editRollback',
    ]);
  });

  it('FR-TX-4: begin during an open session goes on; everything waits while a hook is awaited', async () => {
    const { store, controller, edit, commit } = setup();
    edit.begin();
    const base = store.getSnapshot().session;
    await commit(MOVE);
    expect(edit.begin()).toEqual({ status: 'already-open' });
    expect(store.getSnapshot().session).toBe(base);

    const answer = deferred<undefined>();
    const off = controller.hooks.add('beforeTaskChange', () => answer.promise);
    const pending = commit(DOCS);
    expect(controller.pending).toBe(true);
    expect(edit.commit()).toEqual({ status: 'busy' });
    expect(edit.rollback()).toEqual({ status: 'busy' });
    // The change being confirmed is only a preview: not part of the session yet.
    expect(ids(edit.getChanges())).toEqual(['design', 'build', 'review']);
    answer.resolve(undefined);
    await pending;
    expect(ids(edit.getChanges())).toEqual(ALL);
    expect(edit.rollback().status).toBe('rolled-back');

    const again = deferred<undefined>();
    off();
    controller.hooks.add('beforeTaskChange', () => again.promise);
    const later = commit(MOVE);
    expect(edit.begin()).toEqual({ status: 'busy' });
    expect(store.getSnapshot().session).toBeUndefined();
    again.resolve(undefined);
    await later;
    expect(edit.begin()).toEqual({ status: 'begun' });
  });
});

describe('createEditSession: history', () => {
  it('FR-TX-4, FR-TX-5: undo works inside a session; rollback puts the history back as at begin', async () => {
    const { store, history, edit, commit, initial } = setup();
    await commit(MOVE);
    const moved = store.getSnapshot();
    edit.begin();
    await commit(DOCS);
    expect(history!.undo().status).toBe('undone');
    expect(edit.isDirty).toBe(false);
    // Undo reaches back before the session began.
    expect(history!.undo().status).toBe('undone');
    expect(ids(edit.getChanges())).toEqual(['design', 'build', 'review']);
    expect(history!.canRedo).toBe(true);
    edit.rollback();
    expect(store.getSnapshot().tasks).toBe(moved.tasks);
    expect([history!.canUndo, history!.canRedo]).toEqual([true, false]);
    expect(history!.undo().status).toBe('undone');
    for (const id of ALL) expect(valuesOf(store.getSnapshot(), id)).toEqual(valuesOf(initial, id));
  });

  it('FR-TX-4, FR-TX-5: rollback puts the history back also after an option rebuilt the base', async () => {
    const { store, controller, history, edit, commit } = setup();
    await commit(MOVE);
    edit.begin();
    const base = store.getSnapshot().session;
    await commit(DOCS);
    controller.update({ type: 'setOptions', options: { hierarchy: { childAnchor: 'FF' } } });
    expect(store.getSnapshot().session).not.toBe(base);
    expect(edit.rollback().status).toBe('rolled-back');
    expect([history!.canUndo, history!.canRedo]).toEqual([true, false]);
    expect(history!.undo().status).toBe('undone');
  });

  it('FR-TX-4, FR-TX-5: commit keeps the entries of the session', async () => {
    const { history, edit, commit } = setup();
    edit.begin();
    await commit(DOCS);
    edit.commit();
    expect(history!.canUndo).toBe(true);
    expect(history!.undo().status).toBe('undone');
  });

  it('FR-TX-4: a session begun on the store directly has no saved history: rollback clears it', async () => {
    const { store, history, edit, commit } = setup();
    await commit(MOVE);
    store.dispatch({ type: 'beginSession' });
    expect(edit.isOpen).toBe(true);
    await commit(DOCS);
    expect(edit.rollback().status).toBe('rolled-back');
    expect(history!.canUndo).toBe(false);
  });
});

describe('createEditSession: dispose', () => {
  it('FR-TX-4: after dispose, methods resolve cancelled and nothing is emitted', async () => {
    const { edit, names, commit } = setup({}, false);
    edit.begin();
    edit.dispose();
    edit.dispose();
    await commit(MOVE);
    expect(names()).toEqual(['tasksChange']);
    const disposed = { status: 'cancelled', reason: 'disposed' };
    expect(edit.begin()).toEqual(disposed);
    expect(edit.commit()).toEqual(disposed);
    expect(edit.rollback()).toEqual(disposed);
    expect(edit.isOpen).toBe(true);
    expectTypeOf(edit.getChanges()).toEqualTypeOf<SessionChanges | undefined>();
  });

  it('FR-EVT-1: listener errors of a session go to `error`, else they are thrown after every event', async () => {
    const { emitter, edit, commit, events } = setup({}, false);
    const boom = new Error('boom');
    emitter.on('dirtyChange', () => {
      throw boom;
    });
    edit.begin();
    await commit(MOVE);
    expect(events.find(([name]) => name === 'error')).toEqual([
      'error',
      { error: boom, source: 'listener', name: 'dirtyChange' },
    ]);

    // Without an `error` listener.
    const store = createStore({ tasks: TASKS, links: LINKS });
    const bare = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter: bare });
    const session = createEditSession({ store, controller, emitter: bare });
    const seen: string[] = [];
    bare.on('dirtyChange', () => {
      throw boom;
    });
    bare.on('editRollback', () => seen.push('editRollback'));
    bare.on('tasksChange', () => seen.push('tasksChange'));
    session.begin();
    await expect(controller.commit(changeSetOn(store, MOVE))).rejects.toBe(boom);
    expect(seen).toEqual(['tasksChange']);
    expect(session.isDirty).toBe(true);
    expect(() => session.rollback()).toThrow(boom);
    expect(seen).toEqual(['tasksChange', 'editRollback']);
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(() => session.begin()).not.toThrow();
  });

  it('FR-EVT-1: several listener errors of a session step are one AggregateError naming it', () => {
    const store = createStore({ tasks: TASKS, links: LINKS });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const session = createEditSession({ store, controller, emitter });
    const first = new Error('first');
    const second = new Error('second');
    session.begin();
    controller.apply(changeSetOn(store, MOVE));
    emitter.on('dirtyChange', () => {
      throw first;
    });
    emitter.on('editRollback', () => {
      throw second;
    });
    let thrown: unknown;
    try {
      session.rollback();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
    expect((thrown as AggregateError).message).toBe(
      "2 event listeners threw during the edit session's rollback()",
    );
  });

  it('FR-EVT-1: a throwing store listener stops neither the history nor the events of a rollback', async () => {
    const { store, history, edit, commit, events, names } = setup();
    edit.begin();
    await commit(DOCS);
    const boom = new Error('boom');
    store.subscribe(() => {
      throw boom;
    });
    events.length = 0;
    expect(() => edit.rollback()).toThrow(boom);
    expect(names()).toEqual(['historyChange', 'dirtyChange', 'editRollback']);
    expect([history!.canUndo, edit.isOpen]).toEqual([false, false]);
  });

  it('FR-EVT-1: a throwing historyChange listener does not stop a rollback', async () => {
    const store = createStore({ tasks: TASKS, links: LINKS });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const history = createChangeHistory({ store, controller, emitter, enabled: true });
    const session = createEditSession({ store, controller, emitter, history });
    const boom = new Error('boom');
    emitter.on('historyChange', () => {
      throw boom;
    });
    const rolledBack = vi.fn();
    emitter.on('editRollback', rolledBack);
    session.begin();
    await expect(controller.commit(changeSetOn(store, MOVE))).rejects.toBe(boom);
    expect(history.canUndo).toBe(true);
    expect(() => session.rollback()).toThrow(boom);
    expect(rolledBack).toHaveBeenCalledOnce();
    expect(history.canUndo).toBe(false);
    expect(store.getSnapshot().tasks).toBe(TASKS);
  });
});

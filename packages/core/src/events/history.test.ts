import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { type Link, normalizeModel, patchTask, type Task } from '../model';
import { type ChangeSet, propagate, type PropagationCommand, type TaskPatch } from '../schedule';
import { createStore, type Store, type StoreOptions, type StoreState } from '../store';
import { type DateTimeMs, DAY, parseDateInput } from '../time';
import {
  type ChangeController,
  type CoreEventName,
  type CoreEvents,
  createChangeController,
  createChangeHistory,
  createEmitter,
  type Emitter,
  type HistoryResult,
  type HistorySettings,
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

const MOVE: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-09') };
const DOCS: PropagationCommand = { kind: 'move', id: 'docs', start: at('2026-03-04') };
const LATER: PropagationCommand = { kind: 'move', id: 'docs', start: at('2026-03-11') };

type Logged = { [K in CoreEventName]: readonly [K, CoreEvents[K]] }[CoreEventName];

const EVENTS: readonly CoreEventName[] = [
  'tasksChange',
  'taskDatesChange',
  'linkCreate',
  'linkDelete',
  'historyChange',
  'issues',
];

function setup(settings: HistorySettings = { enabled: true }, options: StoreOptions = {}) {
  const store = createStore({
    tasks: TASKS,
    links: LINKS,
    options: { calendar: { weekends: [0, 6] }, ...options },
  });
  const emitter = createEmitter<CoreEvents>();
  const controller = createChangeController({ store, emitter });
  const history = createChangeHistory({ store, controller, emitter, ...settings });
  const events: Logged[] = [];
  for (const name of EVENTS) {
    emitter.on(name, (payload) => events.push([name, payload] as unknown as Logged));
  }
  return {
    store,
    emitter,
    controller,
    history,
    events,
    initial: store.getSnapshot(),
    names: (): CoreEventName[] => events.map(([name]) => name),
    flags: (): unknown[] =>
      events.flatMap(([name, payload]) => (name === 'historyChange' ? [payload] : [])),
    commit: (command: PropagationCommand) => controller.commit(changeSetOn(store, command)),
  };
}

function changeSetOn(store: Store, command: PropagationCommand): ChangeSet {
  const { derived, settings } = store.getSnapshot();
  const { model, hierarchy, graph } = derived;
  return propagate(command, { model, hierarchy, graph, options: settings.propagation });
}

function valuesOf(state: StoreState, id: string): TaskPatch | undefined {
  const task = state.derived.model.taskById.get(id);
  const span = task?.span;
  return span && { start: span.start, endExclusive: span.endExclusive, progress: task.progress };
}

function valuesAll(state: StoreState): unknown[] {
  return ALL.map((id) => valuesOf(state, id));
}

/** The owner of controlled data: applies what `tasksChange` asks for with `flush()`. */
function createOwner(store: Store, controller: ChangeController, emitter: Emitter<CoreEvents>) {
  let tasks = store.getSnapshot().tasks;
  let queue: ChangeSet[] = [];
  emitter.on('tasksChange', (changeSet) => queue.push(changeSet));
  return {
    flush: (): void => {
      for (const { changes } of queue) {
        const model = normalizeModel({ tasks }, store.getSnapshot().settings.model);
        const after = new Map(changes.map((change) => [change.id, change.after]));
        tasks = tasks.map((task) => {
          const values = after.get(task.id);
          return values ? patchTask(task, values, model) : task;
        });
      }
      queue = [];
      controller.update({ type: 'setTasks', tasks });
    },
    reject: (): void => {
      queue = [];
      controller.update({ type: 'setTasks', tasks });
    },
  };
}

describe('createChangeHistory: settings', () => {
  it('FR-TX-5: records nothing unless enabled', async () => {
    const { history, commit, flags } = setup({});
    expect([history.enabled, history.limit]).toEqual([false, 100]);
    await commit(MOVE);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toEqual({ status: 'empty' });
    expect(history.redo()).toEqual({ status: 'empty' });
    history.configure({ enabled: true });
    await commit(DOCS);
    expect(history.canUndo).toBe(true);
    history.configure({ limit: 5 });
    expect([history.enabled, history.limit]).toEqual([true, 5]);
    history.configure({ enabled: false });
    expect(history.canUndo).toBe(false);
    expect(flags()).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: false },
    ]);
  });

  it.each<[number | undefined, number]>([
    [undefined, 100],
    [-1, 100],
    [1.5, 100],
    [Number.NaN, 100],
    [0, 0],
    [3, 3],
    [Infinity, Infinity],
  ])('FR-TX-5: a limit of %s is %s', (limit, expected) => {
    expect(setup({ enabled: true, limit }).history.limit).toBe(expected);
  });

  it('FR-TX-5: keeps at most `limit` entries, the newest; a smaller limit drops the oldest', async () => {
    const { history, commit, store, initial } = setup({ enabled: true, limit: 2 });
    await commit(MOVE);
    const moved = store.getSnapshot();
    await commit(DOCS);
    await commit(LATER);
    expect(history.undo().status).toBe('undone');
    expect(history.undo().status).toBe('undone');
    expect(history.undo()).toEqual({ status: 'empty' });
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(moved));
    expect(valuesAll(store.getSnapshot())).not.toEqual(valuesAll(initial));
    // Both entries are redo entries now; a limit of one keeps the next one.
    history.configure({ limit: 1 });
    expect(history.checkpoint().redo).toHaveLength(1);
    expect(history.redo().status).toBe('redone');
    expect(history.canRedo).toBe(false);
    history.configure({ limit: 0 });
    expect(history.canUndo).toBe(false);
    await commit(MOVE);
    expect(history.canUndo).toBe(false);
  });
});

describe('createChangeHistory: steps', () => {
  it('FR-TX-5: one commit is one entry; undo and redo skip the hooks and emit one tasksChange each', async () => {
    const { store, controller, history, events, names, commit, initial } = setup();
    await commit(MOVE);
    const [, committed] = events.find(([name]) => name === 'tasksChange') as readonly [
      'tasksChange',
      ChangeSet,
    ];
    const moved = store.getSnapshot();
    expect(committed.changes).toHaveLength(3);
    const veto = vi.fn(() => false);
    controller.hooks.add('beforeTaskChange', veto);

    events.length = 0;
    const undone: HistoryResult = history.undo();
    expectTypeOf(undone).toEqualTypeOf<HistoryResult>();
    expect(undone).toMatchObject({ status: 'undone', entry: { type: 'tasks' } });
    expect(veto).not.toHaveBeenCalled();
    expect(names()).toEqual([
      'historyChange',
      'tasksChange',
      'taskDatesChange',
      'taskDatesChange',
      'taskDatesChange',
    ]);
    const [, inverse] = events[1] as readonly ['tasksChange', ChangeSet];
    expect(inverse.reason).toBe('undo');
    expect(inverse.changes.map(({ id, before, after }) => [id, before, after])).toEqual(
      committed.changes.map(({ id, before, after }) => [id, after, before]),
    );
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(initial));
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);

    events.length = 0;
    const redone = history.redo();
    expect(redone.status).toBe('redone');
    const [, again] = events[1] as readonly ['tasksChange', ChangeSet];
    expect(again.reason).toBe('redo');
    expect(again.changes).toEqual(committed.changes);
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(moved));
    // The entry keeps the reason of the action.
    expect(redone).toMatchObject({ entry: { changeSet: { reason: 'move' } } });
    expect(history.redo()).toEqual({ status: 'empty' });
  });

  it('FR-TX-5: undo and redo across a link create', async () => {
    const { store, controller, history, events, names, commit, initial } = setup();
    const link: Link = { source: 'docs', target: 'build', type: 'SS' };
    await controller.createLink(link);
    await commit(MOVE);
    expect(history.undo().status).toBe('undone');
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(initial));

    events.length = 0;
    expect(history.undo()).toEqual({
      status: 'undone',
      entry: { type: 'linkCreate', id: 'docs:SS:build', link },
    });
    expect(names()).toEqual(['historyChange', 'linkDelete']);
    expect(store.getSnapshot().links).toEqual(LINKS);
    expect(history.undo()).toEqual({ status: 'empty' });

    events.length = 0;
    expect(history.redo().status).toBe('redone');
    expect(names()).toEqual(['historyChange', 'linkCreate']);
    expect(store.getSnapshot().links).toEqual([...LINKS, link]);
    expect(store.getSnapshot().links![1]).toBe(link);
    expect(history.redo().status).toBe('redone');
    expect(valuesOf(store.getSnapshot(), 'design')?.start).toBe(at('2026-03-09'));
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
  });

  it('FR-TX-5: undoing a link delete creates it again: the caller’s link, or an equal one', async () => {
    const { store, controller, history } = setup();
    await controller.deleteLink('design:FS:build');
    expect(store.getSnapshot().links).toEqual([]);
    expect(history.undo()).toMatchObject({ status: 'undone', entry: { type: 'linkDelete' } });
    expect(store.getSnapshot().links![0]).toBe(LINKS[0]);

    // A link of the shorthand comes back in `links`.
    await controller.deleteLink('build:FS:review');
    expect(store.getSnapshot().derived.graph.linkById.has('build:FS:review')).toBe(false);
    expect(history.undo().status).toBe('undone');
    const state = store.getSnapshot();
    expect(state.links).toEqual([
      LINKS[0],
      { source: 'build', target: 'review', type: 'FS', editable: true },
    ]);
    expect(state.derived.graph.linkById.get('build:FS:review')?.type).toBe('FS');
    expect(history.redo().status).toBe('redone');
    expect(store.getSnapshot().links).toEqual(LINKS);
  });

  it('FR-TX-5: a shorthand link with a lag is created again with that lag', async () => {
    const tasks = TASKS.map((task) =>
      task.id === 'review' ? { ...task, dependencies: [{ id: 'build', lag: '1d' }] } : task,
    );
    const store = createStore({ tasks, links: LINKS });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const history = createChangeHistory({ store, controller, emitter, enabled: true });
    const lag = store.getSnapshot().derived.model.linkById.get('build:FS:review')?.lag;
    await controller.deleteLink('build:FS:review');
    history.undo();
    expect(store.getSnapshot().links?.[1]).toMatchObject({ lag: '1d' });
    expect(store.getSnapshot().derived.model.linkById.get('build:FS:review')?.lag).toBe(lag);
  });

  it('FR-TX-5: a shorthand link with a lead or a sub-day lag comes back with exactly that lag', async () => {
    // Leads can only be written as a signed number of days: -1 day, and -6 hours.
    const tasks = TASKS.map((task) => {
      if (task.id === 'review') return { ...task, dependencies: [{ id: 'build', lag: -1 }] };
      if (task.id === 'docs') {
        return { ...task, dependencies: [{ id: 'design', type: 'SS' as const, lag: -0.25 }] };
      }
      return task;
    });
    const store = createStore({
      tasks,
      links: LINKS,
      options: { scheduling: { granularity: '1h' } },
    });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const history = createChangeHistory({ store, controller, emitter, enabled: true });
    const { model } = store.getSnapshot().derived;
    const lead = model.linkById.get('build:FS:review')!;
    const short = model.linkById.get('design:SS:docs')!;
    expect([lead.lag, short.lag]).toEqual([-DAY, -DAY / 4]);
    expect(model.issues).toEqual([]);

    for (const { id, lag } of [lead, short]) {
      expect((await controller.deleteLink(id)).status).toBe('deleted');
      expect(history.undo().status).toBe('undone');
      const state = store.getSnapshot();
      const restored = state.derived.model.linkById.get(id);
      expect(restored?.lag).toBe(lag);
      expect(restored?.issues).toEqual([]);
      expect(state.derived.model.issues.filter((issue) => issue.linkId === id)).toEqual([]);
      // Redo and undo again: the same link each time.
      expect(history.redo().status).toBe('redone');
      expect(history.undo().status).toBe('undone');
      expect(store.getSnapshot().derived.model.linkById.get(id)?.lag).toBe(lag);
    }
    expect(store.getSnapshot().links?.slice(1)).toMatchObject([
      { source: 'build', target: 'review', type: 'FS', lag: -1 },
      { source: 'design', target: 'docs', type: 'SS', lag: -0.25 },
    ]);
  });

  it('FR-TX-5: a new action clears the redo entries', async () => {
    const { history, commit, flags } = setup();
    await commit(MOVE);
    history.undo();
    expect(history.canRedo).toBe(true);
    await commit(DOCS);
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
    // historyChange only when a flag flips.
    expect(flags()).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: false },
    ]);
  });

  it('FR-TX-5: an action started by a listener of a step is recorded after it', async () => {
    const { store, controller, emitter, history, commit } = setup();
    await commit(MOVE);
    const off = emitter.on('tasksChange', ({ reason }) => {
      if (reason === 'undo') controller.apply(changeSetOn(store, DOCS));
    });
    expect(history.undo().status).toBe('undone');
    off();
    // The listener's change is the newest entry and cleared the redo entries.
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
    expect(history.undo().status).toBe('undone');
    expect(history.undo()).toEqual({ status: 'empty' });
  });
});

describe('createChangeHistory: safety', () => {
  it('FR-TX-5: uncontrolled data replaced from outside clears the history; options that keep the model do not', async () => {
    const { controller, history, commit } = setup();
    await commit(MOVE);
    controller.update({ type: 'setOptions', options: { scheduling: { propagation: 'none' } } });
    expect(history.canUndo).toBe(true);
    controller.update({ type: 'setTasks', tasks: [...TASKS] });
    expect(history.canUndo).toBe(false);
  });

  it('FR-TX-5: an entry whose result is no longer in the data is stale: the history is cleared', async () => {
    const { store, history, commit, flags } = setup();
    await commit(MOVE);
    await commit(DOCS);
    // Bypassing the controller: nothing tells the history.
    store.dispatch({ type: 'setTasks', tasks: TASKS });
    expect(history.canUndo).toBe(true);
    const result = history.undo();
    expect(result).toMatchObject({ status: 'stale', entry: { type: 'tasks' } });
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(flags().at(-1)).toEqual({ canUndo: false, canRedo: false });
  });

  it('FR-TX-5: a link entry is stale when the link is not where the entry left it', async () => {
    const { store, controller, history } = setup();
    await controller.createLink({ source: 'docs', target: 'build' });
    store.dispatch({ type: 'setLinks', links: LINKS });
    expect(history.undo().status).toBe('stale');
    await controller.deleteLink('design:FS:build');
    history.undo();
    // Redo of the delete: the link must still be there.
    store.dispatch({ type: 'setLinks', links: [] });
    expect(history.redo().status).toBe('stale');
  });

  it('FR-TX-5: an entry the controller cannot apply clears the history', async () => {
    const { store, history, commit } = setup();
    await commit(DOCS);
    // Docs is locked now, with the same dates: re-validation drops the undo.
    const tasks = store
      .getSnapshot()
      .tasks.map((task) => (task.id === 'docs' ? { ...task, locked: true } : task));
    store.dispatch({ type: 'setTasks', tasks });
    expect(history.undo()).toMatchObject({ status: 'stale' });
    expect(history.canUndo).toBe(false);
  });

  it('FR-TX-5, FR-TX-3: controlled: steps wait for the owner and emit the inverse', async () => {
    const { store, controller, emitter, history, commit, initial } = setup(
      { enabled: true },
      { dataMode: 'controlled' },
    );
    const owner = createOwner(store, controller, emitter);
    await commit(MOVE);
    // The owner has not applied the change yet.
    expect(history.undo()).toEqual({ status: 'busy' });
    owner.flush();
    const moved = store.getSnapshot();
    expect(history.undo().status).toBe('undone');
    expect(store.getSnapshot().draft?.committed).toBe(true);
    expect(history.redo()).toEqual({ status: 'busy' });
    owner.flush();
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(initial));
    expect(history.redo().status).toBe('redone');
    owner.flush();
    expect(valuesAll(store.getSnapshot())).toEqual(valuesAll(moved));
    // The owner's data is how changes arrive: the history stays.
    expect(history.canUndo).toBe(true);

    // The owner rejects a change: its entry no longer matches the data.
    await commit(DOCS);
    owner.reject();
    expect(history.canUndo).toBe(true);
    expect(history.undo().status).toBe('stale');
  });

  it('FR-TX-5: steps are busy while a hook is awaited and cancelled after dispose', async () => {
    const { controller, history, commit } = setup();
    await commit(MOVE);
    const answer = deferred<undefined>();
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const pending = commit(DOCS);
    expect(history.undo()).toEqual({ status: 'busy' });
    answer.resolve(undefined);
    await pending;
    history.dispose();
    history.dispose();
    expect(history.undo()).toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(history.redo()).toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(history.canUndo).toBe(false);
    history.configure({ enabled: true });
    history.clear();
    history.restore({ undo: [], redo: [] });
    expect(history.canUndo).toBe(false);
  });

  it('FR-TX-5: a disposed controller cancels a step; listener errors keep the stacks in step', async () => {
    const { store, emitter, controller, history, commit } = setup();
    await commit(MOVE);
    await commit(DOCS);
    const boom = new Error('boom');
    // No `error` listener in this setup: the error reaches the caller, after the step.
    const off = emitter.on('tasksChange', () => {
      throw boom;
    });
    expect(() => history.undo()).toThrow(boom);
    off();
    expect([history.canUndo, history.canRedo]).toEqual([true, true]);
    expect(valuesOf(store.getSnapshot(), 'docs')?.start).toBe(at('2026-03-02'));
    controller.dispose();
    expect(history.undo()).toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(history.canUndo).toBe(true);
  });
});

describe('createChangeHistory: checkpoints', () => {
  it('FR-TX-5: restore puts back the stacks within the limit; a disabled history stays empty', async () => {
    const { history, commit } = setup({ enabled: true, limit: 3 });
    await commit(MOVE);
    await commit(DOCS);
    history.undo();
    const checkpoint = history.checkpoint();
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect([checkpoint.undo.length, checkpoint.redo.length]).toEqual([1, 1]);
    history.clear();
    expect(history.canUndo).toBe(false);
    history.configure({ limit: 1 });
    history.restore(checkpoint);
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
    history.configure({ enabled: false });
    history.restore(checkpoint);
    expect(history.canUndo).toBe(false);
  });
});

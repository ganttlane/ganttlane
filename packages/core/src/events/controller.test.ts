import { deepFreeze, workingDayScenarios } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Link, Task } from '../model';
import {
  type ChangeSet,
  type NonWorkingDayConflict,
  propagate,
  type PropagationCommand,
  type PropagationOptions,
} from '../schedule';
import { createStore, type Store, type StoreOptions } from '../store';
import { asDateTimeMs, type DateTimeMs, DAY, parseDateInput, toISODate } from '../time';
import {
  type BeforeTaskChangeContext,
  type CommitResult,
  type ControllerOperation,
  type CoreEventName,
  type CoreEvents,
  createChangeController,
  createEmitter,
  createHooks,
  type Emitter,
  type LinkCreatePayload,
  type LinkDeletePayload,
} from './index';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(`bad test date ${iso}`);
  return parsed.value.value;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 2026-03-02 is a Monday.
const TASKS: readonly Task[] = deepFreeze([
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 50 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'review', name: 'Review', start: '2026-03-16', duration: 2, dependencies: ['build'] },
  { id: 'frozen', name: 'Frozen', start: '2026-03-02', end: '2026-03-03', locked: true },
  { id: 'stub', name: 'Stub', type: 'placeholder' },
]);
const LINKS: readonly Link[] = deepFreeze([{ source: 'design', target: 'build' }]);

/** Design a week later: build and review follow through their links. */
const MOVE: PropagationCommand = { kind: 'move', id: 'design', start: at('2026-03-09') };

type Logged = { [K in CoreEventName]: readonly [K, CoreEvents[K]] }[CoreEventName];

const CONTROLLER_EVENTS: readonly CoreEventName[] = [
  'issues',
  'tasksChange',
  'taskDatesChange',
  'taskProgressChange',
  'linkCreate',
  'linkDelete',
  'error',
];

function setup(options: StoreOptions = {}, tasks: readonly Task[] = TASKS) {
  const store = createStore({
    tasks,
    links: LINKS,
    options: { calendar: { weekends: [0, 6] }, ...options },
  });
  const emitter = createEmitter<CoreEvents>();
  const controller = createChangeController({ store, emitter });
  const events: Logged[] = [];
  for (const name of CONTROLLER_EVENTS) {
    emitter.on(name, (payload) => events.push([name, payload] as unknown as Logged));
  }
  return {
    store,
    emitter,
    controller,
    events,
    names: (): CoreEventName[] => events.map(([name]) => name),
    changeSetOf: (command: PropagationCommand, extra?: PropagationOptions): ChangeSet =>
      changeSetOn(store, command, extra),
  };
}

/** A change set computed on the store's model, as the interaction layer will (plan step 3.7). */
function changeSetOn(
  store: Store,
  command: PropagationCommand,
  extra?: PropagationOptions,
): ChangeSet {
  const { derived, settings } = store.getSnapshot();
  const { model, hierarchy, graph } = derived;
  return propagate(command, {
    model,
    hierarchy,
    graph,
    options: { ...settings.propagation, ...extra },
  });
}

/** Lets pending promise reactions run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('createChangeController: commit', () => {
  it('FR-TX-1, FR-TX-3: commits uncontrolled data with exactly one tasksChange and per-task events', async () => {
    const { store, controller, events, names, changeSetOf } = setup();
    const changeSet = changeSetOf(MOVE);
    expect(changeSet.changes.map((change) => change.id)).toEqual(['design', 'build', 'review']);
    expect(controller.preview(changeSet)).toBe(true);
    expect(store.getSnapshot().draft?.changeSet).toBe(changeSet);

    const result = await controller.commit(changeSet);
    expectTypeOf(result).toEqualTypeOf<CommitResult>();
    expect(result).toEqual({ status: 'committed', changeSet, issues: [] });
    expect(result.status === 'committed' && result.changeSet).toBe(changeSet);
    const state = store.getSnapshot();
    expect(state.draft).toBeUndefined();
    expect(state.tasks.slice(0, 3)).toEqual([
      { ...TASKS[0], start: '2026-03-09', end: '2026-03-13' },
      { ...TASKS[1], start: '2026-03-16', end: '2026-03-20' },
      { ...TASKS[2], start: '2026-03-23' },
    ]);
    expect(names()).toEqual([
      'tasksChange',
      'taskDatesChange',
      'taskDatesChange',
      'taskDatesChange',
    ]);
    expect(events[0]).toEqual(['tasksChange', changeSet]);
    expect(events[1]).toEqual([
      'taskDatesChange',
      { id: 'design', start: at('2026-03-09'), endExclusive: at('2026-03-14') },
    ]);
    expect(Object.isFrozen(events[1]![1])).toBe(true);
    expect(controller.pending).toBe(false);
  });

  it('FR-TX-1, FR-PROG-2: emits taskProgressChange for changes of progress', async () => {
    const { controller, events, changeSetOf } = setup();
    // Design grows from 5 to 9 days and keeps its done part: 2.5 of 9 days.
    const changeSet = changeSetOf({
      kind: 'resize-end',
      id: 'design',
      endExclusive: at('2026-03-11'),
    });
    await controller.commit(changeSet);
    const progress = events.filter(([name]) => name === 'taskProgressChange');
    expect(progress).toEqual([
      ['taskProgressChange', { id: 'design', progress: changeSet.changes[0]!.after.progress }],
    ]);
    expect(changeSet.changes[0]!.after.progress).toBeCloseTo((2.5 / 9) * 100);
    expect(events.map(([name, payload]) => [name, (payload as { id?: unknown }).id])).toEqual([
      ['tasksChange', undefined],
      ['taskDatesChange', 'design'],
      ['taskProgressChange', 'design'],
      ['taskDatesChange', 'build'],
      ['taskDatesChange', 'review'],
    ]);
  });

  it('FR-TX-3: in controlled mode the tasks stay and the change set stays as the draft', async () => {
    const { store, controller, names, changeSetOf } = setup({ dataMode: 'controlled' });
    const changeSet = changeSetOf(MOVE);
    const result = await controller.commit(changeSet);
    expect(result.status).toBe('committed');
    const state = store.getSnapshot();
    expect(state.tasks).toBe(TASKS);
    expect(state.draft?.changeSet).toBe(changeSet);
    expect(names()[0]).toBe('tasksChange');
    // The owner answers with new tasks: the draft goes.
    store.dispatch({ type: 'setTasks', tasks: [...TASKS] });
    expect(store.getSnapshot().draft).toBeUndefined();
  });

  it('FR-TX-3: controlled, a change the owner has not applied stays under previews; changes wait for it', async () => {
    const { store, controller, events, changeSetOf } = setup({ dataMode: 'controlled' });
    const changeSet = changeSetOf(MOVE);
    expect((await controller.commit(changeSet)).status).toBe('committed');
    events.length = 0;
    const hook = vi.fn();
    controller.hooks.add('beforeTaskChange', hook);
    controller.hooks.add('beforeLinkCreate', hook);

    // A preview lies over the committed change; cancelling it brings the committed change back.
    const other = changeSetOf({ kind: 'move', id: 'design', start: at('2026-03-16') });
    expect(controller.preview(other)).toBe(true);
    expect(store.getSnapshot().draft).toMatchObject({ changeSet: other, committed: true });
    expect(controller.cancelPreview()).toBe(true);
    expect(store.getSnapshot().draft).toMatchObject({ changeSet, committed: true });
    expect(controller.pending).toBe(false);

    // Every change set would be computed on the owner's old data: busy until the owner answers.
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    expect(await controller.commit(other)).toEqual({ status: 'busy' });
    expect(controller.apply(other)).toEqual({ status: 'busy' });
    expect(await controller.createLink(link)).toEqual({ status: 'busy' });
    expect(controller.applyLinkCreate(link)).toEqual({ status: 'busy' });
    expect(await controller.deleteLink('design:FS:build')).toEqual({ status: 'busy' });
    expect(controller.applyLinkDelete('design:FS:build')).toEqual({ status: 'busy' });
    expect(store.getSnapshot().draft).toMatchObject({ changeSet, committed: true });
    expect(hook).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    // The owner answers (here: rejects it): the next change goes through.
    controller.update({ type: 'setTasks', tasks: TASKS });
    expect(store.getSnapshot().draft).toBeUndefined();
    expect((await controller.commit(changeSetOf(MOVE))).status).toBe('committed');
  });

  it('FR-EDIT-4, FR-EDIT-5: previews and cancels a preview', () => {
    const { store, controller, events, changeSetOf } = setup();
    const changeSet = changeSetOf(MOVE);
    expect(controller.preview(changeSet)).toBe(true);
    expect(store.getSnapshot().draft?.changeSet).toBe(changeSet);
    expect(controller.cancelPreview()).toBe(true);
    expect(store.getSnapshot().draft).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('FR-TX-1: an empty change set commits nothing and clears the preview', async () => {
    const { store, controller, events, changeSetOf } = setup();
    controller.preview(changeSetOf(MOVE));
    const hook = vi.fn();
    controller.hooks.add('beforeTaskChange', hook);
    const result = await controller.commit({ reason: 'api', changes: [], conflicts: [] });
    expect(result).toEqual({ status: 'unchanged', issues: [] });
    expect(store.getSnapshot().draft).toBeUndefined();
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(hook).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('FR-TX-1: a commit without async hooks happens synchronously inside the call', async () => {
    const { store, controller, names, changeSetOf } = setup();
    controller.hooks.add('beforeTaskChange', () => true);
    const promise = controller.commit(changeSetOf(MOVE));
    expect(store.getSnapshot().tasks).not.toBe(TASKS);
    expect(names()[0]).toBe('tasksChange');
    expect(controller.pending).toBe(false);
    expect((await promise).status).toBe('committed');
  });

  it('FR-SNAP-13, FR-TX-2: re-validates the change set given to commit', async () => {
    const { store, controller, events, changeSetOf } = setup();
    const valid = changeSetOf(MOVE);
    const [design] = valid.changes;
    const frozenChange = {
      ...design!,
      id: 'frozen',
      before: { start: at('2026-03-02'), endExclusive: at('2026-03-04'), progress: 0 },
      after: { start: at('2026-03-09'), endExclusive: at('2026-03-11'), progress: 0 },
    };
    const result = await controller.commit({ ...valid, changes: [...valid.changes, frozenChange] });
    expect(result.status).toBe('committed');
    expect(result.status === 'committed' && result.changeSet).toEqual(valid);
    expect(events[0]).toMatchObject([
      'issues',
      { source: 'change-set', issues: [{ code: 'locked-task', taskId: 'frozen' }] },
    ]);
    expect(store.getSnapshot().tasks[3]).toBe(TASKS[3]);

    // Only a change of the locked task: nothing is left, the issue is still reported.
    events.length = 0;
    const onlyLocked = await controller.commit({ ...valid, changes: [frozenChange] });
    expect(onlyLocked).toMatchObject({ status: 'unchanged', issues: [{ code: 'locked-task' }] });
    expect(events.map(([name]) => name)).toEqual(['issues']);
  });

  it('FR-SNAP-13, FR-TX-2: issues of a cancelled commit are reported too', async () => {
    const { controller, events, changeSetOf } = setup();
    controller.hooks.add('beforeTaskChange', () => false);
    const valid = changeSetOf(MOVE);
    const ghost = { ...valid.changes[0]!, id: 'ghost' };
    const result = await controller.commit({ ...valid, changes: [...valid.changes, ghost] });
    expect(result).toEqual({ status: 'cancelled', reason: 'hook' });
    expect(events).toMatchObject([
      ['issues', { source: 'change-set', issues: [{ code: 'unknown-task', taskId: 'ghost' }] }],
    ]);
  });
});

describe('createChangeController: before-hooks', () => {
  it('FR-TX-2: hooks answering nothing or true let the change set pass', async () => {
    const { controller, changeSetOf } = setup();
    const contexts: BeforeTaskChangeContext[] = [];
    controller.hooks.add('beforeTaskChange', (context) => {
      contexts.push(context);
    });
    controller.hooks.add('beforeTaskChange', () => true);
    const changeSet = changeSetOf(MOVE);
    expect(await controller.commit(changeSet)).toMatchObject({ status: 'committed', changeSet });
    expect(contexts).toEqual([{ changeSet, reason: 'move', conflicts: changeSet.conflicts }]);
    expect(Object.isFrozen(contexts[0])).toBe(true);
  });

  it('FR-TX-2: false cancels: the draft is cleared, nothing is committed or emitted', async () => {
    const { store, controller, events, changeSetOf } = setup();
    const later = vi.fn();
    controller.hooks.add('beforeTaskChange', () => false);
    controller.hooks.add('beforeTaskChange', later);
    const changeSet = changeSetOf(MOVE);
    controller.preview(changeSet);
    expect(await controller.commit(changeSet)).toEqual({ status: 'cancelled', reason: 'hook' });
    expect(store.getSnapshot().draft).toBeUndefined();
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(later).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('FR-TX-2: a returned ChangeSet replaces the one being committed', async () => {
    const { store, controller, events, changeSetOf } = setup();
    const replacement = changeSetOf({ kind: 'move', id: 'build', start: at('2026-03-10') });
    controller.hooks.add('beforeTaskChange', () => replacement);
    const result = await controller.commit(changeSetOf(MOVE));
    expect(result).toEqual({ status: 'committed', changeSet: replacement, issues: [] });
    expect(events[0]).toEqual(['tasksChange', replacement]);
    expect(store.getSnapshot().tasks[0]).toBe(TASKS[0]);
    expect(store.getSnapshot().tasks[1]).toEqual({
      ...TASKS[1],
      start: '2026-03-10',
      end: '2026-03-14',
    });
  });

  it('FR-TX-2: a replacement without a reason keeps the reason of the change set it replaces', async () => {
    const { controller, events, changeSetOf } = setup();
    const replacement = changeSetOf({ kind: 'move', id: 'build', start: at('2026-03-10') });
    const { reason: _reason, ...withoutReason } = replacement;
    controller.hooks.add('beforeTaskChange', () => withoutReason as ChangeSet);
    const result = await controller.commit(changeSetOf(MOVE));
    expect(result).toMatchObject({ status: 'committed', changeSet: { reason: 'move' } });
    expect(result.status === 'committed' && result.changeSet.changes).toEqual(replacement.changes);
    expect(events[0]).toMatchObject(['tasksChange', { reason: 'move' }]);
  });

  it('FR-TX-2: an async hook keeps the commit pending and shows the change set as the draft', async () => {
    const { store, controller, events, changeSetOf } = setup();
    const answer = deferred<boolean | undefined>();
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const changeSet = changeSetOf(MOVE);
    const pending = controller.commit(changeSet);
    expect(controller.pending).toBe(true);
    expect(store.getSnapshot().draft?.changeSet).toBe(changeSet);
    expect(store.getSnapshot().tasks).toBe(TASKS);
    await flush();
    expect(events).toEqual([]);
    answer.resolve(true);
    expect(await pending).toMatchObject({ status: 'committed', changeSet });
    expect(controller.pending).toBe(false);
    expect(store.getSnapshot().draft).toBeUndefined();
  });

  it('FR-TX-2: several hooks run in registration order, each seeing the previous result', async () => {
    const { controller, changeSetOf } = setup();
    const order: string[] = [];
    const seen: ChangeSet[] = [];
    const replacement = changeSetOf({ kind: 'move', id: 'build', start: at('2026-03-10') });
    controller.hooks.add('beforeTaskChange', async ({ changeSet }) => {
      seen.push(changeSet);
      await Promise.resolve();
      order.push('a');
    });
    controller.hooks.add('beforeTaskChange', ({ changeSet }) => {
      seen.push(changeSet);
      order.push('b');
      return replacement;
    });
    controller.hooks.add('beforeTaskChange', async ({ changeSet }) => {
      seen.push(changeSet);
      await Promise.resolve();
      order.push('c');
      return true;
    });
    const original = changeSetOf(MOVE);
    const result = await controller.commit(original);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([original, original, replacement]);
    expect(result).toMatchObject({ status: 'committed', changeSet: replacement });
  });

  it.each<[string, () => unknown, (error: unknown) => void]>([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
      (error) => expect(error).toEqual(new Error('boom')),
    ],
    [
      'rejects',
      () => Promise.reject(new Error('boom')),
      (error) => expect(error).toEqual(new Error('boom')),
    ],
    [
      'answers something else',
      () => 42,
      (error) =>
        expect(error).toEqual(
          new TypeError(
            'a beforeTaskChange hook answered number, expected a boolean, a ChangeSet or nothing',
          ),
        ),
    ],
  ])('FR-TX-2, FR-EVT-1: a hook that %s cancels and reports the error', async (_, hook, check) => {
    const { store, controller, events, changeSetOf } = setup();
    const later = vi.fn();
    controller.hooks.add('beforeTaskChange', hook as () => undefined);
    controller.hooks.add('beforeTaskChange', later);
    const changeSet = changeSetOf(MOVE);
    controller.preview(changeSet);
    const result = await controller.commit(changeSet);
    expect(result).toMatchObject({ status: 'cancelled', reason: 'error' });
    const { error } = result as { readonly error: unknown };
    check(error);
    expect(events).toEqual([['error', { error, source: 'hook', name: 'beforeTaskChange' }]]);
    expect(store.getSnapshot().draft).toBeUndefined();
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(later).not.toHaveBeenCalled();
  });

  it('FR-SNAP-13, FR-SCH-6: a modified change set is re-aligned, reported and gets its conflicts', async () => {
    const tasks: readonly Task[] = deepFreeze([
      { id: 'meet', name: 'Meeting', start: '2026-03-05T09:00', end: '2026-03-05T11:00' },
    ]);
    const { store, controller, events, changeSetOf } = setup(
      { scheduling: { granularity: '1h' } },
      tasks,
    );
    const seen: BeforeTaskChangeContext[] = [];
    // The hook moves the meeting to Saturday 10:30 and copies the conflicts of the original.
    controller.hooks.add('beforeTaskChange', ({ changeSet }) => ({
      ...changeSet,
      changes: changeSet.changes.map((change) => ({
        ...change,
        after: {
          ...change.after,
          start: at('2026-03-07T10:30'),
          endExclusive: at('2026-03-07T12:30'),
        },
      })),
    }));
    controller.hooks.add('beforeTaskChange', (context) => {
      seen.push(context);
    });
    const dragged = changeSetOf({ kind: 'move', id: 'meet', start: at('2026-03-06T09:00') });
    expect(dragged.conflicts).toEqual([]);
    const result = await controller.commit(dragged);
    if (result.status !== 'committed') throw new Error(`not committed: ${result.status}`);
    const { changeSet } = result;
    expect(changeSet.changes[0]?.after).toEqual({
      start: at('2026-03-07T10:00'),
      endExclusive: at('2026-03-07T13:00'),
      progress: 0,
    });
    expect(changeSet.conflicts.map((conflict) => conflict.type)).toEqual([
      'non-working-start',
      'non-working-end',
    ]);
    // The next hook already saw the aligned change set and its conflicts.
    expect(seen[0]?.changeSet).toBe(changeSet);
    expect(seen[0]?.conflicts).toBe(changeSet.conflicts);
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['misaligned', 'changes[0].after.start'],
      ['misaligned', 'changes[0].after.endExclusive'],
    ]);
    expect(events.map(([name]) => name)).toEqual(['issues', 'tasksChange', 'taskDatesChange']);
    expect(events[0]).toEqual(['issues', { source: 'change-set', issues: result.issues }]);
    expect(store.getSnapshot().tasks[0]).toEqual({
      ...tasks[0],
      start: '2026-03-07T10:00',
      end: '2026-03-07T13:00',
    });
  });

  it('FR-TX-2: a change set is re-validated against the store as it is after an async hook', async () => {
    const { store, controller, changeSetOf } = setup();
    const answer = deferred<undefined>();
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const pending = controller.commit(changeSetOf(MOVE));
    // Meanwhile the owner removes 'review'.
    store.dispatch({ type: 'setTasks', tasks: TASKS.filter((task) => task.id !== 'review') });
    answer.resolve(undefined);
    const result = await pending;
    if (result.status !== 'committed') throw new Error(`not committed: ${result.status}`);
    expect(result.changeSet.changes.map((change) => change.id)).toEqual(['design', 'build']);
    expect(result.issues.map((issue) => [issue.code, issue.taskId])).toEqual([
      ['unknown-task', 'review'],
    ]);
  });

  it.each(['accept', 'ignore'] as const)(
    'FR-SCH-7 (d)/(e): start dragged onto Saturday, the non-working-day prompt answered "%s"',
    async (answer) => {
      const scenario = workingDayScenarios.find(
        (candidate) =>
          candidate.action.kind === 'resize-start' && candidate.action.onConflict === answer,
      )!;
      const { given, action, expected } = scenario;
      const scheduling = given.options?.scheduling;
      const store = createStore({
        tasks: [given.task],
        options: {
          calendar: given.calendar,
          scheduling: {
            durationMode: scheduling?.durationMode,
            skipNonWorkingDays: scheduling?.skipNonWorkingDays,
          },
        },
      });
      const emitter = createEmitter<CoreEvents>();
      const command: PropagationCommand = {
        kind: 'resize-start',
        id: given.task.id,
        start: at(action.to),
      };
      const prompts: string[] = [];
      const controller = createChangeController({
        store,
        emitter,
        handlers: {
          // The app's dialog: "the start lands on a non-working day — move it or keep it?"
          onBeforeTaskChange: async ({ conflicts }) => {
            const conflict = conflicts.find(
              (candidate): candidate is NonWorkingDayConflict =>
                candidate.type === 'non-working-start',
            );
            if (conflict === undefined) return;
            prompts.push(toISODate(conflict.date));
            await Promise.resolve();
            return answer === 'accept'
              ? changeSetOn(store, command, { skipNonWorkingDays: { resize: true } })
              : true;
          },
        },
      });
      const committed: ChangeSet[] = [];
      emitter.on('tasksChange', (changeSet) => committed.push(changeSet));

      const dragged = changeSetOn(store, command);
      expect(toISODate(dragged.changes[0]!.after.start)).toBe('2026-04-11');
      const result = await controller.commit(dragged);
      expect(result.status).toBe('committed');
      expect(prompts).toEqual(['2026-04-11']);
      expect(committed).toHaveLength(1);
      const [change] = committed[0]!.changes;
      expect(toISODate(change!.after.start)).toBe(expected.start);
      expect(toISODate(asDateTimeMs(change!.after.endExclusive - DAY))).toBe(expected.end);
      expect(committed[0]!.conflicts.map((conflict) => conflict.type)).toEqual(
        answer === 'accept' ? [] : ['non-working-start'],
      );
      expect(store.getSnapshot().tasks[0]).toEqual({ ...given.task, start: expected.start });
    },
  );
});

describe('createChangeController: one operation at a time', () => {
  it('FR-TX-2: while a commit awaits a hook, other operations are busy and previews refused', async () => {
    const { controller, changeSetOf } = setup();
    const answer = deferred<boolean>();
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const changeSet = changeSetOf(MOVE);
    const pending = controller.commit(changeSet);
    expect(controller.pending).toBe(true);
    expect(await controller.commit(changeSet)).toEqual({ status: 'busy' });
    expect(await controller.createLink({ source: 'build', target: 'design', type: 'SS' })).toEqual({
      status: 'busy',
    });
    expect(await controller.deleteLink('design:FS:build')).toEqual({ status: 'busy' });
    expect(controller.preview(changeSet)).toBe(false);
    expect(controller.cancelPreview()).toBe(false);
    answer.resolve(false);
    expect(await pending).toEqual({ status: 'cancelled', reason: 'hook' });
    expect(controller.pending).toBe(false);
    expect(controller.preview(changeSet)).toBe(true);
  });

  it('FR-TX-1: after-event listeners may start the next commit', async () => {
    const { store, emitter, controller, changeSetOf } = setup();
    const results: Promise<CommitResult>[] = [];
    const off = emitter.on('tasksChange', () => {
      off();
      results.push(
        controller.commit(
          changeSetOn(store, { kind: 'move', id: 'build', start: at('2026-03-30') }),
        ),
      );
    });
    await controller.commit(changeSetOf(MOVE));
    expect(results).toHaveLength(1);
    expect((await results[0])?.status).toBe('committed');
    expect(store.getSnapshot().tasks[1]).toMatchObject({ start: '2026-03-30' });
  });

  it('FR-TX-1, FR-EVT-1: an operation started by a listener emits its events after those of the running one', async () => {
    const { store, emitter, controller, events } = setup();
    let nested: unknown;
    const off = emitter.on('tasksChange', () => {
      off();
      const later = changeSetOn(store, { kind: 'move', id: 'review', start: at('2026-03-30') });
      nested = controller.apply(later);
      controller.applyLinkCreate({ source: 'design', target: 'review', type: 'SS' });
    });
    expect((await controller.commit(changeSetOn(store, MOVE))).status).toBe('committed');
    expect(nested).toMatchObject({ status: 'committed' });
    const what = (payload: object): unknown =>
      (payload as { readonly id?: unknown }).id ??
      (payload as { readonly reason?: unknown }).reason;
    expect(events.map(([name, payload]) => [name, what(payload)])).toEqual([
      ['tasksChange', 'move'],
      ['taskDatesChange', 'design'],
      ['taskDatesChange', 'build'],
      ['taskDatesChange', 'review'],
      ['tasksChange', 'move'],
      ['taskDatesChange', 'review'],
      ['linkCreate', 'design:SS:review'],
    ]);
  });

  it('FR-TX-2: dispose aborts a pending commit; nothing happens afterwards', async () => {
    const { store, emitter, controller, events, changeSetOf } = setup();
    const answer = deferred<boolean>();
    const onTasksChange = vi.fn();
    controller.setHandlers({ onTasksChange });
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const changeSet = changeSetOf(MOVE);
    const pending = controller.commit(changeSet);
    controller.dispose();
    controller.dispose();
    expect(await pending).toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(controller.pending).toBe(false);
    answer.resolve(true);
    await flush();
    expect(events).toEqual([]);
    expect(store.getSnapshot().tasks).toBe(TASKS);
    // The store is left as it is, with the draft shown while the hook was awaited.
    expect(store.getSnapshot().draft?.changeSet).toBe(changeSet);
    const disposed = { status: 'cancelled', reason: 'disposed' };
    expect(await controller.commit(changeSet)).toEqual(disposed);
    expect(await controller.createLink({ source: 'build', target: 'design', type: 'SS' })).toEqual(
      disposed,
    );
    expect(await controller.deleteLink('design:FS:build')).toEqual(disposed);
    expect(controller.preview(changeSet)).toBe(false);
    expect(controller.cancelPreview()).toBe(false);
    // The option-style handlers are gone; listeners added with `on` are the emitter's.
    controller.setHandlers({ onTasksChange });
    emitter.emit('tasksChange', changeSet);
    expect(onTasksChange).not.toHaveBeenCalled();
    expect(events).toEqual([['tasksChange', changeSet]]);
  });

  it('FR-TX-2: a hook that disposes the controller cancels its commit', async () => {
    const { store, controller, events, changeSetOf } = setup();
    controller.hooks.add('beforeTaskChange', () => {
      controller.dispose();
      return true;
    });
    expect(await controller.commit(changeSetOf(MOVE))).toEqual({
      status: 'cancelled',
      reason: 'disposed',
    });
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(events).toEqual([]);
  });
});

describe('createChangeController: listener errors', () => {
  it('FR-EVT-1: a throwing listener goes to `error`; the other events still go out', async () => {
    const { emitter, controller, names, events, changeSetOf } = setup();
    const boom = new Error('boom');
    emitter.on('tasksChange', () => {
      throw boom;
    });
    expect((await controller.commit(changeSetOf(MOVE))).status).toBe('committed');
    expect(names()).toEqual([
      'tasksChange',
      'error',
      'taskDatesChange',
      'taskDatesChange',
      'taskDatesChange',
    ]);
    expect(events[1]).toEqual(['error', { error: boom, source: 'listener', name: 'tasksChange' }]);
  });

  it('FR-EVT-1, FR-TX-3: a throwing store listener stops neither the observers nor the events', async () => {
    const { store, controller, names, changeSetOf } = setup();
    const boom = new Error('boom');
    const observed = vi.fn();
    controller.observe(observed);
    const off = store.subscribe(() => {
      throw boom;
    });
    await expect(controller.commit(changeSetOf(MOVE))).rejects.toBe(boom);
    expect(observed).toHaveBeenCalledOnce();
    expect(names()).toEqual([
      'tasksChange',
      'taskDatesChange',
      'taskDatesChange',
      'taskDatesChange',
    ]);
    expect(() => controller.applyLinkDelete('design:FS:build')).toThrow(boom);
    expect(names().at(-1)).toBe('linkDelete');
    off();
  });

  it('FR-EVT-1: without an `error` listener the commit rejects, after the change was applied', async () => {
    const store = createStore({ tasks: TASKS, links: LINKS });
    const emitter = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const boom = new Error('boom');
    const dates = vi.fn();
    emitter.on('tasksChange', () => {
      throw boom;
    });
    emitter.on('taskDatesChange', dates);
    await expect(controller.commit(changeSetOn(store, MOVE))).rejects.toBe(boom);
    expect(store.getSnapshot().tasks).not.toBe(TASKS);
    expect(dates).toHaveBeenCalledTimes(3);
    expect(controller.pending).toBe(false);

    const second = new Error('second');
    emitter.on('taskDatesChange', () => {
      throw second;
    });
    const result = controller.commit(changeSetOn(store, { ...MOVE, start: at('2026-03-16') }));
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    // Several errors: one AggregateError that names the operation.
    const thrown: unknown = await result.catch((error: unknown) => error);
    expect((thrown as AggregateError).errors).toEqual([boom, second, second, second]);
    expect((thrown as AggregateError).message).toBe(
      '4 event listeners or observers threw during commit()',
    );
    controller.observe(() => {
      throw second;
    });
    controller.observe(() => {
      throw second;
    });
    expect(() => {
      controller.update({ type: 'setTasks', tasks: [...TASKS] });
    }).toThrow('2 event listeners or observers threw during update()');
    // An error of a failed hook without an `error` listener is still in the result.
    controller.hooks.add('beforeTaskChange', () => {
      throw boom;
    });
    expect(await controller.commit(changeSetOn(store, MOVE))).toEqual({
      status: 'cancelled',
      reason: 'error',
      error: boom,
    });
  });
});

describe('createChangeController: links', () => {
  it('FR-LINK-6: creates a link in uncontrolled data and emits linkCreate', async () => {
    const { store, controller, events } = setup();
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    const result = await controller.createLink(link);
    expect(result).toEqual({ status: 'created', id: 'build:SS:review', link });
    expect(store.getSnapshot().links).toEqual([...LINKS, link]);
    expect(store.getSnapshot().derived.graph.linkById.has('build:SS:review')).toBe(true);
    const payload: LinkCreatePayload = { id: 'build:SS:review', link };
    expect(events).toEqual([['linkCreate', payload]]);
  });

  it('FR-LINK-6, FR-TX-3: in controlled mode only emits linkCreate', async () => {
    const { store, controller, events } = setup({ dataMode: 'controlled' });
    const link: Link = { id: 'custom', source: 'build', target: 'review', type: 'FF' };
    expect(await controller.createLink(link)).toEqual({ status: 'created', id: 'custom', link });
    expect(store.getSnapshot().links).toBe(LINKS);
    const payload: LinkCreatePayload = { id: 'custom', link };
    expect(events).toEqual([['linkCreate', payload]]);
  });

  it.each<[string, Link, string]>([
    ['an unknown task', { source: 'build', target: 'ghost' }, 'unknown-task'],
    ['the same id', { source: 'design', target: 'build' }, 'duplicate'],
    ['the same ends and type', { id: 'other', source: 'design', target: 'build' }, 'duplicate'],
    ['a link of the shorthand', { source: 'build', target: 'review', type: 'FS' }, 'duplicate'],
  ])('FR-LINK-6: rejects a link to %s without asking the hooks', async (_, link, reason) => {
    const { store, controller, events } = setup();
    const hook = vi.fn();
    controller.hooks.add('beforeLinkCreate', hook);
    expect(await controller.createLink(link)).toEqual({ status: 'rejected', reason });
    expect(hook).not.toHaveBeenCalled();
    expect(store.getSnapshot().links).toBe(LINKS);
    expect(events).toEqual([]);
  });

  it.each<[string, Link, StoreOptions, string]>([
    [
      'an unknown type',
      { source: 'design', target: 'review', type: 'XX' as 'FS' },
      {},
      'invalid-shape',
    ],
    [
      'a lag with months',
      { source: 'design', target: 'review', lag: { months: 1 } },
      {},
      'invalid-duration',
    ],
    [
      'a misaligned lag with alignInput reject',
      { source: 'design', target: 'review', type: 'SS', lag: '4h' },
      { scheduling: { alignInput: 'reject' } },
      'misaligned',
    ],
  ])(
    'FR-LINK-6, FR-DATA-11: rejects a link with %s that the model would drop',
    async (_, link, options, code) => {
      const { store, controller, events } = setup(options);
      const hook = vi.fn();
      controller.hooks.add('beforeLinkCreate', hook);
      const expected = {
        status: 'rejected',
        reason: 'invalid',
        issues: [{ code, severity: 'error' }],
      };
      expect(await controller.createLink(link)).toMatchObject(expected);
      expect(controller.applyLinkCreate(link)).toMatchObject(expected);
      const result = controller.applyLinkCreate(link);
      expect(result.status === 'rejected' && Object.isFrozen(result.issues)).toBe(true);
      expect(hook).not.toHaveBeenCalled();
      expect(store.getSnapshot().links).toBe(LINKS);
      expect(events).toEqual([]);
    },
  );

  it('FR-LINK-6: an id-less link whose default id another link took gets a free id, written into it', async () => {
    const { store, controller, events } = setup();
    // Unrelated links (other ends and type) with the default id of the new link and its first
    // alternative as their explicit ids.
    const taken: Link = { id: 'design:FS:review', source: 'frozen', target: 'review', type: 'SS' };
    const next: Link = { id: 'design:FS:review#2', source: 'frozen', target: 'build', type: 'SS' };
    expect(controller.applyLinkCreate(taken)).toMatchObject({ status: 'created' });
    expect(controller.applyLinkCreate(next)).toMatchObject({ status: 'created' });
    events.length = 0;
    const hook = vi.fn();
    controller.hooks.add('beforeLinkCreate', hook);
    const link: Link = deepFreeze({ source: 'design', target: 'review' });
    const written: Link = { ...link, id: 'design:FS:review#3' };
    expect(await controller.createLink(link)).toEqual({
      status: 'created',
      id: 'design:FS:review#3',
      link: written,
    });
    expect(hook).toHaveBeenCalledWith({
      link: written,
      id: 'design:FS:review#3',
      wouldCreateCycle: false,
    });
    expect(link).toEqual({ source: 'design', target: 'review' });
    expect(store.getSnapshot().links).toEqual([...LINKS, taken, next, written]);
    // The model keeps every link: none of them is dropped as a duplicate id.
    const { model } = store.getSnapshot().derived;
    expect(model.issues.filter((found) => found.code === 'duplicate-id')).toEqual([]);
    expect(model.linkById.get('design:FS:review')?.source).toBe('frozen');
    expect(model.linkById.get('design:FS:review#3')).toMatchObject({
      source: 'design',
      target: 'review',
      type: 'FS',
    });
    const payload: LinkCreatePayload = { id: 'design:FS:review#3', link: written };
    expect(events).toEqual([['linkCreate', payload]]);
    // The same ends and type are a duplicate whatever the id, and so is an explicit id in use.
    const duplicate = { status: 'rejected', reason: 'duplicate' };
    expect(controller.applyLinkCreate(link)).toEqual(duplicate);
    expect(
      controller.applyLinkCreate({ id: 'design:FS:review', source: 'build', target: 'frozen' }),
    ).toEqual(duplicate);
  });

  it('FR-LINK-6, FR-TX-3: a controlled owner appends the link of linkCreate, free id included', () => {
    const { store, controller, events } = setup({ dataMode: 'controlled' });
    const taken: Link = { id: 'design:FS:review', source: 'frozen', target: 'review', type: 'SS' };
    controller.update({ type: 'setLinks', links: [...LINKS, taken] });
    const result = controller.applyLinkCreate({ source: 'design', target: 'review' });
    expect(result).toMatchObject({ status: 'created', id: 'design:FS:review#2' });
    const [[, payload]] = events as [readonly ['linkCreate', LinkCreatePayload]];
    controller.update({ type: 'setLinks', links: [...LINKS, taken, payload.link] });
    expect(store.getSnapshot().derived.graph.linkById.get('design:FS:review#2')).toMatchObject({
      source: 'design',
      target: 'review',
    });
  });

  it('FR-LINK-6: the checks run on the link as the model normalizes it', () => {
    const { store, controller } = setup({
      scheduling: { defaultLinkType: 'SS', granularity: '1h' },
    });
    // The default type gives the id and the type the duplicate check compares.
    const link: Link = { source: 'design', target: 'review', lag: 0.5 };
    expect(controller.applyLinkCreate(link)).toEqual({
      status: 'created',
      id: 'design:SS:review',
      link,
    });
    expect(store.getSnapshot().derived.model.linkById.get('design:SS:review')?.lag).toBe(DAY / 2);
    const duplicate = { status: 'rejected', reason: 'duplicate' };
    expect(controller.applyLinkCreate({ ...link, lag: 1 })).toEqual(duplicate);
    expect(controller.applyLinkCreate({ ...link, id: 'other', type: 'SS' })).toEqual(duplicate);
    // A misaligned lag that the model aligns (and reports) is accepted.
    const aligned = controller.applyLinkCreate({
      source: 'frozen',
      target: 'review',
      lag: '90min',
    });
    expect(aligned).toMatchObject({ status: 'created', id: 'frozen:SS:review' });
    expect(store.getSnapshot().derived.model.linkById.get('frozen:SS:review')?.lag).toBe(
      2 * 3_600_000,
    );
  });

  it('FR-LINK-6, FR-LINK-7: a cycle is always rejected; the hooks are told', async () => {
    const { store, controller, events } = setup();
    const hook = vi.fn(() => true);
    controller.hooks.add('beforeLinkCreate', hook);
    const link: Link = { source: 'review', target: 'design' };
    expect(await controller.createLink(link)).toEqual({ status: 'rejected', reason: 'cycle' });
    expect(hook).toHaveBeenCalledWith({ link, id: 'review:FS:design', wouldCreateCycle: true });
    expect(await controller.createLink({ source: 'design', target: 'design', type: 'SS' })).toEqual(
      { status: 'rejected', reason: 'cycle' },
    );
    expect(store.getSnapshot().links).toBe(LINKS);
    expect(events).toEqual([]);
  });

  it('FR-LINK-6: hooks can veto a link, synchronously or asynchronously', async () => {
    const { store, controller, events } = setup();
    const answer = deferred<boolean>();
    const contexts: unknown[] = [];
    controller.setHandlers({
      onBeforeLinkCreate: (context) => {
        contexts.push(context);
        return answer.promise;
      },
    });
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    const pending = controller.createLink(link);
    expect(controller.pending).toBe(true);
    expect(await controller.createLink(link)).toEqual({ status: 'busy' });
    answer.resolve(false);
    expect(await pending).toEqual({ status: 'cancelled', reason: 'hook' });
    expect(contexts).toEqual([{ link, id: 'build:SS:review', wouldCreateCycle: false }]);
    controller.setHandlers({ onBeforeLinkCreate: () => true });
    expect((await controller.createLink(link)).status).toBe('created');
    expect(store.getSnapshot().links).toHaveLength(2);
    expect(events.map(([name]) => name)).toEqual(['linkCreate']);
  });

  it.each<[string, () => unknown]>([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
    ['rejects', () => Promise.reject(new Error('boom'))],
    ['answers something else', () => 'yes'],
  ])('FR-LINK-6, FR-EVT-1: a link hook that %s cancels and reports the error', async (_, hook) => {
    const { store, controller, events } = setup();
    controller.hooks.add('beforeLinkCreate', hook as () => undefined);
    const result = await controller.createLink({ source: 'build', target: 'review', type: 'SS' });
    expect(result).toMatchObject({ status: 'cancelled', reason: 'error' });
    const { error } = result as { readonly error: unknown };
    expect(error).toBeInstanceOf(Error);
    expect(events).toEqual([['error', { error, source: 'hook', name: 'beforeLinkCreate' }]]);
    expect(store.getSnapshot().links).toBe(LINKS);
  });

  it('FR-LINK-6: the checks are repeated when the store changed while a hook was awaited', async () => {
    const { store, controller, events } = setup();
    const answer = deferred<undefined>();
    controller.hooks.add('beforeLinkCreate', () => answer.promise);
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    const pending = controller.createLink(link);
    store.dispatch({ type: 'setLinks', links: [...LINKS, { ...link }] });
    answer.resolve(undefined);
    expect(await pending).toEqual({ status: 'rejected', reason: 'duplicate' });
    expect(events).toEqual([]);
  });

  it('FR-LINK-5: deletes a link of `links` and emits linkDelete', async () => {
    const { store, controller, events } = setup();
    const record = store.getSnapshot().derived.graph.linkById.get('design:FS:build')!;
    expect(await controller.deleteLink('design:FS:build')).toEqual({
      status: 'deleted',
      id: 'design:FS:build',
      link: record,
    });
    expect(store.getSnapshot().links).toEqual([]);
    expect(store.getSnapshot().tasks).toBe(TASKS);
    const payload: LinkDeletePayload = { id: 'design:FS:build', link: record };
    expect(events).toEqual([['linkDelete', payload]]);
  });

  it('FR-LINK-5: deletes a link of the dependencies shorthand from its target task', async () => {
    const tasks: readonly Task[] = deepFreeze([
      ...TASKS.slice(0, 3),
      {
        id: 'ship',
        name: 'Ship',
        start: '2026-03-20',
        duration: 1,
        dependencies: ['review', { id: 'build', type: 'FF' }, { id: 'design', type: 'SS' }],
      },
    ]);
    const { store, controller } = setup({}, tasks);
    expect((await controller.deleteLink('build:FF:ship')).status).toBe('deleted');
    const state = store.getSnapshot();
    expect(state.tasks[3]).toEqual({
      ...tasks[3],
      dependencies: ['review', { id: 'design', type: 'SS' }],
    });
    expect(state.tasks.slice(0, 3)).toEqual(tasks.slice(0, 3));
    expect(state.tasks[0]).toBe(tasks[0]);
    expect([...state.derived.graph.linkById.keys()]).toEqual([
      'design:FS:build',
      'build:FS:review',
      'review:FS:ship',
      'design:SS:ship',
    ]);
    expect((await controller.deleteLink('review:FS:ship')).status).toBe('deleted');
    expect(store.getSnapshot().tasks[3]?.dependencies).toEqual([{ id: 'design', type: 'SS' }]);
  });

  it('FR-LINK-5, FR-TX-3: in controlled mode only emits linkDelete; unknown ids are rejected', async () => {
    const { store, controller, events } = setup({ dataMode: 'controlled' });
    expect((await controller.deleteLink('build:FS:review')).status).toBe('deleted');
    expect(store.getSnapshot().tasks).toBe(TASKS);
    expect(store.getSnapshot().links).toBe(LINKS);
    expect(events.map(([name]) => name)).toEqual(['linkDelete']);
    expect(await controller.deleteLink('nope')).toEqual({
      status: 'rejected',
      reason: 'unknown-link',
    });
  });

  it('FR-EVT-1: a throwing linkDelete listener without an `error` listener rejects', async () => {
    const store = createStore({ tasks: TASKS, links: LINKS });
    const emitter: Emitter<CoreEvents> = createEmitter<CoreEvents>();
    const controller = createChangeController({ store, emitter });
    const boom = new Error('boom');
    emitter.on('linkDelete', () => {
      throw boom;
    });
    emitter.on('linkCreate', () => {
      throw boom;
    });
    await expect(controller.deleteLink('design:FS:build')).rejects.toBe(boom);
    expect(store.getSnapshot().links).toEqual([]);
    await expect(controller.createLink({ source: 'design', target: 'build' })).rejects.toBe(boom);
    expect(controller.pending).toBe(false);
  });
});

describe('createChangeController: handlers', () => {
  it('FR-EVT-2, FR-EVT-3: setHandlers swaps handlers without losing listeners added with on()', async () => {
    const { emitter, controller, store } = setup();
    const calls: string[] = [];
    controller.setHandlers({ onTasksChange: () => calls.push('first') });
    emitter.on('tasksChange', () => calls.push('on'));
    await controller.commit(changeSetOn(store, MOVE));
    controller.setHandlers({ onTasksChange: () => calls.push('second') });
    await controller.commit(changeSetOn(store, { ...MOVE, start: at('2026-03-16') }));
    // Swapping keeps the handler's place: it was set before the `on` listener.
    expect(calls).toEqual(['first', 'on', 'second', 'on']);
    controller.setHandlers({ onTasksChange: undefined });
    await controller.commit(changeSetOn(store, { ...MOVE, start: at('2026-03-23') }));
    expect(calls).toEqual(['first', 'on', 'second', 'on', 'on']);
    // Set again: subscribed anew, now after the `on` listener.
    controller.setHandlers({ onTasksChange: () => calls.push('third') });
    await controller.commit(changeSetOn(store, { ...MOVE, start: at('2026-03-30') }));
    expect(calls.slice(5)).toEqual(['on', 'third']);
  });

  it('FR-EVT-2: handlers of renderer events and of `error`; keys left out are kept', () => {
    const { emitter, controller } = setup();
    const onTaskClick = vi.fn();
    const onError = vi.fn();
    controller.setHandlers({ onTaskClick, onError });
    controller.setHandlers({ onScroll: vi.fn() });
    controller.setHandlers({ unknownKey: vi.fn(), o: vi.fn() } as never);
    const payload = { id: 'design', event: { kind: 'pointer' } };
    emitter.emit('taskClick', payload);
    expect(onTaskClick).toHaveBeenCalledWith(payload);
    const boom = new Error('boom');
    emitter.on('linkClick', () => {
      throw boom;
    });
    emitter.emit('linkClick', { id: 'design:FS:build', event: undefined });
    expect(onError).toHaveBeenCalledWith({ error: boom, source: 'listener', name: 'linkClick' });
  });

  it('FR-EVT-2, FR-TX-2: hook handlers are swapped in place; hooks added with add() stay', async () => {
    const hooks = createHooks();
    const store = createStore({ tasks: TASKS, links: LINKS });
    const emitter = createEmitter<CoreEvents>();
    const order: string[] = [];
    const controller = createChangeController({
      store,
      emitter,
      hooks,
      handlers: {
        onBeforeTaskChange: () => {
          order.push('handler-1');
          return false;
        },
      },
    });
    expect(controller.hooks).toBe(hooks);
    hooks.add('beforeTaskChange', () => {
      order.push('added');
    });
    expect((await controller.commit(changeSetOn(store, MOVE))).status).toBe('cancelled');
    controller.setHandlers({
      onBeforeTaskChange: () => {
        order.push('handler-2');
      },
    });
    expect((await controller.commit(changeSetOn(store, MOVE))).status).toBe('committed');
    expect(order).toEqual(['handler-1', 'handler-2', 'added']);
    controller.setHandlers({ onBeforeTaskChange: undefined });
    expect([...hooks.chain('beforeTaskChange')]).toHaveLength(1);
  });
});

describe('createChangeController: without hooks', () => {
  it('FR-TX-5, FR-SNAP-13: apply commits synchronously, re-validated, without the hooks', () => {
    const { store, controller, events, names, changeSetOf } = setup();
    const veto = vi.fn(() => false);
    controller.hooks.add('beforeTaskChange', veto);
    const changeSet = changeSetOf(MOVE);
    const result = controller.apply(changeSet);
    expect(result).toEqual({ status: 'committed', changeSet, issues: [] });
    expect(veto).not.toHaveBeenCalled();
    expect(names()).toEqual([
      'tasksChange',
      'taskDatesChange',
      'taskDatesChange',
      'taskDatesChange',
    ]);
    expect(store.getSnapshot().tasks[0]).toMatchObject({ start: '2026-03-09' });

    // Nothing left after re-validation: a preview stays as it is.
    events.length = 0;
    const preview = changeSetOf({ ...MOVE, start: at('2026-03-16') });
    controller.preview(preview);
    const ghost = { ...changeSet.changes[0]!, id: 'ghost' };
    const unchanged = controller.apply({ reason: 'api', changes: [ghost], conflicts: [] });
    expect(unchanged).toMatchObject({ status: 'unchanged', issues: [{ code: 'unknown-task' }] });
    expect(names()).toEqual(['issues']);
    expect(store.getSnapshot().draft?.changeSet).toBe(preview);
  });

  it('FR-TX-5, FR-LINK-7: applyLinkCreate and applyLinkDelete skip the hooks; the checks stay', () => {
    const { store, controller, names } = setup();
    const veto = vi.fn(() => false);
    controller.hooks.add('beforeLinkCreate', veto);
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    expect(controller.applyLinkCreate(link)).toEqual({
      status: 'created',
      id: 'build:SS:review',
      link,
    });
    expect(veto).not.toHaveBeenCalled();
    expect(store.getSnapshot().links).toEqual([...LINKS, link]);
    expect(controller.applyLinkCreate(link)).toEqual({ status: 'rejected', reason: 'duplicate' });
    expect(controller.applyLinkCreate({ source: 'review', target: 'design' })).toEqual({
      status: 'rejected',
      reason: 'cycle',
    });
    expect(controller.applyLinkDelete('build:SS:review')).toMatchObject({ status: 'deleted' });
    expect(controller.applyLinkDelete('build:SS:review')).toEqual({
      status: 'rejected',
      reason: 'unknown-link',
    });
    expect(names()).toEqual(['linkCreate', 'linkDelete']);
  });

  it('FR-TX-5: they are busy while a hook is awaited and cancelled after dispose', async () => {
    const { controller, changeSetOf } = setup();
    const answer = deferred<undefined>();
    controller.hooks.add('beforeTaskChange', () => answer.promise);
    const pending = controller.commit(changeSetOf(MOVE));
    expect(controller.apply(changeSetOf(MOVE))).toEqual({ status: 'busy' });
    const link: Link = { source: 'build', target: 'review', type: 'SS' };
    expect(controller.applyLinkCreate(link)).toEqual({ status: 'busy' });
    expect(controller.applyLinkDelete('design:FS:build')).toEqual({ status: 'busy' });
    answer.resolve(undefined);
    await pending;
    controller.dispose();
    const disposed = { status: 'cancelled', reason: 'disposed' };
    expect(controller.apply(changeSetOf(MOVE))).toEqual(disposed);
    expect(controller.applyLinkCreate(link)).toEqual(disposed);
  });
});

describe('createChangeController: observers and owner updates', () => {
  it('FR-TX-4, FR-TX-5: observers see each applied operation before its events', async () => {
    const { store, emitter, controller, changeSetOf } = setup();
    const seen: string[] = [];
    const operations: ControllerOperation[] = [];
    const off = controller.observe((operation) => {
      operations.push(operation);
      seen.push(operation.type);
    });
    emitter.on('tasksChange', () => seen.push('tasksChange'));
    const before = store.getSnapshot();
    await controller.commit(changeSetOf(MOVE));
    expect(seen).toEqual(['tasks', 'tasksChange']);
    expect(operations[0]).toMatchObject({ type: 'tasks', before, after: store.getSnapshot() });
    expect(Object.isFrozen(operations[0])).toBe(true);
    // Cancelled, rejected and unchanged operations are not reported.
    const veto = controller.hooks.add('beforeTaskChange', () => false);
    await controller.commit(changeSetOf({ ...MOVE, start: at('2026-03-16') }));
    veto();
    await controller.createLink({ source: 'design', target: 'build' });
    controller.apply({ reason: 'api', changes: [], conflicts: [] });
    expect(seen).toEqual(['tasks', 'tasksChange']);
    await controller.createLink({ source: 'build', target: 'review', type: 'SS' });
    await controller.deleteLink('build:SS:review');
    expect(operations.slice(1).map((operation) => operation.type)).toEqual([
      'linkCreate',
      'linkDelete',
    ]);
    expect(operations[2]).toMatchObject({ id: 'build:SS:review', link: { type: 'SS' } });
    off();
    off();
    controller.apply(changeSetOf({ ...MOVE, start: at('2026-03-16') }));
    expect(operations).toHaveLength(3);
  });

  it('FR-DATA-7: update forwards the owner’s commands and reports those that change something', () => {
    const { store, controller } = setup();
    const operations: ControllerOperation[] = [];
    controller.observe((operation) => operations.push(operation));
    controller.update({ type: 'setTasks', tasks: TASKS });
    expect(operations).toEqual([]);
    const tasks = [...TASKS];
    const before = store.getSnapshot();
    controller.update({ type: 'setTasks', tasks });
    expect(store.getSnapshot().tasks).toBe(tasks);
    expect(operations).toEqual([
      { type: 'data', command: { type: 'setTasks', tasks }, before, after: store.getSnapshot() },
    ]);
    controller.update({ type: 'setOptions', options: { dataMode: 'controlled' } });
    controller.update({ type: 'setLinks', links: [] });
    expect(operations.map((operation) => operation.type)).toEqual(['data', 'data', 'data']);
    controller.dispose();
    controller.update({ type: 'setLinks', links: LINKS });
    expect(store.getSnapshot().links).toEqual([]);
    const off = controller.observe(() => undefined);
    expect(off).not.toThrow();
  });

  it('FR-DATA-7, FR-API-2: update with setData is one owner change, derived once', () => {
    const { store, controller } = setup();
    const operations: ControllerOperation[] = [];
    controller.observe((operation) => operations.push(operation));
    const before = store.getSnapshot();
    const tasks = [...TASKS];
    const command = {
      type: 'setData',
      tasks,
      links: [],
      options: { scheduling: { granularity: '1h' } },
    } as const;
    controller.update(command);
    const after = store.getSnapshot();
    expect(operations).toEqual([{ type: 'data', command, before, after }]);
    expect(after.lastDataChange.version).toBe(before.lastDataChange.version + 1);
    expect(after.tasks).toBe(tasks);
    expect(after.links).toEqual([]);
    controller.update({ type: 'setData' });
    expect(operations).toHaveLength(1);
  });

  it('FR-EVT-1: what an observer throws is rethrown after the other observers and the events', async () => {
    const { controller, names, changeSetOf } = setup();
    const boom = new Error('boom');
    const late = vi.fn();
    let offLate = (): void => undefined;
    controller.observe(() => {
      // An observer removed during a notification is not called by it.
      offLate();
      throw boom;
    });
    const second = vi.fn();
    controller.observe(second);
    offLate = controller.observe(late);
    await expect(controller.commit(changeSetOf(MOVE))).rejects.toBe(boom);
    expect(second).toHaveBeenCalledOnce();
    expect(late).not.toHaveBeenCalled();
    expect(names()[0]).toBe('tasksChange');
    expect(controller.pending).toBe(false);
    expect(() => {
      controller.update({ type: 'setTasks', tasks: [...TASKS] });
    }).toThrow(boom);
  });
});

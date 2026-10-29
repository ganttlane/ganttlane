import { deepFreeze } from '@ganttlane/fixtures';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Task } from '../model';
import { createSelector, createStore, type StoreState } from './index';

const TASKS: readonly Task[] = deepFreeze([
  { id: 'phase', name: 'Phase', start: '2026-03-02', end: '2026-03-13' },
  { id: 'design', name: 'Design', parentId: 'phase', start: '2026-03-02', end: '2026-03-06' },
  { id: 'later', name: 'Later', start: '2026-03-16', duration: 3 },
]);

describe('createStore', () => {
  it('FR-TX-3: keeps the snapshot identity until a command changes something', () => {
    const store = createStore({ tasks: TASKS });
    const { getSnapshot } = store;
    const first = getSnapshot();
    expect(getSnapshot()).toBe(first);
    store.dispatch({ type: 'setTasks', tasks: TASKS });
    store.dispatch({ type: 'setViewMode', id: 'day' });
    expect(getSnapshot()).toBe(first);
    store.dispatch({ type: 'setViewMode', id: 'week' });
    const second = getSnapshot();
    expect(second).not.toBe(first);
    expect(getSnapshot()).toBe(second);
    expect(second.derived.model).toBe(first.derived.model);
  });

  it('FR-TX-3: notifies subscribers only on change, once per command, until unsubscribed', () => {
    const store = createStore({ tasks: TASKS });
    const calls: string[] = [];
    const unsubscribeA = store.subscribe(() => calls.push(`a:${store.getSnapshot().viewModeId}`));
    const unsubscribeB = store.subscribe(() => calls.push(`b:${store.getSnapshot().viewModeId}`));
    store.dispatch({ type: 'setViewMode', id: 'week' });
    store.dispatch({ type: 'setViewMode', id: 'week' });
    expect(calls).toEqual(['a:week', 'b:week']);
    unsubscribeA();
    unsubscribeA();
    store.dispatch({ type: 'collapseAll' });
    expect(calls).toEqual(['a:week', 'b:week', 'b:week']);
    unsubscribeB();
    store.dispatch({ type: 'expandAll' });
    expect(calls).toHaveLength(3);
  });

  it('FR-REACT-5: every subscription of the same listener is its own (StrictMode re-subscribes)', () => {
    const store = createStore({ tasks: TASKS });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.subscribe(listener);
    unsubscribe();
    store.dispatch({ type: 'collapseAll' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('FR-TX-3: a listener may dispatch and unsubscribe while being notified', () => {
    const store = createStore({ tasks: TASKS });
    const seen: string[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getSnapshot().viewModeId);
      unsubscribe();
      store.dispatch({ type: 'setViewMode', id: 'month' });
    });
    const late = vi.fn();
    store.subscribe(late);
    store.dispatch({ type: 'setViewMode', id: 'week' });
    expect(seen).toEqual(['week']);
    expect(store.getSnapshot().viewModeId).toBe('month');
    expect(late).toHaveBeenCalledTimes(2);
  });

  it('FR-TX-3: a throwing listener does not stop the others; their errors are rethrown after all ran', () => {
    const store = createStore({ tasks: TASKS });
    const first = new Error('first');
    const second = new Error('second');
    const calls: string[] = [];
    const offFirst = store.subscribe(() => {
      calls.push('first');
      throw first;
    });
    store.subscribe(() => calls.push('quiet'));
    expect(() => {
      store.dispatch({ type: 'setViewMode', id: 'week' });
    }).toThrow(first);
    expect(calls).toEqual(['first', 'quiet']);
    expect(store.getSnapshot().viewModeId).toBe('week');

    store.subscribe(() => {
      calls.push('second');
      throw second;
    });
    let thrown: unknown;
    try {
      store.dispatch({ type: 'setViewMode', id: 'month' });
    } catch (error) {
      thrown = error;
    }
    expect(calls.slice(2)).toEqual(['first', 'quiet', 'second']);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
    expect((thrown as AggregateError).message).toBe('2 store listeners threw');
    offFirst();
    expect(() => {
      store.dispatch({ type: 'setViewMode', id: 'day' });
    }).toThrow(second);
  });

  it('FR-TX-3: select reads the current snapshot', () => {
    const store = createStore({ tasks: TASKS, expandedKeys: [] });
    expect(store.select((state) => state.derived.rows.length)).toBe(2);
    store.dispatch({ type: 'toggleExpanded', id: 'phase' });
    expect(store.select((state) => state.derived.rows.length)).toBe(3);
    expect(Object.isFrozen(store)).toBe(true);
  });
});

describe('createSelector', () => {
  it('FR-TX-3: recomputes only when an input changed and keeps the result identity', () => {
    const combine = vi.fn((rows: StoreState['derived']['rows'], mode: string) =>
      rows.map((row) => `${mode}:${String(row.id)}`),
    );
    const selectLabels = createSelector(
      [(state: StoreState) => state.derived.rows, (state: StoreState) => state.derived.viewMode.id],
      combine,
    );
    expectTypeOf(selectLabels).toEqualTypeOf<(state: StoreState) => string[]>();
    const store = createStore({ tasks: TASKS });
    const first = store.select(selectLabels);
    expect(first).toEqual(['day:phase', 'day:design', 'day:later']);
    store.dispatch({ type: 'setOptions', options: { scheduling: { snap: '1w' } } });
    expect(store.select(selectLabels)).toBe(first);
    expect(combine).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'setViewMode', id: 'week' });
    expect(store.select(selectLabels)).toEqual(['week:phase', 'week:design', 'week:later']);
    expect(combine).toHaveBeenCalledTimes(2);
  });
});

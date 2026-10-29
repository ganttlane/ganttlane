/**
 * `createStore`: the synchronous state container of core (Observer pattern,
 * `docs/architecture.md` §10). Hooks, async confirmation and history live above it (`events`,
 * plan steps 3.2–3.3).
 */

import { createStoreState, reduceStore } from './reducer';
import type { Store, StoreCommand, StoreInit, StoreState } from './types';

/**
 * Creates a store over immutable snapshots (FR-TX-3, FR-DATA-7), compatible with React's
 * `useSyncExternalStore(store.subscribe, store.getSnapshot)`: `getSnapshot` returns the same
 * object until a command changes something, and listeners are called only then, once per
 * command, in subscription order. No globals, no timers: everything happens synchronously inside
 * `dispatch`. A listener added or removed while listeners are being called takes effect from the
 * next command. A listener that throws does not stop the others: once all ran, `dispatch`
 * rethrows what they threw (one error as it is, several as an `AggregateError`); the snapshot
 * has changed by then.
 *
 * @param initial - Tasks, links, options and the initial UI state.
 * @returns The store.
 *
 * @example
 * ```ts
 * const store = createStore({ tasks, links, options: { calendar: { weekends: [0, 6] } } });
 * const unsubscribe = store.subscribe(() => render(store.getSnapshot()));
 * store.dispatch({ type: 'toggleExpanded', id: 'group-1' }); // recomputes the rows only
 * store.select((state) => state.derived.rows.length);
 * ```
 */
export function createStore<TData = unknown>(initial: StoreInit<TData>): Store<TData> {
  let state: StoreState<TData> = createStoreState(initial);
  let listeners: readonly (() => void)[] = [];
  return Object.freeze({
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      const entry = (): void => {
        listener();
      };
      listeners = [...listeners, entry];
      return () => {
        listeners = listeners.filter((other) => other !== entry);
      };
    },
    dispatch: (command: StoreCommand<TData>) => {
      const next = reduceStore(state, command);
      if (next === state) return;
      state = next;
      let errors: unknown[] | undefined;
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          (errors ??= []).push(error);
        }
      }
      if (errors === undefined) return;
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, `${errors.length} store listeners threw`);
    },
    select: <T>(selector: (snapshot: StoreState<TData>) => T): T => selector(state),
  });
}

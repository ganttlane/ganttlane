/**
 * Selectors over store snapshots: a small memoization helper (`createSelector`) and reads that
 * overlay the draft on the committed data.
 */

import type { TaskId } from '../model';
import type { TaskPatch } from '../schedule';
import type { StoreState } from './types';

/** A function that reads a value from a state; `never` accepts a selector of any state. */
type InputSelector = (state: never) => unknown;

/** The values the input selectors of {@link createSelector} return, in order. */
export type SelectorResults<T extends readonly InputSelector[]> = {
  -readonly [K in keyof T]: T[K] extends (state: never) => infer V ? V : never;
};

/**
 * Creates a memoized selector (like Reselect's `createSelector`, without dependencies): the
 * input selectors run on every call, `combine` only when one of their results changed
 * (`Object.is`), so the result keeps its identity, as `useSyncExternalStore` selectors need. The
 * cache holds the last call only; create one selector per consumer that needs its own. The
 * selector takes the state type of the first input.
 *
 * @param inputs - Selectors of the values `combine` depends on, at least one.
 * @param combine - Computes the result from those values.
 * @returns The memoized selector.
 *
 * @example
 * ```ts
 * const selectBarCount = createSelector(
 *   [(state: StoreState) => state.derived.rows, (state: StoreState) => state.derived.model],
 *   (rows, model) => rows.filter((row) => model.taskById.get(row.id)?.span).length,
 * );
 * ```
 */
export function createSelector<const T extends readonly [InputSelector, ...InputSelector[]], R>(
  inputs: T,
  combine: (...values: SelectorResults<T>) => R,
): (state: Parameters<T[0]>[0]) => R {
  let last: { readonly values: readonly unknown[]; readonly result: R } | undefined;
  return (state) => {
    const values = inputs.map((input) => (input as (state: unknown) => unknown)(state));
    if (!last?.values.every((value, i) => Object.is(value, values[i]))) {
      last = { values, result: combine(...(values as SelectorResults<T>)) };
    }
    return last.result;
  };
}

/**
 * A task's dates and progress as rendered (FR-EDIT-5): the draft's `after` when the draft
 * changes it (the preview over the committed layer), else the committed values of the model.
 * Tasks without a bar (unknown ids, placeholders, invalid tasks) have none, whatever the draft
 * says, as in `applyChangeSet`.
 *
 * @param state - A store snapshot.
 * @param id - The task.
 * @returns The values, or `undefined` for a task without a bar.
 */
export function selectTaskPatch(state: StoreState, id: TaskId): TaskPatch | undefined {
  const task = state.derived.model.taskById.get(id);
  const span = task?.span;
  if (task === undefined || span === undefined) return undefined;
  return (
    state.draft?.patches.get(id) ?? {
      start: span.start,
      endExclusive: span.endExclusive,
      progress: task.progress,
    }
  );
}

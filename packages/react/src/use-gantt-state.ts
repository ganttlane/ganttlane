import type { GanttSnapshot } from '@ganttlane/dom';
import { useState, useSyncExternalStore } from 'react';

import type { SnapshotSource } from './types';

/**
 * The last selection of one `useGanttState`, and the snapshot and selector it was made for: what
 * `useSyncExternalStore` needs to be handed the same value while nothing a component can see has
 * changed. Holding it in a class keeps this bookkeeping (a cache, written while reading) out of
 * the component function.
 */
class Selection<TData, T> {
  private has = false;
  private snapshot: GanttSnapshot<TData> | undefined;
  private selector: ((snapshot: GanttSnapshot<TData>) => T) | undefined;
  private selection: T | undefined;

  /**
   * The selection for `snapshot`: the cached one while the snapshot and the selector are the
   * same; else the selector's result, or the cached selection when `isEqual` calls them equal.
   */
  read(
    snapshot: GanttSnapshot<TData>,
    selector: (snapshot: GanttSnapshot<TData>) => T,
    isEqual: (a: T, b: T) => boolean,
  ): T {
    if (this.has && this.snapshot === snapshot && this.selector === selector) {
      return this.selection as T;
    }
    const picked = selector(snapshot);
    if (!this.has || !isEqual(this.selection as T, picked)) this.selection = picked;
    this.has = true;
    this.snapshot = snapshot;
    this.selector = selector;
    return this.selection as T;
  }
}

/**
 * Reads a slice of a chart's state, and renders again only when that slice changes. The state is
 * the core's snapshot (`docs/architecture.md` §4), read through `useSyncExternalStore`, so it is
 * consistent with the render under concurrent rendering, and it also reads on a server (the core
 * exists while the component renders, so the server snapshot is the same snapshot, and hydration
 * agrees with it).
 *
 * The selector runs when the snapshot changes (or when you pass another selector). If it returns
 * something that `isEqual` calls equal to the last selection, the last selection is kept (same
 * identity) and nothing renders. The default `isEqual` is `Object.is`: select primitives or parts
 * of the snapshot, which keep their identity while they do not change; a selector that builds a
 * new object or array every time needs an `isEqual` (a shallow one), or it renders on every
 * change of the chart.
 *
 * @typeParam TData - Type of `task.data`.
 * @typeParam T - What the selector returns.
 * @param instance - A chart from `useGantt`, or a core from `createGanttCore`.
 * @param selector - Picks what the component needs; may be written inline.
 * @param isEqual - Whether two selections are the same; default `Object.is`.
 * @returns The selection, for the chart's current snapshot.
 *
 * @example
 * ```tsx
 * const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);
 * const ids = useGanttState(gantt, (s) => s.selection.tasks);
 * ```
 */
export function useGanttState<TData = unknown, T = unknown>(
  instance: SnapshotSource<TData>,
  selector: (snapshot: GanttSnapshot<TData>) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const [memo] = useState(() => new Selection<TData, T>());
  const { getSnapshot, subscribe } = instance;
  const read = (): T => memo.read(getSnapshot(), selector, isEqual);
  return useSyncExternalStore(subscribe, read, read);
}

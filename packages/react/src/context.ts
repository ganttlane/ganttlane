import { type Context, createContext, useContext } from 'react';

import type { GanttInstance } from './types';

/**
 * The chart that {@link GanttRoot} shares with the components below it. `null` outside a root.
 * Holds an instance of any `TData`: the hooks type it again, since a context cannot know it.
 */
export const GanttContext: Context<GanttInstance | null> =
  /* @__PURE__ */ createContext<GanttInstance | null>(null);

/**
 * The chart of the nearest `GanttRoot`, else `own` (a chart given by hand). Not exported by the
 * package: the hooks and `TaskList` that take an optional chart use it.
 *
 * @typeParam TChart - What the caller works with: a `GanttInstance`, or any `SnapshotSource`.
 * @param own - The chart the caller passed, if any; it wins over the context.
 * @param name - The hook or component that asks, for the message.
 * @returns The chart.
 * @throws When there is neither.
 */
export function useChartOr<TChart>(own: TChart | undefined, name: string): TChart {
  const shared = useContext(GanttContext);
  const found = own ?? (shared as unknown as TChart | null);
  if (found === null) {
    throw new Error(
      `[@ganttlane/react] ${name} needs a chart: render it inside <GanttRoot>, or pass the chart of useGantt.`,
    );
  }
  return found;
}

/**
 * The chart of the nearest {@link GanttRoot}: the same object for the life of the root, with the
 * methods of the vanilla `Gantt` (`scrollToTask`, `updateTask`, `select`, `undo`, `edit.begin`, …),
 * `getSnapshot` and `subscribe`. Reading it subscribes to nothing: use `useGanttState` or
 * `useGanttBar` for what changes.
 *
 * A context cannot know the type of `task.data`: name it, `useGanttContext<MyData>()`.
 *
 * @typeParam TData - Type of `task.data`.
 * @returns The chart of the root.
 * @throws Outside a `GanttRoot`.
 *
 * @example
 * ```tsx
 * function UndoButton() {
 *   const gantt = useGanttContext();
 *   const canUndo = useGanttState(() => gantt.canUndo);
 *   return <button disabled={!canUndo} onClick={() => gantt.undo()}>Undo</button>;
 * }
 * ```
 */
export function useGanttContext<TData = unknown>(): GanttInstance<TData> {
  return useChartOr<GanttInstance<TData>>(undefined, 'useGanttContext');
}

import { useEffect, useLayoutEffect, useReducer, useState } from 'react';

import { type Controller, createController } from './controller';
import type { GanttInstance, GanttReactOptions } from './types';

/**
 * `useLayoutEffect` where there is a DOM, `useEffect` (which a server never runs) where there is
 * none: React 18 warns about a layout effect on the server. Looked up when the hook runs, not
 * when the module loads: importing this package reads no global.
 */
export function useIsomorphicLayoutEffect(effect: () => void): void {
  const useEffectOfHost = typeof document === 'undefined' ? useEffect : useLayoutEffect;
  useEffectOfHost(effect);
}

const next = (count: number): number => count + 1;

/**
 * Makes a gantt chart for the component and keeps it in step with the options you pass: the
 * headless core is created while the component renders (so it also answers on a server), the
 * vanilla renderer is drawn into the element you give to `instance.setContainer`, and both end
 * with the component. {@link Gantt} is this hook and a `div`.
 *
 * - **Stable.** The returned instance is the same object for the life of the component, and it
 *   survives StrictMode's mount, unmount, mount: the renderer is removed and drawn again, the
 *   core, which has no timers or listeners of its own, is destroyed only when the component is
 *   really gone, a microtask after the cleanup, if the effects were not set up again by then.
 * - **Options as props.** After every commit, what changed is handed to `setOptions`: compared
 *   by identity and then by data, group by group the way `setOptions` merges them, so options
 *   written inline cost nothing while they stay equal, and an option or a field you remove goes
 *   back to its default. Nothing is sent when nothing changed.
 * - **Handlers are always current.** The core is given one function per `on<Event>` handler
 *   that calls the latest one: a handler that is new on every render is no change at all and
 *   is never stale. Giving a handler for the first time, or removing it, is a change. They are
 *   never called while React renders: the first events (those of the creation) wait for the end
 *   of the first commit, and what a handler throws while the chart is brought to the props goes
 *   to `onError` (without one, to the host's unhandled-rejection channel), and never into
 *   React's commit.
 * - **Controlled or uncontrolled** `tasks`, `links`, `viewMode`, `expandedKeys` and
 *   `selectedKeys`, see {@link GanttControlledProps}.
 * - **One core, whichever core.** `instance.core` is the same object too, with its own `subscribe`
 *   and `on`; it stands for the core the chart has now, which is a new one after a hidden
 *   `<Activity>` shows the chart again.
 * - **Slots.** `renderTooltip`, `renderLinkMenu` and `renderBarLabel` give the chart's tooltip,
 *   link menu and bar labels as `ReactNode`s, see {@link GanttSlotProps}. React draws
 *   them through portals that `instance.slots` holds, so render `instance.slots` next to the
 *   container, below the providers the content should see (`<Gantt>` does).
 *
 * @typeParam TData - Type of `task.data`.
 * @param options - The options of the chart, which are the props of {@link Gantt}.
 * @returns The chart; read its state with `useGanttState`.
 *
 * @example
 * ```tsx
 * const gantt = useGantt({
 *   tasks,
 *   links,
 *   viewMode: 'week',
 *   onTaskClick: open,
 *   renderTooltip: ({ task }) => <TaskCard task={task} />,
 * });
 * const selected = useGanttState(gantt, (s) => s.selection.tasks);
 * // Destructured, which keeps `react-hooks/refs` quiet.
 * const { setContainer, slots } = gantt;
 * return (
 *   <>
 *     <div ref={setContainer} style={{ height: 480 }} />
 *     {slots}
 *   </>
 * );
 * ```
 */
export function useGantt<TData = unknown>(options: GanttReactOptions<TData>): GanttInstance<TData> {
  const controller = useController(options);
  // The events the chart held back: after the effect above, and the last of this hook's.
  useIsomorphicLayoutEffect(() => {
    controller.settle();
  });
  return controller.instance;
}

/**
 * The part of {@link useGantt} before the first events are let through: the controller, with the
 * effects that bring the chart to the props and end it with the component. For {@link Gantt},
 * which has something of its own to put in place (the `ref` handle) before the application hears of
 * them, and so declares the effect of `controller.settle` itself, after it. Not exported by the
 * package.
 *
 * @param options - The options of the chart.
 * @returns The controller; call `settle` in a layout effect declared after anything the first
 *   events' handlers may need.
 */
export function useController<TData = unknown>(
  options: GanttReactOptions<TData>,
): Controller<TData> {
  const [, render] = useReducer(next, 0);
  const [controller] = useState(() => createController(options, render));
  // After every commit, and when React sets effects up again (StrictMode, `<Activity>`).
  useIsomorphicLayoutEffect(() => {
    controller.update(options);
  });
  useEffect(() => {
    controller.retain();
    return () => {
      controller.release();
    };
  }, [controller]);
  return controller;
}

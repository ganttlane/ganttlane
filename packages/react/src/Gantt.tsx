import type { ForwardedRef, HTMLAttributes, ReactElement, RefAttributes } from 'react';
import { forwardRef, useImperativeHandle } from 'react';

import type { GanttHandle, GanttProps, GanttReactOptions } from './types';
import { useController, useIsomorphicLayoutEffect } from './use-gantt';

/** The component as `forwardRef` types it, with the type of `task.data` not yet chosen. */
type GanttRender = (props: GanttProps, ref: ForwardedRef<GanttHandle>) => ReactElement;

/**
 * Splits the props of {@link Gantt} into the container's attributes (`id`, `className`, `style`,
 * `aria-*`, `data-*`: for the element as they are) and the options of the chart.
 */
function splitContainer(props: GanttProps): {
  readonly options: GanttReactOptions;
  readonly attributes: HTMLAttributes<HTMLDivElement>;
} {
  const options: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const own =
      key === 'id' ||
      key === 'className' ||
      key === 'style' ||
      key.startsWith('aria-') ||
      key.startsWith('data-');
    (own ? attributes : options)[key] = value;
  }
  return { options, attributes };
}

/**
 * The body of {@link Gantt}: {@link useGantt}, a container, the portals of the slots and the
 * handle. `forwardRef` cannot carry a type parameter, so {@link Gantt} casts it back.
 */
function GanttImpl(props: GanttProps, ref: ForwardedRef<GanttHandle>): ReactElement {
  const { options, attributes } = splitContainer(props);
  const controller = useController(options);
  const { handle, instance } = controller;
  const { setContainer, slots } = instance;
  // The same object every render, so the handle is set once and again only when React says so
  // (StrictMode, a hidden `<Activity>`): it never changes under whoever holds it.
  useImperativeHandle(ref, () => handle, [handle]);
  // The events the chart held back (those of its creation) are let through only now, so that
  // `ref.current` is the handle in their handlers.
  useIsomorphicLayoutEffect(() => {
    controller.settle();
  });
  return (
    <>
      <div ref={setContainer} {...attributes} />
      {slots}
    </>
  );
}

/**
 * A gantt chart: a `div` that the vanilla renderer of `@ganttlane/dom` draws into, with the
 * options as props (FR-REACT-1). It is {@link useGantt} and a container; see there for how props
 * reach the chart (only what changed, group by group), for the handlers that are always current
 * and for what happens under StrictMode and on a server.
 *
 * The container is empty markup on a server (`renderToString` gives the `div` only) and the chart
 * is drawn after hydration, before the browser paints. Give the container a height, through
 * `className` or `style`, or the chart a `layout.height` of its own. Import the stylesheet once:
 * `@ganttlane/dom/styles.css`.
 *
 * `tasks`, `links`, `viewMode`, `expandedKeys` and `selectedKeys` are controlled by their prop
 * and uncontrolled by their `default…` prop, see {@link GanttControlledProps}.
 *
 * **Slots (FR-REACT-4).** `renderTooltip`, `renderLinkMenu` and `renderBarLabel` return a
 * `ReactNode` that is drawn inside the tooltip, the link menu and the bar labels of the chart
 * through portals: see {@link GanttSlotProps}. The portals are siblings of the container, so the
 * content sees the providers above `<Gantt>`.
 *
 * **Ref (FR-REACT-3).** `ref` is the {@link GanttHandle} of the chart: the same object for the life
 * of the component, with the methods of `docs/api.md` §6 (`scrollToTask`, `updateTask`,
 * `select`, `edit.begin`, `undo`, `on`, …). It is made with `forwardRef`, which works in React 18.3
 * and 19, and `forwardRef` cannot be generic: `Gantt` is `forwardRef` cast to a generic function
 * component, so `TData` is inferred from the props and types the handle (a `useRef<GanttHandle<MyData>>`
 * is the handle of a `<Gantt<MyData> …>`, or of one whose `defaultTasks` are `Task<MyData>[]`). It is
 * set before the handlers hear of the first events (`onIssues`, `onRangeChange`), so `ref.current`
 * is the handle in them, and it is `null` while a hidden `<Activity>` has the chart.
 *
 * `id`, `aria-*` and `data-*` go to the container `div`, as `className` and `style` do.
 *
 * @typeParam TData - Type of `task.data`.
 * @param props - The options of the chart, plus `id`, `className`, `style`, `aria-*` and `data-*`
 *   of the container, and `ref`.
 * @returns The container element, and the portals of the slots.
 *
 * @example
 * ```tsx
 * import '@ganttlane/dom/styles.css';
 * import { Gantt, type GanttHandle } from '@ganttlane/react';
 *
 * const chart = useRef<GanttHandle>(null);
 *
 * <Gantt
 *   ref={chart}
 *   style={{ height: 480 }}
 *   defaultTasks={tasks}
 *   links={links}
 *   viewMode="week"
 *   onTaskClick={(record) => open(record.id)}
 *   renderTooltip={({ task }) => <TaskCard task={task} />}
 * />;
 *
 * chart.current?.scrollToTask('design');
 * ```
 */
export const Gantt = forwardRef(GanttImpl as GanttRender) as <TData = unknown>(
  props: GanttProps<TData> & RefAttributes<GanttHandle<TData>>,
) => ReactElement | null;

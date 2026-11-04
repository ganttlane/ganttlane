import type { AriaAttributes, CSSProperties, ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';

import { GanttContext, useChartOr } from './context';
import { isDev, warn } from './dev';
import type { GanttDataAttributes, GanttInstance, GanttReactOptions } from './types';
import { useGantt } from './use-gantt';

/**
 * The props of {@link GanttRoot}: the options of {@link useGantt} (so the controlled and
 * uncontrolled groups, the handlers and the slots of {@link Gantt} too) and the `children`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttRootProps<TData = unknown> = GanttReactOptions<TData> & {
  /** What is drawn below the root: a {@link GanttChart}, a `TaskList`, your own components. */
  readonly children?: ReactNode;
};

/**
 * Makes a chart with {@link useGantt} and shares it with the components below, which reach it with
 * {@link useGanttContext}, `useGanttState(selector)`, `useGanttBar` and `TaskList`, without a prop
 * to hand it down. It draws no element of its own: put a {@link GanttChart} where the chart goes.
 *
 * It takes the options `<Gantt>` takes and behaves as it does (see `useGantt`): only what changed
 * reaches the chart, handlers are never stale, and StrictMode and a server render are fine. The
 * portals of the slots (`renderTooltip`, `renderLinkMenu`, `renderBarLabel`) are drawn inside the
 * root, so their content sees the root's context and can call `useGanttBar`.
 *
 * A `<Gantt>` below a root is a chart of its own and is not seen by the hooks.
 *
 * @typeParam TData - Type of `task.data`.
 * @param props - The options of the chart, and the `children`.
 * @returns The children and the portals of the slots.
 *
 * @example
 * ```tsx
 * <GanttRoot defaultTasks={tasks} defaultViewMode="week" history>
 *   <Toolbar />
 *   <div style={{ display: 'flex', height: 480 }}>
 *     <TaskList />
 *     <GanttChart style={{ flex: 1, minWidth: 0 }} />
 *   </div>
 *   <TaskPanel />
 * </GanttRoot>
 * ```
 */
export function GanttRoot<TData = unknown>(props: GanttRootProps<TData>): ReactElement {
  const { children, ...options } = props;
  const gantt = useGantt<TData>(options);
  return (
    <GanttContext.Provider value={gantt as unknown as GanttInstance}>
      {children}
      {gantt.slots}
    </GanttContext.Provider>
  );
}

/**
 * The props of {@link GanttChart}: what goes to its `div` as it is.
 */
export type GanttChartProps = Readonly<AriaAttributes> &
  GanttDataAttributes & {
    /** The `id` of the `div`. */
    readonly id?: string | undefined;
    /** The class of the `div`. */
    readonly className?: string | undefined;
    /** The style of the `div`. Give it a height, or the chart a `layout.height` of its own. */
    readonly style?: CSSProperties | undefined;
  };

/** How many {@link GanttChart}s are mounted for each chart: more than one is a mistake. */
const claims = /* @__PURE__ */ new WeakMap<object, number>();

/**
 * The element a {@link GanttRoot}'s chart is drawn into: the same `div` `<Gantt>` renders, with
 * the same `id`, `className`, `style`, `aria-*` and `data-*` props. A root has one chart, so one
 * `GanttChart`; a second one in development is reported and takes the chart from the first.
 *
 * @param props - The attributes of the `div`.
 * @returns The container.
 * @throws Outside a `GanttRoot`.
 */
export function GanttChart(props: GanttChartProps): ReactElement {
  const gantt = useChartOr<GanttInstance>(undefined, 'GanttChart');
  useEffect(() => {
    if (!isDev()) return undefined;
    const count = (claims.get(gantt) ?? 0) + 1;
    claims.set(gantt, count);
    if (count > 1) {
      warn('a <GanttRoot> has one chart: the second <GanttChart> takes it from the first.');
    }
    return () => {
      claims.set(gantt, (claims.get(gantt) ?? 1) - 1);
    };
  }, [gantt]);
  const { setContainer } = gantt;
  return <div ref={setContainer} {...props} />;
}

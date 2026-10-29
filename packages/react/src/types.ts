import type {
  BarLabelContext,
  Gantt as GanttApi,
  GanttOptions,
  GanttSnapshot,
  Link,
  LinkMenuContext,
  Task,
  TaskId,
  TaskTooltipContext,
} from '@ganttlane/dom';
import type { AriaAttributes, CSSProperties, ReactNode } from 'react';

/**
 * Which parents are expanded: `'all'` or the ids of the expanded parents (the `hierarchy` option
 * of the core, which this package takes as `expandedKeys`).
 */
export type ExpandedKeys = 'all' | readonly TaskId[];

/**
 * The props of the five controlled / uncontrolled groups, named like React Aria's
 * (`value` / `defaultValue` / `onValueChange`). A group is **controlled** when its value prop is
 * not `undefined` the first time the chart renders, and uncontrolled otherwise; it keeps that mode
 * for the life of the component (switching is reported once in development and ignored).
 *
 * - **Controlled**: the prop is the truth. The chart follows it whenever it changes, and when
 *   the chart changes the value itself (a click, a method of the instance) it calls the handler
 *   and then goes back to the prop, so the value only changes when your state does.
 * - **Uncontrolled**: the chart keeps the value; the `default*` prop is only its start. The
 *   handler tells you what happened.
 *
 * The handlers are the `on<Event>` options of the core (`onTasksChange`, `onViewModeChange`,
 * `onExpandedChange`, `onSelectionChange`), with their usual arguments, plus `onLinksChange`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttControlledProps<TData = unknown> {
  /**
   * The tasks, controlled (`dataMode: 'controlled'`): the chart never changes them, it reports
   * every committed change to `onTasksChange` as a `ChangeSet`, and you pass the new tasks back
   * (`patchTasks(tasks, changeSet, model)` writes a `ChangeSet` into tasks of any shape). Until
   * you do, the change shows as a draft; passing the same array again changes nothing, and a
   * new array (even with the same content) is your answer and ends the draft, so memoize tasks
   * you derive, and pass a new array to discard a change that was not saved. Tasks that go from
   * `undefined` to an array (`tasks={data?.tasks}`) make the chart controlled from then on.
   */
  readonly tasks?: readonly Task<TData>[] | undefined;
  /** The tasks the chart starts with and then owns (uncontrolled, the default). */
  readonly defaultTasks?: readonly Task<TData>[] | undefined;
  /**
   * The links, controlled. With controlled `tasks`, pass `links` too: a link the user draws or
   * removes is reported (`onLinkCreate`, `onLinkDelete`, `onLinksChange`) and applied only when
   * you pass the new list back. Like `tasks`, links that go from `undefined` to a list make the
   * chart controlled from then on.
   */
  readonly links?: readonly Link[] | undefined;
  /** The links the chart starts with and then owns (uncontrolled). */
  readonly defaultLinks?: readonly Link[] | undefined;
  /**
   * The links after a link was created or deleted: your `links` with the change applied
   * (controlled), or the chart's own links (uncontrolled), ready to be your next `links`.
   * Links that come from `task.dependencies` are not in `links`, so deleting one leaves the list
   * as it was; `onLinkDelete` reports it.
   */
  readonly onLinksChange?: ((links: readonly Link[]) => void) | undefined;
  /** The view mode id (`'day'`, `'week'`, …), controlled. */
  readonly viewMode?: string | undefined;
  /** The view mode the chart starts in and then owns. */
  readonly defaultViewMode?: string | undefined;
  /** The expanded parents, controlled. */
  readonly expandedKeys?: ExpandedKeys | undefined;
  /** The expanded parents the chart starts with and then owns. */
  readonly defaultExpandedKeys?: ExpandedKeys | undefined;
  /**
   * The selected tasks, controlled (the selected link is the chart's own). Keys that name tasks
   * the chart does not have yet are selected when the tasks arrive.
   */
  readonly selectedKeys?: readonly TaskId[] | undefined;
  /**
   * The selected tasks the chart starts with and then owns. Keys that name tasks the chart does
   * not have yet are selected when the tasks arrive, until the selection is changed otherwise.
   */
  readonly defaultSelectedKeys?: readonly TaskId[] | undefined;
}

/**
 * What the chart draws as React: the three places where the renderer has content of its own
 * (the task tooltip, the menu a click on a link opens, a bar's label) take a function that
 * returns a `ReactNode`, drawn through a portal into the node the renderer shows. The content
 * is part of your tree, so it sees your context providers and your state.
 *
 * - **Called while rendering**, once for each tooltip, menu or label the chart is showing (one
 *   per visible bar for labels), as the body of a component of its own: it may use hooks, and it
 *   is called again when the context it was made for changes (another task, new previewed values
 *   while a bar is dragged, a new progress) and when you give a new function. A function that is
 *   new on every render costs the chart nothing: it is the latest one that is called, and the
 *   chart is not told. Return `<MyTooltip task={context.task} />` and keep the logic in a
 *   component.
 * - **Nothing is drawn on a server**: the chart itself is drawn after hydration.
 * - **Not given**: the chart's own content, or the vanilla function of the options
 *   (`tooltip.render`, `linkMenu.render`, `display.renderBarLabel`), which these props
 *   replace when both are given.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttSlotProps<TData = unknown> {
  /**
   * The tooltip of a task (`tooltip.render` for React). `null`, `undefined`, `false` and
   * `''` show no tooltip, as `null` does there; so does content that is only whitespace, and
   * one that becomes blank while it is open closes it. The tooltip takes pointer events when it
   * stays open (`tooltip.trigger: 'click'`), so that what is in it can be used; a hover tooltip
   * is for reading and does not.
   */
  readonly renderTooltip?: ((context: TaskTooltipContext<TData>) => ReactNode) | undefined;
  /**
   * The menu a click on a link opens (`linkMenu.render` for React). It moves the focus to its
   * first button when it opens, takes pointer events, and closes on Escape or a press outside
   * it; `context.remove()` and `context.api.hide()` are for its buttons.
   */
  readonly renderLinkMenu?: ((context: LinkMenuContext<TData>) => ReactNode) | undefined;
  /**
   * The label of a bar (`display.renderBarLabel` for React), in a box the size of the bar when it
   * is inside it (`display.barLabel`) and one that does not clip when it is outside. The chart
   * does not measure what React draws, so `'auto'` placement has no width to go by and puts the
   * label inside: choose `'inside'` or `'outside'` for a label that needs the one or the other.
   * The label does not take pointer events.
   */
  readonly renderBarLabel?: ((context: BarLabelContext<TData>) => ReactNode) | undefined;
}

/**
 * The options of {@link useGantt}: those of `createGantt` (`@ganttlane/dom`, `docs/api.md` §3,
 * flat: data, view mode, calendar, scheduling, layout, `display`, `theme`, `tooltip`, the `on<Event>`
 * handlers, …) with the controlled / uncontrolled groups of {@link GanttControlledProps} in place
 * of `tasks`, `links`, `viewMode`, `hierarchy.expandedKeys` and `dataMode`, and the slots of
 * {@link GanttSlotProps}. `renderer` is read once, when the chart is created.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttReactOptions<TData = unknown> = Omit<
  GanttOptions<TData>,
  'tasks' | 'links' | 'viewMode' | 'dataMode' | 'hierarchy'
> & {
  /** The `hierarchy` group without `expandedKeys`, which is the prop of its own. */
  readonly hierarchy?:
    Omit<NonNullable<GanttOptions<TData>['hierarchy']>, 'expandedKeys'> | undefined;
} & GanttControlledProps<TData> &
  GanttSlotProps<TData>;

/** The `data-*` attributes of the container `div`: text, numbers or flags, as React writes them. */
export type GanttDataAttributes = Readonly<
  Record<`data-${string}`, string | number | boolean | undefined>
>;

/**
 * The props of {@link Gantt}: the options of {@link useGantt} and what goes to the container `div`
 * as it is: `id`, `className`, `style`, the `aria-*` attributes (typed as React's) and the
 * `data-*` attributes. The container is a `div` that the chart fills, so give it a height (or
 * give the chart its own with `layout.height`).
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttProps<TData = unknown> = GanttReactOptions<TData> &
  Readonly<AriaAttributes> &
  GanttDataAttributes & {
    /** The `id` of the container `div`. */
    readonly id?: string | undefined;
    /** The class of the container `div`. */
    readonly className?: string | undefined;
    /** The style of the container `div`. */
    readonly style?: CSSProperties | undefined;
  };

/**
 * What the chart's state can be asked for: `useGanttState` takes a {@link GanttInstance} or a
 * core from `createGanttCore`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface SnapshotSource<TData = unknown> {
  /** The current snapshot; the same object until something in it changed. */
  readonly getSnapshot: () => GanttSnapshot<TData>;
  /** Calls `listener` after every change of the snapshot; returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A chart made by {@link useGantt}: the methods of the vanilla `Gantt` of `@ganttlane/dom`
 * (`docs/api.md` §6) minus `destroy`, which belongs to React, plus what React needs. It is the
 * same object for the life of the component, also while StrictMode mounts, unmounts and mounts it
 * again.
 *
 * The methods act on the chart's current core, which is replaced (its state carried over) in one
 * case only: effects that are torn down and set up again without the component being unmounted,
 * which a hidden `<Activity>` does. `core` is one object all the same, that stands for the core
 * the chart has now, with its `subscribe` and `on`, so it can be kept and given to `useGanttState`.
 * While the chart is hidden it is gone: the commands do nothing and the queries answer from the
 * state it had. Options set with `setOptions` here are not tracked by the props: a prop that
 * changes later wins over them.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttInstance<TData = unknown>
  extends Omit<GanttApi<TData>, 'destroy'>, SnapshotSource<TData> {
  /**
   * The ref of the element the chart fills. The chart is drawn while an element is attached and
   * removed when it is detached, before the browser paints.
   */
  readonly setContainer: (element: HTMLElement | null) => void;
  /**
   * The portals of the slots (`renderTooltip`, `renderLinkMenu`, `renderBarLabel`, see
   * {@link GanttSlotProps}): render it in the component that calls `useGantt`, anywhere below the
   * providers the slot content should see; `<Gantt>` does it for you. It is the same element for
   * the life of the component and draws again by itself, and it draws nothing while no slot is
   * showing and on a server.
   */
  readonly slots: ReactNode;
}

/**
 * What `<Gantt ref>` gives: the {@link GanttInstance} of the chart without what is for React
 * (`setContainer`, `slots`), so the methods of `docs/api.md` §6 (`scrollToTask`, `updateTask`,
 * `select`, `setViewMode`, `edit.begin`, `undo`, `on`, queries, …), `core`, `getSnapshot` and
 * `subscribe`, as an object of its own that has nothing of what is for React. It is the same object
 * for the life of the component: it is set when the chart is committed, before the layout
 * effects of the parent and before the first events reach their handlers, and it is `null` after
 * the component unmounts, and while a hidden `<Activity>` has the chart.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttHandle<TData = unknown> = Omit<GanttInstance<TData>, 'setContainer' | 'slots'>;

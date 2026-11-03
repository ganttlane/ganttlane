import {
  createEmitter,
  createGanttCore,
  type ErrorPayload,
  type GanttCore,
  type GanttCoreOptions,
  type GanttEventMap,
  type GanttEventName,
  type GanttIssues,
  type Issue,
  type IssuesPayload,
  type Listener,
  type OptionIssue,
  type TaskId,
  type Unsubscribe,
} from '@ganttlane/core';

import { assertContainer } from './container';
import { type ResolvedDisplay, resolveDisplay, type RowStripesOption } from './display';
import {
  checkVisual,
  coreOf,
  displayOf,
  type GanttMountOptions,
  type GanttOptions,
  type GanttOptionsPatch,
  isRecord,
  ISSUE_KEYS,
  resetOf,
  sameIssues,
} from './options';
import { type MountedRenderer, mountRenderer } from './renderer';
import { type HeightOption, resolveHeight, resolveTheme, type ThemeOption } from './skeleton';
import {
  DEFAULT_STRINGS,
  type GanttStrings,
  type GanttStringsInput,
  resolveStrings,
} from './strings';

/**
 * What the chart's renderer draws that the core does not know, for what stands beside the chart
 * and has to match it (`getAppearance`). Frozen, and the same object until one of them changes
 * (`on('appearanceChange')`).
 */
export interface GanttAppearance {
  /** `data-theme` of the chart: `'light'`, `'dark'` or `'auto'`. */
  readonly theme: ThemeOption;
  /** `layout.height`: a number of px, `'auto'`, or `undefined` when the chart fills its container. */
  readonly height: HeightOption | undefined;
  /** `display.rowStripes`. */
  readonly rowStripes: RowStripesOption;
  /** `display.rowHover`. */
  readonly rowHover: boolean;
  /** `selection.multiple`, which a list beside the chart follows. */
  readonly multiSelect: boolean;
}

/**
 * The events of a chart, with the arguments their handlers get: the core's, and the one the chart
 * adds for what the core does not know.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type GanttChartEventMap<TData = unknown> = GanttEventMap<TData> & {
  /** The theme, the height, the row stripes or the row hover of the chart changed. */
  readonly appearanceChange: (appearance: GanttAppearance) => void;
};

/**
 * A chart created by {@link createGantt}: the data, view, rows, selection, edit session, history
 * and event methods, all on this one object and none needing `this`. After
 * `destroy()` the commands (data, options, view, rows, selection, edit session, history,
 * `hideTooltip`) do nothing and `on` returns a function that does nothing, while the queries
 * (`getTask`, `getLink`, `getVisibleRange`, `getRowMetrics`, `getBarRect`, `getIssues`,
 * `canUndo`, `canRedo`) keep answering from the state the chart had when it was destroyed: reading
 * what the user left behind in a clean-up needs no extra bookkeeping. Most methods are the
 * core's own (see `GanttCore`); what differs:
 * `setOptions` takes the renderer's options too, the `scrollTo*` and view methods return nothing,
 * `on('issues')` also reports the renderer's options, and `hideTooltip` and `destroy` are the
 * renderer's.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface Gantt<TData = unknown> {
  // ---- data ----

  /** Replaces the tasks: diffed by id, only what changed is recomputed. */
  readonly setTasks: GanttCore<TData>['setTasks'];
  /** Replaces the links. */
  readonly setLinks: GanttCore<TData>['setLinks'];
  /**
   * Changes a task's dates or progress from code (reason `'api'`): propagated like the same drag
   * and passed through `onBeforeTaskChange`. See `GanttCore.updateTask`.
   */
  readonly updateTask: GanttCore<TData>['updateTask'];
  /** Creates a link through `onBeforeLinkCreate`. */
  readonly addLink: GanttCore<TData>['addLink'];
  /** Deletes a link by id. */
  readonly removeLink: GanttCore<TData>['removeLink'];

  // ---- options ----

  /**
   * Changes options without recreating the chart: a key left out keeps its value, a
   * key given with `undefined` returns to its default (`tasks` has none and the types do not
   * allow `undefined` for it: untyped code gets an `invalid-option` issue and an emptied chart),
   * and each key is routed to what depends on it and nothing else:
   *
   * | Key | Goes to |
   * | --- | --- |
   * | `tasks`, `links`, `dataMode`, `viewMode`, `viewModes`, `locale`, `direction`, `now`, `dates`, `calendar`, `scheduling`, `hierarchy`, `editing`, `selection`, `history`, `timeline`, `scroll`, `interaction`, `layout` (all but `height`) | the core: it recomputes only what the key invalidates (`GanttCore.setOptions`) |
   * | `on<Event>`, `onBeforeTaskChange`, `onBeforeLinkCreate` | the core: the handler is swapped in O(1), keeping its place among the listeners, and nothing is recomputed or redrawn |
   * | `onIssues` | the chart: swapped in O(1), nothing else is touched |
   * | `layout.height` | the renderer: `setHeight` |
   * | `theme` | the renderer: `setTheme`, the `data-theme` attribute only |
   * | `strings` | the renderer: `setStrings` |
   * | `display`, `highlights`, `tooltip`, `linkMenu`, `highlightTooltip` | the renderer: `setDisplay` |
   * | `toolbar` | checked only (not available yet) |
   * | `renderer` | ignored: it is for creation |
   *
   * An option object is merged field by field, one level deep, with the one set before: the
   * core's groups (`calendar`, `dates`, `scheduling`, `hierarchy`, `layout`, `timeline`,
   * `scroll`, `selection`, `interaction`), `display` and `strings`. A field you give replaces that field, one
   * you leave out keeps its value, and one given with `undefined` returns to its default.
   * Taken whole, so that a given value replaces the old one and a field it leaves out is back to
   * its default: the objects nested in a group (`scheduling.skipNonWorkingDays`,
   * `scheduling.snap`, `timeline.range`, `timeline.infinite`, `scroll.autoScroll`,
   * `interaction.handles`), `tooltip`, `linkMenu`, `highlightTooltip`, `editing` and `history`
   * as objects, `viewModes`, and every list (`tasks`, `links`, `highlights`,
   * `calendar.holidays`, …). `undefined` for a whole group puts all of its fields back.
   *
   * Unusable values become issues (`onIssues`, the result, {@link Gantt.getIssues}) and their
   * defaults are used; nothing throws.
   *
   * @param patch - The options to change.
   * @returns The issues of the options now in use: the core's and the renderer's, one list.
   */
  readonly setOptions: (patch: GanttOptionsPatch<TData>) => readonly Issue[];

  // ---- view ----

  /**
   * Switches the view mode: the date at the centre of the viewport stays in place
   * unless `keepScroll` is `false`. The chart scrolls itself in its next frame; there is nothing
   * to apply (`gantt.core.setViewMode` returns the request the renderer applies).
   */
  readonly setViewMode: (...args: Parameters<GanttCore<TData>['setViewMode']>) => void;
  /** Sets the zoom level of the current view mode, keeping the anchor date in place. */
  readonly zoomTo: (...args: Parameters<GanttCore<TData>['zoomTo']>) => void;
  /** Scrolls a date into view; the infinite timeline grows first. */
  readonly scrollToDate: (...args: Parameters<GanttCore<TData>['scrollToDate']>) => void;
  /** Scrolls today into view. */
  readonly scrollToToday: (...args: Parameters<GanttCore<TData>['scrollToToday']>) => void;
  /** Scrolls a task's row and bar into view, on both axes; collapsed ancestors are expanded. */
  readonly scrollToTask: (...args: Parameters<GanttCore<TData>['scrollToTask']>) => void;
  /** Scrolls to a position on either axis or both; an axis left out stays where it is. */
  readonly scrollTo: (...args: Parameters<GanttCore<TData>['scrollTo']>) => void;

  // ---- rows and selection ----

  /** Expands a parent. */
  readonly expand: GanttCore<TData>['expand'];
  /** Collapses a parent. */
  readonly collapse: GanttCore<TData>['collapse'];
  /** Expands a collapsed parent and collapses an expanded one. */
  readonly toggle: GanttCore<TData>['toggle'];
  /** Expands every parent. */
  readonly expandAll: GanttCore<TData>['expandAll'];
  /** Collapses every parent. */
  readonly collapseAll: GanttCore<TData>['collapseAll'];
  /** Replaces the selected tasks; unknown ids are left out. */
  readonly select: GanttCore<TData>['select'];
  /** Selects a link, or none with `undefined`. */
  readonly selectLink: GanttCore<TData>['selectLink'];
  /** Clears the selected tasks and the selected link. */
  readonly clearSelection: GanttCore<TData>['clearSelection'];
  /** Lights the row of a task from outside the chart; `undefined` gives it back to the pointer. */
  readonly setHoveredRow: GanttCore<TData>['setHoveredRow'];
  /** Says which task's row has the keyboard focus; a task list moves the focus to it. */
  readonly focusTask: GanttCore<TData>['focusTask'];

  // ---- queries ----

  /** A task as a public record; `undefined` for an unknown id. */
  readonly getTask: GanttCore<TData>['getTask'];
  /** A link of the graph; `undefined` for an unknown id. */
  readonly getLink: GanttCore<TData>['getLink'];
  /** The dates at the viewport's left and right edges. */
  readonly getVisibleRange: GanttCore<TData>['getVisibleRange'];
  /** Where a task's row lies, in body px; `undefined` when hidden. */
  readonly getRowMetrics: GanttCore<TData>['getRowMetrics'];
  /** Where a task's bar lies as drawn (a drag in progress included), in body px. */
  readonly getBarRect: GanttCore<TData>['getBarRect'];
  /** The visible rows in order, the same array until a row changes (`onRowsChange`). */
  readonly getRows: GanttCore<TData>['getRows'];
  /** Which rows the chart draws now, for a list that draws the same ones. */
  readonly getRowWindow: GanttCore<TData>['getRowWindow'];
  /** The chart's sizes: header, rows, content and viewport. */
  readonly getLayoutMetrics: GanttCore<TData>['getLayoutMetrics'];
  /** The theme, the height and the row display the chart has now. */
  readonly getAppearance: () => GanttAppearance;
  /**
   * The current problems of the data and of the options. `options` is the core's issues and
   * the renderer's in one list, the same one `onIssues` reports as `source: 'options'`.
   */
  readonly getIssues: () => GanttIssues;
  /** Closes the popover that is open: a task tooltip, the link menu or a day label. */
  readonly hideTooltip: () => void;
  /**
   * Moves the browser's focus to the bar of a task and scrolls to it: `focusTask` says which task
   * has the focus, and does not take it from where it is. Does nothing unless `keyboard.barFocus`
   * is on, the chart is mounted and the task has a bar in a visible row.
   */
  readonly focusBar: (id: TaskId) => void;

  // ---- edit session and history ----

  /** The edit session: `begin`, `commit`, `rollback`, `getChanges`, `isOpen`, `isDirty`. */
  readonly edit: GanttCore<TData>['edit'];
  /** Undoes the last action; needs `history`. */
  readonly undo: GanttCore<TData>['undo'];
  /** Redoes the last undone action. */
  readonly redo: GanttCore<TData>['redo'];
  /** Whether `undo()` has an entry. */
  readonly canUndo: boolean;
  /** Whether `redo()` has an entry. */
  readonly canRedo: boolean;

  // ---- events and life cycle ----

  /**
   * Adds a listener with the same payload as the `on<Name>` option, or of `appearanceChange`,
   * which has no option: `getAppearance` changed.
   *
   * @returns A function that removes it (idempotent).
   */
  readonly on: <K extends keyof GanttChartEventMap>(
    name: K,
    handler: GanttChartEventMap<TData>[K],
  ) => Unsubscribe;
  /**
   * Removes everything the chart added to its container, then destroys its core; safe to call
   * twice.
   */
  readonly destroy: () => void;
  /**
   * The chart's core, the escape hatch for what the facade leaves out: the snapshot and its
   * subscription, scroll requests, `setViewport` and `send` for a custom input.
   */
  readonly core: GanttCore<TData>;
}

/**
 * Events the facade fans out itself: `issues`, whose payload merges in the renderer's options, and
 * `appearanceChange`, of options the core does not have.
 */
interface Bus {
  readonly issues: IssuesPayload;
  readonly error: ErrorPayload;
  readonly appearanceChange: GanttAppearance;
}

const NO_ISSUES: readonly OptionIssue[] = Object.freeze([]);
const noop = (): void => undefined;

/** What the chart takes from the core as it is. */
const SAME = [
  'setTasks',
  'setLinks',
  'updateTask',
  'addLink',
  'removeLink',
  'expand',
  'collapse',
  'toggle',
  'expandAll',
  'collapseAll',
  'select',
  'selectLink',
  'clearSelection',
  'setHoveredRow',
  'focusTask',
  'getTask',
  'getLink',
  'getVisibleRange',
  'getRowMetrics',
  'getBarRect',
  'getRows',
  'getRowWindow',
  'getLayoutMetrics',
  'edit',
  'undo',
  'redo',
] as const;

/**
 * What makes the renderer scroll: the core returns the request that the renderer applies, and
 * the chart returns nothing.
 */
const SCROLLING = [
  'setViewMode',
  'zoomTo',
  'scrollToDate',
  'scrollToToday',
  'scrollToTask',
  'scrollTo',
] as const;

/**
 * A chart made by {@link createChart}: the facade `createGantt` returns, and the means to put
 * its renderer in a container, take it out and put it back (`@ganttlane/dom/facade`).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttChart<TData = unknown> {
  /** The chart's methods, the object `createGantt` returns; its `destroy()` ends the chart. */
  readonly gantt: Gantt<TData>;
  /**
   * Mounts the renderer into `container` (empty, with a height), in place of the one mounted
   * before, if any. The chart draws what its options say now, including what was set while
   * nothing was mounted (`setOptions` keeps the renderer's part for the next mount). Throws
   * what `mountRenderer` throws, and the chart stays usable, without a renderer; throws a
   * `TypeError` when `container` is not an element, and then the renderer that is mounted stays.
   * Does nothing after `gantt.destroy()`.
   */
  readonly mount: (container: HTMLElement) => void;
  /**
   * Removes the renderer: its nodes, listeners, observers and timer. The core and the state
   * stay, the chart keeps working headless, and `mount` draws it again. Does nothing when
   * nothing is mounted.
   */
  readonly unmount: () => void;
}

/**
 * Creates a chart (the core, the routing of the options and the merge of the issues) that need
 * not be mounted at once: the part of `createGantt` that needs no DOM, for bindings that get
 * their container later (React) or draw into it more than once. Given a `container` it mounts at
 * once, which is exactly what {@link createGantt} does. Without one nothing touches the DOM until
 * `mount`, so it also runs on a server, and `gantt.core.getSnapshot()` already answers.
 *
 * `createGantt` and `createChart` share every line of option routing, validation and issue
 * merging, and the rest of this text applies to both. The container should be empty and have a
 * height (or give the chart its own with `layout.height`). The stylesheet
 * (`@ganttlane/dom/styles.css`) is a separate import.
 *
 * **Options.** The core's options go to the core, the renderer's to the renderer: `theme` is
 * `data-theme`, `strings` the text the chart writes, `layout.height` the height, `display` the
 * plain display options and `highlights`, `tooltip`, `linkMenu` and `highlightTooltip` the
 * rest of the display (see {@link GanttOptions}). Defaults: `locale` `'en'` (not the browser's, so
 * that a server and a browser draw the same text), `theme` `'auto'`, `timeline.infinite` off.
 * `linkMenu.onRemove` is the chart's own `removeLink` unless you give yours. Keys nobody knows
 * are ignored; the caller's options, tasks and links are never mutated.
 *
 * **Issues.** The core validates its options and data; `createGantt` validates the renderer's
 * the same way: a problem is an `invalid-option` issue with the full path of the value
 * (`tooltip.trigger`, `display.gridLines`, `layout.height`, `highlights[1].dates`,
 * `strings.removeLink`, `onIssues`, …) and the option's default is used instead (a highlight
 * with a field of the wrong kind keeps the rest; one that is no object, has no id or repeats an
 * earlier id is left out). A value planned for a later release is an `unsupported-option`:
 * `toolbar` when enabled, `direction: 'rtl'` (drawn left to right), `tooltip.trigger: 'focus'`
 * (opens nothing yet) and `display.stickyBarLabels` / `display.expectedProgress` set to `true`
 * (accepted, drawn as if off). Both kinds are one list: `getIssues().options`,
 * the result of `setOptions` and the `issues` event (`source: 'options'`), which fires when that
 * list changes, also at creation. The renderer's issues follow the core's in the list. The
 * `issues` listeners (`onIssues`, `on('issues')`) are the chart's own, not the core's: one that
 * throws does not stop the others, and its error goes to `onError` when the core's issues
 * changed, as for every event, but is rethrown by `setOptions` (or `createGantt`) when only the
 * renderer's issues changed, since the core has no event to carry it.
 *
 * **Events.** `on<Event>` options and `on(name, handler)` take the same payloads;
 * the facade adds none. `setOptions({ onX })` swaps a handler in O(1)
 * without recreating or redrawing anything.
 *
 * @typeParam TData - Type of `task.data`.
 * @param options - Tasks, links and options, see {@link GanttOptions}.
 * @param container - Element to render into at once; left out, call `mount` later.
 * @returns The chart.
 * @throws {TypeError} When `container` is given and is not an element (checked before anything
 * is created).
 */
export function createChart<TData = unknown>(
  options: GanttOptions<TData>,
  container?: HTMLElement,
): GanttChart<TData> {
  // Before a core is made, so that a wrong container costs nothing and names the caller.
  if (container !== undefined) assertContainer(container, 'createChart');
  const given: Readonly<Record<string, unknown>> = isRecord(options) ? options : {};
  let destroyed = false;
  const bus = createEmitter<Bus>();
  // A function, or none: anything else is reported by `checkVisual` and is no handler.
  const handlerOf = (value: unknown): Listener<IssuesPayload> | undefined =>
    typeof value === 'function' ? (value as Listener<IssuesPayload>) : undefined;
  let onIssues = handlerOf(given.onIssues);
  // The issue handler of the option, first among the listeners so that it keeps its place.
  bus.on('issues', (payload) => {
    onIssues?.(payload);
  });

  // ---- the renderer's issues, merged into the core's ----

  const own = new Map<string, readonly OptionIssue[]>();
  /** The renderer's issues, one list; the same list while they are equal. */
  let ownList = NO_ISSUES;
  /** The renderer's issues the last `issues` event of the options carried. */
  let shown = NO_ISSUES;
  let merged: readonly [readonly Issue[], readonly Issue[], readonly Issue[]] | undefined;
  const merge = (list: readonly Issue[]): readonly Issue[] => {
    if (ownList.length === 0) return list;
    if (merged?.[0] !== list || merged[1] !== ownList) {
      merged = [list, ownList, Object.freeze([...list, ...ownList])];
    }
    return merged[2];
  };
  const record = (found: ReturnType<typeof checkVisual>): void => {
    let changed = false;
    for (const [key, list] of found) {
      const known = own.get(key);
      if (list.length === 0) changed = own.delete(key) || changed;
      else if (known === undefined || !sameIssues(known, list)) {
        own.set(key, list);
        changed = true;
      }
    }
    if (changed) {
      ownList =
        own.size === 0 ? NO_ISSUES : Object.freeze(ISSUE_KEYS.flatMap((key) => own.get(key) ?? []));
    }
  };
  // One way out for the options' issues: whatever the core reports comes through the bridge, with
  // the renderer's issues behind it, and a change of the renderer's issues alone is sent by `sync`.
  const bridge = (payload: IssuesPayload): void => {
    if (payload.source !== 'options') {
      bus.emit('issues', payload);
      return;
    }
    shown = ownList;
    bus.emit('issues', Object.freeze({ source: 'options', issues: merge(payload.issues) }));
  };

  record(checkVisual(given));
  const core = createGanttCore<TData>({
    ...coreOf(given),
    onIssues: bridge,
  } as GanttCoreOptions<TData>);
  const removeLink = (link: { readonly id: string }): unknown => core.removeLink(link.id);
  const sync = (): void => {
    if (shown === ownList) return;
    shown = ownList;
    bus.emit(
      'issues',
      Object.freeze({ source: 'options', issues: merge(core.getIssues().options) }),
    );
  };

  // What the renderer draws, kept here so that it outlives a renderer: the theme and the height as
  // last given, the display and the strings resolved the way the renderer resolves them.
  let theme = given.theme as ThemeOption | undefined;
  let height = (given.layout as { height?: HeightOption } | undefined)?.height;
  let display: ResolvedDisplay = resolveDisplay(displayOf(given, true, removeLink));
  let strings: GanttStrings = resolveStrings(given.strings as GanttStringsInput | undefined);
  let multiSelect = isRecord(given.selection) && given.selection.multiple === true;
  let renderer: MountedRenderer<GanttCore<TData>> | undefined;
  const appearanceNow = (): GanttAppearance =>
    Object.freeze({
      theme: resolveTheme(theme),
      height: resolveHeight(height),
      rowStripes: display.rowStripes,
      rowHover: display.rowHover,
      multiSelect,
    });
  let appearance = appearanceNow();
  const syncAppearance = (): void => {
    const next = appearanceNow();
    if (JSON.stringify(next) === JSON.stringify(appearance)) return;
    appearance = next;
    bus.emit('appearanceChange', next);
  };
  const unmount = (): void => {
    const mounted = renderer;
    renderer = undefined;
    mounted?.destroy();
  };
  const mount = (target: HTMLElement): void => {
    if (destroyed) return;
    // Before the renderer that is mounted is taken down: a typo must not cost the chart its view.
    assertContainer(target, 'mount');
    unmount();
    renderer = mountRenderer(target, core, {
      ...(given.renderer as GanttMountOptions | undefined),
      theme,
      strings,
      height,
      display,
    });
  };
  try {
    if (container !== undefined) mount(container);
    sync();
  } catch (error) {
    try {
      unmount();
    } finally {
      core.destroy();
    }
    throw error;
  }

  const getIssues = (): GanttIssues => {
    const found = core.getIssues();
    return ownList.length === 0
      ? found
      : Object.freeze({ data: found.data, options: merge(found.options) });
  };
  const setOptions = (patch: GanttOptionsPatch<TData>): readonly Issue[] => {
    if (destroyed) return getIssues().options;
    const source: Readonly<Record<string, unknown>> = isRecord(patch) ? patch : {};
    record(checkVisual(source));
    // The renderer's part first, so that the core's listeners see the chart whole. It is kept
    // while nothing is mounted too: the next mount draws it.
    if ('theme' in source) {
      theme = source.theme as ThemeOption | undefined;
      renderer?.setTheme(source.theme as ThemeOption);
    }
    if ('strings' in source) {
      const stringsPatch = isRecord(source.strings) ? source.strings : resetOf(DEFAULT_STRINGS);
      strings = resolveStrings(stringsPatch, strings);
      renderer?.setStrings(stringsPatch);
    }
    if ('layout' in source) {
      const layout = source.layout;
      if (!isRecord(layout)) height = undefined;
      else if ('height' in layout) height = layout.height as HeightOption | undefined;
      if (!isRecord(layout) || 'height' in layout) renderer?.setHeight(height);
    }
    const displayPatch = displayOf(source, false, removeLink);
    if (displayPatch !== undefined) {
      display = resolveDisplay(displayPatch, display);
      renderer?.setDisplay(displayPatch);
    }
    if ('onIssues' in source) onIssues = handlerOf(source.onIssues);
    if ('selection' in source) {
      const { selection } = source;
      if (!isRecord(selection)) multiSelect = false;
      else if ('multiple' in selection) multiSelect = selection.multiple === true;
    }
    const forCore = coreOf(source);
    try {
      if (!isRecord(patch)) core.setOptions(patch);
      else if (Object.keys(forCore).length > 0) core.setOptions(forCore);
    } finally {
      // Also when a listener of the core threw: the renderer's issues are news all the same.
      sync();
      syncAppearance();
    }
    return getIssues().options;
  };

  const same = Object.fromEntries(SAME.map((name) => [name, core[name]])) as Pick<
    GanttCore<TData>,
    (typeof SAME)[number]
  >;
  const scrolling = Object.fromEntries(
    SCROLLING.map((name) => [
      name,
      (...args: unknown[]): void => {
        (core[name] as (...args: unknown[]) => unknown)(...args);
      },
    ]),
  ) as { [K in (typeof SCROLLING)[number]]: (...args: Parameters<GanttCore<TData>[K]>) => void };
  const gantt: Gantt<TData> = {
    ...same,
    ...scrolling,
    core,
    setOptions,
    getIssues,
    hideTooltip: () => {
      renderer?.hideTooltip();
    },
    focusBar: (id) => {
      renderer?.focusBar(id);
    },
    get canUndo() {
      return core.canUndo;
    },
    get canRedo() {
      return core.canRedo;
    },
    getAppearance: () => appearance,
    on: (name, handler) =>
      name !== 'issues' && name !== 'appearanceChange'
        ? core.on(name, handler as GanttEventMap<TData>[GanttEventName])
        : destroyed
          ? noop
          : bus.on(name as 'issues', handler as Listener<IssuesPayload>),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        unmount();
      } finally {
        core.destroy();
        bus.clear();
      }
    },
  };
  return { gantt, mount, unmount };
}

/**
 * Creates a chart in `container`: a core made from the options, the DOM renderer
 * mounted on it, and one object with every method of the chart ({@link Gantt}). The container
 * should be empty and have a height (or give the chart its own with `layout.height`). The
 * stylesheet (`@ganttlane/dom/styles.css`) is a separate import. How the options are routed,
 * validated and their issues merged is described at {@link createChart}, which this function is a
 * call of.
 *
 * @typeParam TData - Type of `task.data`.
 * @param container - Element to render into.
 * @param options - Tasks, links and options, see {@link GanttOptions}.
 * @returns The chart.
 * @throws {TypeError} When `container` is not an element: a selector string, `null` (a
 * `querySelector` that found nothing), another kind of node. An element of another window or
 * document is fine.
 *
 * @example
 * ```ts
 * import '@ganttlane/dom/styles.css';
 * import { createGantt } from '@ganttlane/dom';
 *
 * const gantt = createGantt(container, {
 *   tasks,
 *   links,
 *   viewMode: 'week',
 *   theme: 'dark',
 *   tooltip: { delay: 300 },
 *   onTasksChange: (changes) => save(changes),
 * });
 * gantt.setOptions({ theme: 'light', locale: 'uk' });
 * gantt.scrollToTask('design');
 * gantt.destroy();
 * ```
 */
export function createGantt<TData = unknown>(
  container: HTMLElement,
  options: GanttOptions<TData>,
): Gantt<TData> {
  assertContainer(container, 'createGantt');
  return createChart(options, container).gantt;
}

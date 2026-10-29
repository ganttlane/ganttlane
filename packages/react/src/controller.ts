import type {
  BarLabelContext,
  GanttCore,
  GanttEventMap,
  GanttEventName,
  GanttOptions,
  Link,
  LinkMenuContext,
  LinkRecord,
  SessionChanges,
  Task,
  TaskId,
  TaskTooltipContext,
} from '@ganttlane/dom';
import { createChart, type GanttChart } from '@ganttlane/dom/facade';

import { isDev, warn } from './dev';
import {
  CONTROLLED_KEYS,
  type ControlledKey,
  diffOptions,
  equalData,
  type Fields,
  isRecord,
  modesOf,
  splitProps,
} from './options';
import { createSlots, type SlotRenders } from './slots';
import type { ExpandedKeys, GanttHandle, GanttInstance, GanttReactOptions } from './types';

/** An event the application is to hear, as the key of its handler and the handler's arguments. */
type Pending = readonly [key: string, args: unknown[]];

/**
 * What a chart keeps while its component is hidden by `<Activity>`: effects are torn down and set
 * up again, and the core, which cannot be restarted, is made again from this and the props.
 */
interface Carry<TData> {
  readonly tasks: readonly Task<TData>[];
  readonly links: readonly Link[] | undefined;
  readonly viewMode: string;
  readonly expandedKeys: ExpandedKeys;
  readonly selection: readonly TaskId[];
  /** The selected link. */
  readonly link: string | undefined;
  /** The zoom (`pxPerDay`) when `zoomTo` set it, `undefined` while it is the view mode's own. */
  readonly zoom: number | undefined;
  /** The date at the left edge of the viewport; `undefined` if the chart was never sized. */
  readonly edge: Date | undefined;
  /**
   * What the application is told once the chart is there again: what a chart made again lost that
   * it had been told of (an edit session that was open, the undo history).
   */
  readonly ended: readonly Pending[];
}

/** The part of the chart's life that belongs to one component, see {@link createController}. */
export interface Controller<TData> {
  /** The chart as the component hands it out: the same object for the life of the component. */
  readonly instance: GanttInstance<TData>;
  /**
   * What `<Gantt ref>` gives: the instance's members but those that are for React
   * (`setContainer`, `slots`), as an object of its own, so that they are out of reach at run time too.
   */
  readonly handle: GanttHandle<TData>;
  /**
   * Called after every commit (a layout effect): brings the chart to the props and makes the
   * handlers current. Events the chart emitted before (those of its creation, of a chart made
   * again) are held back until {@link Controller.settle}.
   */
  update(props: GanttReactOptions<TData>): void;
  /**
   * Called after {@link Controller.update}, in a layout effect that is declared after whatever
   * else should be in place when the application hears of the first events (`<Gantt>` sets its
   * `ref` first): lets the held-back events through, in order.
   */
  settle(): void;
  /** Effects were set up: a destroy that was about to happen is called off. */
  retain(): void;
  /** Effects were torn down: the chart is destroyed unless they are set up again at once. */
  release(): void;
}

type Handler = (...args: unknown[]) => unknown;

/** Calls `run` with the given handler keys silenced, so that a change we make is no event. */
type Quietly = (keys: readonly string[], run: () => void) => void;

/** A handler of the application that threw while the controller was driving the chart. */
interface Failure {
  /** The event it was a handler of (`'rangeChange'`), as the core names it. */
  readonly name: string;
  readonly error: unknown;
}

/** What a chart and its core both have for adding a listener. */
interface Listening {
  readonly on: (name: GanttEventName, handler: Handler) => () => void;
}

/** A listener of `instance.on` or `instance.core.on`: it outlives the core it was added to. */
interface Registered {
  readonly name: GanttEventName;
  /** As the application gave it. */
  readonly handler: Handler;
  /** Adds it to the chart there is now; returns what removes it. */
  readonly attach: () => () => void;
  off: () => void;
}

/**
 * Delegates the methods, getters and nested method objects of `sample` (but those in `omit`) to whatever
 * `target()` returns now, so one object stays the chart's face while the chart behind it is
 * replaced. It reads the property descriptors, so a getter stays a getter.
 */
function delegate<T extends object>(sample: T, target: () => T, omit: readonly string[] = []): T {
  const result: Record<string, unknown> = {};
  const at = (): Record<string, unknown> => target() as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(sample))) {
    if (omit.includes(key)) continue;
    if (typeof descriptor.value === 'function') {
      result[key] = (...args: unknown[]): unknown => (at()[key] as Handler)(...args);
    } else if (descriptor.get !== undefined) {
      Object.defineProperty(result, key, { enumerable: true, get: () => at()[key] });
    } else if (typeof descriptor.value === 'object' && descriptor.value !== null) {
      result[key] = delegate(descriptor.value, () => at()[key] as object);
    }
  }
  return result as T;
}

/** The functions of the slots among the props, by kind: those that are functions. */
function rendersOf(props: Fields): SlotRenders {
  const pick = (value: unknown): SlotRenders['tooltip'] =>
    typeof value === 'function' ? (value as SlotRenders['tooltip']) : undefined;
  return {
    tooltip: pick(props.renderTooltip),
    linkMenu: pick(props.renderLinkMenu),
    barLabel: pick(props.renderBarLabel),
  };
}

/** The handler keys the chart listens to besides the application's, for the controlled groups. */
const OBSERVED: Readonly<Record<string, ControlledKey>> = {
  onSelectionChange: 'selectedKeys',
  onViewModeChange: 'viewMode',
  onExpandedChange: 'expandedKeys',
};

/**
 * The groups whose value is data that may be loaded after the first render
 * (`tasks={data?.tasks}`): a group that goes from `undefined` to a value becomes controlled, instead
 * of being ignored, which would leave a chart that is empty for good.
 */
const UPGRADABLE: ReadonlySet<ControlledKey> = new Set(['tasks', 'links']);

/** The event a handler key is for (`'onRangeChange'` is `'rangeChange'`), as the core names it. */
const eventOf = (key: string): string => key.charAt(2).toLowerCase() + key.slice(3);

/** A before-hook: the core uses its answer, and reports its errors by itself (`source: 'hook'`). */
const isHook = (key: string): boolean => key.startsWith('onBefore');

/** Whether `a` and `b` have the same tasks, whatever the order. */
const sameTasks = (a: readonly TaskId[], b: readonly TaskId[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Whether the editing option lets the user change a task's dates or progress (`move`, `resize`,
 * `progress`; on unless it is `false`, as in the core); not the per-task `editable` overrides.
 */
const editsTasks = (editing: unknown): boolean =>
  isRecord(editing)
    ? ['move', 'resize', 'progress'].some((flag) => editing[flag] !== false)
    : editing !== false;

/** The prop of each slot kind, which names its errors. */
const SLOT_PROPS = {
  tooltip: 'renderTooltip',
  linkMenu: 'renderLinkMenu',
  barLabel: 'renderBarLabel',
} as const;

/**
 * Hands errors to the host's unhandled-rejection channel instead of throwing them, as the core
 * does where it must not throw: one `Error` as it is, anything else as an `AggregateError`.
 */
function reportLater(errors: readonly unknown[]): void {
  const [only] = errors;
  void Promise.reject(
    errors.length === 1 && only instanceof Error
      ? only
      : new AggregateError(errors, `${errors.length} listeners threw`),
  );
}

/**
 * Makes the chart of one component: the core, the vanilla renderer in the component's container,
 * and everything between them and React. It is what `useGantt` is, without hooks, so that the
 * rules are in one place and testable.
 *
 * **Lifetime.** The chart (`createChart`) is made when the component first renders, so that the
 * core answers during that render and on a server; nothing outside the chart's own objects is
 * touched until a container is attached. The renderer follows the container (`setContainer`).
 * The core ends in `release`, not at once: an effect cleanup also runs when React only simulates
 * an unmount (StrictMode, Fast Refresh, `<Activity>`), and a microtask later is when a real
 * unmount can be told from those, since the effect is set up again before it. A chart that was
 * destroyed and is then needed again is made anew and keeps its state ({@link Carry}); what the
 * application had been told and the new chart cannot keep, it is told has ended. The instance
 * (`core` too, with its `subscribe` and `on`) is one object whichever core is behind it.
 *
 * **Props.** `update` sends the core what changed between two commits, compared the way
 * `setOptions` merges (`diffOptions`), and makes the handlers current: the core is given one
 * stable function per handler key that reads the latest props, so a handler that is new on every
 * render costs nothing.
 *
 * **Events.** The application's handlers are never called while React renders, and what they
 * throw never reaches React: a handler that throws while the controller drives the chart (`update`,
 * `settle`) is reported the way the core reports a listener's error, to `onError` with
 * `source: 'listener'` and the event's name, and without a listener of `error` outside the commit.
 * Where the core drives the chart (a click) it does that by itself.
 *
 * **Slots.** `renderTooltip`, `renderLinkMenu` and `renderBarLabel` are not options: the chart is given
 * one stable function of its own for each, in the place of the vanilla `tooltip.render`,
 * `linkMenu.render` and `display.renderBarLabel` (`withSlots`), which asks `createSlots` for a
 * host node that React fills through a portal. The application's functions go to the slots
 * (`slots.update`) after every commit, so the latest one draws and the chart is told nothing.
 *
 * **Controlled groups.** A controlled value is pushed when the prop changes. When the chart
 * changes it by itself (an event the chart emits and the props did not cause), the application's
 * handler runs and the component renders again, which sets the chart back to the prop:
 * the value changes only when the application's state does. `tasks` and `links` are loaded data:
 * going from `undefined` to a value makes them controlled (once, with a warning in development).
 *
 * @param initial - The props of the first render.
 * @param requestRender - Renders the component again (a state update).
 * @returns The controller.
 */
export function createController<TData>(
  initial: GanttReactOptions<TData>,
  requestRender: () => void,
): Controller<TData> {
  const first = initial as unknown as Fields;
  /** Whether each group is controlled: decided at the first render, and kept (but see `UPGRADABLE`). */
  const modes: Record<ControlledKey, boolean> = { ...modesOf(first) };
  let latest: Fields = first;
  /** The option values the chart has, as the last `update` (or the creation) left them. */
  let applied: Fields = {};
  /** The selected tasks the chart was last told to have (controlled `selectedKeys`). */
  let appliedSelection: readonly TaskId[] | undefined;
  /**
   * An uncontrolled start selection (`defaultSelectedKeys`) that names tasks the chart does not
   * have yet (they load later): the keys, and the selection they made, which tells whether anyone
   * has selected something else since.
   */
  let startSelection:
    { readonly keys: readonly TaskId[]; readonly made: readonly TaskId[] } | undefined;
  let chart: GanttChart<TData>;
  let container: HTMLElement | null = null;

  // ---- slots ----

  // The three functions the renderer is given for a slot (stable: giving them again is no change).
  // Each asks the slots for a host that React fills, whatever the application's function is now.
  // A slot function's error goes where a handler's does (`onError`, the `error` listeners, else
  // the host's rejection channel), named after the prop that threw. `report` is declared below;
  // slots only call it once the chart draws, long after this factory has run.
  const slots = createSlots(
    () => container?.ownerDocument,
    (error, kind) => {
      report([{ name: SLOT_PROPS[kind], error }]);
    },
  );
  slots.update(rendersOf(first));
  const slotted = {
    tooltip: (context: TaskTooltipContext<TData>) =>
      slots.acquire('tooltip', context.task.id, context),
    linkMenu: (context: LinkMenuContext<TData>) =>
      slots.acquire('linkMenu', context.link.id, context),
    barLabel: (context: BarLabelContext<TData>) => slots.acquire('barLabel', context.id, context),
  };
  let destroyed = false;
  let pendingDestroy = false;
  let carry: Carry<TData> | undefined;

  // ---- events ----

  /**
   * Whether the handlers are called: not before the first commit (`'queue'`: the events of the
   * creation and of the mount wait, the render must not call the application), and not while a
   * chart is made again (`'drop'`: the application has seen those events).
   */
  let gate: 'queue' | 'open' | 'drop' = 'queue';
  const queued: Pending[] = [];
  const quiet = new Set<string>();
  const trampolines = new Map<string, Handler>();
  const warned = new Set<string>();
  /** Controlled groups the chart changed by itself, to be set back to their prop. */
  const diverged = new Set<ControlledKey>();
  /** Listeners of the snapshot, and the application's `instance.on` listeners: they outlive a core. */
  const watchers = new Set<() => void>();
  let stopWatching: (() => void) | undefined;
  const listeners = new Set<Registered>();
  /**
   * Where a handler's error is kept while the controller drives the chart (`update`, `settle`):
   * React's commit must not be thrown into, and the core cannot route what a listener throws
   * where it had no event to carry it. `undefined` otherwise: the core routes the error.
   */
  let failures: Failure[] | undefined;

  const quietly: Quietly = (keys, run) => {
    const added = keys.filter((key) => !quiet.has(key));
    for (const key of added) quiet.add(key);
    try {
      run();
    } finally {
      for (const key of added) quiet.delete(key);
    }
  };

  /**
   * Runs the application's code for the event `name` (`undefined` for a before-hook, whose answer
   * is the core's): while `failures` is kept, what it throws is kept there instead.
   */
  const guard = (name: string | undefined, run: () => unknown): unknown => {
    if (failures === undefined || name === undefined) return run();
    try {
      return run();
    } catch (error) {
      failures.push({ name, error });
      return undefined;
    }
  };

  const diverge = (key: ControlledKey): void => {
    if (!modes[key]) return;
    diverged.add(key);
    requestRender();
  };

  /**
   * `onLinksChange`: the links after the link event that has just happened, as a list the
   * application can pass back. The base is the application's `links` when they are controlled,
   * else what the chart has, which at the time of the event is what it had before the change
   * (the snapshot is published when the operation ends), so the change is put on it, once.
   */
  const linksChanged = (key: string, argument: unknown): void => {
    const notify = latest.onLinksChange as ((links: readonly Link[]) => void) | undefined;
    if (typeof notify !== 'function') return;
    const own = chart.gantt.core.getSnapshot().state.links ?? [];
    const base = (modes.links ? (latest.links as readonly Link[] | undefined) : undefined) ?? own;
    const scheduling = isRecord(latest.scheduling) ? latest.scheduling : {};
    const standard =
      typeof scheduling.defaultLinkType === 'string' ? scheduling.defaultLinkType : 'FS';
    const idOf = (link: Link): string =>
      link.id ?? `${link.source}:${link.type ?? standard}:${link.target}`;
    if (key === 'onLinkCreate') {
      const link = argument as Link;
      notify(base.some((known) => idOf(known) === idOf(link)) ? base : [...base, link]);
      return;
    }
    const gone = (argument as LinkRecord).id;
    const next = base.filter((link) => idOf(link) !== gone);
    // A link that came from `task.dependencies` is in no list of links: nothing to remove.
    if (next.length !== base.length) notify(next);
  };

  /** What happens when the chart emits an event the application may listen to. */
  const deliver = (key: string, args: unknown[]): unknown => {
    const user = latest[key];
    try {
      return typeof user === 'function' ? (user as Handler)(...args) : undefined;
    } finally {
      const group = OBSERVED[key];
      if (group !== undefined) diverge(group);
      else if (key === 'onLinkCreate' || key === 'onLinkDelete') {
        linksChanged(key, args[0]);
        diverge('links');
      }
    }
  };

  /** The one function the core is given for a handler key: it calls the latest props' handler. */
  const trampoline = (key: string): Handler => {
    let call = trampolines.get(key);
    if (call === undefined) {
      call = (...args) => {
        if (gate === 'drop' || quiet.has(key)) return undefined;
        if (gate === 'queue') {
          queued.push([key, args]);
          return undefined;
        }
        return guard(isHook(key) ? undefined : eventOf(key), () => deliver(key, args));
      };
      trampolines.set(key, call);
    }
    return call;
  };

  /**
   * Gives what failed to the chart's error channel, as the core gives it a listener's error:
   * `onError` and the listeners of `error` hear `{ error, source: 'listener', name }`. Without any,
   * and for what those throw, the errors go to the host's unhandled-rejection channel together.
   */
  const report = (found: readonly Failure[]): void => {
    if (found.length === 0) return;
    const heard: Handler[] = [];
    if (typeof latest.onError === 'function') heard.push(latest.onError as Handler);
    for (const listener of listeners) if (listener.name === 'error') heard.push(listener.handler);
    const lost: unknown[] = [];
    for (const { name, error } of found) {
      if (heard.length === 0) {
        lost.push(error);
        continue;
      }
      const payload = Object.freeze({ error, source: 'listener', name });
      for (const handler of heard) {
        try {
          handler(payload);
        } catch (thrown) {
          lost.push(thrown);
        }
      }
    }
    if (lost.length > 0) reportLater(lost);
  };

  /** The handler keys the chart listens to: the application's, and what the groups need. */
  const handlerKeys = (handlers: Fields, props: Fields): Set<string> => {
    const keys = new Set(Object.keys(handlers));
    for (const [key, group] of Object.entries(OBSERVED)) if (modes[group]) keys.add(key);
    if (modes.links || typeof props.onLinksChange === 'function') {
      keys.add('onLinkCreate');
      keys.add('onLinkDelete');
    }
    return keys;
  };

  // ---- options ----

  /**
   * Puts the chart's function of a slot where the vanilla one goes, for a slot the application
   * gave: in the group the vanilla function is a field of, with the group's other fields kept.
   * The slot wins over the vanilla function (one dev warning).
   */
  const withSlots = (out: Record<string, unknown>, props: Fields): Record<string, unknown> => {
    const place = (prop: string, group: string, field: string, render: unknown): void => {
      if (typeof props[prop] !== 'function') return;
      const fields = isRecord(out[group]) ? out[group] : {};
      if (typeof fields[field] === 'function' && !warned.has(prop)) {
        warned.add(prop);
        warn(
          `Both \`${prop}\` and \`${group}.${field}\` were given. \`${prop}\` is used, and the other is ` +
            'ignored.',
        );
      }
      out[group] = { ...fields, [field]: render };
    };
    place('renderTooltip', 'tooltip', 'render', slotted.tooltip);
    place('renderLinkMenu', 'linkMenu', 'render', slotted.linkMenu);
    place('renderBarLabel', 'display', 'renderBarLabel', slotted.barLabel);
    return out;
  };

  /**
   * The options the props ask for, in the shape `applied` has: the options, the controlled
   * values, and one trampoline per handler. A controlled prop that went `undefined` (a switch
   * that is reported and ignored) keeps the value the chart has.
   */
  const wanted = (props: Fields): Fields => {
    const { options, handlers } = splitProps(props);
    const out: Record<string, unknown> = { ...options };
    if (modes.tasks) {
      out.dataMode = 'controlled';
      out.tasks = props.tasks ?? applied.tasks;
    }
    if (modes.links) out.links = props.links ?? applied.links;
    if (modes.viewMode) out.viewMode = props.viewMode ?? applied.viewMode;
    if (modes.expandedKeys) {
      const group = isRecord(options.hierarchy) ? options.hierarchy : {};
      const before = isRecord(applied.hierarchy) ? applied.hierarchy.expandedKeys : undefined;
      out.hierarchy = { ...group, expandedKeys: props.expandedKeys ?? before };
    }
    for (const key of handlerKeys(handlers, props)) out[key] = trampoline(key);
    return withSlots(out, props);
  };

  /** Selects tasks without telling `onSelectionChange`: the application asked for it. */
  const select = (gantt: GanttChart<TData>['gantt'], keys: readonly TaskId[]): void => {
    quietly(['onSelectionChange'], () => {
      gantt.select(keys);
    });
  };

  /** Whether the tasks the chart has selected are not those of `keys` that it knows. */
  const selectionDiffers = (
    gantt: GanttChart<TData>['gantt'],
    keys: readonly TaskId[],
  ): boolean => {
    const selected = new Set(gantt.core.getSnapshot().selection.tasks);
    let found = 0;
    for (const id of new Set(keys)) {
      if (selected.has(id)) found++;
      else if (gantt.getTask(id) !== undefined) return true;
    }
    return found !== selected.size;
  };

  /** Makes the chart: options, the uncontrolled start values, the selection. */
  const build = (props: Fields, carried: Carry<TData> | undefined): GanttChart<TData> => {
    const target = wanted(props);
    const options: Record<string, unknown> = {
      ...target,
      dataMode: modes.tasks ? 'controlled' : 'uncontrolled',
    };
    if (!modes.tasks) options.tasks = carried?.tasks ?? props.defaultTasks ?? [];
    if (!modes.links) {
      const links = carried?.links ?? props.defaultLinks;
      if (links !== undefined) options.links = links;
    }
    if (!modes.viewMode) {
      const viewMode = carried?.viewMode ?? props.defaultViewMode;
      if (viewMode !== undefined) options.viewMode = viewMode;
    }
    if (!modes.expandedKeys) {
      const expandedKeys = carried?.expandedKeys ?? props.defaultExpandedKeys;
      if (expandedKeys !== undefined) {
        const group = isRecord(options.hierarchy) ? options.hierarchy : {};
        options.hierarchy = { ...group, expandedKeys };
      }
    }
    if (isRecord(props.renderer)) options.renderer = props.renderer;
    const made = createChart<TData>(options as unknown as GanttOptions<TData>);
    applied = target;
    const selected = modes.selectedKeys
      ? ((props.selectedKeys as readonly TaskId[] | undefined) ?? appliedSelection)
      : (carried?.selection ?? (props.defaultSelectedKeys as readonly TaskId[] | undefined));
    appliedSelection = modes.selectedKeys ? selected : undefined;
    if (selected !== undefined && selected.length > 0) select(made.gantt, selected);
    // A start selection that names tasks the chart does not have yet is finished when they arrive.
    startSelection = undefined;
    if (
      !modes.selectedKeys &&
      carried === undefined &&
      selected?.some((id) => made.gantt.getTask(id) === undefined)
    ) {
      startSelection = { keys: selected, made: made.gantt.core.getSnapshot().selection.tasks };
    }
    return made;
  };

  /**
   * Dev warning: a group went from controlled to uncontrolled or back. The first mode is kept,
   * but for the loaded data (`UPGRADABLE`) that goes from `undefined` to a value: it is used.
   */
  const checkModes = (props: Fields): void => {
    for (const key of CONTROLLED_KEYS) {
      const controlled = props[key] !== undefined;
      if (controlled === modes[key] || warned.has(key)) continue;
      warned.add(key);
      if (controlled && UPGRADABLE.has(key)) {
        modes[key] = true;
        warn(
          `A chart changed \`${key}\` from undefined to a value. It is controlled from now on, and ` +
            `the value is used. To skip this warning, pass \`${key}\` from the first render ` +
            `(\`${key}={data?.${key} ?? []}\` while the data loads), or give the start value as ` +
            `\`default${key.charAt(0).toUpperCase()}${key.slice(1)}\`.`,
        );
        continue;
      }
      const [was, now] = modes[key]
        ? ['controlled', 'uncontrolled']
        : ['uncontrolled', 'controlled'];
      warn(
        `A chart changed \`${key}\` from ${was} to ${now}. It stays ${was} for its whole life, ` +
          `and the new value is ignored. Pass \`${key}\` on every render (\`undefined\` counts as ` +
          `not passing it), or never, and give the start value as ` +
          `\`default${key.charAt(0).toUpperCase()}${key.slice(1)}\`.`,
      );
    }
  };

  /** Dev warning: controlled tasks that the user can edit, and nothing to give the change to. */
  const checkEditing = (props: Fields): void => {
    if (!modes.tasks || warned.has('onTasksChange')) return;
    if (typeof props.onTasksChange === 'function' || !editsTasks(props.editing)) return;
    warned.add('onTasksChange');
    warn(
      'The `tasks` of the chart are controlled and editing is on, but there is no `onTasksChange`: ' +
        'a change the user makes is never given to you, and stays a draft. Pass `onTasksChange` ' +
        '(write the change set into your tasks with `patchTasks`), or `editing={false}` for a chart ' +
        'that only shows its tasks.',
    );
  };

  /**
   * Dev warning: `tasks` is a new array with the content it had, while a change waits for the owner.
   * A new array is the owner's answer and ends the draft (the bar goes back): wanted after a
   * failed save, not on every render of a parent that derives its tasks.
   */
  const checkDraft = (before: unknown, after: unknown): void => {
    if (!isDev() || warned.has('draft')) return;
    if (chart.gantt.core.getSnapshot().state.draft === undefined || !equalData(before, after))
      return;
    warned.add('draft');
    warn(
      '`tasks` is a new array with the same content as before, while a change you have not ' +
        'applied yet is shown as a draft. A new array ends the draft (the bar goes back to where ' +
        'your tasks have it): right after a failed save, not on every render. Memoize tasks you ' +
        'derive (`useMemo`), and pass a new array only to discard the draft.',
    );
  };

  // ---- the chart ----

  chart = build(first, undefined);

  /**
   * What the chart keeps for the one that replaces it. A session that is open is rolled back
   * first, like a Cancel: its edits are not kept, the data is what it was when the session began,
   * and the application is told once the chart is there again (`ended`), not now, when it may have
   * gone with the component. The old core says nothing to anyone meanwhile.
   */
  const capture = (): Carry<TData> => {
    const { gantt } = chart;
    const ended: Pending[] = [];
    const history = gantt.canUndo || gantt.canRedo;
    const dirty = gantt.edit.isDirty;
    let undone: SessionChanges | undefined;
    if (gantt.edit.isOpen) {
      const was = gate;
      gate = 'drop';
      for (const listener of listeners) listener.off();
      try {
        const result = gantt.edit.rollback();
        if (result.status === 'rolled-back') undone = result.changes;
      } finally {
        gate = was;
      }
    }
    // The new chart has no undo history: what the application was told of it is over.
    if (history)
      ended.push(['onHistoryChange', [Object.freeze({ canUndo: false, canRedo: false })]]);
    if (dirty) ended.push(['onDirtyChange', [Object.freeze({ isDirty: false })]]);
    if (undone !== undefined) ended.push(['onEditRollback', [undone]]);
    const snapshot = gantt.core.getSnapshot();
    const { state } = snapshot;
    return {
      tasks: state.tasks,
      links: state.links,
      viewMode: state.viewModeId,
      expandedKeys: state.expandedKeys,
      selection: snapshot.selection.tasks,
      link: snapshot.selection.link,
      zoom:
        snapshot.timeline.scale.pxPerDay === snapshot.viewMode.pxPerDay
          ? undefined
          : snapshot.timeline.scale.pxPerDay,
      edge: snapshot.timeline.viewportWidth > 0 ? gantt.getVisibleRange().start : undefined,
      ended,
    };
  };

  const notify = (): void => {
    for (const watcher of [...watchers]) watcher();
  };
  const watch = (): void => {
    stopWatching = chart.gantt.core.subscribe(notify);
  };

  /** Makes the chart again after its core was destroyed, with what the old one had. */
  const revive = (): void => {
    destroyed = false;
    // The new core is made from the props: nothing is left to set back.
    diverged.clear();
    // What the chart emits while it is made again, the application has heard once already.
    gate = 'drop';
    try {
      chart = build(latest, carry);
      if (carry !== undefined) {
        const { gantt } = chart;
        if (carry.zoom !== undefined) gantt.zoomTo(carry.zoom);
        // The new core starts where `scroll.initial` says: put it back where the old one was (the
        // request is kept until the chart is sized, and then performed in place of the initial one).
        if (carry.edge !== undefined) {
          gantt.scrollToDate(carry.edge, { align: 'start', behavior: 'instant' });
        }
        if (carry.link !== undefined) gantt.selectLink(carry.link);
        queued.push(...carry.ended);
        carry = undefined;
      }
      if (container !== null) chart.mount(container);
    } finally {
      gate = 'open';
    }
    if (watchers.size > 0) {
      stopWatching?.();
      watch();
    }
    for (const listener of listeners) listener.off = listener.attach();
    notify();
  };

  const settle = (): void => {
    if (gate === 'open' && queued.length === 0) return;
    gate = 'open';
    const found: Failure[] = [];
    failures = found;
    try {
      for (const [key, args] of queued.splice(0)) {
        guard(isHook(key) ? undefined : eventOf(key), () => deliver(key, args));
      }
    } finally {
      failures = undefined;
      report(found);
    }
  };

  /** Brings the chart to the props: the part of an `update` where handler errors are kept. */
  const apply = (props: Fields): void => {
    checkModes(props);
    checkEditing(props);
    slots.update(rendersOf(props));
    // What the chart changed by itself since the last commit; events from here on are the next's.
    const forced = new Set(diverged);
    diverged.clear();
    const target = wanted(props);
    let patch = diffOptions(applied, target);
    if (modes.tasks && patch !== undefined && 'tasks' in patch) {
      checkDraft(applied.tasks, target.tasks);
    }
    applied = target;
    const { gantt } = chart;
    // A controlled group the chart changed itself goes back to its prop, unless the prop is
    // what changed (then the patch has it already).
    if (
      forced.has('viewMode') &&
      modes.viewMode &&
      (patch === undefined || !('viewMode' in patch))
    ) {
      patch = { ...patch, viewMode: target.viewMode };
    }
    if (forced.has('links') && modes.links && (patch === undefined || !('links' in patch))) {
      patch = { ...patch, links: target.links };
    }
    // Links the chart already has are nothing to send: `setLinks` ends the undo history of data
    // that is the chart's own.
    if (modes.links && patch !== undefined && 'links' in patch) {
      if (equalData(patch.links, gantt.core.getSnapshot().state.links)) {
        const { links: _same, ...rest } = patch;
        patch = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }
    let expandAll = false;
    if (forced.has('expandedKeys') && modes.expandedKeys) {
      const group = patch?.hierarchy;
      const given = isRecord(group) && 'expandedKeys' in group;
      const keys = (target.hierarchy as Fields).expandedKeys as ExpandedKeys;
      // The option is compared by identity; a copy is a new value for it. `'all'` has no copy.
      if (!given && keys === 'all') {
        expandAll = true;
      } else if (!given && keys !== 'all') {
        patch = {
          ...patch,
          hierarchy: { ...(isRecord(group) ? group : {}), expandedKeys: [...keys] },
        };
      }
    }
    if (patch !== undefined) {
      const silent = modes.viewMode && 'viewMode' in patch ? ['onViewModeChange'] : [];
      const changes = patch;
      quietly(silent, () => {
        gantt.setOptions(changes);
      });
    }
    if (expandAll) {
      quietly(['onExpandedChange'], () => {
        gantt.expandAll();
      });
    }
    // The selected tasks follow the prop: also when the chart changed them by itself, and when the
    // tasks they name came after them.
    if (modes.selectedKeys) {
      const keys = (props.selectedKeys as readonly TaskId[] | undefined) ?? appliedSelection;
      if (keys !== undefined && selectionDiffers(gantt, keys)) select(gantt, keys);
      appliedSelection = keys;
    }
    if (startSelection !== undefined) {
      const { keys, made } = startSelection;
      if (!sameTasks(gantt.core.getSnapshot().selection.tasks, made)) {
        // Someone selected something else: the start selection is over.
        startSelection = undefined;
      } else if (patch !== undefined && 'tasks' in patch) {
        select(gantt, keys);
        startSelection = keys.some((id) => gantt.getTask(id) === undefined)
          ? { keys, made: gantt.core.getSnapshot().selection.tasks }
          : undefined;
      }
    }
  };

  const update = (props: Fields): void => {
    latest = props;
    if (destroyed) revive();
    const found: Failure[] = [];
    failures = found;
    try {
      apply(props);
    } finally {
      failures = undefined;
      report(found);
    }
  };

  // ---- the instance ----

  const retain = (): void => {
    pendingDestroy = false;
  };
  const release = (): void => {
    pendingDestroy = true;
    queueMicrotask(() => {
      if (!pendingDestroy || destroyed) return;
      pendingDestroy = false;
      carry = capture();
      destroyed = true;
      chart.gantt.destroy();
    });
  };

  const setContainer = (element: HTMLElement | null): void => {
    container = element;
    if (element === null) chart.unmount();
    else if (!destroyed) chart.mount(element);
  };

  const subscribe = (watcher: () => void): (() => void) => {
    watchers.add(watcher);
    if (watchers.size === 1) watch();
    return () => {
      watchers.delete(watcher);
      if (watchers.size === 0) {
        stopWatching?.();
        stopWatching = undefined;
      }
    };
  };

  /**
   * `on` of the instance (`via` the chart) or of its core (`via` the core): the listener is added to
   * whatever chart there is, and again to the next. While the controller drives the chart, what it
   * throws is reported like a handler's.
   */
  const listen =
    (via: (current: GanttChart<TData>) => Listening) =>
    (name: GanttEventName, handler: GanttEventMap<TData>[GanttEventName]) => {
      const call = handler as Handler;
      const attach = (): (() => void) =>
        via(chart).on(name, (...args) => guard(name, () => call(...args)));
      const listener: Registered = {
        name,
        handler: call,
        attach,
        off: destroyed ? () => undefined : attach(),
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        listener.off();
      };
    };

  /**
   * The core as the instance hands it out: one object for the life of the component, that is
   * whichever core the chart has now. `subscribe` and `on` are the instance's own, so that what
   * was added to it outlives the core it was added to.
   */
  const core = Object.freeze(
    Object.defineProperties(
      delegate(chart.gantt.core, () => chart.gantt.core, ['subscribe', 'getSnapshot', 'on']),
      {
        subscribe: { enumerable: true, value: subscribe },
        getSnapshot: { enumerable: true, value: () => chart.gantt.core.getSnapshot() },
        on: { enumerable: true, value: listen((current) => current.gantt.core as Listening) },
      },
    ),
  ) as GanttCore<TData>;

  const instance = Object.freeze(
    Object.defineProperties(
      delegate(chart.gantt, () => chart.gantt, ['destroy', 'core', 'on']),
      {
        core: { enumerable: true, value: core },
        on: { enumerable: true, value: listen((current) => current.gantt as Listening) },
        setContainer: { enumerable: true, value: setContainer },
        slots: { enumerable: true, value: slots.element },
        subscribe: { enumerable: true, value: subscribe },
        getSnapshot: { enumerable: true, value: () => chart.gantt.core.getSnapshot() },
      },
    ),
  ) as unknown as GanttInstance<TData>;

  const handle = Object.freeze(
    Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(Object.getOwnPropertyDescriptors(instance)).filter(
          ([key]) => key !== 'setContainer' && key !== 'slots',
        ),
      ),
    ),
  ) as GanttHandle<TData>;

  return { instance, handle, update, settle, retain, release };
}

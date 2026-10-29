import type { DisposableNode } from '@ganttlane/dom';
import { showsNothing } from '@ganttlane/dom/dom-utils';
import type { ReactElement, ReactNode } from 'react';
import {
  Component,
  createElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createPortal, flushSync } from 'react-dom';

import { warn } from './dev';

/** What a slot is for: the task tooltip, the link menu, a bar's label. */
export type SlotKind = 'tooltip' | 'linkMenu' | 'barLabel';

/**
 * What fills a slot: the context of its kind in, `ReactNode` out.
 *
 * The function is called as the body of a component of the slot's own, so it may use hooks, and
 * they belong to that component: **the same hooks, in the same order, for as long as the slot
 * lives.** A function that is new on every render (an inline arrow) is the same function as far as
 * that goes, and the slot keeps its state. A different function with other hooks is another
 * component: give it its own `slotKey` and the slot starts it anew. Without a `slotKey`, React
 * cannot tell, and an error it raises on the swap is recovered once (the slot starts the new
 * function anew and shows it), but React reports it in development, and hooks of the same count
 * and other kinds go unnoticed.
 */
export type SlotRender = ((context: never) => ReactNode) & {
  /**
   * Names the component the function is. While it is the same string or number from one function
   * to the next, the slot keeps its state; when it changes (or the function appears or goes away)
   * the slot's component is made anew.
   */
  readonly slotKey?: string | number | undefined;
};

/** The functions the application gave, by kind; a kind it did not give has none. */
export type SlotRenders = Readonly<Partial<Record<SlotKind, SlotRender | undefined>>>;

/**
 * Where an error of a slot function goes: the function threw while React rendered its content.
 * The slot draws nothing in its place (and a tooltip or a menu is hidden); the rest of the app is
 * not touched.
 */
export type SlotReport = (error: unknown, kind: SlotKind) => void;

/** One host the renderer shows, and what React is to put in it. */
interface Entry {
  /** `kind:id`: the host of one tooltip, one menu or one label, whatever its context. */
  readonly key: string;
  readonly kind: SlotKind;
  /** The node the renderer holds; the portal's container. */
  readonly host: HTMLElement;
  /** The latest context the renderer made the content for. */
  readonly context: unknown;
  /** The function that fills it now. */
  readonly render: SlotRender | undefined;
  /** Grows when the function is another component: the portal's content is made anew. */
  readonly generation: number;
}

/** The slots of one chart: the hosts the renderer shows and the portals that fill them. */
export interface Slots {
  /**
   * The element that draws the portals: render it anywhere in the component that owns the chart
   * (below the providers its slot content is to see). The same element for the life of the chart;
   * it renders again by itself, so a parent that renders again does not have to.
   */
  readonly element: ReactElement;
  /** Gives the functions of the latest props; the portals draw again when one is a new function. */
  update(renders: SlotRenders): void;
  /**
   * The slot content of a tooltip, a link menu or a label, for the renderer to show
   * (`DisposableNode`): the host of `kind:id` (the one the renderer holds for it, if it holds one
   * already), with the content for `context` drawn into it by a portal, and a `dispose` that ends
   * the portal when the renderer is done with the host.
   *
   * A tooltip or a menu is drawn when the renderer says its host is in the document and about to
   * be measured (`attached`, with `flushSync`: `autoFocus` and layout effects need the document),
   * and is judged blank by the renderer then. It names what its content renders in nested
   * portals (`owns`), so that a press there is not a press outside. A label is drawn a microtask
   * later, all the labels of a window in one update.
   */
  acquire(kind: SlotKind, id: unknown, context: unknown): DisposableNode;
}

/** What `useSyncExternalStore` reads, and where an error goes. */
interface Store {
  readonly subscribeKeys: (listener: () => void) => () => void;
  readonly getKeys: () => readonly string[];
  readonly subscribe: (key: string, listener: () => void) => () => void;
  readonly get: (key: string) => Entry | undefined;
  readonly report: SlotReport;
}

/** React's pointer from a DOM node to its fiber: this, and a random suffix (React 17 to 19). */
const FIBER_KEY = '__reactFiber$';
/** `HostPortal` among React's work tags, the same from React 17 to 19. */
const HOST_PORTAL = 4;

/** The part of a fiber the walk up the React tree reads. */
interface Fiber {
  readonly tag: number;
  readonly return: Fiber | null;
  readonly stateNode: { readonly containerInfo?: unknown } | null;
}

const fiberOf = (node: Node): Fiber | undefined => {
  for (const name of Object.keys(node)) {
    if (name.startsWith(FIBER_KEY)) return (node as unknown as Record<string, Fiber>)[name];
  }
  return undefined;
};

/**
 * Whether a node is rendered by a portal of a host, however deep: a portal in a portal in the
 * content (the menu of a select, a date picker's popup) is in the page, outside the popover, and
 * is part of the content all the same. React's own events bubble through portals, but the
 * renderer asks in the capture phase of the document, before React has seen the event, so the
 * answer is read off the tree: the nearest DOM ancestor that React rendered knows its fiber, and
 * the fibers above it lead through every portal there is to the one of the host. This reads
 * React's private pointer; if a future React changes it, the answer is `false`, and a press in a
 * nested portal closes the popover as it would for any element outside it.
 */
const ownedBy =
  (host: HTMLElement) =>
  (target: Node): boolean => {
    let node: Node | null = target;
    while (node !== null) {
      const known = fiberOf(node);
      if (known !== undefined) {
        for (let fiber: Fiber | null = known; fiber !== null; fiber = fiber.return) {
          if (fiber.tag === HOST_PORTAL && fiber.stateNode?.containerInfo === host) return true;
        }
        return false;
      }
      // Up the document, and out of a shadow root through its host.
      node = node.parentNode ?? (node as Partial<ShadowRoot>).host ?? null;
    }
    return false;
  };

/** `api.hide` of a tooltip's or a link menu's context. */
const hideOf = (context: unknown): (() => void) | undefined =>
  (context as { readonly api?: { readonly hide?: () => void } } | undefined)?.api?.hide;

/** An error nobody was given to report to: not swallowed, it goes to the page (`reportError`). */
export const surfaceError: SlotReport = (error) => {
  if (typeof reportError === 'function') reportError(error);
  else {
    setTimeout(() => {
      throw error;
    });
  }
};

interface SlotProps {
  readonly entry: Entry;
  /** The popover kinds close their popover when what they draw becomes blank. */
  readonly hide: (() => void) | undefined;
}

/**
 * One host's content: the application's function called for the host's context, as the body of a
 * component (so it may use hooks, and is isolated from the other hosts).
 */
function Slot({ entry, hide }: SlotProps): ReactNode {
  const { render, context, host } = entry;
  const first = useRef(true);
  // The first time is the renderer's to judge (it asks whether the host shows anything once the
  // content is drawn). Later, a popover whose content went blank has nothing to show: close it,
  // as `render` giving `null` does. Not when the function is gone: the chart is about to make the
  // popover again without it.
  useLayoutEffect(() => {
    if (!first.current && render !== undefined && hide !== undefined && showsNothing(host)) hide();
    first.current = false;
  });
  return render === undefined ? null : render(context as never);
}

interface GuardProps {
  readonly entry: Entry;
  readonly report: SlotReport;
}

interface GuardState {
  readonly failed: boolean;
  /** Grows when the slot's component is started anew after a failure. */
  readonly attempt: number;
}

/**
 * Catches what the application's function throws while React renders its content, so that a
 * failing slot does not unmount the app's root. The error goes to `report`; a tooltip or a menu
 * is hidden (`api.hide()`), a label draws nothing. A slot that failed is drawn again when what it
 * was drawn from changes: its context, or its function.
 *
 * One failure is not reported at once: when the function is not the one that last drew without an
 * error, the hooks the new one meets may be the old one's (React throws "rendered fewer hooks" at
 * a swap), so the slot's component is started anew, once, before the failure counts.
 */
class Guard extends Component<GuardProps, GuardState> {
  override state: GuardState = { failed: false, attempt: 0 };
  /** The function that drew last without an error. */
  private good: { readonly render: SlotRender | undefined } | undefined;
  private retried = false;
  /** What failed and was reported. */
  private failedWith: Entry | undefined;

  static getDerivedStateFromError(): Partial<GuardState> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const { entry, report } = this.props;
    if (this.good !== undefined && this.good.render !== entry.render && !this.retried) {
      this.retried = true;
      this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }));
      return;
    }
    this.failedWith = entry;
    try {
      report(error, entry.kind);
    } catch (thrown) {
      // The application's handler failed: that is its own error, and still not ours to swallow.
      surfaceError(thrown, entry.kind);
    }
    if (entry.kind !== 'barLabel') hideOf(entry.context)?.();
  }

  override componentDidMount(): void {
    this.settle();
  }

  override componentDidUpdate(): void {
    this.settle();
  }

  private settle(): void {
    const { entry } = this.props;
    if (!this.state.failed) {
      this.good = { render: entry.render };
      this.retried = false;
      this.failedWith = undefined;
      return;
    }
    const { failedWith } = this;
    if (
      failedWith !== undefined &&
      (failedWith.context !== entry.context || failedWith.render !== entry.render)
    ) {
      this.failedWith = undefined;
      this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }));
    }
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    const { entry } = this.props;
    return (
      <Slot
        key={this.state.attempt}
        entry={entry}
        hide={entry.kind === 'barLabel' ? undefined : hideOf(entry.context)}
      />
    );
  }
}

/** The portal of one host: it draws again only when its own entry changes. */
function HostPortal({ id, store }: { readonly id: string; readonly store: Store }): ReactNode {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(id, listener),
    [store, id],
  );
  const get = useCallback(() => store.get(id), [store, id]);
  const entry = useSyncExternalStore(subscribe, get, get);
  if (entry === undefined) return null;
  return createPortal(
    <Guard key={entry.generation} entry={entry} report={store.report} />,
    entry.host,
  );
}

/** The portals of a chart's slots: one per host, in the order the hosts were made. */
function Portals({ store }: { readonly store: Store }): ReactElement {
  const keys = useSyncExternalStore(store.subscribeKeys, store.getKeys, store.getKeys);
  return (
    <>
      {keys.map((key) => (
        <HostPortal key={key} id={key} store={store} />
      ))}
    </>
  );
}

const KINDS = ['tooltip', 'linkMenu', 'barLabel'] as const;

/**
 * Makes the slots of a chart. The renderer (`@ganttlane/dom`) asks for a node for every tooltip,
 * link menu and bar label the application gave a `ReactNode` function for; the node is a host
 * that React fills through a portal, so the content lives in the application's tree and sees its
 * context, state and providers. The registry of live hosts is the whole of the machinery:
 *
 * - **One host per tooltip, menu or label** (`kind:id`), kept while the renderer holds it: when
 *   the renderer asks again for the same one (a new record, new previewed values, a new progress)
 *   the host stays, its context is replaced and its portal draws again, so the state of what is
 *   in it survives. The renderer asks for the new content before it lets the old go, hence the
 *   count of uses: the host goes with the last of them.
 * - **No leak.** A host goes when the renderer disposes its last content (the popover closed, was
 *   made again for another task, the bar left the window, the label was hidden or replaced, the
 *   chart was destroyed), and its portal is unmounted with it.
 * - **Fresh.** The functions are the latest props' (`update`), called while rendering: a parent
 *   that renders again with new state gives a new function, and the portals draw again without
 *   the renderer being asked for anything.
 * - **Cost of a change.** Every host has its own subscription to the registry, and the list of
 *   hosts has one: a label that changes draws that label's portal and nothing else; the list is
 *   drawn again only when a host comes or goes.
 * - **Failure.** A function that throws is caught around its content and reported to `report`
 *   (see {@link Guard}); the app's root is not unmounted.
 * - **Server.** There is no renderer on a server, so there are no hosts: the portals draw nothing.
 *
 * @param documentOf - The document the hosts are made in: the chart's, once it has a container.
 * @param report - Where the errors of the application's functions go; without it they are
 *   reported to the page (`reportError`).
 * @returns The slots.
 */
export function createSlots(
  documentOf: () => Document | undefined,
  report: SlotReport = surfaceError,
): Slots {
  const entries = new Map<string, Entry>();
  const uses = new Map<string, number>();
  const generations: Record<SlotKind, number> = { tooltip: 0, linkMenu: 0, barLabel: 0 };
  let renders: SlotRenders = {};
  let keys: readonly string[] = [];
  let keysChanged = false;
  const touched = new Set<string>();
  let scheduled = false;
  let warned = false;
  const keyListeners = new Set<() => void>();
  const listeners = new Map<string, Set<() => void>>();

  /** Tells the list of hosts if it changed, then the hosts that did. */
  const flush = (): void => {
    scheduled = false;
    const listed = keysChanged;
    keysChanged = false;
    const changed = [...touched];
    touched.clear();
    if (listed) for (const listener of [...keyListeners]) listener();
    for (const key of changed) for (const listener of [...(listeners.get(key) ?? [])]) listener();
  };
  /** The labels of a whole window are one update, a microtask later. */
  const later = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };
  /**
   * Draws what changed now. A popover is drawn when its host is in the document and about to be
   * measured: that is the renderer's `attached`.
   */
  const flushNow = (): void => {
    if (!keysChanged && touched.size === 0) return;
    if (keyListeners.size === 0) flush();
    else flushSync(flush);
  };

  const store: Store = {
    subscribeKeys(listener) {
      keyListeners.add(listener);
      return () => {
        keyListeners.delete(listener);
      };
    },
    getKeys: () => keys,
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(key) === set) listeners.delete(key);
      };
    },
    get: (key) => entries.get(key),
    report,
  };

  const release = (key: string): void => {
    const left = (uses.get(key) ?? 1) - 1;
    if (left > 0) {
      uses.set(key, left);
      return;
    }
    uses.delete(key);
    entries.delete(key);
    keys = [...entries.keys()];
    keysChanged = true;
    touched.add(key);
    later();
  };

  return {
    element: createElement(Portals, { store }),
    update(next) {
      let changed = false;
      for (const kind of KINDS) {
        const before = renders[kind];
        const after = next[kind];
        if (before === after) continue;
        changed = true;
        // Another component when the function appears or goes, or says it is another.
        if (
          (before === undefined) !== (after === undefined) ||
          before?.slotKey !== after?.slotKey
        ) {
          generations[kind]++;
        }
      }
      if (!changed) return;
      renders = next;
      for (const [key, entry] of entries) {
        const render = renders[entry.kind];
        const generation = generations[entry.kind];
        if (entry.render === render && entry.generation === generation) continue;
        entries.set(key, { ...entry, render, generation });
        touched.add(key);
      }
      later();
    },
    acquire(kind, id, context) {
      const key = `${kind}:${String(id)}`;
      const known = entries.get(key);
      let host = known?.host;
      if (host === undefined) {
        host = (documentOf() ?? document).createElement('div');
        host.dataset.slot = kind;
      }
      entries.set(key, {
        key,
        kind,
        host,
        context,
        render: renders[kind],
        generation: generations[kind],
      });
      uses.set(key, (uses.get(key) ?? 0) + 1);
      const popover = kind !== 'barLabel';
      // Labels are drawn when the chart is mounted, before the portals subscribe (an effect); a
      // tooltip or a menu is asked for by the user, long after. Nothing listening then is a chart
      // whose `instance.slots` is not rendered.
      if (popover && keyListeners.size === 0 && !warned) {
        warned = true;
        warn(
          'A tooltip or a menu slot (`renderTooltip`, `renderLinkMenu`) was asked for, but ' +
            'nothing draws its portals. With `useGantt`, render `instance.slots` next to the ' +
            'container; `<Gantt>` does it for you.',
        );
      }
      if (known === undefined) {
        keys = [...entries.keys()];
        keysChanged = true;
      }
      touched.add(key);
      later();
      let disposed = false;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        release(key);
      };
      return popover
        ? { node: host, dispose, attached: flushNow, owns: ownedBy(host) }
        : { node: host, dispose };
    },
  };
}

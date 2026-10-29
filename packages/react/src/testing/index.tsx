/**
 * Test helpers of `@ganttlane/react`: rendering into a real DOM (happy-dom) with `act`, a size for
 * the chart's scroller (happy-dom does no layout), manual frames for the renderer, and a count of
 * the DOM listeners that are alive. Test files only: nothing in a build reaches this folder.
 *
 * @module
 */

import type { ReactElement } from 'react';
import { act, StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

/** The frame source of the renderer, driven by hand (`renderer: { frames }`). */
export interface ManualFrames {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
  /** Runs the queued callbacks, as one frame would. */
  step(): void;
  /** How many callbacks wait for a frame. */
  readonly queued: number;
}

/**
 * Creates a {@link ManualFrames}.
 *
 * @returns A fresh queue.
 */
export function createManualFrames(): ManualFrames {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    request(callback) {
      const handle = next++;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    step() {
      const batch = [...queue.values()];
      queue.clear();
      for (const callback of batch) callback();
    },
    get queued() {
      return queue.size;
    },
  };
}

/**
 * happy-dom does no layout, so a scroller is 0 × 0 and the chart never gets a viewport. This
 * reports a size for `.gantt__scroller` (and 0 for everything else); undone by
 * `vi.restoreAllMocks()`.
 *
 * @param width - Client width of scrollers.
 * @param height - Client height of scrollers.
 */
export function stubScrollerSize(width: number, height: number): void {
  const isScroller = (element: Element): boolean => element.classList.contains('gantt__scroller');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? height : 0;
  });
}

/** The containers of React roots: React DOM listens on them for its own events. */
const reactRoots = new WeakSet<EventTarget>();

/** What {@link trackListeners} observes. */
export interface ListenerTracker {
  /**
   * Listeners added and not removed (by `removeEventListener` or an aborted `signal`), but those
   * of React DOM itself: on the container of a root made by {@link renderInto}, on the host of a
   * slot (the container of a portal), and the document's `selectionchange`.
   */
  alive(): { readonly target: EventTarget; readonly type: string }[];
  /** Puts the original methods back. */
  restore(): void;
}

/**
 * Records the listeners the DOM's event targets (elements, document, window) gain and lose, so
 * that a test can assert that nothing of the chart survives it. Call `restore()` afterwards.
 *
 * @returns The tracker.
 */
export function trackListeners(): ListenerTracker {
  interface Entry {
    target: EventTarget;
    type: string;
    listener: unknown;
    signal: AbortSignal | undefined;
    removed: boolean;
  }
  const all: Entry[] = [];
  const restorers: (() => void)[] = [];
  type Owner = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  const ownerOf = (object: object): Owner | undefined => {
    for (
      let proto: object | null = object;
      proto;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      if (Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) return proto as Owner;
    }
    return undefined;
  };
  const patch = (owner: Owner): void => {
    const add = owner.addEventListener;
    const remove = owner.removeEventListener;
    owner.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      const signal = typeof options === 'object' ? options.signal : undefined;
      if (!(this instanceof AbortSignal)) {
        all.push({ target: this, type, listener, signal, removed: false });
      }
      add.call(this, type, listener, options);
    };
    owner.removeEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void {
      const known = all.find(
        (entry) =>
          !entry.removed &&
          entry.target === this &&
          entry.type === type &&
          entry.listener === listener,
      );
      if (known) known.removed = true;
      remove.call(this, type, listener, options);
    };
    restorers.push(() => {
      owner.addEventListener = add;
      owner.removeEventListener = remove;
    });
  };
  const elementOwner = ownerOf(document.createElement('div'));
  if (elementOwner) patch(elementOwner);
  const windowOwner = ownerOf(window);
  if (windowOwner && windowOwner !== elementOwner) patch(windowOwner);
  return {
    alive: () =>
      all
        .filter((entry) => !entry.removed && !entry.signal?.aborted)
        .filter((entry) => !reactRoots.has(entry.target))
        .filter((entry) => !(entry.target === document && entry.type === 'selectionchange'))
        // The host of a slot is the container of a portal: React DOM listens on it too.
        .filter(
          (entry) => !(entry.target instanceof Element && entry.target.hasAttribute('data-slot')),
        )
        .map(({ target, type }) => ({ target, type })),
    restore: () => {
      for (const restore of restorers.splice(0)) restore();
    },
  };
}

/** A React root in the document, for tests. */
export interface Rendered {
  /** The element the root renders into. */
  readonly container: HTMLElement;
  /** Renders `ui` (the same root, so state and instances persist). */
  render(ui: ReactElement): Promise<void>;
  /** Unmounts the root and lets the microtasks of the cleanup run. */
  unmount(): Promise<void>;
}

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * Renders into a fresh container in `document.body`, inside `act`, and lets pending microtasks
 * run (the chart ends its core a microtask after an unmount).
 *
 * @param ui - The first element.
 * @param options - `strict` wraps what is rendered in `StrictMode`.
 * @returns The handle.
 */
export async function renderInto(
  ui: ReactElement,
  options: { readonly strict?: boolean } = {},
): Promise<Rendered> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  reactRoots.add(container);
  const root: Root = createRoot(container);
  const wrap = (element: ReactElement): ReactElement =>
    options.strict === true ? <StrictMode>{element}</StrictMode> : element;
  const rendered: Rendered = {
    container,
    // An async `act` also lets the microtasks queued while rendering run before it returns.
    render: (element) =>
      act(() => {
        root.render(wrap(element));
        return Promise.resolve();
      }),
    unmount: () =>
      act(() => {
        root.unmount();
        return Promise.resolve();
      }),
  };
  await rendered.render(ui);
  return rendered;
}

/**
 * Cleans up after a test: whatever is left in the document goes.
 */
export function cleanUpDocument(): void {
  document.body.replaceChildren();
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
}

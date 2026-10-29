/** One `addEventListener` call seen by {@link trackListeners}. */
export interface TrackedListener {
  readonly target: EventTarget;
  readonly type: string;
  readonly listener: unknown;
  /** The `signal` option, if any. */
  readonly signal: AbortSignal | undefined;
  /** Whether `removeEventListener` took it off. */
  removed: boolean;
}

/** What {@link trackListeners} observes. */
export interface ListenerTracker {
  /** Every listener added since tracking began. */
  readonly all: readonly TrackedListener[];
  /**
   * Listeners still active: not removed with `removeEventListener` and not tied to an aborted
   * signal. Independent of how the DOM implementation applies `signal`.
   */
  alive(): TrackedListener[];
  /** Puts the original methods back. */
  restore(): void;
}

type Add = EventTarget['addEventListener'];
type Remove = EventTarget['removeEventListener'];

/** The prototype in the chain of `object` that owns `addEventListener`. */
function ownerOfListeners(
  object: object,
): (object & { addEventListener: Add; removeEventListener: Remove }) | undefined {
  for (
    let proto: object | null = object;
    proto;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    if (Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) {
      return proto as object & { addEventListener: Add; removeEventListener: Remove };
    }
  }
  return undefined;
}

/**
 * Wraps `addEventListener` / `removeEventListener` of the DOM's event targets (elements, the
 * document and the window) and records what is added, so that a test can assert that nothing
 * survives `destroy()`. Call `restore()` in `afterEach`.
 *
 * @returns The tracker.
 */
export function trackListeners(): ListenerTracker {
  const all: TrackedListener[] = [];
  const restorers: (() => void)[] = [];

  const patch = (owner: { addEventListener: Add; removeEventListener: Remove }): void => {
    const add = owner.addEventListener;
    const remove = owner.removeEventListener;
    owner.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      const signal = typeof options === 'object' ? options.signal : undefined;
      // The DOM implementation's own bookkeeping for `signal` is not the code under test.
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

  const elementOwner = ownerOfListeners(document.createElement('div'));
  if (elementOwner) patch(elementOwner);
  // The window may carry its own methods (happy-dom copies them onto the global).
  const windowOwner = ownerOfListeners(window);
  if (windowOwner && windowOwner !== elementOwner) patch(windowOwner);

  return {
    all,
    alive: () => all.filter((entry) => !entry.removed && !entry.signal?.aborted),
    restore: () => {
      for (const restore of restorers.splice(0)) restore();
    },
  };
}

/** Options of {@link listen}. */
export interface ListenOptions {
  /**
   * Aborting it removes the listener. Required: every listener of an instance is owned by the
   * instance's `AbortController`, so that `destroy()` is one `abort()`.
   */
  readonly signal: AbortSignal;
  /** Listen in the capture phase. */
  readonly capture?: boolean;
  /** Promise not to call `preventDefault()` (lets the browser scroll without waiting). */
  readonly passive?: boolean;
  /** Remove the listener after its first call. */
  readonly once?: boolean;
}

/**
 * Adds an event listener that lives as long as `options.signal`. With an already aborted signal
 * nothing is added.
 *
 * @param target - Element, document or window.
 * @param type - Event type.
 * @param listener - Handler.
 * @param options - See {@link ListenOptions}.
 */
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | SVGElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options: ListenOptions,
): void;
/** Overload for a `Window`. */
export function listen<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options: ListenOptions,
): void;
/** Overload for a `Document`. */
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options: ListenOptions,
): void;
/** Overload for any other event target and event type. */
export function listen(
  target: EventTarget,
  type: string,
  listener: (event: Event) => void,
  options: ListenOptions,
): void;
export function listen(
  target: EventTarget,
  type: string,
  listener: (event: never) => void,
  options: ListenOptions,
): void {
  // Standard DOM adds nothing for an aborted signal; not every implementation does.
  if (options.signal.aborted) return;
  target.addEventListener(type, listener as EventListener, options);
}

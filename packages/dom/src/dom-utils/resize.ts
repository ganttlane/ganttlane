/** A size in CSS pixels. */
export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/** What {@link observeSize} returns. */
export interface SizeObservation {
  /**
   * Whether the environment has a `ResizeObserver`. When `false` nothing is ever reported and
   * the caller has to measure on its own (e.g. on `window` `resize`).
   */
  readonly supported: boolean;
  /** Stops observing. Idempotent. */
  disconnect(): void;
}

/** What the host window may offer: `ResizeObserver` is missing in some DOM implementations. */
type ResizeObserverHost = Partial<Pick<typeof globalThis, 'ResizeObserver'>>;

/**
 * Measures an element's client box (content plus padding, without borders and scrollbars)
 * synchronously. Forces layout, so call it at mount, never in a scroll handler.
 *
 * @param element - The element to measure.
 * @returns Its client width and height.
 */
export function measureSize(element: Element): ElementSize {
  return { width: element.clientWidth, height: element.clientHeight };
}

/**
 * Reports the content-box size of an element whenever it changes (a `ResizeObserver` of the
 * element's own window, so it also works inside iframes). The first report arrives right after
 * `observe`, as with any `ResizeObserver`; equal consecutive sizes are not reported twice.
 *
 * @param element - The element to watch.
 * @param onSize - Called with the new size.
 * @returns The observation; see {@link SizeObservation.supported}.
 */
export function observeSize(
  element: Element,
  onSize: (size: ElementSize) => void,
): SizeObservation {
  const host: ResizeObserverHost | null = element.ownerDocument.defaultView;
  const Observer = host?.ResizeObserver;
  if (Observer === undefined) return { supported: false, disconnect: () => undefined };

  let last: ElementSize | undefined;
  let connected = true;
  const observer = new Observer((entries) => {
    const entry = entries[entries.length - 1];
    if (!connected || entry === undefined) return;
    const { width, height } = entry.contentRect;
    if (last?.width === width && last.height === height) return;
    last = { width, height };
    onSize(last);
  });
  observer.observe(element);
  return {
    supported: true,
    disconnect(): void {
      if (!connected) return;
      connected = false;
      observer.disconnect();
    },
  };
}

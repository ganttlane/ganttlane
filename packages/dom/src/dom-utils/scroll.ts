import { listen } from './listen';
import { observeSize } from './resize';

/** A distance to scroll by, in CSS px; a missing axis does not move. */
export interface ScrollDelta {
  /** Horizontal distance: positive scrolls towards the end of the content. */
  readonly left?: number | undefined;
  /** Vertical distance: positive scrolls down. */
  readonly top?: number | undefined;
}

/**
 * Moves a scroll container by a distance from where it is now, at once. This is the way for
 * anything that scrolls a chart in steps (the drag autoscroll of the input adapter):
 *
 * - **relative**, so a compensation of the infinite timeline that moved the scroller since the
 *   writer last looked is not undone, as it would be by a write from a remembered position;
 * - **instant** whatever `scroll-behavior` the page puts on the container (the `scrollLeft`
 *   setter and a plain `scrollBy` follow it, and a slide that starts again every frame never
 *   gets anywhere).
 *
 * The scroll event that follows takes the usual way: the renderer reports the position to the
 * core, which extends the range when the scroller is near its edge.
 *
 * @param scroller - The scroll container.
 * @param delta - How far to move on each axis.
 */
export function scrollByInstant(scroller: Element, delta: ScrollDelta): void {
  scroller.scrollBy({ left: delta.left ?? 0, top: delta.top ?? 0, behavior: 'instant' });
}

/**
 * Lets `from`, an element in front of a scroller that does not scroll sideways itself (the
 * header pin of a chart of automatic height: `overflow: hidden`, so nothing a user does over it
 * reaches the scroller next to it), pass sideways scrolling on to `to`, by `scrollByInstant`:
 *
 * - the **wheel**: `deltaX` (a trackpad swipe, a tilt wheel), or `deltaY` with Shift held, in
 *   px (a unit of lines, as Firefox reports a mouse wheel, or pages, is about 40 px);
 * - a **touch** that drags sideways: the content follows the finger. Give `from`
 *   `touch-action: pan-y`: a vertical pan is then the browser's (it scrolls the page, and
 *   cancels the pointer), a horizontal one is not, and arrives here as pointer moves. There is
 *   no fling.
 *
 * A vertical wheel and a vertical touch go on to the page, as they would anywhere else. The
 * listeners are passive and end with `signal`.
 *
 * @param from - The element the user's hand is over.
 * @param to - The scroll container to move.
 * @param signal - Ends the listeners.
 */
export function forwardScroll(from: HTMLElement, to: Element, signal: AbortSignal): void {
  const options = { signal, passive: true };
  listen(
    from,
    'wheel',
    (event) => {
      // A unit of lines (or pages) is a line of about 40 px.
      const left =
        (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * (event.deltaMode ? 40 : 1);
      if (left !== 0) scrollByInstant(to, { left });
    },
    options,
  );
  // Where a touch is, from its press until it ends (or the browser takes it for a pan).
  let last: number | undefined;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
    listen(
      from,
      type,
      (event) => {
        if (type !== 'pointermove')
          last =
            type === 'pointerdown' && event.pointerType === 'touch' ? event.clientX : undefined;
        else if (last !== undefined) {
          scrollByInstant(to, { left: last - event.clientX });
          last = event.clientX;
        }
      },
      options,
    );
  }
}

/**
 * What scrolls a chart vertically when its height is automatic (`height: 'auto'`): the chart
 * grows to its content and its ancestor, or the page, scrolls it. Found by
 * {@link scrollHostOf}.
 */
export interface ScrollHost {
  /** The scrolling element: the nearest scrollable ancestor, or the document's scrolling element. */
  readonly element: Element;
  /** Where its `scroll` events fire: the element itself, or the `document` for the page. */
  readonly events: EventTarget;
  /** Whether it is the page (the viewport) rather than an element. */
  readonly page: boolean;
}

/** `overflow-y` values that make an element scroll vertically on its own. */
const SCROLLING_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/**
 * Finds what scrolls `element` vertically: the nearest ancestor with `overflow-y: auto`,
 * `scroll` or `overlay` that has something to scroll, or else the page. `body` and `html` are
 * the page whatever their `overflow` says (the browser hands theirs to the viewport), and an
 * ancestor that clips (`hidden`, `clip`) is no host: nothing can scroll the chart inside it, so
 * the page is asked.
 *
 * An ancestor whose content fits (`scrollHeight` is not more than `clientHeight`) is no host
 * either: a wrapper with `overflow-x: auto` alone computes to `overflow-y: auto` as well, grows
 * with the chart and never scrolls, and asking it would draw every row. That is a fact of the
 * moment: a chart that has no rows yet fits everywhere, so look again once it has its height.
 *
 * Reads computed styles and sizes up the tree: call it when the mode is set and when the
 * chart's height changes, never while scrolling.
 *
 * @param element - The chart's element (its scroller).
 * @returns The host.
 */
export function scrollHostOf(element: Element): ScrollHost {
  const document = element.ownerDocument;
  const view = document.defaultView;
  const stop = new Set<Element | null>([document.body, document.documentElement]);
  for (
    let node = element.parentElement;
    node !== null && !stop.has(node);
    node = node.parentElement
  ) {
    if (
      SCROLLING_OVERFLOW.has(view?.getComputedStyle(node).overflowY ?? '') &&
      node.scrollHeight > node.clientHeight
    ) {
      return { element: node, events: node, page: false };
    }
  }
  return {
    element: document.scrollingElement ?? document.documentElement,
    events: document,
    page: true,
  };
}

/**
 * The part of a {@link ScrollHost} that shows the chart, in CSS px: where the chart's sticky
 * header sticks and how much of the host is below it.
 */
export interface HostBox {
  /**
   * Where the chart's header sticks, in viewport coordinates: the top edge of the host's client
   * box (`0` for the page), plus the host's `padding-top` (an element's sticky children stick
   * inside its padding; the page's do not) and the `top` of the pin.
   */
  readonly top: number;
  /** The height of the host's client box (the viewport's for the page) below {@link HostBox.top}. */
  readonly height: number;
  /**
   * Where a row that is scrolled to goes, in the same coordinates as {@link HostBox.top}: that,
   * or lower when the host asks for more room with `scroll-padding-top`.
   */
  readonly target: number;
}

/** The pixels of a computed length; `0` for `auto`, a percentage or nothing. */
const pixels = (value: string | undefined): number =>
  value?.endsWith('px') === true ? Number.parseFloat(value) : 0;

/**
 * Measures a host: the room an application leaves above the chart's header is part of the
 * answer (a `top` of its own on the pin, below a sticky page header; padding on the host). Forces
 * layout, so call it in a frame task or at setup, never in a scroll handler.
 *
 * @param host - From {@link scrollHostOf}.
 * @param pin - The element the chart's header sticks as (`.gantt__pin`), for its `top`.
 * @returns Where the header sticks, the height below it and where a row is scrolled to.
 */
export function measureHost(host: ScrollHost, pin?: Element): HostBox {
  const { element } = host;
  const view = element.ownerDocument.defaultView;
  const length = (of: Element, property: string): number =>
    pixels(view?.getComputedStyle(of).getPropertyValue(property));
  const cover = (host.page ? 0 : length(element, 'padding-top')) + (pin ? length(pin, 'top') : 0);
  const edge = host.page ? 0 : element.getBoundingClientRect().top + element.clientTop;
  return {
    top: edge + cover,
    height: element.clientHeight - cover,
    target: edge + Math.max(cover, length(element, 'scroll-padding-top')),
  };
}

/**
 * Calls `onChange` when the host's height may have changed: the window is resized (the page) or
 * the element is (a `ResizeObserver`; without one nothing is reported, and a host that is not
 * the page is measured only when it scrolls). Scrolling is not reported here: listen to
 * {@link ScrollHost.events}.
 *
 * @param host - From {@link scrollHostOf}.
 * @param onChange - Called, without arguments, for every change.
 * @param signal - Ends the window listener; the observer ends with the returned function.
 * @returns Releases the observer (the caller keeps it with its other disposables).
 */
export function observeHostSize(
  host: ScrollHost,
  onChange: () => void,
  signal: AbortSignal,
): () => void {
  if (host.page) {
    const view = host.element.ownerDocument.defaultView;
    if (view) listen(view, 'resize', onChange, { signal, passive: true });
    return () => undefined;
  }
  const observation = observeSize(host.element, onChange);
  return () => {
    observation.disconnect();
  };
}

import type { GanttSnapshot, ScrollRequest, ViewportChange } from '@ganttlane/core';

import {
  type ElementSize,
  forwardScroll,
  listen,
  measureHost,
  observeHostSize,
  type ScrollHost,
  scrollHostOf,
} from './dom-utils';

/**
 * The slice of the core that scrolling needs: `core.scroll` reports the user's position and
 * returns the infinite timeline's compensation, `core.setViewport` tells it how much of the
 * chart is visible.
 */
export interface ScrollCore {
  scroll(position: { readonly left: number; readonly top: number }): ViewportChange | undefined;
  setViewport(size: ElementSize): unknown;
}

/** What {@link createScrollSync} needs from its renderer. */
export interface ScrollSyncOptions {
  /** The core to report to. */
  readonly core: ScrollCore;
  /** The scroll container; the only element whose `scrollLeft` / `scrollTop` this module writes. */
  readonly scroller: HTMLElement;
  /**
   * Where the header sits while the page scrolls the chart (`Skeleton.pin`): it follows the
   * scroller's `scrollLeft`, as it would if it were inside it.
   */
  readonly pin: HTMLElement;
  /** Sizes the scrolled content at once (`Skeleton.setExtent`), before `scrollLeft` moves. */
  readonly setContentWidth: (width: number) => void;
  /** Renders the core's latest snapshot synchronously (`FrameScheduler.flush`). */
  readonly flush: () => void;
  /**
   * Whether the core's latest scroll request is one the renderer has not performed yet
   * ({@link ScrollSync.apply}): until then the scroller still shows the picture the request
   * replaces, so what it says is not the core's position.
   */
  readonly pending: () => boolean;
  /** Owns the listeners. */
  readonly signal: AbortSignal;
  /**
   * Asks for a frame in which the renderer calls {@link ScrollSync.measure}: the page moved or
   * was resized (a chart of automatic height).
   */
  readonly requestFrame: () => void;
  /** Keeps a release function (an observer) until the chart is destroyed. */
  readonly onDispose: (release: () => void) => void;
}

/** Writes and reads the scroller's position on behalf of the core, see {@link createScrollSync}. */
export interface ScrollSync {
  /**
   * Performs a core scroll request: with `from`, jump there
   * instantly first, then scroll to `left` / `top` with the request's `behavior`. Call it once
   * per request id, after the scrolled content has the size of the request's snapshot. With an
   * automatic height `top` is not the scroller's: the page scrolls to put that row at the top
   * of the visible part of the chart.
   *
   * @param request - From `snapshot.scrollRequest`.
   */
  apply(request: ScrollRequest): void;
  /**
   * Puts a freshly created scroller where the core already is (a renderer mounted onto a core
   * that was scrolled before). A zero position is left alone.
   *
   * @param snapshot - The first snapshot rendered.
   */
  place(snapshot: GanttSnapshot): void;
  /**
   * Switches between a scroller that scrolls both ways (a fixed or filled height) and one that
   * scrolls sideways while the page scrolls it vertically (`height: 'auto'`).
   * Call it after the DOM has the shape of the mode (`Skeleton.setHeight`), then give the core
   * the new {@link ScrollSync.viewport}. The same mode twice does nothing.
   *
   * @param paged - `true` for an automatic height.
   */
  setPaged(paged: boolean): void;
  /**
   * Sends the scroller's current position to the core now, synchronously, settles the range it
   * answers with and renders the result before returning: exactly what the scroller's `scroll`
   * event does, without waiting for it. For a writer that moves the scroller and needs the
   * outcome in the same frame (the drag autoscroll: it writes `scrollLeft`, calls this, and the
   * extended range and the dragged bar are drawn before paint). The browser's own event, a frame
   * later, reports the same position, which the core answers with nothing to do.
   */
  report(): void;
  /**
   * Calls `listener` when the page (or the ancestor that scrolls) has moved or been resized
   * while the chart's height is automatic: the chart's frame on screen is not where it was.
   * Whoever caches it (the input module measures the scroller's box on pointer down) should
   * forget it and measure again when it next needs it. Called synchronously from the scroll and
   * resize handlers, so it must not read layout. Never called for a chart with a fixed height,
   * whose scroller is not moved by the page's scrolling in a way the renderer watches.
   *
   * @param listener - Called without arguments.
   * @returns Stops listening.
   */
  onFrameMove(listener: () => void): () => void;
  /**
   * Takes the scroller to a position it was asked to be at and could not reach yet (the content
   * had no size: the stylesheet was late). Call it when the scroller's size changed, which is
   * what the stylesheet arriving does; it does nothing otherwise, and nothing once the user has
   * scrolled.
   */
  refresh(): void;
  /**
   * The size the core is told is the viewport for a scroller of this client size: itself, or,
   * for an automatic height, its width and the height of what scrolls the chart (the page),
   * so that the core windows the rows by what is visible and `scrollToTask` aims at it.
   *
   * @param size - The scroller's client size.
   */
  viewport(size: ElementSize): ElementSize;
  /**
   * Reads where the page is relative to the chart and tells the core (its `scrollTop` is how
   * far the page has scrolled past the top of the chart, and its viewport height is the page's),
   * when the page moved or was resized since the last call. Call it at the start of every render:
   * it reads layout, which is fine in a frame but never in a scroll handler, and
   * it does nothing at all unless the height is automatic. While a scroll request is pending
   * (`pending`) it waits for the render that performs the request, in the next frame.
   */
  measure(): void;
  /**
   * Tells that the scrolled content has another height (the first render, rows added or
   * collapsed): whether an ancestor can scroll the chart depends on it, so the next
   * {@link ScrollSync.measure} looks for the host again and, if it is another one, tells the core
   * its height. Does nothing unless the height is automatic.
   */
  contentResized(): void;
}

/**
 * The most `core.scroll` calls one scroll event makes. `planExtension` makes at most one change
 * per call and settles within four (an extension and a trim for each edge), so this is the
 * whole of what a settling core has to say; a core that never settles is left for the next event.
 */
const SETTLE_STEPS = 4;

/**
 * The renderer's whole scroll wiring in one place. The renderer
 * owns `scrollLeft` / `scrollTop` writes and the core never touches the DOM, so:
 *
 * - **User scroll, from every source.** Wheel, scrollbar, keyboard, touch, programmatic
 *   scrolling and the drag autoscroll of the input adapter all move the scroller, so the one
 *   `scroll` event they all end in is the only trigger: it reports `scrollLeft` /
 *   `scrollTop` to `core.scroll`. Browsers fire it at most once per frame, before
 *   `requestAnimationFrame` callbacks, which is the "once per frame" the core expects. Nothing
 *   but those two properties is read. A writer that is not this module (the
 *   autoscroll) must move the scroller relative to where it is now (`scrollByInstant`), never
 *   from a position of its own: a compensation may have moved it since the writer last looked.
 * - **Compensation.** When the core extends or trims the range it answers with a
 *   {@link ViewportChange}: the new content width is written first, then the compensated offset
 *   (`scrollTo` with `behavior: 'instant'`, so that a page that sets `scroll-behavior: smooth`
 *   cannot turn it into a visible slide), then the snapshot is rendered synchronously, so the
 *   date under the left edge stays put before paint. Without the synchronous
 *   render the old nodes would be painted one frame at their old x.
 * - **Settling.** The core makes one change per call, so the handler asks again at the
 *   compensated position until the core has nothing more to do (an extension of one edge and
 *   the trim that follows it come out of one event, not of one event each: a user who scrolls
 *   faster than the range grows would otherwise starve the trims, and the content would only
 *   ever get wider). One write and one render for the whole sequence.
 * - **Requests.** {@link ScrollSync.apply} performs the core's scroll requests; the resulting
 *   scroll events report the final position back like any user scroll. Until the render that
 *   performs a request has run, the scroller still shows the picture it replaces (and a smooth
 *   scroll or a momentum goes on firing events in its coordinates): nothing is reported then
 *   (`pending`). A scroll event renders the request first; `measure` waits a frame.
 * - **Automatic height** (`setPaged`). The scroller is as tall as its content and
 *   scrolls only sideways, so what scrolls the chart vertically is its host, the nearest
 *   ancestor that scrolls (it has something to scroll, which depends on the chart's height, so
 *   it is looked for again when that changes, `contentResized`) or the page (`scrollHostOf`).
 *   The core is told the height of the host below the pin as the viewport, and as `scrollTop`
 *   the body position at the bottom of the stuck pin (`measureHost`: a `top` of the
 *   application's on the pin, the host's padding), so it windows the rows by what is visible
 *   and `scrollToTask` aims at it; a request's `top` becomes a `scrollBy` of the host. Both are
 *   read in a frame (`measure`), triggered by a flag the host's scroll and resize handlers set,
 *   so the handlers read nothing. The header, which has to stick to the host and so cannot be
 *   inside the scroller, scrolls sideways with it by `scrollTo` on its pin, in the same task;
 *   the pin passes a sideways wheel or touch on to the scroller (`forwardScroll`).
 * - **A throwing handler of the application** cannot take a compensation away: the core's input
 *   methods do not throw after they changed the chart, and the settle loop applies what it has
 *   got even if one of its calls does throw.
 *
 * @param options - Core, scroller and the renderer callbacks.
 * @returns Request, position and mode handlers.
 */
export function createScrollSync(options: ScrollSyncOptions): ScrollSync {
  const { core, scroller, pin, setContentWidth, flush, pending, signal, requestFrame, onDispose } =
    options;

  /** What scrolls the chart vertically, while the height is automatic. */
  let host: ScrollHost | undefined;
  /** The host's height as the core last heard it, and the scroller's width. */
  let hostHeight = 0;
  let width = 0;
  /** How far the host has scrolled past the top of the chart: the core's `scrollTop` there. */
  let pageTop = 0;
  /** The host moved or was resized since {@link ScrollSync.measure} last looked. */
  let dirty = false;
  /** The next measure also looks for the host again (its height or its content's changed). */
  let recheck = false;
  /** The hosts that have listeners (they end with the chart). */
  const watched = new Set<EventTarget>();
  /**
   * A horizontal position that was asked for at once and could not be reached, because the
   * content was not as wide as it needs to be yet. A chart mounted before its stylesheet is in
   * effect (WebKit runs a module script first) has a body without a size, and `scrollTo` clamps
   * to that: the chart would stay at its start though the core is at its date. When the scroller
   * is resized ({@link ScrollSync.refresh}: the stylesheet arriving) it is taken there; any scroll
   * drops it.
   */
  let wanted: number | undefined;

  /** Moves the scroller to `left` at once, and remembers it when the content could not hold it. */
  const goTo = (left: number, top?: number): void => {
    // A member that is `undefined` is a member that is left out (WebIDL), which the type of
    // `ScrollToOptions` (`exactOptionalPropertyTypes`) does not say.
    scroller.scrollTo({ left, top, behavior: 'instant' } as ScrollToOptions);
    wanted = Math.abs(scroller.scrollLeft - left) > 1 ? left : undefined;
  };

  /**
   * Tells the core where the scroller is, applies what it changes and renders it. Not while a
   * request is pending: the render that performs it comes first (it moves the scroller to the
   * request's picture, so the position read below is the core's own), and if that cannot run
   * now, the render under way performs it, and the reading would be a stale one.
   */
  const report = (): void => {
    if (pending() && (flush(), pending())) return;
    wanted = undefined;
    let left = scroller.scrollLeft;
    const top = host === undefined ? scroller.scrollTop : pageTop;
    let compensated = false;
    try {
      for (let step = 0; step < SETTLE_STEPS; step += 1) {
        const change = core.scroll({ left, top });
        if (change === undefined) break;
        // The content takes its new size first, so that the scroller has room for the offset.
        setContentWidth(change.scale.durationToPx(change.range.end - change.range.start));
        if (change.shift === 0) continue;
        left = change.scrollLeft;
        compensated = true;
      }
    } finally {
      // Also when the core threw after a change it had adopted: that change is in the snapshot,
      // so the offset has to follow it. `scrollTo`, not the `scrollLeft` setter: the setter
      // follows the page's CSS `scroll-behavior`, and a smooth compensation is a visible jump.
      if (compensated) scroller.scrollTo({ left, behavior: 'instant' });
      if (host !== undefined) pin.scrollTo({ left, behavior: 'instant' });
      if (compensated) flush();
    }
  };
  listen(scroller, 'scroll', report, { signal, passive: true });
  // The pin covers the header and scrolls nothing by hand: a sideways wheel or touch on it is the scroller's.
  forwardScroll(pin, scroller, signal);

  /** Who wants to know that the chart's frame moved on screen ({@link ScrollSync.onFrameMove}). */
  const frameListeners = new Set<() => void>();

  /** The host's scroll or resize: the next frame measures. */
  const mark = (): void => {
    if (host === undefined) return;
    dirty = true;
    requestFrame();
    for (const listener of [...frameListeners]) listener();
  };

  /** A resize of the host (or the window): what it can scroll may have changed, so look again. */
  const hostResized = (): void => {
    recheck = true;
    mark();
  };

  /** Makes `next` the host, and listens to it (once, whatever the number of times it is host). */
  const adopt = (next: ScrollHost): void => {
    host = next;
    if (watched.has(next.events)) return;
    watched.add(next.events);
    listen(next.events, 'scroll', mark, { signal, passive: true });
    onDispose(observeHostSize(next, hostResized, signal));
  };

  return {
    apply({ from, left, top, behavior }): void {
      wanted = undefined;
      if (from !== undefined) scroller.scrollTo({ left: from, behavior: 'instant' });
      // The scroller scrolls both ways, or, with an automatic height, sideways only.
      const own = host === undefined ? top : undefined;
      if (left !== undefined || own !== undefined) {
        if (behavior === 'instant' && left !== undefined) goTo(left, own);
        else scroller.scrollTo({ left, top: own, behavior } as ScrollToOptions);
      }
      if (host === undefined) return;
      if (top !== undefined) {
        // The row at `top` goes to the top of the visible part of the chart: the chart's own
        // top edge is `top` px above it, and that part starts at the host's `target`, below the
        // pin (which may stick below a header of the application's).
        const { target } = measureHost(host, pin);
        host.element.scrollBy({
          top: scroller.getBoundingClientRect().top - target + top,
          behavior,
        });
      }
      pin.scrollTo({ left: scroller.scrollLeft, behavior: 'instant' });
    },
    place(snapshot): void {
      const left = snapshot.timeline.scrollLeft;
      const top = host === undefined ? snapshot.scrollTop : undefined;
      if (left === 0 && !top) return;
      goTo(left, top);
      if (host !== undefined) pin.scrollTo({ left, behavior: 'instant' });
    },
    setPaged(paged): void {
      if (paged === (host !== undefined)) return;
      if (!paged) {
        host = undefined;
        pageTop = 0;
        dirty = recheck = false;
        // The scroller's own position is the core's again.
        report();
        return;
      }
      const found = scrollHostOf(scroller);
      adopt(found);
      hostHeight = measureHost(found, pin).height;
      width = scroller.clientWidth;
      dirty = true;
      requestFrame();
    },
    contentResized(): void {
      if (host === undefined) return;
      recheck = dirty = true;
      requestFrame();
    },
    report,
    onFrameMove(listener): () => void {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    refresh(): void {
      if (wanted !== undefined) goTo(wanted);
    },
    viewport(size): ElementSize {
      width = size.width;
      return host === undefined ? size : { width: size.width, height: hostHeight };
    },
    measure(): void {
      if (host === undefined || !dirty) return;
      // The render this runs in performs the pending request next: measure in the one after.
      if (pending()) {
        requestFrame();
        return;
      }
      dirty = false;
      if (recheck) {
        recheck = false;
        const found = scrollHostOf(scroller);
        if (found.element !== host.element) {
          adopt(found);
          hostHeight = -1;
        }
      }
      const view = measureHost(host, pin);
      const top = Math.max(0, view.top - scroller.getBoundingClientRect().top);
      const resized = view.height !== hostHeight;
      if (!resized && top === pageTop) return;
      hostHeight = view.height;
      pageTop = top;
      if (resized) core.setViewport({ width, height: hostHeight });
      report();
    },
  };
}

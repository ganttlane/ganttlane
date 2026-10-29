import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeResizeObserver, trackListeners } from '../testing';
import {
  forwardScroll,
  measureHost,
  observeHostSize,
  scrollByInstant,
  scrollHostOf,
} from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('scrollByInstant', () => {
  it('FR-EDIT-6: moves the scroller by a distance, instantly, whatever the page puts on it', () => {
    const scroller = document.createElement('div');
    const scrollBy = vi.spyOn(scroller, 'scrollBy');

    scrollByInstant(scroller, { left: 24 });
    scrollByInstant(scroller, { left: -8, top: 47 });

    expect(scrollBy.mock.calls).toEqual([
      [{ left: 24, top: 0, behavior: 'instant' }],
      [{ left: -8, top: 47, behavior: 'instant' }],
    ]);
  });

  it('FR-TL-3: is relative to the current position, so a compensation in between is kept', () => {
    const scroller = document.createElement('div');
    scroller.scrollLeft = 100;

    scrollByInstant(scroller, { left: 20 });
    // The infinite timeline moves the scroller (a compensation) between two steps of the writer…
    scroller.scrollLeft += 560;
    // …which the next step must not undo, however long ago the writer looked.
    scrollByInstant(scroller, { left: 20 });

    expect(scroller.scrollLeft).toBe(100 + 20 + 560 + 20);
  });
});

describe('forwardScroll', () => {
  /** An element that covers a scroller, wired to pass sideways scrolling on to it. */
  function wired() {
    const cover = document.createElement('div');
    const scroller = document.createElement('div');
    document.body.append(cover, scroller);
    const abort = new AbortController();
    const scrollBy = vi.spyOn(scroller, 'scrollBy');
    forwardScroll(cover, scroller, abort.signal);
    return { cover, scroller, scrollBy, abort };
  }
  const touch = (type: string, x: number, pointerType = 'touch'): PointerEvent =>
    new PointerEvent(type, { pointerType, pointerId: 1, clientX: x, bubbles: true });

  it('FR-SCROLL-3: a sideways wheel over the cover scrolls the scroller, instantly', () => {
    const { cover, scrollBy } = wired();

    cover.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 3 }));
    cover.dispatchEvent(new WheelEvent('wheel', { deltaX: -40 }));

    expect(scrollBy.mock.calls).toEqual([
      [{ left: 120, top: 0, behavior: 'instant' }],
      [{ left: -40, top: 0, behavior: 'instant' }],
    ]);
  });

  it('FR-SCROLL-3: the wheel with shift scrolls sideways by its vertical distance', () => {
    const { cover, scrollBy } = wired();

    // (happy-dom's wheel events do not take the modifier keys of their init.)
    const event = new WheelEvent('wheel', { deltaY: 90 });
    Object.defineProperty(event, 'shiftKey', { value: true });
    cover.dispatchEvent(event);

    expect(scrollBy.mock.calls).toEqual([[{ left: 90, top: 0, behavior: 'instant' }]]);
  });

  it('FR-SCROLL-3: a vertical wheel is left to the page, and a wheel in lines is converted to px', () => {
    const { cover, scrollBy } = wired();

    cover.dispatchEvent(new WheelEvent('wheel', { deltaY: 90 }));
    expect(scrollBy).not.toHaveBeenCalled();

    // Firefox reports a mouse wheel in lines.
    cover.dispatchEvent(new WheelEvent('wheel', { deltaX: 3, deltaMode: 1 }));
    expect(scrollBy.mock.calls).toEqual([[{ left: 120, top: 0, behavior: 'instant' }]]);
  });

  it('FR-SCROLL-3: a touch that drags sideways over the cover drags the scroller with it', () => {
    const { cover, scrollBy } = wired();

    cover.dispatchEvent(touch('pointerdown', 300));
    cover.dispatchEvent(touch('pointermove', 260));
    cover.dispatchEvent(touch('pointermove', 275));
    cover.dispatchEvent(touch('pointerup', 275));
    cover.dispatchEvent(touch('pointermove', 100));

    // Content follows the finger: the scroller moves by what the finger moved, the other way.
    expect(scrollBy.mock.calls).toEqual([
      [{ left: 40, top: 0, behavior: 'instant' }],
      [{ left: -15, top: 0, behavior: 'instant' }],
    ]);
  });

  it('FR-SCROLL-3: a touch the browser takes over (a vertical pan, pointercancel), a mouse and a pen are left alone', () => {
    const { cover, scrollBy } = wired();

    cover.dispatchEvent(touch('pointerdown', 300));
    cover.dispatchEvent(touch('pointercancel', 300));
    cover.dispatchEvent(touch('pointermove', 200));
    cover.dispatchEvent(touch('pointerdown', 300, 'mouse'));
    cover.dispatchEvent(touch('pointermove', 200, 'mouse'));
    cover.dispatchEvent(touch('pointerdown', 300, 'pen'));
    cover.dispatchEvent(touch('pointermove', 200, 'pen'));

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('FR-API-4: nothing listens once the signal is aborted', () => {
    const tracker = trackListeners();
    const { cover, scrollBy, abort } = wired();
    expect(tracker.alive().length).toBeGreaterThan(0);

    abort.abort();
    cover.dispatchEvent(new WheelEvent('wheel', { deltaX: 120 }));
    cover.dispatchEvent(touch('pointerdown', 300));
    cover.dispatchEvent(touch('pointermove', 200));

    expect(scrollBy).not.toHaveBeenCalled();
    expect(tracker.alive()).toEqual([]);
    tracker.restore();
  });
});

/**
 * An element at the end of a chain of ancestors with the given `overflow-y` values. Those that
 * scroll have content to scroll (300 px of client box, 900 of content) unless `fits` says their
 * content fits, which is what a wrapper that grows with its content looks like.
 */
function nested(...overflows: (string | undefined)[]): HTMLElement {
  return nestedWith(false, ...overflows);
}

/** Gives an element a client box and a content of the given heights (happy-dom lays out nothing). */
function size(element: Element, client: number, content: number): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => client });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => content });
}

function nestedWith(fits: boolean, ...overflows: (string | undefined)[]): HTMLElement {
  let parent: HTMLElement = document.body;
  for (const overflow of overflows) {
    const element = document.createElement('div');
    if (overflow !== undefined) element.style.overflowY = overflow;
    size(element, 300, fits ? 300 : 900);
    parent.append(element);
    parent = element;
  }
  const leaf = document.createElement('div');
  parent.append(leaf);
  return leaf;
}

describe('scrollHostOf', () => {
  it('FR-SCROLL-2: is the page when no ancestor scrolls', () => {
    const host = scrollHostOf(nested(undefined, 'visible'));

    expect(host.page).toBe(true);
    expect(host.element).toBe(document.scrollingElement);
    // The page's scroll events fire on the document, not on its scrolling element.
    expect(host.events).toBe(document);
  });

  it('FR-SCROLL-2: is the nearest ancestor that scrolls vertically', () => {
    for (const overflow of ['auto', 'scroll', 'overlay']) {
      const leaf = nested('auto', undefined, overflow, undefined);
      const nearest = leaf.parentElement?.parentElement;

      const host = scrollHostOf(leaf);

      expect(host.page, overflow).toBe(false);
      expect(host.element, overflow).toBe(nearest);
      expect(host.events, overflow).toBe(nearest);
      document.body.replaceChildren();
    }
  });

  it('FR-SCROLL-3: an ancestor that has nothing to scroll is not a host: a wrapper that grows with the chart', () => {
    // `overflow-x: auto` alone computes to `overflow-y: auto`, and the wrapper never scrolls.
    const wrapper = nestedWith(true, 'auto');

    expect(scrollHostOf(wrapper).page).toBe(true);
  });

  it('FR-SCROLL-3: the next ancestor up that does scroll is the host, past a wrapper that does not', () => {
    const leaf = nestedWith(false, 'auto');
    const outer = leaf.parentElement!;
    const wrapper = document.createElement('div');
    wrapper.style.overflowY = 'auto';
    size(wrapper, 500, 500);
    // outer (scrolls) > wrapper (does not) > leaf
    outer.append(wrapper);
    wrapper.append(leaf);

    const host = scrollHostOf(leaf);

    expect(host.page).toBe(false);
    expect(host.element).toBe(outer);
  });

  it('FR-SCROLL-3: whether it can scroll is checked now: a chart that has no height yet fits everywhere', () => {
    const leaf = nestedWith(false, 'auto');
    const element = leaf.parentElement!;

    size(element, 300, 300);
    expect(scrollHostOf(leaf).page).toBe(true);
    size(element, 300, 900);
    expect(scrollHostOf(leaf).element).toBe(element);
  });

  it('FR-SCROLL-2: an ancestor that clips (hidden) is not a host: nothing can scroll the chart in it', () => {
    const host = scrollHostOf(nested('hidden', 'clip'));

    expect(host.page).toBe(true);
  });

  it('FR-SCROLL-2: `body` and `html` are the page, whatever their overflow says', () => {
    // `overflow: auto` on body is passed on to the viewport: it is the page that scrolls.
    document.body.style.overflowY = 'auto';
    const host = scrollHostOf(nested(undefined));
    document.body.style.overflowY = '';

    expect(host.page).toBe(true);
  });
});

describe('measureHost', () => {
  it('FR-SCROLL-3: the page: its client height, top edge at 0', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this === document.documentElement ? 720 : 0;
    });

    expect(measureHost(scrollHostOf(nested(undefined)))).toEqual({
      top: 0,
      height: 720,
      target: 0,
    });
  });

  it('FR-SCROLL-3: an element: its client height and the top of its client box in the viewport', () => {
    const leaf = nested('auto');
    const element = leaf.parentElement!;
    vi.spyOn(element, 'clientTop', 'get').mockReturnValue(2);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 140 } as DOMRect);

    expect(measureHost(scrollHostOf(leaf))).toEqual({ top: 142, height: 300, target: 142 });
  });

  it('FR-SCROLL-2: the top of the pin and the padding of an element host are above the chart', () => {
    const leaf = nested('auto');
    const element = leaf.parentElement!;
    element.style.paddingTop = '24px';
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    const pin = document.createElement('div');
    pin.style.top = '80px';
    document.body.append(pin);

    // 24 px of padding and an 80 px `top`: the header sticks 104 px below the host's top edge,
    // and 104 of its 300 px are not the chart's.
    expect(measureHost(scrollHostOf(leaf), pin)).toEqual({ top: 204, height: 196, target: 204 });
    // The page's own padding does not count: its sticky children stick to the viewport.
    const page = scrollHostOf(nested(undefined));
    document.documentElement.style.paddingTop = '24px';
    expect(measureHost(page, pin).top).toBe(80);
    document.documentElement.style.paddingTop = '';
  });

  it('FR-SCROLL-2: `scroll-padding-top` is where a row goes when it is more than the header needs', () => {
    const leaf = nested('auto');
    const element = leaf.parentElement!;
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    element.style.setProperty('scroll-padding-top', '64px');
    const pin = document.createElement('div');
    pin.style.top = '10px';
    document.body.append(pin);

    // It never puts the row under the header, and the room the application asks for is kept.
    expect(measureHost(scrollHostOf(leaf), pin)).toMatchObject({ top: 110, target: 164 });
    element.style.setProperty('scroll-padding-top', '4px');
    expect(measureHost(scrollHostOf(leaf), pin)).toMatchObject({ top: 110, target: 110 });
    // Anything that is not a length in px (auto, a percentage) asks for nothing.
    element.style.setProperty('scroll-padding-top', '10%');
    expect(measureHost(scrollHostOf(leaf), pin)).toMatchObject({ top: 110, target: 110 });
  });
});

describe('observeHostSize', () => {
  it('FR-SCROLL-3: the page: reports when the window is resized, until the signal is aborted', () => {
    const tracker = trackListeners();
    const abort = new AbortController();
    const changed = vi.fn();

    observeHostSize(scrollHostOf(nested(undefined)), changed, abort.signal);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    abort.abort();
    window.dispatchEvent(new Event('resize'));

    expect(changed).toHaveBeenCalledTimes(2);
    expect(tracker.alive()).toEqual([]);
    tracker.restore();
  });

  it('FR-SCROLL-3: an element: reports when it is resized, and disconnects when released', () => {
    const FakeObserver = installFakeResizeObserver();
    const leaf = nested('auto');
    const element = leaf.parentElement!;
    const abort = new AbortController();
    const changed = vi.fn();

    const release = observeHostSize(scrollHostOf(leaf), changed, abort.signal);
    FakeObserver.instances[0]?.deliver(element, 600, 300);
    FakeObserver.instances[0]?.deliver(element, 600, 280);
    release();

    expect(changed).toHaveBeenCalledTimes(2);
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
  });
});

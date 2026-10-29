import type { ScrollRequest } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountRenderer, type RendererOptions } from './renderer';
import type { ListenerTracker } from './testing';
import {
  createContainer,
  createFakeCore,
  createManualFrames,
  fakeSnapshot,
  installFakeResizeObserver,
  trackListeners,
} from './testing';

/**
 * Plan step 4.9 (FR-SCROLL-2, FR-SCROLL-3): the chart's height, and the page that scrolls a chart
 * of automatic height. happy-dom does no layout, so the boxes the renderer reads are stubbed:
 * the chart is at `chartTop` in the viewport, the page is `hostHeight` tall (and, for an
 * element that scrolls, starts at `hostTop`).
 */

let tracker: ListenerTracker;
/**
 * The geometry the stubs report. `hostContent` is the `scrollHeight` of an element that is
 * marked as a host (`data-host`), or, when it is a function, what that is for the chart as drawn
 * so far (the body height the renderer has written).
 */
const geometry: {
  chartTop: number;
  hostTop: number;
  hostHeight: number;
  /** The page's height when it is not the host's (`hostHeight` is both by default). */
  pageHeight: number | undefined;
  hostContent: number | ((bodyHeight: number) => number);
} = { chartTop: 0, hostTop: 0, hostHeight: 700, pageHeight: undefined, hostContent: 5000 };

beforeEach(() => {
  tracker = trackListeners();
  geometry.chartTop = 0;
  geometry.hostTop = 0;
  geometry.hostHeight = 700;
  geometry.pageHeight = undefined;
  geometry.hostContent = 5000;
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    if ((this as HTMLElement).dataset.host !== '') return 0;
    const { hostContent } = geometry;
    if (typeof hostContent === 'number') return hostContent;
    const written = document.querySelector<HTMLElement>('.gantt')?.style;
    return hostContent(Number.parseFloat(written?.getPropertyValue('--gantt-body-height') ?? '0'));
  });
  const isScroller = (element: Element): boolean => element.classList.contains('gantt__scroller');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? 800 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (isScroller(this)) return 400;
    if (this === document.documentElement) return geometry.pageHeight ?? geometry.hostHeight;
    return this.dataset.host === '' ? geometry.hostHeight : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = isScroller(this) ? geometry.chartTop : geometry.hostTop;
    return { top } as DOMRect;
  });
});

afterEach(() => {
  tracker.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function request(parts: Partial<ScrollRequest> & { id: number }): ScrollRequest {
  return {
    reason: 'scroll-to',
    from: undefined,
    left: undefined,
    top: undefined,
    behavior: 'instant',
    ...parts,
  };
}

/** Mounts onto a fake core, by default in a plain container on the page. */
function setup(options: RendererOptions = {}, into?: HTMLElement) {
  const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
  const scrollBy = vi.spyOn(Element.prototype, 'scrollBy');
  const container = into ?? createContainer();
  const fake = createFakeCore();
  const frames = createManualFrames();
  const renderer = mountRenderer(container, fake, { frames, ...options });
  const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
  const root = container.querySelector<HTMLElement>('.gantt')!;
  const pin = container.querySelector<HTMLElement>('.gantt__pin');
  return { container, fake, frames, renderer, scroller, root, pin, scrollTo, scrollBy };
}

/** The elements a spy was called on, by call. */
const contextsOf = (spy: { mock: { contexts: unknown[] } }): unknown[] => spy.mock.contexts;

describe('the height option', () => {
  it('FR-SCROLL-3: a number is the height of the chart, kept as a custom property of the root', () => {
    const { root, renderer } = setup({ height: 320 });

    expect(root.style.getPropertyValue('--gantt-height')).toBe('320px');
    expect(root.hasAttribute('data-height')).toBe(false);

    renderer.setHeight(480);
    expect(root.style.getPropertyValue('--gantt-height')).toBe('480px');
  });

  it('FR-SCROLL-3: without it, or with a value it cannot use, the chart fills its container', () => {
    for (const height of [undefined, 0, -1, Number.NaN, 'tall'] as unknown as number[]) {
      const { root } = setup({ height });

      expect(root.style.getPropertyValue('--gantt-height'), String(height)).toBe('');
      expect(root.hasAttribute('data-height'), String(height)).toBe(false);
    }
  });

  it('FR-SCROLL-3: a fixed height is the chart with the header in its scroller, as before', () => {
    const { scroller, pin, fake } = setup({ height: 300 });

    expect(scroller.firstElementChild?.className).toBe('gantt__header');
    expect(pin).toBeNull();
    // The scroller's own vertical position is the core's, as it always was.
    scroller.scrollTop = 120;
    scroller.dispatchEvent(new Event('scroll'));
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 120 });
    // No host to watch (that is `'auto'` only): the one resize listener is the input's, which
    // drops its measurement of the chart when the window changes size.
    expect(tracker.alive().filter((entry) => entry.type === 'resize')).toHaveLength(1);
  });
});

describe("height: 'auto' (the page scrolls the chart)", () => {
  it('FR-SCROLL-3: the header leaves the scroller for a pin in front of it', () => {
    const { root, scroller, pin } = setup({ height: 'auto' });

    expect(root.getAttribute('data-height')).toBe('auto');
    expect(pin?.firstElementChild?.className).toBe('gantt__header');
    expect(pin?.nextElementSibling).toBe(scroller);
    expect(scroller.querySelector('.gantt__header')).toBeNull();
  });

  it('FR-SCROLL-3: the core sees the page as the viewport: its height, not the chart’s', () => {
    const { fake } = setup({ height: 'auto' });

    // The scroller is 400 px tall here, as tall as its content; the page shows 700.
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 700 });
  });

  it('FR-SCROLL-3, NFR-PERF-3: how far the page is scrolled past the chart is the core’s scrollTop', () => {
    const { fake, frames } = setup({ height: 'auto' });

    geometry.chartTop = -300;
    document.dispatchEvent(new Event('scroll'));
    frames.step();

    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 300 });

    // A chart that starts below the top of the page has not been scrolled at all.
    geometry.chartTop = 120;
    document.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 0 });
  });

  it('NFR-PERF-2: the handler of the page’s scroll reads no layout; the frame it asks for reads it once', () => {
    const { frames } = setup({ height: 'auto' });
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    rect.mockClear();

    geometry.chartTop = -50;
    document.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
    expect(rect).not.toHaveBeenCalled();
    expect(frames.queued).toBe(1);

    frames.step();
    // The scroller's box (the page is the viewport: nothing to measure there).
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('FR-SCROLL-3: nothing happens to the core when the page has not moved', () => {
    const { fake, frames } = setup({ height: 'auto' });
    geometry.chartTop = -300;
    document.dispatchEvent(new Event('scroll'));
    frames.step();
    fake.scroll.mockClear();
    fake.setViewport.mockClear();

    document.dispatchEvent(new Event('scroll'));
    frames.step();

    expect(fake.scroll).not.toHaveBeenCalled();
    expect(fake.setViewport).not.toHaveBeenCalled();
  });

  it('FR-SCROLL-3: the window being resized reports the new height of the page', () => {
    const { fake, frames } = setup({ height: 'auto' });

    geometry.hostHeight = 540;
    window.dispatchEvent(new Event('resize'));
    frames.step();

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 540 });
  });

  it('FR-TL-2: the scroller’s own scroll reports the page’s top, since its scrollTop is always 0', () => {
    const { fake, frames, scroller } = setup({ height: 'auto' });
    geometry.chartTop = -300;
    document.dispatchEvent(new Event('scroll'));
    frames.step();

    scroller.scrollLeft = 640;
    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 640, top: 300 });
  });

  it('FR-SCROLL-2, FR-SCROLL-3: a page that moved in the frame that performs a request is measured in the next one', () => {
    const { fake, frames, scroller } = setup({ height: 'auto' });
    fake.publish(
      fakeSnapshot({ contentWidth: 5000, scrollRequest: request({ id: 1, left: 900 }) }),
    );
    geometry.chartTop = -300;
    document.dispatchEvent(new Event('scroll'));
    fake.scroll.mockClear();

    frames.step();

    // The scroller still held the old picture when the frame began: reporting it (with the
    // page's top) would undo the request, so the frame performs the request and measures later.
    expect(scroller.scrollLeft).toBe(900);
    expect(fake.scroll).not.toHaveBeenCalled();
    expect(frames.queued).toBe(1);
    frames.step();
    expect(fake.scroll.mock.calls).toEqual([[{ left: 900, top: 300 }]]);
    expect(frames.queued).toBe(0);
  });

  it('FR-SCROLL-3: a sideways wheel or touch over the header pin scrolls the chart, as it does over the rows', () => {
    // The pin is in front of the scroller and does not scroll sideways itself (`overflow:
    // hidden`), so without help nothing the user does over the header moves the chart.
    const { pin, scroller } = setup({ height: 'auto' });
    const scrollBy = vi.spyOn(scroller, 'scrollBy');

    pin!.dispatchEvent(new WheelEvent('wheel', { deltaX: 80 }));
    pin!.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: 200 }));
    pin!.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 150 }));

    expect(scrollBy.mock.calls).toEqual([
      [{ left: 80, top: 0, behavior: 'instant' }],
      [{ left: 50, top: 0, behavior: 'instant' }],
    ]);
  });

  it('FR-SCROLL-3: the header pin scrolls with the scroller, in the same task', () => {
    const { scroller, pin, scrollTo } = setup({ height: 'auto' });
    scrollTo.mockClear();

    scroller.scrollLeft = 321;
    scroller.dispatchEvent(new Event('scroll'));

    const index = contextsOf(scrollTo).indexOf(pin);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(scrollTo.mock.calls[index]).toEqual([{ left: 321, behavior: 'instant' }]);
  });

  it('FR-SCROLL-2: a request that scrolls vertically scrolls the page by the distance to the row', () => {
    const { fake, frames, scrollTo, scrollBy, scroller } = setup({ height: 'auto' });
    // The chart's top is 300 px above the page's: body y = 1000 is 700 px below the page's top.
    geometry.chartTop = -300;
    scrollTo.mockClear();

    fake.publish(
      fakeSnapshot({ scrollRequest: request({ id: 1, top: 1000, behavior: 'smooth' }) }),
    );
    frames.step();

    const index = contextsOf(scrollBy).indexOf(document.scrollingElement);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(scrollBy.mock.calls[index]).toEqual([{ top: 700, behavior: 'smooth' }]);
    // Never the scroller: it does not scroll vertically.
    expect(contextsOf(scrollTo).filter((context) => context === scroller)).toEqual([]);
  });

  it('FR-SCROLL-2: a request that scrolls both ways scrolls the scroller sideways and the page down', () => {
    const { fake, frames, scrollTo, scrollBy, scroller } = setup({ height: 'auto' });
    scrollTo.mockClear();

    fake.publish(
      fakeSnapshot({ scrollRequest: request({ id: 1, left: 900, top: 250, behavior: 'instant' }) }),
    );
    frames.step();

    const sideways = contextsOf(scrollTo).indexOf(scroller);
    expect(scrollTo.mock.calls[sideways]).toEqual([{ left: 900, behavior: 'instant' }]);
    const down = contextsOf(scrollBy).indexOf(document.scrollingElement);
    expect(scrollBy.mock.calls[down]).toEqual([{ top: 250, behavior: 'instant' }]);
  });

  it('FR-SCROLL-2: a horizontal request leaves the page where it is', () => {
    const { fake, frames, scrollBy } = setup({ height: 'auto' });

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, left: 900 }) }));
    frames.step();

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('FR-SCROLL-2: the nearest ancestor that scrolls is the host: it scrolls, is measured and listened to', () => {
    const host = createContainer();
    host.style.overflowY = 'auto';
    host.dataset.host = '';
    const inner = document.createElement('div');
    host.append(inner);
    geometry.hostTop = 100;
    geometry.chartTop = 40;
    geometry.hostHeight = 500;
    const { fake, frames, scrollBy } = setup({ height: 'auto' }, inner);

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 500 });
    // The chart starts 60 px above the top of the host's client box.
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 60 });

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, top: 300 }) }));
    frames.step();
    const index = contextsOf(scrollBy).indexOf(host);
    // The chart's top (40) is 60 px above the host's (100): body y = 300 is 240 px below it.
    expect(scrollBy.mock.calls[index]).toEqual([{ top: 240, behavior: 'instant' }]);

    // The host's scroll (not the page's) is what moves the window of rows.
    geometry.chartTop = -200;
    host.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 300 });
  });

  it('FR-SCROLL-3: the host being resized (an element) reports its new height', () => {
    const FakeObserver = installFakeResizeObserver();
    const host = createContainer();
    host.style.overflowY = 'auto';
    host.dataset.host = '';
    const inner = document.createElement('div');
    host.append(inner);
    const { fake, frames } = setup({ height: 'auto' }, inner);

    geometry.hostHeight = 380;
    for (const observer of FakeObserver.instances) observer.deliver(host, 600, 380);
    frames.step();

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 380 });
  });

  it('FR-SCROLL-3: the height changes at runtime, both ways', () => {
    const { fake, frames, renderer, root, scroller, container } = setup({ height: 300 });

    renderer.setHeight('auto');
    expect(root.getAttribute('data-height')).toBe('auto');
    expect(container.querySelector('.gantt__pin .gantt__header')).not.toBeNull();
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 700 });
    geometry.chartTop = -120;
    document.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 120 });

    renderer.setHeight(260);
    expect(root.getAttribute('data-height')).toBeNull();
    expect(root.style.getPropertyValue('--gantt-height')).toBe('260px');
    expect(container.querySelector('.gantt__pin')).toBeNull();
    expect(scroller.firstElementChild?.className).toBe('gantt__header');
    // The core is told the scroller's own size and position again, and the page is not heard.
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 0 });
    fake.scroll.mockClear();
    document.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).not.toHaveBeenCalled();
  });

  it('FR-SCROLL-3: a chart that is scrolled sideways when its height becomes auto keeps the header on its bars', () => {
    const { frames, renderer, scroller, container } = setup({ height: 300 });
    scroller.scrollLeft = 560;
    scroller.dispatchEvent(new Event('scroll'));
    frames.step();

    renderer.setHeight('auto');
    const pin = container.querySelector<HTMLElement>('.gantt__pin')!;
    expect(pin.querySelector('.gantt__header')).not.toBeNull();
    // At once, not at the next scroll event: the pin starts at 0 and nothing else moves it.
    expect(pin.scrollLeft).toBe(scroller.scrollLeft);
    expect(pin.scrollLeft).toBe(560);

    // Round trip: the pin that left the document comes back at the scroller's offset.
    renderer.setHeight(260);
    scroller.scrollLeft = 300;
    scroller.dispatchEvent(new Event('scroll'));
    pin.scrollLeft = 0;
    renderer.setHeight('auto');
    expect(pin.scrollLeft).toBe(300);
  });

  it('FR-API-4: no listener or observer of the page survives destroy', () => {
    const FakeObserver = installFakeResizeObserver();
    const host = createContainer();
    host.style.overflowY = 'auto';
    host.dataset.host = '';
    const inner = document.createElement('div');
    host.append(inner);
    const page = setup({ height: 'auto' });
    const element = setup({ height: 'auto' }, inner);

    page.renderer.destroy();
    element.renderer.destroy();
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    host.dispatchEvent(new Event('scroll'));
    page.frames.step();

    expect(page.fake.scroll).not.toHaveBeenCalled();
    expect(tracker.alive()).toEqual([]);
    expect(FakeObserver.instances.every((observer) => observer.observed.size === 0)).toBe(true);
  });
});

/** A host that scrolls (when it has something to scroll), around an element for the chart. */
function hostAround(): { host: HTMLElement; inner: HTMLElement } {
  const host = createContainer();
  host.style.overflowY = 'auto';
  host.dataset.host = '';
  const inner = document.createElement('div');
  host.append(inner);
  return { host, inner };
}

describe("height: 'auto' inside an ancestor that does not scroll (FR-SCROLL-3)", () => {
  it('FR-SCROLL-3: a wrapper that grows with the chart is no host: the page that scrolls it is', () => {
    // `overflow-x: auto` alone computes to `overflow-y: auto` too, but the wrapper is as tall as
    // its content and never scrolls: asking it would draw every row.
    const { host, inner } = hostAround();
    geometry.hostContent = 700;
    const { fake, frames } = setup({ height: 'auto' }, inner);

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 700 });
    geometry.chartTop = -300;
    host.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).not.toHaveBeenCalledWith({ left: 0, top: 300 });

    document.dispatchEvent(new Event('scroll'));
    frames.step();
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 300 });
  });

  it('FR-SCROLL-3: looks again once the chart has its height: a wrapper that scrolls then is the host', () => {
    // At mount the chart has no rows yet, so the wrapper has nothing to scroll; the first render
    // gives it the chart's height, and the host is looked for again before anything is painted.
    const { inner } = hostAround();
    geometry.hostHeight = 400;
    geometry.pageHeight = 700;
    geometry.hostContent = (body) => Math.max(body, 400);
    const frames = createManualFrames();
    const fake = createFakeCore(fakeSnapshot({ bodyHeight: 9000 }));
    mountRenderer(inner, fake, { frames, height: 'auto' });

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });
    expect(frames.queued).toBe(0);
  });

  it('FR-SCROLL-3: and again when its rows change: a wrapper whose content now fits is not a host', () => {
    const { host, inner } = hostAround();
    geometry.hostHeight = 400;
    geometry.pageHeight = 700;
    geometry.hostContent = (body) => Math.max(body, 400);
    const frames = createManualFrames();
    const fake = createFakeCore(fakeSnapshot({ bodyHeight: 9000 }));
    mountRenderer(inner, fake, { frames, height: 'auto' });
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });

    // Rows collapsed: the whole chart fits in the wrapper, which stops scrolling.
    fake.publish(fakeSnapshot({ bodyHeight: 200 }));
    frames.step();
    frames.step();
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 700 });
    expect(host.isConnected).toBe(true);

    // And back: it scrolls again, and its height is the viewport.
    fake.publish(fakeSnapshot({ bodyHeight: 9000 }));
    frames.step();
    frames.step();
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });
  });

  it('FR-SCROLL-3: a window resize looks again, for a wrapper whose height follows the window', () => {
    const { inner } = hostAround();
    geometry.hostHeight = 400;
    geometry.pageHeight = 700;
    geometry.hostContent = 300;
    const { fake, frames } = setup({ height: 'auto' }, inner);
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 700 });

    // The window got smaller: the wrapper (`max-height: 40vh`, say) is now shorter than its content.
    geometry.hostContent = 5000;
    window.dispatchEvent(new Event('resize'));
    frames.step();

    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });
  });
});

describe("height: 'auto' under a sticky header of the application (FR-SCROLL-2)", () => {
  it('FR-SCROLL-2: scrollToTask clears a pin that sticks below the top of the page', () => {
    // `.gantt__pin { top: 80px }`: the header sticks below the application's own, so a row at
    // the top of the chart's visible part is 80 px lower than the page's top.
    const { fake, frames, pin, scrollBy } = setup({ height: 'auto' });
    pin!.style.top = '80px';
    geometry.chartTop = -300;

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, top: 1000 }) }));
    frames.step();

    const index = contextsOf(scrollBy).indexOf(document.scrollingElement);
    expect(scrollBy.mock.calls[index]).toEqual([{ top: 620, behavior: 'instant' }]);
  });

  it('FR-SCROLL-2: the padding of an element host sits above the pin too', () => {
    // The pin sticks inside the host's padding: 24 px of it are above the header.
    const { host, inner } = hostAround();
    host.style.paddingTop = '24px';
    geometry.hostTop = 100;
    geometry.chartTop = 40;
    const { fake, frames, scrollBy } = setup({ height: 'auto' }, inner);

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, top: 300 }) }));
    frames.step();

    const index = contextsOf(scrollBy).indexOf(host);
    expect(scrollBy.mock.calls[index]).toEqual([{ top: 216, behavior: 'instant' }]);
  });

  it('FR-SCROLL-2: `scroll-padding-top` of the host is the room the application asks to keep clear', () => {
    document.documentElement.style.setProperty('scroll-padding-top', '64px');
    const { fake, frames, scrollBy } = setup({ height: 'auto' });
    geometry.chartTop = -300;

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, top: 1000 }) }));
    frames.step();
    document.documentElement.style.removeProperty('scroll-padding-top');

    const index = contextsOf(scrollBy).indexOf(document.scrollingElement);
    expect(scrollBy.mock.calls[index]).toEqual([{ top: 636, behavior: 'instant' }]);
  });

  it('FR-SCROLL-3: the core is told the visible part of the chart, below the pin: its height and top', () => {
    const { fake, frames, pin } = setup({ height: 'auto' });
    pin!.style.top = '80px';
    geometry.chartTop = -300;

    // Anything that makes the renderer measure again: here the window being resized.
    window.dispatchEvent(new Event('resize'));
    frames.step();

    // 80 px of the page are the application's: the rows in view start below them, so the body y
    // at the bottom of the pin is 380, and the part of the page that shows rows is 620 tall.
    expect(fake.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 620 });
    expect(fake.scroll).toHaveBeenLastCalledWith({ left: 0, top: 380 });
  });

  it('NFR-PERF-2: the handlers of the page read nothing; the frame reads the geometry', () => {
    const { frames, pin } = setup({ height: 'auto' });
    pin!.style.top = '80px';
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    rect.mockClear();

    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(rect).not.toHaveBeenCalled();

    frames.step();
    expect(rect).toHaveBeenCalledTimes(1);
  });
});

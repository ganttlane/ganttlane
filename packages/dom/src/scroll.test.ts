import type { ScrollRequest } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayerFactories } from './layers/types';
import { mountRenderer } from './renderer';
import { createScrollSync, type ScrollCore } from './scroll';
import type { ListenerTracker } from './testing';
import {
  createContainer,
  createFakeCore,
  createManualFrames,
  createTestCore,
  fakeSnapshot,
  fakeViewportChange,
  installFakeResizeObserver,
  observeCore,
  resizeObserved,
  stubScrollerSize,
  trackListeners,
} from './testing';

let tracker: ListenerTracker;

beforeEach(() => {
  tracker = trackListeners();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  tracker.restore();
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

/** Mounts onto a fake core and records the `scrollTo` calls the renderer makes. */
function setup(initial = fakeSnapshot()) {
  const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
  const container = createContainer();
  const fake = createFakeCore(initial);
  const frames = createManualFrames();
  const renderer = mountRenderer(container, fake, { frames });
  const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
  const root = container.querySelector<HTMLElement>('.gantt')!;
  return { container, fake, frames, renderer, scroller, root, scrollTo };
}

describe('scroll requests', () => {
  it('FR-SCROLL-2: performs a request once, by id', () => {
    const { fake, frames, scrollTo } = setup();

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, left: 300, top: 20 }) }));
    frames.step();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 300, top: 20, behavior: 'instant' });

    // New snapshots that still carry request 1 do not scroll again.
    fake.publish(
      fakeSnapshot({ contentWidth: 1200, scrollRequest: request({ id: 1, left: 300, top: 20 }) }),
    );
    frames.step();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 2, left: 50 }) }));
    frames.step();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 50, behavior: 'instant' });
  });

  it('FR-SCROLL-2: honours `from`: an instant jump first, then the scroll with its behavior', () => {
    const { fake, frames, scrollTo } = setup();

    fake.publish(
      fakeSnapshot({
        scrollRequest: request({ id: 1, from: 120, left: 400, behavior: 'smooth' }),
      }),
    );
    frames.step();

    expect(scrollTo.mock.calls).toEqual([
      [{ left: 120, behavior: 'instant' }],
      [{ left: 400, behavior: 'smooth' }],
    ]);
  });

  it('FR-SCROLL-2: instant, smooth and auto pass straight through', () => {
    const { fake, frames, scrollTo } = setup();

    (['instant', 'smooth', 'auto'] as const).forEach((behavior, index) => {
      fake.publish(fakeSnapshot({ scrollRequest: request({ id: index + 1, left: 10, behavior }) }));
      frames.step();
    });

    expect(scrollTo.mock.calls.map(([options]) => (options as ScrollToOptions).behavior)).toEqual([
      'instant',
      'smooth',
      'auto',
    ]);
  });

  it('a request that only moves vertically leaves `left` out', () => {
    const { fake, frames, scrollTo } = setup();

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1, top: 64, behavior: 'smooth' }) }));
    frames.step();

    expect(scrollTo).toHaveBeenCalledWith({ top: 64, behavior: 'smooth' });
  });

  it('a request with nothing to scroll to does nothing', () => {
    const { fake, frames, scrollTo } = setup();

    fake.publish(fakeSnapshot({ scrollRequest: request({ id: 1 }) }));
    frames.step();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('NFR-PERF-2: the content is already as wide as the snapshot says when the scroll happens', () => {
    const { fake, frames, root } = setup();
    const widths: string[] = [];
    vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {
      widths.push(root.style.getPropertyValue('--gantt-content-width'));
    });

    fake.publish(
      fakeSnapshot({ contentWidth: 9000, scrollRequest: request({ id: 1, left: 8000 }) }),
    );
    frames.step();

    expect(widths).toEqual(['9000px']);
  });

  it('a request already in the snapshot at mount is not replayed; the scroller is placed where the core is', () => {
    const { scroller, scrollTo, frames } = setup(
      fakeSnapshot({
        scrollLeft: 250,
        scrollTop: 40,
        scrollRequest: request({ id: 5, left: 9999, behavior: 'smooth' }),
      }),
    );

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 250, top: 40, behavior: 'instant' });
    expect(scroller.scrollLeft).toBe(250);
    expect(scroller.scrollTop).toBe(40);
    frames.step();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('a core that has not been scrolled leaves a new scroller alone', () => {
    const { scrollTo } = setup();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('FR-SCROLL-1: the initial request of a real core is performed by the first render', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const container = createContainer();
    const core = createTestCore();

    mountRenderer(container, core, { frames: createManualFrames() });

    const snapshot = core.getSnapshot();
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    expect(snapshot.scrollRequest).toMatchObject({ id: 1, reason: 'initial' });
    expect(snapshot.timeline.scrollLeft).toBeGreaterThan(0);
    expect(scroller.scrollLeft).toBe(snapshot.timeline.scrollLeft);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('FR-SCROLL-2, FR-TL-6: a smooth scrollToDate outside an infinite range jumps to `from` first', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const container = createContainer();
    const core = createTestCore({
      timeline: { infinite: { extendBy: '2w' } },
      scroll: { initial: '2026-03-09', behavior: 'smooth' },
    });
    const frames = createManualFrames();
    mountRenderer(container, core, { frames });
    scrollTo.mockClear();

    const made = core.scrollToDate('2025-06-02')!;
    frames.step();

    expect(made.from).toBeDefined();
    expect(scrollTo.mock.calls).toEqual([
      [{ left: made.from, behavior: 'instant' }],
      [{ left: made.left, behavior: 'smooth' }],
    ]);
  });

  it('FR-SCROLL-2: an instant scrollToDate lands on the date in the same render', () => {
    const container = createContainer();
    const core = createTestCore({ scroll: { initial: '2026-03-02' } });
    const frames = createManualFrames();
    mountRenderer(container, core, { frames });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;

    const made = core.scrollToDate('2026-04-13', { behavior: 'instant' })!;
    frames.step();

    expect(made.left).toBeDefined();
    expect(scroller.scrollLeft).toBe(made.left);
  });
});

describe('a scroll asked for before the chart has a width', () => {
  it('FR-SCROLL-2: scrollToDate made while the container is hidden is performed when it gets its width', () => {
    installFakeResizeObserver();
    const size = stubScrollerSize(0, 400);
    const container = createContainer();
    const core = createTestCore({ scroll: { initial: 'start' } });
    mountRenderer(container, core, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    expect(core.getSnapshot().scrollRequest).toBeUndefined();

    // Nothing to scroll on yet: the core keeps the call.
    expect(core.scrollToDate('2026-04-06', { align: 0 })).toBeUndefined();
    expect(scroller.scrollLeft).toBe(0);
    size.set(800, 400);
    resizeObserved(scroller, 800, 400);

    const { timeline } = core.getSnapshot();
    expect(scroller.scrollLeft).toBe(timeline.scrollLeft);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(timeline.scale.xToDate(scroller.scrollLeft)).toBe(Date.UTC(2026, 3, 6));
  });
});

describe('a scroll event while a request has not been performed yet', () => {
  it('FR-SCROLL-2, FR-TL-2: reports the picture the request made, not the one it replaced', () => {
    // A smooth scroll or a momentum is in flight, and the application calls `scrollToDate`: the
    // browser's next scroll event, before the frame that performs the request, carries the old
    // picture's `scrollLeft`, which the core must never take for the position of the new one.
    const { fake, frames, scroller, scrollTo } = setup();
    scroller.scrollLeft = 120;
    fake.publish(
      fakeSnapshot({ contentWidth: 5000, scrollRequest: request({ id: 1, left: 900 }) }),
    );

    scroller.scrollLeft = 130;
    scroller.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith({ left: 900, behavior: 'instant' });
    expect(fake.scroll.mock.calls).toEqual([[{ left: 900, top: 0 }]]);
    // Performed once: the frame that was waiting for it has nothing left to do.
    scrollTo.mockClear();
    frames.step();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('FR-SCROLL-2, FR-TL-6: a smooth request is reported from where it starts, after its jump to `from`', () => {
    const { fake, scroller } = setup();
    scroller.scrollLeft = 120;
    fake.publish(
      fakeSnapshot({
        contentWidth: 5000,
        scrollRequest: request({ id: 1, from: 640, left: 2400, behavior: 'smooth' }),
      }),
    );

    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll.mock.calls).toEqual([[{ left: 640, top: 0 }]]);
  });

  it('FR-SCROLL-2: the same request is not performed again by the next scroll event', () => {
    const { fake, scroller, scrollTo } = setup();
    fake.publish(
      fakeSnapshot({ contentWidth: 5000, scrollRequest: request({ id: 1, left: 900 }) }),
    );

    scroller.dispatchEvent(new Event('scroll'));
    scroller.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(fake.scroll).toHaveBeenCalledTimes(2);
  });

  it('FR-SCROLL-2, FR-TL-6: with the real core the range grown for a smooth scrollToDate survives a stale scroll event', () => {
    const container = createContainer();
    const core = observeCore(
      createTestCore({
        timeline: { infinite: { extendBy: '2w' } },
        scroll: { initial: '2026-03-09', behavior: 'smooth' },
      }),
    );
    const frames = createManualFrames();
    mountRenderer(container, core, { frames });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    const root = container.querySelector<HTMLElement>('.gantt')!;
    core.scroll.mockClear();
    const oldLeft = scroller.scrollLeft;

    // Months before the plan: the range grows at its start, so every coordinate moves.
    const made = core.inner.scrollToDate('2025-06-02')!;
    const { scale } = core.getSnapshot().timeline;
    expect(made.from).toBeGreaterThan(oldLeft);
    scroller.scrollLeft = oldLeft + 7;
    scroller.dispatchEvent(new Event('scroll'));

    // The core was told the new picture's position, in the new coordinates.
    expect(core.scroll.mock.calls[0]).toEqual([{ left: made.from, top: 0 }]);
    expect(core.getSnapshot().timeline.scale).toBe(scale);
    expect(scroller.scrollLeft).toBe(made.from);
    expect(root.style.getPropertyValue('--gantt-content-width')).toBe(
      `${String(core.getSnapshot().contentWidth)}px`,
    );
    frames.step();
    expect(core.getSnapshot().timeline.scrollLeft).toBe(made.from);
  });
});

describe('a position the scroller cannot reach yet', () => {
  /** A scroller that cannot scroll further than `limit.max`, like one whose stylesheet is late. */
  function clampedScroller(max: number) {
    const limit = { max };
    vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (
      this: Element,
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === 'object' && options.left !== undefined) {
        this.scrollLeft = Math.min(options.left, limit.max);
      }
    });
    return limit;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('FR-SCROLL-1: is taken once the scroller is resized, when the stylesheet that sizes it arrives late', () => {
    // WebKit runs a module script before the stylesheet is applied, and clamps a `scrollTo`
    // against the content of that moment: the chart then opened at its start, not at its date.
    const observers = installFakeResizeObserver();
    const limit = clampedScroller(0);
    const container = createContainer();
    const fake = createFakeCore(fakeSnapshot({ scrollLeft: 2500 }));
    mountRenderer(container, fake, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    expect(scroller.scrollLeft).toBe(0);

    // The stylesheet arrives: the content is as wide as it should be, and the scroller (which
    // had the height of its content, not of its container) changes size.
    limit.max = 6000;
    resizeObserved(scroller, 1246, 384);

    expect(observers.instances[0]?.observed.has(scroller)).toBe(true);
    expect(scroller.scrollLeft).toBe(2500);

    // Reached: a later resize (the window) does not pull the scroller back.
    scroller.scrollLeft = 4000;
    resizeObserved(scroller, 1000, 384);
    expect(scroller.scrollLeft).toBe(4000);
  });

  it('FR-SCROLL-2: an instant request that could not be reached is taken the same way', () => {
    installFakeResizeObserver();
    const limit = clampedScroller(300);
    const container = createContainer();
    const fake = createFakeCore();
    const frames = createManualFrames();
    mountRenderer(container, fake, { frames });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;

    fake.publish(
      fakeSnapshot({ contentWidth: 9000, scrollRequest: request({ id: 1, left: 5000 }) }),
    );
    frames.step();
    expect(scroller.scrollLeft).toBe(300);

    limit.max = 8000;
    resizeObserved(scroller, 1246, 384);

    expect(scroller.scrollLeft).toBe(5000);
  });

  it('a scroll of the user in between drops it: the user is not pulled back', () => {
    installFakeResizeObserver();
    const limit = clampedScroller(0);
    const container = createContainer();
    const fake = createFakeCore(fakeSnapshot({ scrollLeft: 2500 }));
    mountRenderer(container, fake, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;

    scroller.scrollLeft = 30;
    scroller.dispatchEvent(new Event('scroll'));
    limit.max = 6000;
    resizeObserved(scroller, 1246, 384);

    expect(scroller.scrollLeft).toBe(30);
  });
});

describe('user scroll', () => {
  it('FR-TL-2: every scroll event reports scrollLeft and scrollTop to the core', () => {
    const { fake, scroller, scrollTo } = setup();

    scroller.scrollLeft = 321;
    scroller.scrollTop = 45;
    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll).toHaveBeenCalledTimes(1);
    expect(fake.scroll).toHaveBeenCalledWith({ left: 321, top: 45 });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('FR-TL-5: applies the compensation the core returns with an instant scrollTo, after the content is resized', () => {
    const { fake, scroller, root, scrollTo } = setup();
    const order: string[] = [];
    scrollTo.mockImplementation((options) => {
      order.push(
        `${JSON.stringify(options)} width=${root.style.getPropertyValue('--gantt-content-width')}`,
      );
    });
    // Not the `scrollLeft` setter: it follows the page's CSS `scroll-behavior`, and a smooth
    // compensation is a visible jump that fights the scroll in progress.
    const writes = vi.fn();
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => 300,
      set: writes,
    });
    fake.scroll.mockReturnValueOnce(fakeViewportChange(120, 5000, 420));

    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll).toHaveBeenCalledWith({ left: 300, top: 0 });
    expect(order).toEqual(['{"left":420,"behavior":"instant"} width=5000px']);
    expect(writes).not.toHaveBeenCalled();
  });

  it('FR-TL-5: renders the new snapshot synchronously, in the same frame as the compensation', () => {
    const container = createContainer();
    const fake = createFakeCore();
    const frames = createManualFrames();
    const widths: string[] = [];
    mountRenderer(container, fake, {
      frames,
      layers: {
        bars: () => ({
          mount: () => undefined,
          update(snapshot) {
            widths.push(String(snapshot.contentWidth));
          },
          destroy: () => undefined,
        }),
      } satisfies LayerFactories,
    });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    fake.scroll.mockImplementationOnce(() => {
      // The core publishes the extended range while it answers.
      fake.publish(fakeSnapshot({ contentWidth: 5000 }));
      return fakeViewportChange(80, 5000, 90);
    });
    scroller.scrollLeft = 10;

    scroller.dispatchEvent(new Event('scroll'));

    expect(scroller.scrollLeft).toBe(90);
    expect(widths).toEqual(['1000', '5000']);
    expect(frames.queued).toBe(0);
  });

  it('a change that only extends the end resizes at once but leaves scrollLeft and the frame alone', () => {
    const { fake, frames, scroller, root, scrollTo } = setup();
    fake.scroll.mockImplementationOnce(() => {
      fake.publish(fakeSnapshot({ contentWidth: 6000 }));
      return fakeViewportChange(0, 6000, 700);
    });
    scroller.scrollLeft = 700;

    scroller.dispatchEvent(new Event('scroll'));

    expect(root.style.getPropertyValue('--gantt-content-width')).toBe('6000px');
    expect(scroller.scrollLeft).toBe(700);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(frames.queued).toBe(1);
  });

  it('FR-TL-4: asks the core again at the compensated position until the range is settled', () => {
    const { fake, scroller, root, scrollTo } = setup();
    // An extension at the start, then a trim of the end, then nothing more to do.
    fake.scroll
      .mockReturnValueOnce(fakeViewportChange(120, 5000, 420))
      .mockReturnValueOnce(fakeViewportChange(0, 4000, 420))
      .mockReturnValueOnce(undefined);
    scroller.scrollLeft = 300;

    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll.mock.calls.map(([position]) => position.left)).toEqual([300, 420, 420]);
    // One write to the final position, over the final width.
    expect(root.style.getPropertyValue('--gantt-content-width')).toBe('4000px');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 420, behavior: 'instant' });
  });

  it('FR-EVT-1, FR-TL-5: a core that throws in the middle of settling still gets its first change applied', () => {
    // The first call extended the range (and the core published it); the second threw, say a
    // handler of the application did. The content has to be as wide as the snapshot says and
    // the offset compensated, or the date under the left edge jumps by the extension.
    const { fake, scroller, root, scrollTo } = setup();
    fake.scroll
      .mockReturnValueOnce(fakeViewportChange(120, 5000, 420))
      .mockImplementationOnce(() => {
        throw new Error('handler failed');
      });
    scroller.scrollLeft = 300;

    expect(() => scroller.dispatchEvent(new Event('scroll'))).toThrow('handler failed');

    expect(root.style.getPropertyValue('--gantt-content-width')).toBe('5000px');
    expect(scrollTo).toHaveBeenCalledWith({ left: 420, behavior: 'instant' });
    expect(scroller.scrollLeft).toBe(420);
  });

  it('FR-EVT-1, FR-TL-3: a handler of the application that throws on every range change cannot stop the extension or the compensation', () => {
    const reports: unknown[] = [];
    vi.spyOn(Promise, 'reject').mockImplementation((reason) => {
      reports.push(reason);
      return new Promise<never>(() => undefined);
    });
    const container = createContainer();
    const core = observeCore(
      createTestCore({
        timeline: { infinite: { extendBy: '2w' } },
        scroll: { initial: '2026-03-09' },
      }),
    );
    mountRenderer(container, core, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    const root = container.querySelector<HTMLElement>('.gantt')!;
    core.inner.on('rangeChange', () => {
      throw new Error('handler failed');
    });

    for (let i = 0; i < 3; i += 1) {
      const before = core.getSnapshot().timeline;
      const dateAtEdge = before.scale.xToDate(0);
      scroller.scrollLeft = 0;
      scroller.dispatchEvent(new Event('scroll'));

      // The range grew, the content was resized and the date at the start is where it was.
      const after = core.getSnapshot();
      expect(after.timeline.range.start).toBeLessThan(before.range.start);
      expect(root.style.getPropertyValue('--gantt-content-width')).toBe(`${after.contentWidth}px`);
      expect(after.timeline.scale.xToDate(scroller.scrollLeft)).toBe(dateAtEdge);
    }
    expect(reports).toHaveLength(3);
  });

  it('FR-TL-4: a core that never settles cannot keep one scroll event busy for ever', () => {
    const { fake, scroller } = setup();
    fake.scroll.mockImplementation(() => fakeViewportChange(10, 2000, 10));

    scroller.dispatchEvent(new Event('scroll'));

    // An extension and a trim for each edge is all a settling core has (`planExtension`).
    expect(fake.scroll).toHaveBeenCalledTimes(4);
  });

  it('FR-TL-4: one scroll event extends the end and trims the start, so the range is settled before paint', () => {
    const container = createContainer();
    const core = observeCore(
      createTestCore({
        timeline: { infinite: { extendBy: '2w', threshold: 300, maxSpan: '2mo' } },
        scroll: { initial: '2026-03-09' },
      }),
    );
    mountRenderer(container, core, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    const before = core.getSnapshot().timeline;
    // The user flings to within a few pixels of the end of the content.
    scroller.scrollLeft = core.getSnapshot().contentWidth - 800 - 100;
    core.scroll.mockClear();

    scroller.dispatchEvent(new Event('scroll'));

    const after = core.getSnapshot().timeline;
    expect(after.range.end).toBeGreaterThan(before.range.end);
    expect(after.range.start).toBeGreaterThan(before.range.start);
    // Settled: nothing more to do at the position the handler left.
    expect(core.scroll.mock.calls.length).toBeGreaterThan(1);
    expect(core.inner.scroll({ left: scroller.scrollLeft, top: 0 })).toBeUndefined();
  });

  it('FR-TL-3, FR-TL-5: with the real infinite timeline the date under the left edge stays put', () => {
    const container = createContainer();
    const core = observeCore(
      createTestCore({
        timeline: { infinite: { extendBy: '2w' } },
        scroll: { initial: '2026-03-09' },
      }),
    );
    const frames = createManualFrames();
    const drawn: number[] = [];
    mountRenderer(container, core, {
      frames,
      layers: {
        grid: () => ({
          mount: () => undefined,
          update: (snapshot) => drawn.push(snapshot.timeline.range.start),
          destroy: () => undefined,
        }),
      },
    });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
    const root = container.querySelector<HTMLElement>('.gantt')!;
    const before = core.getSnapshot().timeline;
    const dateAtLeft = before.scale.xToDate(0);

    // The user drags the scrollbar to the very start.
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll'));

    const after = core.getSnapshot();
    expect(after.timeline.range.start).toBeLessThan(before.range.start);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(scroller.scrollLeft).toBe(after.timeline.scrollLeft);
    expect(root.style.getPropertyValue('--gantt-content-width')).toBe(`${after.contentWidth}px`);
    // The same date is at the left edge (within a pixel), and the layers already drew the new range.
    const dayInPx = 1 / after.timeline.scale.pxPerDay;
    expect(
      Math.abs(after.timeline.scale.xToDate(scroller.scrollLeft) - dateAtLeft),
    ).toBeLessThanOrEqual(dayInPx * 86_400_000);
    expect(drawn.at(-1)).toBe(after.timeline.range.start);
    expect(frames.queued).toBe(0);

    // The compensated position comes back as a scroll event: nothing more to do.
    scroller.dispatchEvent(new Event('scroll'));
    expect(core.scroll).toHaveBeenLastCalledWith({ left: scroller.scrollLeft, top: 0 });
    expect(core.getSnapshot()).toBe(after);
  });

  it('FR-API-4: no scroll listener survives destroy', () => {
    const { fake, renderer, scroller } = setup();

    renderer.destroy();
    scroller.dispatchEvent(new Event('scroll'));

    expect(fake.scroll).not.toHaveBeenCalled();
    expect(tracker.alive()).toEqual([]);
  });
});

describe('keyboard scrolling', () => {
  it('FR-TL-2: the scroller is a focusable region named by `strings.chartLabel`', () => {
    const container = createContainer();
    mountRenderer(container, createFakeCore(), { frames: createManualFrames() });
    mountRenderer(container, createFakeCore(), {
      frames: createManualFrames(),
      strings: { chartLabel: 'Plan' },
    });

    const [first, second] = [...container.querySelectorAll<HTMLElement>('.gantt__scroller')];
    expect(first?.getAttribute('tabindex')).toBe('0');
    expect(first?.getAttribute('aria-label')).toBe('Gantt chart');
    expect(second?.getAttribute('aria-label')).toBe('Plan');
  });

  it('FR-TL-2: a scroll made by the browser on a key press goes the way of every other source', () => {
    const { fake, scroller } = setup();
    scroller.focus();

    // The focused scroller moves by the browser's step: all the renderer ever sees is the event.
    scroller.scrollLeft = 40;
    scroller.dispatchEvent(new Event('scroll'));

    expect(document.activeElement).toBe(scroller);
    expect(fake.scroll).toHaveBeenCalledWith({ left: 40, top: 0 });
  });
});

describe('the seams of the scroll path for the input module', () => {
  /** A scroll sync over bare elements and a core that answers what the test says. */
  function bare(core: Partial<ScrollCore> = {}) {
    const scroller = document.createElement('div');
    const pin = document.createElement('div');
    const abort = new AbortController();
    const flush = vi.fn();
    const scroll = vi.fn<ScrollCore['scroll']>(() => undefined);
    const widths: number[] = [];
    const sync = createScrollSync({
      core: { scroll, setViewport: vi.fn(), ...core },
      scroller,
      pin,
      setContentWidth: (width) => widths.push(width),
      flush,
      pending: () => false,
      signal: abort.signal,
      requestFrame: vi.fn(),
      onDispose: vi.fn(),
    });
    return { sync, scroller, scroll, flush, widths, abort };
  }

  it('FR-EDIT-6, FR-TL-5: report() sends the scroller position to the core now, and settles it before paint', () => {
    // The drag autoscroll writes `scrollLeft` and needs the result in the same frame, so it
    // cannot wait for the browser's scroll event (a frame later).
    const { sync, scroller, scroll, flush } = bare();
    const scrollTo = vi.spyOn(scroller, 'scrollTo');
    scroll.mockReturnValueOnce(fakeViewportChange(560, 6000, 960));
    scroller.scrollLeft = 400;

    sync.report();

    expect(scroll).toHaveBeenNthCalledWith(1, { left: 400, top: 0 });
    expect(scroll).toHaveBeenNthCalledWith(2, { left: 960, top: 0 });
    expect(scrollTo).toHaveBeenCalledWith({ left: 960, behavior: 'instant' });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-6: the scroll event the browser fires a frame later, with the same position, changes nothing', () => {
    const { sync, scroller, scroll, flush } = bare();
    scroller.scrollLeft = 700;

    sync.report();
    scroll.mockClear();
    scroller.dispatchEvent(new Event('scroll'));
    sync.report();

    // The same position again: asked, answered "nothing to do", nothing written or rendered.
    expect(scroll.mock.calls).toEqual([[{ left: 700, top: 0 }], [{ left: 700, top: 0 }]]);
    expect(flush).not.toHaveBeenCalled();
  });

  it('FR-EDIT-6: a synthetic scroll event is the same seam: handled in the task, compensation included', () => {
    const { scroller, scroll, flush } = bare();
    scroll.mockReturnValueOnce(fakeViewportChange(80, 5000, 180));
    scroller.scrollLeft = 100;

    scroller.dispatchEvent(new Event('scroll'));

    expect(scroller.scrollLeft).toBe(180);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('FR-SCROLL-3: onFrameMove tells, without reading layout, that the page moved the chart', () => {
    // A chart of automatic height moves with the page: whoever caches its frame (the input
    // module measures it on pointer down) is told to measure it again.
    const { sync, scroller } = bare();
    document.body.append(scroller);
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const moved = vi.fn();
    const stop = sync.onFrameMove(moved);

    // Not while the scroller scrolls both ways: the page does not move it then.
    document.dispatchEvent(new Event('scroll'));
    expect(moved).not.toHaveBeenCalled();

    sync.setPaged(true);
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(moved).toHaveBeenCalledTimes(2);
    expect(rect).not.toHaveBeenCalled();

    stop();
    document.dispatchEvent(new Event('scroll'));
    expect(moved).toHaveBeenCalledTimes(2);
  });

  it('FR-SCROLL-3: onFrameMove covers the host that is an element too, and ends with the chart', () => {
    const { sync, scroller, abort } = bare();
    const host = document.createElement('div');
    host.style.overflowY = 'auto';
    // It has something to scroll: an element that fits its content is no host.
    vi.spyOn(host, 'scrollHeight', 'get').mockReturnValue(900);
    host.append(scroller);
    document.body.append(host);
    const moved = vi.fn();
    sync.onFrameMove(moved);
    sync.setPaged(true);

    host.dispatchEvent(new Event('scroll'));
    expect(moved).toHaveBeenCalledTimes(1);

    abort.abort();
    host.dispatchEvent(new Event('scroll'));
    expect(moved).toHaveBeenCalledTimes(1);
  });
});

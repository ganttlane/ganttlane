import type { GanttSnapshot } from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayerContext, LayerFactories, LayerName, RendererLayer } from './layers/types';
import { LAYER_ORDER } from './layers/types';
import { mountRenderer } from './renderer';
import type { ListenerTracker } from './testing';
import {
  countNodes,
  createContainer,
  createFakeCore,
  createManualFrames,
  createTestCore,
  fakeSnapshot,
  installFakeResizeObserver,
  observeCore,
  resizeObserved,
  stubScrollerSize,
  trackListeners,
} from './testing';

let tracker: ListenerTracker;

beforeEach(() => {
  tracker = trackListeners();
});

afterEach(() => {
  tracker.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** One entry per lifecycle call of every layer, in call order. */
interface Recorded {
  readonly log: string[];
  readonly contexts: Map<LayerName, LayerContext>;
  readonly updates: Map<LayerName, [GanttSnapshot, GanttSnapshot | undefined][]>;
  readonly layers: LayerFactories;
}

/** Layers that record `mount`, `update` and `destroy` instead of drawing. */
function recordingLayers(): Recorded {
  const log: string[] = [];
  const contexts = new Map<LayerName, LayerContext>();
  const updates = new Map<LayerName, [GanttSnapshot, GanttSnapshot | undefined][]>();
  const factory = (name: LayerName) => (): RendererLayer => ({
    mount(context) {
      log.push(`mount:${name}`);
      contexts.set(name, context);
    },
    update(snapshot, previous) {
      log.push(`update:${name}`);
      updates.set(name, [...(updates.get(name) ?? []), [snapshot, previous]]);
    },
    destroy() {
      log.push(`destroy:${name}`);
    },
  });
  const layers = Object.fromEntries(LAYER_ORDER.map((name) => [name, factory(name)]));
  return { log, contexts, updates, layers: layers };
}

describe('mountRenderer: structure', () => {
  it('FR-API-1: builds the DOM structure of architecture §8 inside the container', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();

    mountRenderer(container, createTestCore(), { frames: createManualFrames() });

    expect(container.children).toHaveLength(1);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe('DIV');
    expect(root.getAttribute('class')).toBe('gantt');
    expect(root.getAttribute('data-theme')).toBe('auto');
    const [scroller, layer] = [...root.children];
    expect(scroller?.getAttribute('class')).toBe('gantt__scroller');
    expect(layer?.getAttribute('class')).toBe('gantt__layer');
    const [header, body] = [...scroller!.children];
    expect(header?.tagName).toBe('DIV');
    expect(header?.getAttribute('class')).toBe('gantt__header');
    expect(body?.tagName.toLowerCase()).toBe('svg');
    expect(body?.getAttribute('class')).toBe('gantt__body');
    expect([...body!.children].map((child) => child.getAttribute('class'))).toEqual([
      'gantt__grid',
      'gantt__links',
      'gantt__bars',
      'gantt__overlay',
    ]);
  });

  it('FR-API-1: the toolbar is not part of the skeleton and nothing is parsed from HTML', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();

    mountRenderer(container, createTestCore(), { frames: createManualFrames() });

    expect(container.querySelector('.gantt__toolbar')).toBeNull();
  });

  it('FR-THEME-2: data-theme follows the theme option', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();

    mountRenderer(container, createTestCore(), { theme: 'dark', frames: createManualFrames() });

    expect(container.querySelector('.gantt')?.getAttribute('data-theme')).toBe('dark');
  });

  it('FR-API-4: every id carries the instance prefix, which idPrefix sets', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();

    mountRenderer(container, createTestCore(), {
      idPrefix: 'chart-a',
      frames: createManualFrames(),
    });

    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) expect(id.startsWith('chart-a')).toBe(true);
    expect(container.querySelector('.gantt')?.id).toBe('chart-a');
  });

  it('FR-API-4: the default prefix is allocated, so ids never repeat across charts', () => {
    stubScrollerSize(800, 400);
    const [first, second] = [createContainer(), createContainer()];

    mountRenderer(first, createTestCore(), { frames: createManualFrames() });
    mountRenderer(second, createTestCore(), { frames: createManualFrames() });

    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('NFR-PERF-2: sizes the scrolled content from the first snapshot, synchronously', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();
    const core = createTestCore();

    mountRenderer(container, core, { frames: createManualFrames() });

    const snapshot = core.getSnapshot();
    const root = container.querySelector<HTMLElement>('.gantt')!;
    expect(snapshot.contentWidth).toBeGreaterThan(800);
    expect(root.style.getPropertyValue('--gantt-content-width')).toBe(`${snapshot.contentWidth}px`);
    expect(root.style.getPropertyValue('--gantt-header-height')).toBe(
      `${snapshot.layout.rows.headerHeight}px`,
    );
    expect(root.style.getPropertyValue('--gantt-body-height')).toBe(
      `${snapshot.layout.rows.bodyHeight}px`,
    );
  });
});

describe('mountRenderer: two instances', () => {
  it('FR-API-4: two charts get distinct prefixes and share nothing', () => {
    stubScrollerSize(800, 400);
    const [containerA, containerB] = [createContainer(), createContainer()];
    const [framesA, framesB] = [createManualFrames(), createManualFrames()];
    const [recordA, recordB] = [recordingLayers(), recordingLayers()];
    const [coreA, coreB] = [createTestCore(), createTestCore()];

    const a = mountRenderer(containerA, observeCore(coreA), {
      frames: framesA,
      layers: recordA.layers,
    });
    const b = mountRenderer(containerB, observeCore(coreB), {
      frames: framesB,
      layers: recordB.layers,
    });

    const prefixA = recordA.contexts.get('header')!.idPrefix;
    const prefixB = recordB.contexts.get('header')!.idPrefix;
    expect(prefixA).not.toBe(prefixB);
    expect(containerA.querySelector('.gantt')?.id).toBe(prefixA);
    expect(containerB.querySelector('.gantt')?.id).toBe(prefixB);
    expect(recordA.contexts.get('header')!.signal).not.toBe(recordB.contexts.get('header')!.signal);

    // A change in one core renders only in its own chart.
    const updatesB = recordB.log.filter((entry) => entry.startsWith('update:')).length;
    coreA.setTasks([{ id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-03' }]);
    expect(framesA.queued).toBe(1);
    expect(framesB.queued).toBe(0);
    framesA.step();
    expect(recordB.log.filter((entry) => entry.startsWith('update:')).length).toBe(updatesB);

    // Destroying one leaves the other mounted and alive.
    a.destroy();
    expect(containerA.childNodes).toHaveLength(0);
    expect(containerB.querySelector('.gantt')).not.toBeNull();
    coreB.setTasks([{ id: 'y', name: 'Y', start: '2026-03-02', end: '2026-03-03' }]);
    framesB.step();
    expect(recordB.log.filter((entry) => entry.startsWith('update:')).length).toBe(
      updatesB + LAYER_ORDER.length,
    );
    b.destroy();
    expect(containerB.childNodes).toHaveLength(0);
  });

  it('FR-API-4: scrolling one chart reports to its own core only', () => {
    stubScrollerSize(800, 400);
    const [containerA, containerB] = [createContainer(), createContainer()];
    const coreA = observeCore(createTestCore());
    const coreB = observeCore(createTestCore());
    mountRenderer(containerA, coreA, { frames: createManualFrames() });
    mountRenderer(containerB, coreB, { frames: createManualFrames() });

    const scroller = containerA.querySelector<HTMLElement>('.gantt__scroller')!;
    scroller.scrollLeft = 55;
    scroller.dispatchEvent(new Event('scroll'));

    expect(coreA.scroll).toHaveBeenCalledWith({ left: 55, top: 0 });
    expect(coreB.scroll).not.toHaveBeenCalled();
  });
});

describe('mountRenderer: destroy', () => {
  it('FR-API-4: leaves nothing behind: nodes, listeners, observers, frames and subscriptions', () => {
    const FakeObserver = installFakeResizeObserver();
    stubScrollerSize(800, 400);
    const container = createContainer();
    container.append('kept text', document.createElement('p'));
    const initialNodes = countNodes(container);
    const frames = createManualFrames();
    const core = observeCore(createTestCore());
    const record = recordingLayers();

    const renderer = mountRenderer(container, core, { frames, layers: record.layers });
    expect(countNodes(container)).toBeGreaterThan(initialNodes);
    expect(tracker.alive().length).toBeGreaterThan(0);
    // The renderer's own, and the pointer input's (it follows the core's feedback).
    expect(core.subscribers()).toBe(2);
    expect(FakeObserver.instances).toHaveLength(1);

    renderer.destroy();

    expect(countNodes(container)).toBe(initialNodes);
    expect(container.textContent).toBe('kept text');
    expect(tracker.alive()).toEqual([]);
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    expect(core.subscribers()).toBe(0);
    expect(frames.queued).toBe(0);
    expect(record.contexts.get('bars')!.signal.aborted).toBe(true);
    expect(record.contexts.get('bars')!.scheduler.pending).toBe(false);
  });

  it('FR-API-4: a pending frame is cancelled and a later core change renders nothing', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();
    const frames = createManualFrames();
    const core = createTestCore();
    const record = recordingLayers();
    const renderer = mountRenderer(container, core, { frames, layers: record.layers });
    core.setTasks([{ id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-03' }]);
    expect(frames.queued).toBe(1);
    const requested = frames.requested;
    const calls = record.log.length;

    renderer.destroy();
    expect(frames.queued).toBe(0);

    core.setTasks([{ id: 'y', name: 'Y', start: '2026-03-02', end: '2026-03-03' }]);
    core.setViewport({ width: 900, height: 400 });
    frames.step();

    expect(frames.requested).toBe(requested);
    expect(record.log.slice(calls)).toEqual(
      [...LAYER_ORDER].reverse().map((name) => `destroy:${name}`),
    );
  });

  it('FR-API-4: destroys the layers in reverse registration order, once, and is idempotent', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const renderer = mountRenderer(createContainer(), createTestCore(), {
      frames: createManualFrames(),
      layers: record.layers,
    });
    const before = record.log.length;

    renderer.destroy();
    renderer.destroy();

    expect(record.log.slice(before)).toEqual(
      [...LAYER_ORDER].reverse().map((name) => `destroy:${name}`),
    );
  });

  it('FR-API-4: the core belongs to its creator: mountRenderer leaves it usable', () => {
    stubScrollerSize(800, 400);
    const core = observeCore(createTestCore());
    const renderer = mountRenderer(createContainer(), core, { frames: createManualFrames() });

    renderer.destroy();
    const before = core.getSnapshot();
    core.inner.setTasks([{ id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-03' }]);

    expect(renderer.core).toBe(core);
    expect(core.getSnapshot()).not.toBe(before);
    expect(core.inner.getTask('x')).toBeDefined();
  });

  it('FR-API-4: a mount that fails leaves no node and no listener, and reports the failure', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();
    const initial = countNodes(container);
    const record = recordingLayers();
    const failure = new Error('layer cannot mount');

    expect(() =>
      mountRenderer(container, createTestCore(), {
        frames: createManualFrames(),
        layers: {
          ...record.layers,
          bars: () => ({
            mount() {
              throw failure;
            },
            update: () => undefined,
            destroy: () => undefined,
          }),
        },
      }),
    ).toThrow(failure);

    expect(countNodes(container)).toBe(initial);
    expect(tracker.alive()).toEqual([]);
    // The layers that did mount were destroyed, newest first.
    expect(record.log).toEqual([
      'mount:header',
      'mount:grid',
      'mount:links',
      'destroy:links',
      'destroy:grid',
      'destroy:header',
    ]);
  });
});

describe('mountRenderer: the clock (FR-UI-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 2, 4, 10, 30, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('FR-UI-1: asks the core to read its clock at the next minute boundary, then every minute', () => {
    stubScrollerSize(800, 400);
    const core = observeCore(createTestCore());
    mountRenderer(createContainer(), core, { frames: createManualFrames() });
    expect(core.refreshNow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(39_000);
    expect(core.refreshNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_100);
    expect(core.refreshNow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(core.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('FR-UI-1: a new minute from the core is drawn in the next frame, an unchanged one is not', () => {
    stubScrollerSize(800, 400);
    let clock = new Date(2026, 2, 4, 10, 30, 20);
    const core = createTestCore({ now: () => clock });
    const frames = createManualFrames();
    const record = recordingLayers();
    mountRenderer(createContainer(), core, { frames, layers: record.layers });
    const seen = record.updates.get('header')!.length;

    // The clock moved inside the minute: the core publishes nothing, so nothing is drawn.
    clock = new Date(2026, 2, 4, 10, 30, 55);
    vi.advanceTimersByTime(41_000);
    expect(frames.queued).toBe(0);

    clock = new Date(2026, 2, 4, 10, 31, 1);
    vi.advanceTimersByTime(60_000);
    expect(frames.queued).toBe(1);
    frames.step();
    const updates = record.updates.get('header')!;
    expect(updates).toHaveLength(seen + 1);
    expect(updates.at(-1)![0].now).toBe(Date.UTC(2026, 2, 4, 10, 31));
  });

  it('FR-API-4: destroy clears the timer: nothing is asked of the core afterwards', () => {
    stubScrollerSize(800, 400);
    const core = observeCore(createTestCore());
    const renderer = mountRenderer(createContainer(), core, { frames: createManualFrames() });
    expect(vi.getTimerCount()).toBe(1);

    renderer.destroy();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(core.refreshNow).not.toHaveBeenCalled();
  });

  it('FR-API-4: a mount that fails leaves no timer behind', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    expect(() =>
      mountRenderer(createContainer(), createTestCore(), {
        frames: createManualFrames(),
        layers: {
          ...record.layers,
          bars: () => ({
            mount() {
              throw new Error('layer cannot mount');
            },
            update: () => undefined,
            destroy: () => undefined,
          }),
        },
      }),
    ).toThrow('layer cannot mount');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('mountRenderer: viewport', () => {
  it('FR-API-4: sizes the core from the container synchronously, then follows the ResizeObserver', () => {
    const FakeObserver = installFakeResizeObserver();
    stubScrollerSize(800, 400);
    const container = createContainer();
    const core = observeCore(createTestCore());
    const frames = createManualFrames();
    const record = recordingLayers();

    mountRenderer(container, core, { frames, layers: record.layers });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;

    expect(core.setViewport).toHaveBeenCalledWith({ width: 800, height: 400 });
    expect(core.inner.getSnapshot().timeline.viewportWidth).toBe(800);
    expect(FakeObserver.instances[0]?.observed.has(scroller)).toBe(true);

    const updates = record.log.length;
    resizeObserved(scroller, 1000, 500);

    expect(core.setViewport).toHaveBeenLastCalledWith({ width: 1000, height: 500 });
    expect(core.inner.getSnapshot().timeline.viewportWidth).toBe(1000);
    expect(core.inner.getSnapshot().viewportHeight).toBe(500);
    // Rendered inside the observer callback (before paint), not a frame later.
    expect(frames.queued).toBe(0);
    expect(record.log.length).toBeGreaterThan(updates);
  });

  it('FR-API-4: an unchanged size from the observer is not reported again', () => {
    installFakeResizeObserver();
    stubScrollerSize(800, 400);
    const container = createContainer();
    const core = observeCore(createTestCore());
    mountRenderer(container, core, { frames: createManualFrames() });
    const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;

    resizeObserved(scroller, 900, 400);
    resizeObserved(scroller, 900, 400);

    // Once at mount (measured), once for 900x400.
    expect(core.setViewport).toHaveBeenCalledTimes(2);
  });

  it('FR-API-4: without a ResizeObserver it measures at mount and on window resize', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const size = stubScrollerSize(800, 400);
    const container = createContainer();
    const core = observeCore(createTestCore());

    const renderer = mountRenderer(container, core, { frames: createManualFrames() });
    expect(core.setViewport).toHaveBeenCalledTimes(1);
    expect(core.setViewport).toHaveBeenLastCalledWith({ width: 800, height: 400 });

    size.set(600, 300);
    window.dispatchEvent(new Event('resize'));
    expect(core.setViewport).toHaveBeenCalledTimes(2);
    expect(core.setViewport).toHaveBeenLastCalledWith({ width: 600, height: 300 });

    renderer.destroy();
    window.dispatchEvent(new Event('resize'));
    expect(core.setViewport).toHaveBeenCalledTimes(2);
    expect(tracker.alive()).toEqual([]);
  });

  it('a container with no size yet leaves the core unmounted until the observer reports one', () => {
    const FakeObserver = installFakeResizeObserver();
    const size = stubScrollerSize(0, 0);
    const container = createContainer();
    const core = createTestCore();

    mountRenderer(container, core, { frames: createManualFrames() });
    expect(core.getSnapshot().timeline.viewportWidth).toBe(0);

    size.set(700, 300);
    resizeObserved(container.querySelector('.gantt__scroller')!, 700, 300);

    expect(core.getSnapshot().timeline.viewportWidth).toBe(700);
    expect(FakeObserver.instances).toHaveLength(1);
  });
});

describe('mountRenderer: layers', () => {
  it('FR-API-1: layers mount, update and destroy in the fixed registration order', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();

    const renderer = mountRenderer(createContainer(), createTestCore(), {
      frames: createManualFrames(),
      layers: record.layers,
    });
    expect(record.log).toEqual([
      ...LAYER_ORDER.map((name) => `mount:${name}`),
      ...LAYER_ORDER.map((name) => `update:${name}`),
    ]);

    renderer.destroy();
    expect(record.log.slice(LAYER_ORDER.length * 2)).toEqual(
      [...LAYER_ORDER].reverse().map((name) => `destroy:${name}`),
    );
    expect(LAYER_ORDER).toEqual(['header', 'grid', 'links', 'bars', 'overlay', 'popover']);
  });

  it('gives every layer its own root, the document, ids with the prefix and the instance signal', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const container = createContainer();

    mountRenderer(container, createTestCore(), {
      idPrefix: 'p',
      frames: createManualFrames(),
      layers: record.layers,
    });

    const root = (name: LayerName): string | null =>
      record.contexts.get(name)!.root.getAttribute('class');
    expect(root('header')).toBe('gantt__header');
    expect(root('grid')).toBe('gantt__grid');
    expect(root('links')).toBe('gantt__links');
    expect(root('bars')).toBe('gantt__bars');
    expect(root('overlay')).toBe('gantt__overlay');
    expect(root('popover')).toBe('gantt__layer');
    const bars = record.contexts.get('bars')!;
    expect(bars.document).toBe(document);
    expect(bars.id('arrow')).toBe('p-arrow');
    expect(bars.scroller).toBe(container.querySelector('.gantt__scroller'));
    expect(bars.signal.aborted).toBe(false);
  });

  it('NFR-PERF-2: renders the latest snapshot once per frame, with the previous one', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const core = createTestCore();
    mountRenderer(createContainer(), core, { frames, layers: record.layers });
    const [firstUpdate] = record.updates.get('bars')!;
    const [first, none] = firstUpdate!;
    expect(first).toBe(core.getSnapshot());
    expect(none).toBeUndefined();

    core.setTasks([{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' }]);
    core.setTasks([{ id: 'b', name: 'B', start: '2026-03-02', end: '2026-03-03' }]);
    core.select(['b']);
    expect(frames.queued).toBe(1);
    expect(record.updates.get('bars')).toHaveLength(1);

    frames.step();

    const bars = record.updates.get('bars')!;
    expect(bars).toHaveLength(2);
    expect(bars[1]![0]).toBe(core.getSnapshot());
    expect(bars[1]![1]).toBe(first);
  });

  it('does not render a snapshot twice', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const fake = createFakeCore();
    mountRenderer(createContainer(), fake, { frames, layers: record.layers });
    const same = fake.getSnapshot();

    fake.publish(same);
    frames.step();

    expect(record.updates.get('header')).toHaveLength(1);
  });

  it('FR-UI-1, FR-UI-4: a display change redraws the same snapshot once, with the new context.display', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const fake = createFakeCore();
    const mounted = mountRenderer(createContainer(), fake, {
      frames,
      layers: record.layers,
      display: { gridLines: 'vertical' },
    });
    const context = record.contexts.get('grid')!;
    const first = context.display;
    expect(first.gridLines).toBe('vertical');

    mounted.setDisplay({ gridLines: 'vertical' });
    frames.step();
    expect(record.updates.get('grid')).toHaveLength(1);
    expect(context.display).toBe(first);

    mounted.setDisplay({ today: false, gridLines: 'bogus' as never });
    expect(record.updates.get('grid')).toHaveLength(1);
    frames.step();
    const updates = record.updates.get('grid')!;
    expect(updates).toHaveLength(2);
    expect(updates[1]![0]).toBe(updates[1]![1]);
    expect(context.display).toBe(mounted.display);
    expect([context.display.today, context.display.gridLines]).toEqual([false, 'both']);

    mounted.destroy();
    mounted.setDisplay({ today: true });
    expect(mounted.display.today).toBe(false);
  });

  it('FR-I18N-2: every layer reads context.strings: the defaults, then the option, then setStrings', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const mounted = mountRenderer(createContainer(), createFakeCore(), {
      frames,
      layers: record.layers,
      strings: { today: 'Сьогодні' },
    });
    const seen = (): (string | undefined)[] =>
      LAYER_ORDER.map((name) => record.contexts.get(name)?.strings.today);
    expect(seen()).toEqual(LAYER_ORDER.map(() => 'Сьогодні'));
    for (const name of LAYER_ORDER) {
      expect(record.contexts.get(name)!.strings).toBe(mounted.strings);
    }

    mounted.setStrings({ today: 'Heute', zoomIn: 'Näher' });
    frames.step();

    expect(seen()).toEqual(LAYER_ORDER.map(() => 'Heute'));
    for (const name of LAYER_ORDER) {
      const context = record.contexts.get(name)!;
      expect(context.strings).toBe(mounted.strings);
      expect(context.strings.zoomIn).toBe('Näher');
      expect(context.strings.zoomOut).toBe('Zoom out');
    }
  });

  it('FR-I18N-2: a strings change redraws the same snapshot once, in one frame, without a remount', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const container = createContainer();
    const mounted = mountRenderer(container, createFakeCore(), { frames, layers: record.layers });
    const root = container.firstElementChild;
    const context = record.contexts.get('popover')!;
    const first = context.strings;
    expect(first).toBe(mounted.strings);

    mounted.setStrings({});
    mounted.setStrings({ today: 'Today', nothing: 'x' } as never);
    mounted.setStrings({ zoomIn: 5 } as never);
    frames.step();
    expect(record.updates.get('popover')).toHaveLength(1);
    expect(context.strings).toBe(first);

    mounted.setStrings({ today: 'Сьогодні' });
    mounted.setStrings({ zoomIn: 'Збільшити' });
    expect(record.updates.get('popover')).toHaveLength(1);
    expect(frames.queued).toBe(1);
    frames.step();

    const updates = record.updates.get('popover')!;
    expect(updates).toHaveLength(2);
    expect(updates[1]![0]).toBe(updates[1]![1]);
    expect(context.strings).toBe(mounted.strings);
    expect([context.strings.today, context.strings.zoomIn]).toEqual(['Сьогодні', 'Збільшити']);
    expect(container.firstElementChild).toBe(root);
    expect(record.log.filter((entry) => entry.startsWith('mount:'))).toHaveLength(
      LAYER_ORDER.length,
    );

    mounted.setStrings({ today: undefined });
    frames.step();
    expect(mounted.strings.today).toBe('Today');
  });

  it('FR-I18N-2: after destroy setStrings does nothing', () => {
    stubScrollerSize(800, 400);
    const frames = createManualFrames();
    const mounted = mountRenderer(createContainer(), createFakeCore(), { frames });

    mounted.destroy();
    mounted.setStrings({ today: 'Сьогодні' });

    expect(mounted.strings.today).toBe('Today');
    expect(frames.queued).toBe(0);
  });

  it('FR-I18N-2: the scroller’s aria-label is strings.chartLabel, from the start and when it changes', () => {
    stubScrollerSize(800, 400);
    const frames = createManualFrames();
    const container = createContainer();
    const mounted = mountRenderer(container, createFakeCore(), { frames });
    const scroller = container.querySelector('.gantt__scroller')!;
    expect(scroller.getAttribute('aria-label')).toBe('Gantt chart');

    mounted.setStrings({ chartLabel: 'Діаграма Ганта' });
    expect(scroller.getAttribute('aria-label')).toBe('Gantt chart');
    frames.step();
    expect(scroller.getAttribute('aria-label')).toBe('Діаграма Ганта');

    // An empty name is no name: the default comes back, like for any value that cannot be used.
    mounted.setStrings({ chartLabel: '' });
    frames.step();
    expect(scroller.getAttribute('aria-label')).toBe('Gantt chart');

    mounted.setStrings({ chartLabel: 'Діаграма Ганта' });
    frames.step();
    mounted.setStrings({ chartLabel: undefined });
    frames.step();
    expect(scroller.getAttribute('aria-label')).toBe('Gantt chart');

    const named = createContainer();
    mountRenderer(named, createFakeCore(), {
      frames: createManualFrames(),
      strings: { chartLabel: 'Plan' },
    });
    expect(named.querySelector('.gantt__scroller')!.getAttribute('aria-label')).toBe('Plan');
  });

  it('FR-THEME-2: setTheme changes data-theme at once, with no frame, and a bad theme is auto', () => {
    stubScrollerSize(800, 400);
    const frames = createManualFrames();
    const container = createContainer();
    const mounted = mountRenderer(container, createFakeCore(), { frames, theme: 'light' });
    const root = container.querySelector('.gantt')!;
    expect(root.getAttribute('data-theme')).toBe('light');
    const requested = frames.requested;

    mounted.setTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    mounted.setTheme('dark');
    mounted.setTheme('sepia' as never);
    expect(root.getAttribute('data-theme')).toBe('auto');
    mounted.setTheme(undefined as never);
    expect(root.getAttribute('data-theme')).toBe('auto');

    expect(frames.requested).toBe(requested);
    mountRenderer(createContainer(), createFakeCore(), {
      frames: createManualFrames(),
      theme: 'sepia' as never,
    });
    expect(document.querySelectorAll('[data-theme="auto"]')).toHaveLength(2);
  });

  it('FR-THEME-2: after destroy setTheme does nothing', () => {
    stubScrollerSize(800, 400);
    const container = createContainer();
    const mounted = mountRenderer(container, createFakeCore(), { frames: createManualFrames() });

    mounted.destroy();
    mounted.setTheme('dark');

    expect(container.querySelector('.gantt')).toBeNull();
  });

  it('FR-TIP-1: hideTooltip asks the popover layer to close, and is harmless without one', () => {
    stubScrollerSize(800, 400);
    const hide = vi.fn();
    const mounted = mountRenderer(createContainer(), createFakeCore(), {
      frames: createManualFrames(),
      layers: {
        popover: () => ({
          mount: () => undefined,
          update: () => undefined,
          destroy: () => undefined,
          hide,
        }),
      },
    });

    mounted.hideTooltip();
    expect(hide).toHaveBeenCalledTimes(1);
    mounted.destroy();
    mounted.hideTooltip();
    expect(hide).toHaveBeenCalledTimes(1);

    // A replacement layer that cannot hide anything.
    const plain = mountRenderer(createContainer(), createFakeCore(), {
      frames: createManualFrames(),
      layers: {
        popover: () => ({
          mount: () => undefined,
          update: () => undefined,
          destroy: () => undefined,
        }),
      },
    });
    expect(() => {
      plain.hideTooltip();
    }).not.toThrow();
  });

  it('FR-API-4: ctx.on listens to core events until the layer stops or the chart is destroyed', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const fake = createFakeCore();
    const mounted = mountRenderer(createContainer(), fake, {
      frames: createManualFrames(),
      layers: record.layers,
    });
    const context = record.contexts.get('popover')!;
    const clicks: unknown[] = [];
    context.on('linkClick', (link) => clicks.push(link));
    const stop = context.on('taskClick', () => clicks.push('task'));
    expect(fake.handlers()).toBe(2);

    fake.emit('linkClick', { id: 'a' } as never, undefined);
    stop();
    stop();
    fake.emit('taskClick', {} as never, undefined);
    expect(clicks).toEqual([{ id: 'a' }]);
    expect(fake.handlers()).toBe(1);

    mounted.destroy();
    expect(fake.handlers()).toBe(0);
    context.on('linkClick', () => clicks.push('late'));
    fake.emit('linkClick', { id: 'b' } as never, undefined);
    expect(fake.handlers()).toBe(0);
    expect(clicks).toEqual([{ id: 'a' }]);
  });

  it('ctx.send forwards interaction events to the core and returns its effects', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const fake = createFakeCore();
    const effects = [{ type: 'autoscroll', velocity: 3 }] as unknown as ReturnType<
      typeof fake.send
    >;
    fake.send.mockReturnValue(effects);
    const renderer = mountRenderer(createContainer(), fake, {
      frames: createManualFrames(),
      layers: record.layers,
    });
    const event = { type: 'cancel', pointerId: 1 } as unknown as Parameters<typeof fake.send>[0];
    const { send } = record.contexts.get('bars')!;

    expect(send(event)).toBe(effects);
    expect(fake.send).toHaveBeenCalledWith(event);

    renderer.destroy();
    expect(send(event)).toEqual([]);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it('a layer that throws in update does not stop the others; the error surfaces from the frame', () => {
    stubScrollerSize(800, 400);
    const record = recordingLayers();
    const frames = createManualFrames();
    const core = createTestCore();
    const failure = new Error('grid broke');
    let broken = false;
    mountRenderer(createContainer(), core, {
      frames,
      layers: {
        ...record.layers,
        grid: () => ({
          mount: () => undefined,
          update() {
            if (broken) throw failure;
          },
          destroy: () => undefined,
        }),
      },
    });
    broken = true;
    const before = record.updates.get('bars')!.length;

    core.setTasks([{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' }]);

    expect(() => {
      frames.step();
    }).toThrow(failure);
    expect(record.updates.get('bars')).toHaveLength(before + 1);
    expect(record.updates.get('header')).toHaveLength(before + 1);
  });

  it('FR-API-1: replaces built-in layers by name and keeps the others', () => {
    stubScrollerSize(800, 400);
    const calls: string[] = [];

    mountRenderer(createContainer(), createTestCore(), {
      frames: createManualFrames(),
      layers: {
        bars: () => ({
          mount: () => calls.push('mount'),
          update: () => calls.push('update'),
          destroy: () => calls.push('destroy'),
        }),
      },
    }).destroy();

    expect(calls).toEqual(['mount', 'update', 'destroy']);
  });
});

describe('mountRenderer: extent', () => {
  it('FR-API-1: writes the content extent of every new snapshot before the layers draw', () => {
    stubScrollerSize(800, 400);
    const fake = createFakeCore(fakeSnapshot({ contentWidth: 1000, headerHeight: 50 }));
    const frames = createManualFrames();
    const seen: string[] = [];
    const container = createContainer();
    mountRenderer(container, fake, {
      frames,
      layers: {
        header: () => ({
          mount: () => undefined,
          update() {
            const root = container.querySelector<HTMLElement>('.gantt')!;
            seen.push(root.style.getPropertyValue('--gantt-content-width'));
          },
          destroy: () => undefined,
        }),
      },
    });

    fake.publish(fakeSnapshot({ contentWidth: 2500 }));
    frames.step();

    expect(seen).toEqual(['1000px', '2500px']);
  });
});

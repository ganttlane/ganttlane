import {
  barsInWindow,
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type GanttSnapshot,
  type PointerInput,
} from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayerFactories, LayerName } from './layers/types';
import { LAYER_ORDER } from './layers/types';
import { type MountedRenderer, mountRenderer } from './renderer';
import {
  createContainer,
  createManualFrames,
  createTestCore,
  instrumentLayers,
  type ManualFrames,
  stubScrollerSize,
} from './testing';

/**
 * The rules of the render path (plan step 4.5, `docs/architecture.md` §7a), with the real core
 * and the real layers: scroll event, `core.scroll`, snapshot, one render per frame, layers.
 * Timings are in `render-path.perf.test.ts`, the same path in browsers in `e2e/bench.spec.ts`.
 */

beforeEach(() => {
  stubScrollerSize(800, 400);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Chart {
  readonly core: GanttCore;
  readonly renderer: MountedRenderer<GanttCore>;
  readonly scroller: HTMLElement;
  readonly root: HTMLElement;
  readonly frames: ManualFrames;
  /** `update` calls of every layer so far. */
  readonly updates: Record<LayerName, number>;
}

function mount(core: GanttCore): Chart {
  const container = createContainer();
  const frames = createManualFrames();
  const updates = Object.fromEntries(LAYER_ORDER.map((name) => [name, 0])) as Record<
    LayerName,
    number
  >;
  const layers = instrumentLayers((name) => {
    updates[name]++;
  });
  // A popover measures the page once when it opens (plan step 4.8: `popover-layer.test.ts` pins
  // that), so the render path is checked with the tooltip off: a drag would open one.
  const display = { tooltip: { trigger: 'none' } } as const;
  const renderer = mountRenderer(container, core, { frames, layers, display });
  return {
    core,
    renderer,
    scroller: container.querySelector<HTMLElement>('.gantt__scroller')!,
    root: container.querySelector<HTMLElement>('.gantt')!,
    frames,
    updates,
  };
}

/** A generated plan, opened at its start. */
function plan(count: number, options: Partial<GanttCoreOptions> = {}): GanttCore {
  const fixture = generateFixture({ count });
  return createGanttCore({
    tasks: fixture.tasks,
    links: fixture.links,
    calendar: fixture.calendar,
    ...fixture.options,
    scroll: { initial: 'start', autoScroll: false },
    ...options,
  });
}

/** The user scrolls: the position changes and the browser fires `scroll`. */
function scrollTo(chart: Chart, left: number, top: number): void {
  chart.scroller.scrollLeft = left;
  chart.scroller.scrollTop = top;
  chart.scroller.dispatchEvent(new Event('scroll'));
}

/** What the tests need of a Vitest spy. */
interface Spy {
  readonly mock: { readonly calls: readonly unknown[] };
  mockClear(): unknown;
}

/** Layout-reading members of the DOM that exist in this DOM implementation, spied on. */
function spyOnLayoutReads(): Map<string, Spy> {
  const spies = new Map<string, Spy>();
  const watch = (target: object, name: string, label: string): void => {
    for (
      let proto: object | null = target;
      proto !== null;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor) continue;
      if (descriptor.get) {
        spies.set(label, vi.spyOn(proto as never, name as never, 'get'));
      } else if (typeof descriptor.value === 'function') {
        spies.set(label, vi.spyOn(proto as never, name as never));
      }
      return;
    }
    // Not in this DOM (happy-dom has no `getBBox`): define it, so that a call is still seen.
    const fake = vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 }));
    Object.defineProperty(target, name, { configurable: true, value: fake, writable: true });
    spies.set(label, fake);
  };
  const html = HTMLElement.prototype;
  for (const name of [
    'clientWidth',
    'clientHeight',
    'offsetWidth',
    'offsetHeight',
    'offsetLeft',
    'offsetTop',
    'scrollWidth',
    'scrollHeight',
    'getBoundingClientRect',
    'getClientRects',
  ]) {
    watch(html, name, `HTMLElement.${name}`);
  }
  watch(SVGElement.prototype, 'getBBox', 'SVGElement.getBBox');
  watch(SVGElement.prototype, 'getComputedTextLength', 'SVGElement.getComputedTextLength');
  watch(window, 'getComputedStyle', 'window.getComputedStyle');
  return spies;
}

describe('the render path reads no layout (NFR-PERF-2)', () => {
  it('NFR-PERF-2: scrolling, data, option and clock changes and a drag read none, only scrollLeft / scrollTop in the handler', () => {
    const core = plan(500, { now: () => new Date(2026, 2, 4, 10, 30) });
    const chart = mount(core);
    const spies = spyOnLayoutReads();
    // The measuring at mount is over: from here on a read of any of these is a violation.
    for (const spy of spies.values()) spy.mockClear();

    for (let i = 0; i < 30; i++) {
      scrollTo(chart, i * 90, (i % 5) * 200);
      chart.frames.step();
    }
    core.setTasks([{ id: 'only', name: 'Only', start: '2026-03-02', end: '2026-03-06' }]);
    chart.frames.step();
    core.setOptions({ layout: { rowHeight: 36 }, locale: 'uk', editing: false });
    chart.frames.step();
    chart.renderer.setDisplay({ gridLines: 'none', barLabel: 'outside', today: false });
    chart.frames.step();
    core.refreshNow();
    chart.frames.step();
    const bar = core.getSnapshot().layout.barAt(0)!;
    const at = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
    core.setOptions({ editing: true });
    scrollTo(chart, Math.max(bar.x - 100, 0), 0);
    chart.frames.step();
    expect(chart.root.querySelector('.gantt__bar')).not.toBeNull();
    const pointer = (type: PointerInput['type'], dx: number, time: number): PointerInput => ({
      type,
      pointerId: 1,
      x: at.x + dx,
      y: at.y,
      time,
    });
    core.send({ ...pointer('down', 0, 0), target: { kind: 'task', id: 'only', part: 'body' } });
    for (let i = 0; i < 5; i++) {
      core.send(pointer('move', 40 * (i + 1), i + 1));
      chart.frames.step();
    }
    expect(chart.root.querySelector('.gantt__bar[data-dragging]')).not.toBeNull();
    core.send({ type: 'cancel', pointerId: 1 });
    chart.frames.step();

    const called = [...spies]
      .filter(([, spy]) => spy.mock.calls.length > 0)
      .map(([label]) => label);
    expect(called).toEqual([]);
    expect(spies.size).toBeGreaterThan(8);
  });
});

describe('the layout-read spies see what they are for (NFR-PERF-2)', () => {
  it('NFR-PERF-2: a layer that measures in `update` is caught, by every kind of read', () => {
    const core = plan(50);
    const container = createContainer();
    const frames = createManualFrames();
    const reads: unknown[] = [];
    const measuring: LayerFactories = {
      bars: () => {
        let scroller: HTMLElement | undefined;
        return {
          mount: (context) => {
            scroller = context.scroller;
          },
          update: (_snapshot, previous) => {
            if (previous === undefined) return;
            reads.push(
              scroller?.clientWidth,
              scroller?.getBoundingClientRect(),
              window.getComputedStyle(container),
            );
          },
          destroy: () => undefined,
        };
      },
    };
    mountRenderer(container, core, { frames, layers: measuring });
    const spies = spyOnLayoutReads();
    for (const spy of spies.values()) spy.mockClear();

    core.setOptions({ locale: 'uk' });
    frames.step();

    const called = [...spies]
      .filter(([, spy]) => spy.mock.calls.length > 0)
      .map(([label]) => label);
    expect(called.sort()).toEqual([
      'HTMLElement.clientWidth',
      'HTMLElement.getBoundingClientRect',
      'window.getComputedStyle',
    ]);
  });
});

describe('one render per frame (NFR-PERF-2)', () => {
  it('NFR-PERF-2: any number of publishes and scroll events before the frame make one render', () => {
    const core = plan(200);
    const chart = mount(core);
    const requested = chart.frames.requested;
    const before = { ...chart.updates };

    // A burst: data, options, scroll events and the clock, all before the frame.
    core.setTasks(core.getSnapshot().state.tasks.slice(0, 100));
    core.setOptions({ locale: 'uk' });
    for (let i = 1; i <= 5; i++) scrollTo(chart, i * 60, i * 20);
    core.refreshNow();
    core.setOptions({ layout: { barHeight: 24 } });

    expect(chart.frames.requested).toBe(requested + 1);
    expect(chart.frames.queued).toBe(1);
    chart.frames.step();
    for (const name of LAYER_ORDER) expect(chart.updates[name], name).toBe(before[name] + 1);
    // The snapshot drawn is the last one.
    expect(chart.root.querySelectorAll('.gantt__bar').length).toBeGreaterThan(0);
    expect(chart.frames.queued).toBe(0);
  });

  it('FR-TL-5, NFR-PERF-2: a publish before a compensating scroll and another after share the frames', () => {
    const core = createTestCore({
      timeline: { infinite: { extendBy: '2w' } },
      scroll: { initial: '2026-03-09' },
    });
    const chart = mount(core);
    const rendered = () => chart.updates.header;
    const base = rendered();

    // A publish is waiting for the frame when the scroll event comes with a compensation: the
    // synchronous render takes both, and the frame is cancelled.
    core.setOptions({ locale: 'uk' });
    expect(chart.frames.queued).toBe(1);
    scrollTo(chart, 0, 0);
    expect(core.getSnapshot().timeline.scrollLeft).toBeGreaterThan(0);
    expect(rendered()).toBe(base + 1);
    expect(chart.frames.queued).toBe(0);

    // Whatever comes next in the same turn waits for one frame, however many there are.
    core.setOptions({ locale: 'en' });
    core.setOptions({ layout: { rowHeight: 40 } });
    core.refreshNow();
    expect(chart.frames.queued).toBe(1);
    chart.frames.step();
    expect(rendered()).toBe(base + 2);
    expect(chart.frames.queued).toBe(0);
  });

  it('NFR-PERF-2: a scroll that changes nothing the core publishes renders nothing', () => {
    const core = plan(200);
    const chart = mount(core);
    const { left, top } = { left: core.getSnapshot().timeline.scrollLeft, top: 0 };
    const requested = chart.frames.requested;

    scrollTo(chart, left, top);
    scrollTo(chart, left, top);

    expect(chart.frames.requested).toBe(requested);
    expect(chart.updates.header).toBe(1);
  });
});

describe('pure scrolls inside the drawn window write no DOM (NFR-PERF-2, NFR-PERF-3)', () => {
  /** Records every DOM write below `root` until `take()`. */
  function watch(root: Element): { take(): MutationRecord[]; stop(): void } {
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    return {
      take: () => observer.takeRecords(),
      stop: () => {
        observer.disconnect();
      },
    };
  }

  /** 30 rows of bars in the first week and links between neighbours: nothing at any window edge. */
  function quietPlan(): GanttCore {
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      id: `t${String(i)}`,
      name: `Task ${String(i)}`,
      start: '2026-03-02',
      end: '2026-03-06',
    }));
    const links = tasks.slice(1).map((task, i) => ({ source: `t${String(i)}`, target: task.id }));
    return createTestCore({ tasks, links, scroll: { initial: 'start', autoScroll: false } });
  }

  it('NFR-PERF-2: a few px of scroll, both ways, touch no node and no attribute of any layer', () => {
    const chart = mount(quietPlan());
    const { timeline } = chart.core.getSnapshot();
    expect(chart.root.querySelectorAll('.gantt__bar').length).toBeGreaterThan(5);
    expect(chart.root.querySelectorAll('.gantt__link').length).toBeGreaterThan(5);
    const changes = watch(chart.root);

    // Inside the first day cell and the first rows of the window: no cell, no row, no bar and no
    // link enters or leaves, and the sticky label stays in its cell.
    for (let step = 1; step <= 20; step++) {
      scrollTo(chart, timeline.scrollLeft + step, step / 2);
      chart.frames.step();
    }
    for (let step = 19; step >= 0; step--) {
      scrollTo(chart, timeline.scrollLeft + step, step / 2);
      chart.frames.step();
    }

    expect(changes.take()).toEqual([]);
    expect(chart.updates.header).toBeGreaterThan(30);
    changes.stop();
  });

  it('NFR-PERF-3: a long horizontal scroll changes the DOM at the edges of the window only', () => {
    const chart = mount(plan(2000));
    const nodes = chart.root.getElementsByTagName('*');
    const start = nodes.length;
    const changes = watch(chart.root);
    let added = 0;
    let removed = 0;
    const count = (): void => {
      for (const record of changes.take()) {
        added += record.addedNodes.length;
        removed += record.removedNodes.length;
      }
    };

    for (let i = 1; i <= 200; i++) {
      scrollTo(chart, i * 24, 0);
      chart.frames.step();
      count();
    }

    // 200 frames over 4800 px: a handful of top-level nodes per frame, and the page holds what
    // it held at the start.
    expect((added + removed) / 200).toBeLessThan(30);
    expect(nodes.length).toBeLessThan(start * 1.5);
    changes.stop();
  });
});

describe('virtualization follows snapshot.window with overscan (NFR-PERF-3, docs §7a)', () => {
  /** The drawn parts of every layer, read from the DOM. */
  function drawn(chart: Chart): {
    bars: string[];
    rows: number[];
    cells: { left: number; right: number }[];
    links: number;
    nodes: number;
  } {
    const q = <E extends Element>(selector: string): E[] => [
      ...chart.root.querySelectorAll<E>(selector),
    ];
    return {
      bars: q('.gantt__bar').map((bar) => bar.getAttribute('data-task-id') ?? ''),
      rows: q('.gantt__row').map((row) => Number(row.getAttribute('data-row'))),
      cells: q<HTMLElement>('.gantt__header-cell').map((cell) => {
        const left = Number.parseFloat(cell.style.getPropertyValue('left'));
        return { left, right: left + Number.parseFloat(cell.style.getPropertyValue('width')) };
      }),
      links: q('.gantt__link').length,
      nodes: chart.root.getElementsByTagName('*').length,
    };
  }

  function expectWindowDrawn(chart: Chart, shown: GanttSnapshot): void {
    const { window: view, layout } = shown;
    const found = drawn(chart);
    const inWindow = barsInWindow(view, layout).map((bar) => String(bar.id));
    expect(found.bars.sort()).toEqual(inWindow.sort());
    // The rows of the window, clipped to the plan, and no others.
    const first = Math.max(view.firstRow, 0);
    const last = Math.min(view.lastRow, layout.rows.rows.length - 1);
    expect(found.rows.sort((a, b) => a - b)).toEqual(
      Array.from({ length: Math.max(last - first + 1, 0) }, (_, i) => first + i),
    );
    // Header cells touch the window (clipped to the content), none lies outside it.
    const left = Math.max(view.left, 0);
    const right = Math.min(view.right, shown.contentWidth);
    for (const cell of found.cells) {
      expect(cell.right).toBeGreaterThan(left - 1);
      expect(cell.left).toBeLessThan(right + 1);
    }
    expect(found.cells.length).toBeGreaterThan(0);
    expect(found.nodes).toBeLessThan(3000);
  }

  it.each([
    ['the start', 0, 0],
    ['a far scroll right', 12_000, 0],
    ['a far scroll down', 0, 60_000],
    ['both, far', 20_000, 100_000],
    ['near the end of the rows', 3000, 5000 * 48],
  ])('NFR-PERF-3: at %s every layer draws the window and nothing else', (_name, left, top) => {
    const chart = mount(plan(5000));
    const nodesAtStart = drawn(chart).nodes;

    scrollTo(chart, left, top);
    chart.frames.step();

    const shown = chart.core.getSnapshot();
    expectWindowDrawn(chart, shown);
    // 5000 tasks and a window: about as many nodes as at the start, not a node per task.
    expect(drawn(chart).nodes).toBeLessThan(nodesAtStart * 2 + 200);
  });

  it('NFR-PERF-3: the window moves with the scroll position, the plan size does not matter', () => {
    const small = mount(plan(300));
    const large = mount(plan(5000));
    scrollTo(small, 600, 3000);
    small.frames.step();
    scrollTo(large, 600, 3000);
    large.frames.step();

    expectWindowDrawn(small, small.core.getSnapshot());
    expectWindowDrawn(large, large.core.getSnapshot());
    expect(drawn(large).bars.length).toBe(drawn(small).bars.length);
    expect(drawn(large).nodes).toBeLessThan(drawn(small).nodes * 1.5);
  });
});

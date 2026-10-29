import {
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type PointerInput,
} from '@ganttlane/core';
import { generateFixture } from '@ganttlane/fixtures';
import { afterEach, describe, expect, it } from 'vitest';

import type { LayerName } from './layers/types';
import { mountRenderer } from './renderer';
import {
  createContainer,
  createManualFrames,
  instrumentLayers,
  type ManualFrames,
  stubScrollerSize,
} from './testing';

/**
 * Budgets of plan step 4.5 on the whole render path, scroll event to layers, at 1k and 10k
 * generated tasks (NFR-PERF-1 … NFR-PERF-3): `core.scroll`, a scroll frame (the event, the
 * core's snapshot and every layer's update) horizontally, vertically and as a fling that moves
 * the window past everything drawn, and a drag frame (`core.send` plus the render). The numbers
 * are JavaScript time in a DOM without layout: the browser's style, layout and paint come on top
 * of them (`apps/playground` `/bench/` and `e2e/bench.spec.ts` measure those). The assertions
 * are generous so that slow CI machines pass; the measured means are attached to the test
 * report. Runs in `pnpm test:perf` only.
 */
const FRAME_MS = 16;
const VIEWPORT = { width: 1600, height: 900 };

afterEach(() => {
  document.body.replaceChildren();
});

/** Mean milliseconds of `run`, after a warm-up. */
function mean(runs: number, run: (i: number) => void, warm = 200): number {
  for (let i = 0; i < warm; i++) run(i);
  const start = performance.now();
  for (let i = 0; i < runs; i++) run(warm + i);
  return (performance.now() - start) / runs;
}

interface Chart {
  readonly core: GanttCore;
  readonly scroller: HTMLElement;
  readonly frames: ManualFrames;
  readonly layerMs: Map<LayerName, number>;
  readonly destroy: () => void;
}

/** A renderer with the built-in layers, each timed, over a generated plan. */
function mount(options: Partial<GanttCoreOptions>, count: number, hourly = false): Chart {
  const fixture = generateFixture(
    hourly ? { count, granularity: '1h', precision: 'time' } : { count },
  );
  const core = createGanttCore({
    tasks: fixture.tasks,
    links: fixture.links,
    calendar: fixture.calendar,
    ...fixture.options,
    scroll: { initial: 'start', autoScroll: false },
    ...options,
  });
  stubScrollerSize(VIEWPORT.width, VIEWPORT.height);
  const container = createContainer();
  const frames = createManualFrames();
  const layerMs = new Map<LayerName, number>();
  const layers = instrumentLayers((name, ms) => {
    layerMs.set(name, (layerMs.get(name) ?? 0) + ms);
  });
  const renderer = mountRenderer(container, core, { frames, layers });
  const scroller = container.querySelector<HTMLElement>('.gantt__scroller');
  if (!scroller) throw new Error('no scroller');
  return {
    core,
    scroller,
    frames,
    layerMs,
    destroy: () => {
      renderer.destroy();
      core.destroy();
    },
  };
}

/** One scroll frame: the user moves the scroller, the browser fires `scroll`, the frame runs. */
function scrollFrame(chart: Chart, left: number, top: number): void {
  chart.scroller.scrollLeft = left;
  chart.scroller.scrollTop = top;
  chart.scroller.dispatchEvent(new Event('scroll'));
  chart.frames.step();
}

/** The layers' update time per frame, since the last `reset`, as `name 0.001` text. */
function breakdown(chart: Chart, frames: number): string {
  return [...chart.layerMs]
    .filter(([name]) => name !== 'overlay' && name !== 'popover')
    .map(([name, total]) => `${name} ${(total / frames).toFixed(4)}`)
    .join(', ');
}

describe.each([1000, 10_000])('render path (%i generated tasks)', (count) => {
  it('NFR-PERF-2, NFR-PERF-3: core.scroll is cheap, also when nothing changed', async ({
    annotate,
  }) => {
    const chart = mount({}, count);
    const { core } = chart;
    const left = core.getSnapshot().timeline.scrollLeft;
    let published = 0;
    core.subscribe(() => {
      published++;
    });

    const moving = mean(20_000, (i) => core.scroll({ left: left + (i % 40), top: 0 }));
    const publishedMoving = published;
    core.scroll({ left, top: 0 });
    published = 0;
    const unchanged = mean(20_000, () => core.scroll({ left, top: 0 }), 20_000);

    await annotate(
      `${count} tasks: core.scroll to a new position ${(moving * 1000).toFixed(2)} µs, to the same position ${(unchanged * 1000).toFixed(2)} µs (published ${publishedMoving} snapshots for the first, ${published} for the second)`,
    );
    // The snapshot is rebuilt either way; it has to cost microseconds, and be shared when the
    // position did not change.
    expect(moving).toBeLessThan(0.05);
    expect(unchanged).toBeLessThan(0.05);
    expect(published).toBe(0);
    chart.destroy();
  });

  it('NFR-PERF-2, NFR-PERF-3: a scroll frame, horizontal and vertical, costs a fraction of a frame', async ({
    annotate,
  }) => {
    const chart = mount({}, count);
    const left = chart.core.getSnapshot().timeline.scrollLeft;
    chart.layerMs.clear();
    let runs = 0;
    const horizontal = mean(5000, (i) => {
      runs++;
      scrollFrame(chart, left + (i % 60), 0);
    });
    const byLayerX = breakdown(chart, runs);
    chart.layerMs.clear();
    runs = 0;
    const vertical = mean(2000, (i) => {
      runs++;
      scrollFrame(chart, left, i * 7);
    });
    const byLayerY = breakdown(chart, runs);
    const nodes = document.querySelectorAll('*').length;

    await annotate(
      `${count} tasks: horizontal scroll frame ${(horizontal * 1000).toFixed(1)} µs (${byLayerX}), vertical ${(vertical * 1000).toFixed(1)} µs (${byLayerY}), ${nodes} nodes in the page`,
    );
    expect(horizontal).toBeLessThan(FRAME_MS / 8);
    expect(vertical).toBeLessThan(FRAME_MS / 4);
    // The page holds the window, not the plan.
    expect(nodes).toBeLessThan(3000);
    chart.destroy();
  });

  it('NFR-PERF-3: a fling past everything drawn redraws the window within a frame', async ({
    annotate,
  }) => {
    const chart = mount({}, count);
    const left = chart.core.getSnapshot().timeline.scrollLeft;
    const range = chart.core.getSnapshot().contentWidth - VIEWPORT.width;
    chart.layerMs.clear();
    let runs = 0;
    // 1200 px per frame: every frame is beyond the overscan of the one before.
    const fling = mean(
      300,
      (i) => {
        runs++;
        scrollFrame(chart, left + ((i * 1200) % range), (i % 50) * 480);
      },
      30,
    );
    const nodes = document.querySelectorAll('*').length;

    await annotate(
      `${count} tasks: fling frame ${fling.toFixed(3)} ms (${breakdown(chart, runs)}), ${nodes} nodes in the page`,
    );
    expect(fling).toBeLessThan(FRAME_MS / 2);
    expect(nodes).toBeLessThan(3000);
    chart.destroy();
  });

  it('NFR-PERF-1: a drag frame, core.send plus the render, costs a fraction of a frame', async ({
    annotate,
  }) => {
    const chart = mount({}, count);
    const { core } = chart;
    const { window: view, layout } = core.getSnapshot();
    const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((row) => layout.barAt(view.firstRow + row))
      .filter((found) => found !== undefined);
    const bar = bars[Math.floor(bars.length / 2)]!;
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    const pointer = (type: PointerInput['type'], dx: number, time: number): PointerInput => ({
      type,
      pointerId: 1,
      x: x + dx,
      y,
      time,
    });
    core.send({ ...pointer('down', 0, 0), target: { kind: 'task', id: bar.id, part: 'body' } });
    core.send(pointer('move', 10, 1));

    let sendMs = 0;
    let sent = 0;
    const frame = mean(
      500,
      (i) => {
        const start = performance.now();
        core.send(pointer('move', 80 * (1 + (i % 2)), i + 2));
        sendMs += performance.now() - start;
        sent++;
        chart.frames.step();
      },
      50,
    );
    expect(document.querySelector('.gantt__bar[data-dragging]')).not.toBeNull();
    core.send({ type: 'cancel', pointerId: 1 });

    await annotate(
      `${count} tasks: drag frame ${frame.toFixed(3)} ms, of which core.send ${(sendMs / sent).toFixed(3)} ms`,
    );
    expect(frame).toBeLessThan(FRAME_MS / 4);
    chart.destroy();
  });
});

describe('render path, hourly view (10 000 generated tasks)', () => {
  it('NFR-PERF-3: the hour view, with many more cells and lines, still scrolls within a frame', async ({
    annotate,
  }) => {
    const chart = mount({ viewMode: 'hour' }, 10_000, true);
    const left = chart.core.getSnapshot().timeline.scrollLeft;
    chart.layerMs.clear();
    let runs = 0;
    const horizontal = mean(3000, (i) => {
      runs++;
      scrollFrame(chart, left + (i % 60), 0);
    });
    const byLayer = breakdown(chart, runs);
    chart.layerMs.clear();
    runs = 0;
    const fling = mean(
      300,
      (i) => {
        runs++;
        scrollFrame(chart, left + i * 1500, 0);
      },
      30,
    );
    const nodes = document.querySelectorAll('*').length;

    await annotate(
      `10k hourly tasks: scroll frame ${(horizontal * 1000).toFixed(1)} µs (${byLayer}), fling frame ${fling.toFixed(3)} ms (${breakdown(chart, runs)}), ${nodes} nodes in the page`,
    );
    expect(horizontal).toBeLessThan(FRAME_MS / 4);
    expect(fling).toBeLessThan(FRAME_MS / 2);
    expect(nodes).toBeLessThan(4000);
    chart.destroy();
  });
});

/**
 * Benchmark page of plan step 4.5 (NFR-PERF-1 … NFR-PERF-3): a generated plan of 1k or 10k
 * tasks (`?bench=1k|10k`) is mounted with the vanilla renderer, then auto-scrolled and dragged
 * while the page measures what a user would feel:
 *
 * - **first paint**: from the start of the core to the second frame after the mount;
 * - **scroll frame time**: the `requestAnimationFrame` delta while the scroller is moved by a
 *   fixed step per frame, horizontally and then vertically (`frames=` sets how many frames);
 *   next to it the **work** per frame, the main-thread time from the scroll event to the end of
 *   the renderer's frame task (core, layers; not the browser's style, layout and paint), which
 *   says how much of a frame is left, where the frame time stays at the display's 16.7 ms; and
 *   a **fling**, a horizontal scroll that moves the window past everything drawn every frame;
 * - **node count**: the elements of the chart, sampled every frame (the virtualization keeps it
 *   bounded, whatever the number of tasks);
 * - **churn**: nodes added and removed and attributes written per scroll frame, by layer;
 * - **drag frame**: the cost of `core.send` for a pointer move that makes a new preview, and the
 *   frame time while dragging.
 *
 * `run=1` starts at load, otherwise the button does. The numbers are on screen and in
 * `window.__ganttBench` (the e2e spec reads them there). Frame times depend on the machine, the
 * browser and whether the tab is visible: compare runs of one machine, never machines.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import type { GanttCore, PointerInput } from '@ganttlane/core';
import { barsInWindow, createGanttCore } from '@ganttlane/core';
import { mountRenderer } from '@ganttlane/dom';
import { generateFixture } from '@ganttlane/fixtures';

/** The sizes of `?bench=`. */
const SIZES = { '1k': 1000, '10k': 10_000 } as const;
type BenchSize = keyof typeof SIZES;

/** Frames of each auto-scroll phase, `?frames=` overrides. */
const DEFAULT_FRAMES = 240;
/** Pixels the scroller moves per frame: a fast wheel (about 1500 px/s at 60 Hz) and 1 row. */
const STEP_X = 24;
const STEP_Y = 48;
/** A fling: the window moves past everything drawn in every frame, so each frame redraws it. */
const STEP_FLING = 600;
/** A frame longer than this is counted as dropped (three frames at 60 Hz). */
const LONG_FRAME_MS = 50;

/** Statistics of a list of frame times, in milliseconds. */
export interface FrameStats {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Frames longer than {@link LONG_FRAME_MS}. */
  readonly longFrames: number;
}

/** What the DOM of the chart did per frame while scrolling, by layer. */
export interface Churn {
  /** Nodes (with their descendants) added per frame. */
  readonly added: number;
  /** Nodes (with their descendants) removed per frame. */
  readonly removed: number;
  /** Attribute and style writes per frame. */
  readonly attributes: number;
  /** Added plus removed nodes per frame, by layer. */
  readonly nodesByLayer: Readonly<Record<string, number>>;
}

/** Everything the page measures. */
export interface BenchResult {
  readonly bench: BenchSize;
  readonly tasks: number;
  readonly links: number;
  /** Generating the plan, not part of the chart. */
  readonly fixtureMs: number;
  /** `createGanttCore`: model, hierarchy, graph, layout, first snapshot. */
  readonly coreMs: number;
  /** `mountRenderer`, synchronous: skeleton, first render of every layer. */
  readonly mountMs: number;
  /** From the start of the core to the second frame after the mount. */
  readonly firstPaintMs: number;
  readonly nodesAfterMount: number;
  readonly nodesMax: number;
  readonly scrollX: FrameStats;
  readonly scrollY: FrameStats;
  /** Main-thread work per scroll frame: from the scroll event to the end of the render. */
  readonly workX: FrameStats;
  readonly workY: FrameStats;
  /** The fling: frame time and work (every frame redraws the whole window). */
  readonly fling: FrameStats;
  readonly workFling: FrameStats;
  readonly churn: Churn;
  readonly drag: {
    readonly sendMeanMs: number;
    readonly sendP95Ms: number;
    readonly sendMaxMs: number;
    readonly frame: FrameStats;
    /** Whether the chart showed the dragged bar as dragging during the phase. */
    readonly dragging: boolean;
  };
  /** Long tasks (> 50 ms) of the main thread during the run; `null` where unsupported. */
  readonly longTasks: { readonly count: number; readonly maxMs: number } | null;
}

/** What `window.__ganttBench` holds. */
export interface BenchState {
  status: 'idle' | 'running' | 'done' | 'failed';
  result?: BenchResult;
  error?: string;
}

declare global {
  interface Window {
    __ganttBench?: BenchState;
  }
}

const state: BenchState = { status: 'idle' };
window.__ganttBench = state;

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('#app not found');

const params = new URLSearchParams(window.location.search);
const requested = params.get('bench');
const size: BenchSize = requested === '10k' ? '10k' : '1k';
const frames = Math.max(Number(params.get('frames')) || DEFAULT_FRAMES, 10);

// ---- the page ----

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

const readout = new Map<string, HTMLElement>();
const rows: [key: string, label: string][] = [
  ['tasks', 'Plan'],
  ['first-paint', 'First paint (core start to the second frame after the mount)'],
  ['core', 'Core: createGanttCore'],
  ['mount', 'Renderer: mountRenderer'],
  ['nodes', 'Nodes in the chart (after mount / maximum while scrolling)'],
  ['scroll-x', 'Scroll frame, horizontal (ms: mean / p95 / max, long frames)'],
  ['scroll-y', 'Scroll frame, vertical (ms: mean / p95 / max, long frames)'],
  ['work', 'JS work per scroll frame, horizontal / vertical (ms: mean / p95 / max)'],
  [
    'fling',
    'Fling, 600 px per frame (frame ms: mean / p95 / max, long; JS work ms: mean / p95 / max)',
  ],
  ['churn', 'DOM churn per scroll frame (nodes added / removed, attributes written)'],
  ['churn-layers', 'Nodes added + removed per frame by layer'],
  ['drag-send', 'Drag: core.send of a pointer move (ms: mean / p95 / max)'],
  ['drag-frame', 'Drag: frame time (ms: mean / p95 / max, long frames)'],
  ['long-tasks', 'Long tasks (> 50 ms) of the main thread'],
];
const table = el('table', { className: 'debug-table' });
for (const [key, label] of rows) {
  const value = el('td', { textContent: '…' });
  value.dataset.testid = `bench-${key}`;
  readout.set(key, value);
  table.append(el('tr', {}, el('th', { scope: 'row', textContent: label }), value));
}
const status = el('p', { className: 'summary', textContent: 'idle' });
status.dataset.testid = 'bench-status';
const run = el('button', { type: 'button', textContent: `Run the ${size} benchmark` });
const chartContainer = el('div', { id: 'bench-chart', className: 'chart' });

container.append(
  el('h1', { textContent: `Benchmark · ${size} tasks` }),
  el(
    'p',
    { className: 'picker' },
    el('a', { href: '?bench=1k', textContent: '1k' }),
    el('a', { href: '?bench=10k', textContent: '10k' }),
    run,
  ),
  status,
  el('div', { className: 'table-wrap' }, table),
  chartContainer,
);

const show = (key: string, text: string): void => {
  const cell = readout.get(key);
  if (cell) cell.textContent = text;
};
const ms = (value: number): string => value.toFixed(value < 1 ? 3 : 1);

// ---- measuring ----

const nextFrame = async (): Promise<number> =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

function stats(deltas: readonly number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((total, delta) => total + delta, 0);
  return {
    frames: deltas.length,
    meanMs: deltas.length === 0 ? 0 : sum / deltas.length,
    p95Ms: sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    longFrames: deltas.filter((delta) => delta > LONG_FRAME_MS).length,
  };
}

const showStats = (value: FrameStats): string =>
  `${ms(value.meanMs)} / ${ms(value.p95Ms)} / ${ms(value.maxMs)}, ${String(value.longFrames)} long of ${String(value.frames)}`;

/** Long tasks of the main thread since the call, where the browser reports them (Chromium). */
function watchLongTasks(): () => BenchResult['longTasks'] {
  if (typeof PerformanceObserver === 'undefined') return () => null;
  if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return () => null;
  let count = 0;
  let maxMs = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      count++;
      maxMs = Math.max(maxMs, entry.duration);
    }
  });
  observer.observe({ type: 'longtask' });
  return () => {
    // Entries are delivered asynchronously: take what is queued.
    for (const entry of observer.takeRecords()) {
      count++;
      maxMs = Math.max(maxMs, entry.duration);
    }
    observer.disconnect();
    return { count, maxMs };
  };
}

interface PhaseOutcome {
  readonly deltas: readonly number[];
  /** Main-thread time per frame from the scroll event to the end of the render. */
  readonly work: readonly number[];
  readonly nodesMax: number;
}

/**
 * Moves the scroller by `step` px per frame for `count` frames; the frame time is the delta of
 * `requestAnimationFrame` timestamps, so it includes the scroll event, the render, and the
 * browser's style, layout and paint of the frame before.
 */
async function scrollPhase(
  scroller: HTMLElement,
  chart: Element,
  axis: 'x' | 'y',
  step: number,
  count: number,
  wrapAt = Number.POSITIVE_INFINITY,
): Promise<PhaseOutcome> {
  const nodes = chart.getElementsByTagName('*');
  const deltas: number[] = [];
  const work: number[] = [];
  let nodesMax = 0;
  let position = 0;
  // The work of a frame: a capturing listener marks the start of the scroll event, before the
  // chart's own handler, and a frame callback asked for after that handler (listeners run in the
  // order they were added) runs after the chart's own frame task has rendered.
  let started = 0;
  const begin = (): void => {
    started = performance.now();
  };
  const end = (): void => {
    requestAnimationFrame(() => {
      work.push(performance.now() - started);
    });
  };
  scroller.addEventListener('scroll', begin, { capture: true });
  scroller.addEventListener('scroll', end);
  let last = await nextFrame();
  for (let i = 0; i < count; i++) {
    position = (position + step) % wrapAt;
    if (axis === 'x') scroller.scrollLeft = position;
    else scroller.scrollTop = position;
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
    nodesMax = Math.max(nodesMax, nodes.length);
  }
  await nextFrame();
  scroller.removeEventListener('scroll', begin, { capture: true });
  scroller.removeEventListener('scroll', end);
  return { deltas, work, nodesMax };
}

const LAYERS = ['header', 'grid', 'links', 'bars'] as const;

/** Runs a scroll phase again with a MutationObserver on the chart, to count the DOM work. */
async function measureChurn(
  scroller: HTMLElement,
  chart: Element,
  axis: 'x' | 'y',
  step: number,
  count: number,
): Promise<Churn> {
  let added = 0;
  let removed = 0;
  let attributes = 0;
  const byLayer: Record<string, number> = { header: 0, grid: 0, links: 0, bars: 0, other: 0 };
  const layerOf = (target: Node): string => {
    const element = target instanceof Element ? target : target.parentElement;
    for (const layer of LAYERS) {
      if (element?.closest(layer === 'header' ? '.gantt__header' : `.gantt__${layer}`)) {
        return layer;
      }
    }
    return 'other';
  };
  const weight = (node: Node): number =>
    node instanceof Element ? 1 + node.getElementsByTagName('*').length : 1;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        attributes++;
        continue;
      }
      if (record.type !== 'childList') continue;
      const layer = layerOf(record.target);
      for (const node of record.addedNodes) {
        added += weight(node);
        byLayer[layer] = (byLayer[layer] ?? 0) + weight(node);
      }
      for (const node of record.removedNodes) {
        removed += weight(node);
        byLayer[layer] = (byLayer[layer] ?? 0) + weight(node);
      }
    }
  });
  observer.observe(chart, { subtree: true, childList: true, attributes: true });
  await scrollPhase(scroller, chart, axis, step, count);
  await nextFrame();
  observer.disconnect();
  const perFrame = (value: number): number => value / count;
  return {
    added: perFrame(added),
    removed: perFrame(removed),
    attributes: perFrame(attributes),
    nodesByLayer: Object.fromEntries(
      Object.entries(byLayer).map(([layer, nodes]) => [layer, perFrame(nodes)]),
    ),
  };
}

/** A pointer drag through `core.send`: every move is a new preview with its propagation. */
async function dragPhase(
  core: GanttCore,
  chart: Element,
  count: number,
): Promise<BenchResult['drag']> {
  const { window: view, layout } = core.getSnapshot();
  const bars = barsInWindow(view, layout);
  const bar = bars[Math.floor(bars.length / 2)];
  if (!bar) throw new Error('no bar in the window to drag');
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;
  const pointer = (type: PointerInput['type'], dx: number, time: number): PointerInput => ({
    type,
    pointerId: 1,
    x: x + dx,
    y,
    time,
  });
  core.send({
    ...pointer('down', 0, 0),
    target: { kind: 'task', id: bar.id, part: 'body' },
  });
  core.send(pointer('move', 10, 1));
  const sends: number[] = [];
  const deltas: number[] = [];
  let dragging = false;
  let last = await nextFrame();
  for (let i = 0; i < count; i++) {
    // Two and four days alternately: every frame is a new preview, never a repeat.
    const start = performance.now();
    core.send(pointer('move', 80 * (1 + (i % 2)), i + 2));
    sends.push(performance.now() - start);
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
    dragging ||= chart.querySelector('.gantt__bar[data-dragging]') !== null;
  }
  core.send({ type: 'cancel', pointerId: 1 });
  await nextFrame();
  const sendStats = stats(sends);
  return {
    sendMeanMs: sendStats.meanMs,
    sendP95Ms: sendStats.p95Ms,
    sendMaxMs: sendStats.maxMs,
    frame: stats(deltas),
    dragging,
  };
}

/** The chart of the last run, kept mounted afterwards so that it can be looked at. */
let mounted: { readonly renderer: { destroy(): void }; readonly core: GanttCore } | undefined;

function teardown(): void {
  mounted?.renderer.destroy();
  mounted?.core.destroy();
  mounted = undefined;
}

async function execute(): Promise<BenchResult> {
  teardown();
  const fixtureStart = performance.now();
  const fixture = generateFixture({ count: SIZES[size] });
  const fixtureMs = performance.now() - fixtureStart;
  show('tasks', `${String(fixture.tasks.length)} tasks, ${String(fixture.links.length)} links`);
  const stopLongTasks = watchLongTasks();

  chartContainer.replaceChildren();
  await nextFrame();
  const t0 = performance.now();
  const core = createGanttCore({
    tasks: fixture.tasks,
    links: fixture.links,
    ...(fixture.calendar && { calendar: fixture.calendar }),
    ...fixture.options,
    scroll: { initial: 'start', autoScroll: false },
  });
  const t1 = performance.now();
  const renderer = mountRenderer(chartContainer, core);
  const t2 = performance.now();
  mounted = { renderer, core };
  await nextFrame();
  await nextFrame();
  const t3 = performance.now();
  const chart = chartContainer.querySelector('.gantt');
  const scroller = chartContainer.querySelector<HTMLElement>('.gantt__scroller');
  if (!chart || !scroller) throw new Error('the chart did not mount');
  const nodesAfterMount = chart.getElementsByTagName('*').length;
  show('core', `${ms(t1 - t0)} ms`);
  show('mount', `${ms(t2 - t1)} ms`);
  show('first-paint', `${ms(t3 - t0)} ms`);
  show('nodes', `${String(nodesAfterMount)} / …`);

  // Scrolling, timed without any observer in the way.
  const horizontal = await scrollPhase(scroller, chart, 'x', STEP_X, frames);
  show('scroll-x', showStats(stats(horizontal.deltas)));
  scroller.scrollLeft = 0;
  await nextFrame();
  const vertical = await scrollPhase(scroller, chart, 'y', STEP_Y, frames);
  show('scroll-y', showStats(stats(vertical.deltas)));
  const workX = stats(horizontal.work);
  const workY = stats(vertical.work);
  const plain = (value: FrameStats): string =>
    `${ms(value.meanMs)} / ${ms(value.p95Ms)} / ${ms(value.maxMs)}`;
  show('work', `${plain(workX)} / ${plain(workY)}`);
  scroller.scrollTop = 0;
  await nextFrame();
  // The fling wraps around inside the content: the extent is read once, here, not per frame.
  const range = scroller.scrollWidth - scroller.clientWidth;
  const fling = await scrollPhase(scroller, chart, 'x', STEP_FLING, frames, range);
  const flingStats = stats(fling.deltas);
  const flingWork = stats(fling.work);
  show('fling', `${showStats(flingStats)}; ${plain(flingWork)}`);
  scroller.scrollLeft = 0;
  await nextFrame();
  const nodesMax = Math.max(
    nodesAfterMount,
    horizontal.nodesMax,
    vertical.nodesMax,
    fling.nodesMax,
  );
  show('nodes', `${String(nodesAfterMount)} / ${String(nodesMax)}`);

  // The same scrolling once more, counting what the DOM did.
  const churnX = await measureChurn(scroller, chart, 'x', STEP_X, frames);
  scroller.scrollLeft = 0;
  await nextFrame();
  const churnY = await measureChurn(scroller, chart, 'y', STEP_Y, frames);
  scroller.scrollTop = 0;
  await nextFrame();
  const churn: Churn = {
    added: (churnX.added + churnY.added) / 2,
    removed: (churnX.removed + churnY.removed) / 2,
    attributes: (churnX.attributes + churnY.attributes) / 2,
    nodesByLayer: Object.fromEntries(
      Object.keys(churnX.nodesByLayer).map((layer) => [
        layer,
        ((churnX.nodesByLayer[layer] ?? 0) + (churnY.nodesByLayer[layer] ?? 0)) / 2,
      ]),
    ),
  };
  show(
    'churn',
    `${ms(churn.added)} / ${ms(churn.removed)}, ${ms(churn.attributes)} (horizontal ${ms(churnX.added + churnX.removed)}, vertical ${ms(churnY.added + churnY.removed)} nodes)`,
  );
  show(
    'churn-layers',
    Object.entries(churn.nodesByLayer)
      .map(([layer, nodes]) => `${layer} ${ms(nodes)}`)
      .join(', '),
  );

  const drag = await dragPhase(core, chart, frames);
  show('drag-send', `${ms(drag.sendMeanMs)} / ${ms(drag.sendP95Ms)} / ${ms(drag.sendMaxMs)}`);
  show('drag-frame', showStats(drag.frame));

  const longTasks = stopLongTasks();
  show(
    'long-tasks',
    longTasks === null
      ? 'not reported by this browser'
      : `${String(longTasks.count)} (longest ${ms(longTasks.maxMs)} ms)`,
  );

  return {
    bench: size,
    tasks: fixture.tasks.length,
    links: fixture.links.length,
    fixtureMs,
    coreMs: t1 - t0,
    mountMs: t2 - t1,
    firstPaintMs: t3 - t0,
    nodesAfterMount,
    nodesMax,
    scrollX: stats(horizontal.deltas),
    scrollY: stats(vertical.deltas),
    workX,
    workY,
    fling: flingStats,
    workFling: flingWork,
    churn,
    drag,
    longTasks,
  };
}

async function start(): Promise<void> {
  if (state.status === 'running') return;
  state.status = 'running';
  delete state.error;
  run.disabled = true;
  status.textContent = 'running';
  try {
    state.result = await execute();
    state.status = 'done';
    status.textContent = 'done';
  } catch (error) {
    state.status = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    status.textContent = `failed: ${state.error}`;
    throw error;
  } finally {
    run.disabled = false;
  }
}

run.addEventListener('click', () => {
  void start();
});
if (params.get('run') === '1') void start();

import.meta.hot?.dispose(() => {
  teardown();
  container.replaceChildren();
});

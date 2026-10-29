/**
 * Scrolling page of plan steps 4.6 and 4.9 (FR-TL-2 … FR-TL-8, FR-SCROLL-1 … FR-SCROLL-3): one
 * chart over a generated plan, configured by the query string, and the handle the e2e specs
 * (`e2e/scroll-*.spec.ts`) drive. Everything is optional:
 *
 * - `infinite=0|1` (default `1`), `extendBy` (`2w`), `threshold` (px), `maxSpan` (`6mo`),
 *   `min` / `max` (`bounds`): the infinite timeline;
 * - `height=auto|<px>` (default: the chart fills a 24rem container): `renderer.height`;
 * - `above=<px>` / `below=<px>`: filler before and after the chart, so that the page itself
 *   scrolls (the header of an `auto` chart sticks to the page viewport);
 * - `tasks` (`300`), `view` (view mode id, `day`), `initial` (`first-task`, a keyword or a
 *   date), `behavior` (`smooth` | `instant`, default `instant`), `align` (0 … 1), `now` (an ISO
 *   date that pins "today"), `autoscroll=0`;
 * - `appcss=smooth`: adds an application stylesheet with `scroll-behavior: smooth` on the
 *   scroller, which the compensation of the infinite timeline has to be immune to;
 * - `dir=rtl`: the host page is right to left (`<html dir="rtl">`), which the chart has to ignore;
 * - `wrap=x|scroll`: puts the chart in a wrapper, `x` with `overflow-x: auto` alone (it computes
 *   to `overflow-y: auto` too but grows with the chart and never scrolls), `scroll` with a height
 *   of 480 px, `overflow-y: auto` and 30 px of padding on top (a host that scrolls the chart);
 * - `pintop=<px>`: an application stylesheet with `.gantt__pin { top: <px> }`: a sticky header
 *   of the application above the chart's header.
 *
 * `window.__ganttScroll` holds the core, the renderer, the container and the task ids, and
 * `onFrame`, which the page calls at the end of every frame the renderer ran in: the e2e specs
 * sample the chart there, when the snapshot and the DOM agree. A change of the query string needs a
 * reload: the chart is created once.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import type { GanttCore } from '@ganttlane/core';
import { createGanttCore } from '@ganttlane/core';
import type { FrameSource, MountedRenderer } from '@ganttlane/dom';
import { mountRenderer } from '@ganttlane/dom';
import { generateFixture } from '@ganttlane/fixtures';

/** What `window.__ganttScroll` holds. */
export interface ScrollPage {
  readonly core: GanttCore;
  readonly renderer: MountedRenderer<GanttCore>;
  /** The chart's container (`#chart`). */
  readonly container: HTMLElement;
  /** The ids of the plan's tasks, in the order they were given. */
  readonly taskIds: readonly (string | number)[];
  /** Called after every frame the renderer ran in (its frame callbacks), see the file's comment. */
  onFrame?: () => void;
}

declare global {
  interface Window {
    __ganttScroll?: ScrollPage;
  }
}

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app not found');

const params = new URLSearchParams(window.location.search);
const text = (name: string): string | undefined => params.get(name) ?? undefined;
const count = (name: string, fallback: number): number => {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
};

const filler = (name: string, size: number): HTMLElement => {
  const element = document.createElement('div');
  element.className = 'scroll-filler';
  element.dataset.filler = name;
  element.style.height = `${String(size)}px`;
  return element;
};

// What an application's own stylesheet may do to the chart (unlayered, so it beats the library's
// `@layer gantt`). `appcss=smooth`: every programmatic scroll of the scroller becomes a slide.
// `pintop`: the chart's header sticks below a sticky header of the application's.
const appCss = [
  params.get('appcss') === 'smooth' ? '.gantt__scroller { scroll-behavior: smooth; }' : '',
  params.has('pintop') ? `.gantt__pin { top: ${String(count('pintop', 0))}px; }` : '',
].join('');
if (appCss !== '') {
  const style = document.createElement('style');
  style.textContent = appCss;
  document.head.append(style);
}
// `dir=rtl`: a host page in a right-to-left language.
if (params.get('dir') === 'rtl') document.documentElement.dir = 'rtl';

// The chart measures itself when it is mounted, so its stylesheets have to be in effect by then
// (the layout it reads is the styled one). A module script can run before them in WebKit.
await Promise.all(
  [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    .filter((link) => link.sheet === null)
    .map(
      async (link) =>
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => {
            resolve();
          });
          link.addEventListener('error', () => {
            resolve();
          });
        }),
    ),
);

const heightParam = text('height');
const height =
  heightParam === 'auto' ? 'auto' : heightParam === undefined ? undefined : Number(heightParam);
const container = document.createElement('div');
container.id = 'chart';
// A chart without a height option fills its container, so that needs a height of its own.
container.className = height === undefined ? 'chart' : 'chart-free';

const status = document.createElement('p');
status.className = 'chart-status';
status.dataset.testid = 'gantt-status';

// `wrap`: what the chart sits in. The chart is a child of it, and so is nothing else.
const wrapMode = text('wrap');
let outer: HTMLElement = container;
if (wrapMode === 'x' || wrapMode === 'scroll') {
  outer = document.createElement('div');
  outer.id = 'wrap';
  if (wrapMode === 'x') outer.style.overflowX = 'auto';
  else {
    outer.style.cssText = 'overflow-y: auto; height: 480px; padding-top: 30px;';
    // The padding is the host's: the chart's own box starts below it, like the container's.
  }
  outer.append(container);
}

app.append(filler('above', count('above', 0)), outer, status, filler('below', count('below', 0)));

const fixture = generateFixture({ count: count('tasks', 300), seed: 3, maxDepth: 2 });
const bounds = {
  ...(text('min') !== undefined && { min: text('min') }),
  ...(text('max') !== undefined && { max: text('max') }),
};
const now = text('now');

const core = createGanttCore({
  tasks: fixture.tasks,
  links: fixture.links,
  ...(fixture.calendar && { calendar: fixture.calendar }),
  ...fixture.options,
  viewMode: text('view') ?? 'day',
  ...(now !== undefined && { now: () => now }),
  timeline: {
    padding: '2w',
    infinite:
      params.get('infinite') !== '0'
        ? {
            extendBy: text('extendBy') ?? '2w',
            ...(params.has('threshold') && { threshold: count('threshold', 0) }),
            ...(text('maxSpan') !== undefined && { maxSpan: text('maxSpan') }),
            ...(Object.keys(bounds).length > 0 && { bounds }),
          }
        : false,
  },
  scroll: {
    initial: text('initial') ?? 'first-task',
    behavior: text('behavior') === 'smooth' ? 'smooth' : 'instant',
    ...(params.has('align') && { align: count('align', 0) }),
    ...(params.get('autoscroll') === '0' && { autoScroll: false as const }),
  },
});

// The browser's own frames, with a hook after each: the renderer renders (and the drag autoscroll
// steps) in the callbacks it asks for, and `onFrame` runs once they are done.
const frames: FrameSource = {
  request: (callback) =>
    requestAnimationFrame(() => {
      callback();
      window.__ganttScroll?.onFrame?.();
    }),
  cancel: (handle) => {
    cancelAnimationFrame(handle as number);
  },
};
const renderer = mountRenderer(container, core, {
  frames,
  ...(height !== undefined && { height }),
});
window.__ganttScroll = { core, renderer, container, taskIds: fixture.tasks.map((task) => task.id) };

const round = (value: number): string => String(Math.round(value));
const showStatus = (): void => {
  const { timeline, viewportHeight, contentWidth, scrollTop } = core.getSnapshot();
  status.textContent = [
    `viewport ${round(timeline.viewportWidth)}×${round(viewportHeight)}`,
    `content ${round(contentWidth)} px`,
    `scroll ${round(timeline.scrollLeft)}, ${round(scrollTop)}`,
    `edge ${new Date(timeline.scale.xToDate(timeline.scrollLeft)).toISOString()}`,
  ].join(' · ');
};
const stop = core.subscribe(showStatus);
showStatus();

import.meta.hot?.dispose(() => {
  stop();
  renderer.destroy();
  core.destroy();
  app.replaceChildren();
});

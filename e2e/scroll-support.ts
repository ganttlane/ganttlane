import type { CDPSession, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared by the scrolling specs (`scroll-infinite.spec.ts`, `scroll-height.spec.ts`; plan steps
 * 4.6 and 4.9): opens the `/scroll/` page of the playground, reads the chart's state in one
 * browser task (so a sample is consistent: nothing moves between the reads) and records what the
 * browser does while a source scrolls the chart.
 */

/** A reading of the chart. Dates are floating wall-clock ms, positions CSS px. */
export interface Sample {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  /** The date at the left edge of the viewport, from the snapshot's scale and the real scrollLeft. */
  readonly edge: number;
  readonly pxPerDay: number;
  /** Start and end of the range, and the content width the snapshot has. */
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly contentWidth: number;
  /** Bar nodes, and every node of the chart. */
  readonly bars: number;
  readonly nodes: number;
  /** Size of the scroller's client box. */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** The part of `window.__ganttScroll` (`apps/playground/src/scroll.ts`) the specs read. */
interface PageHandle {
  readonly core: {
    getSnapshot(): {
      readonly timeline: {
        readonly scrollLeft: number;
        readonly range: { readonly start: number; readonly end: number };
        readonly scale: { readonly pxPerDay: number; xToDate(x: number): number };
      };
      readonly contentWidth: number;
      /** The latest scroll request (the application asked for a scroll), by id. */
      readonly scrollRequest?: { readonly id: number } | undefined;
    };
  };
  /**
   * Called by the page before and after the renderer's frame callbacks of every frame it ran in
   * (`apps/playground/src/scroll.ts`).
   */
  beforeFrame?: (() => void) | undefined;
  onFrame?: (() => void) | undefined;
}

/** Milliseconds in a day: the scale is `px per day`, dates are ms. */
export const DAY_MS = 86_400_000;

/** Opens `/scroll/` with the query and waits for the chart to be drawn and still. */
export async function openScrollPage(page: Page, query = ''): Promise<void> {
  await page.goto(`/scroll/${query === '' ? '' : `?${query}`}`);
  await page.locator('#chart .gantt__scroller').waitFor();
  // The header is always drawn (bars only where a task is in the window).
  await page.locator('#chart .gantt__header-cell').first().waitFor({ state: 'attached' });
  await settle(page);
}

/** Reads the chart now. */
export async function sample(page: Page): Promise<Sample> {
  return page.evaluate((): Sample => {
    const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
    const root = document.querySelector<HTMLElement>('#chart .gantt');
    const handle = (window as unknown as { __ganttScroll?: PageHandle }).__ganttScroll;
    if (!scroller || !root || !handle) throw new Error('the scrolling page is not ready');
    const { timeline, contentWidth } = handle.core.getSnapshot();
    return {
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      edge: timeline.scale.xToDate(scroller.scrollLeft),
      pxPerDay: timeline.scale.pxPerDay,
      rangeStart: timeline.range.start,
      rangeEnd: timeline.range.end,
      contentWidth,
      bars: root.querySelectorAll('.gantt__bar').length,
      nodes: root.getElementsByTagName('*').length,
      viewportWidth: scroller.clientWidth,
      viewportHeight: scroller.clientHeight,
    };
  });
}

/**
 * Waits until the chart stops moving: the scroll position and the range are the same for a few
 * frames in a row (a smooth scroll, a momentum scroll and the extensions they trigger are over).
 */
export async function settle(page: Page, frames = 4): Promise<void> {
  await page.evaluate(
    async ({ still, limit }) => {
      const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
      const handle = (window as unknown as { __ganttScroll?: PageHandle }).__ganttScroll;
      const read = (): string => {
        const snapshot = handle?.core.getSnapshot();
        return [
          scroller?.scrollLeft,
          scroller?.scrollTop,
          snapshot?.timeline.range.start,
          snapshot?.contentWidth,
          window.scrollY,
        ].join('|');
      };
      const frame = async (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      let last = read();
      let same = 0;
      const start = performance.now();
      while (same < still && performance.now() - start < limit) {
        await frame();
        const now = read();
        same = now === last ? same + 1 : 0;
        last = now;
      }
    },
    { still: frames, limit: 3000 },
  );
}

/**
 * Waits until a date is at `fraction` of the viewport's width from its left edge (0: at the
 * edge), within 1 px. Polls: a smooth scroll can pause between frames under load, so the chart
 * being still is not the same as it being there.
 */
export async function expectDateAt(page: Page, date: string, fraction = 0): Promise<void> {
  await expect
    .poll(
      async () => {
        const reading = await sample(page);
        const off = ((reading.edge - Date.parse(`${date}T00:00:00Z`)) / DAY_MS) * reading.pxPerDay;
        return Math.abs(off + reading.viewportWidth * fraction);
      },
      { message: `${date} at ${String(fraction)} of the viewport`, timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
}

/** Pixels the scale moved between two samples: the date at the left edge, in px. */
export function edgeMovement(before: Sample, after: Sample): number {
  return ((after.edge - before.edge) / DAY_MS) * after.pxPerDay;
}

/** Collects uncaught page errors and `console.error` calls; assert it is empty at the end. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

/**
 * What the renderer's work did to the chart, in one `scroll` event or in one frame. The renderer
 * extends and trims the range, and compensates `scrollLeft`, in both: in the event handler for
 * the position the event reports, and, in a frame, for the position the scroller has by then (a
 * browser that animates a scroll on the main thread, as Chromium does on Linux, takes its next
 * step between the event and the frame callbacks). A check of the range or of the compensation
 * has to look at both.
 */
export interface Handling {
  /** The date at the left edge moved by this many px across the renderer's work. */
  readonly jump: number;
  /** Whether the range start / end moved during it. */
  readonly startMoved: boolean;
  readonly endMoved: boolean;
  /** The renderer wrote `scrollLeft` during it: a compensation (or a request it performed). */
  readonly compensated: boolean;
  /** The finest header row's cell under the left edge, in DOM coordinates, contains the edge. */
  readonly headerAtEdge: boolean;
  /** `--gantt-content-width` is the snapshot's content width. */
  readonly widthInSync: boolean;
}

/** One `scroll` event of the scroller, see {@link startRecording}. */
export type ScrollEventRecord = Handling;

/**
 * One frame of a recording: what a paint at that moment would show. Sampled by the page at the
 * end of a frame in which the renderer ran, after its render, so the snapshot, the DOM and the
 * scroller's position are those of one picture (a timer after the frame can see the next
 * frame's scroll position next to the last frame's snapshot). Its {@link Handling} is the
 * renderer's frame callbacks'; a frame that performed a scroll request has a `jump` of 0, since
 * moving the edge is what a request is for.
 */
export interface FrameRecord extends Handling {
  /** The date at the left edge, from the snapshot's scale and the real `scrollLeft`. */
  readonly edge: number;
  readonly pxPerDay: number;
  /** The scroller's `scrollLeft`. */
  readonly left: number;
  readonly nodes: number;
  readonly bars: number;
  /** The finest header row's cells, in DOM coordinates, cover the viewport: there is no hole. */
  readonly covered: boolean;
}

/** What the browser did between {@link startRecording} and {@link stopRecording}. */
export interface Recording {
  readonly events: readonly ScrollEventRecord[];
  readonly frames: readonly FrameRecord[];
  /** Largest numbers of chart nodes and bar nodes seen in a frame. */
  readonly maxNodes: number;
  readonly maxBars: number;
}

/** What the in-page recorder keeps on `window`. */
interface RecorderState {
  events: ScrollEventRecord[];
  frames: FrameRecord[];
  stop(): void;
}

/**
 * Starts recording in the page: every `scroll` event of the scroller (read before the renderer's
 * own listener handles it, by a capture listener on the document, and after, by a listener added
 * later than the renderer's) and every animation frame. It reads the DOM and the snapshot, never
 * writes.
 *
 * The jump of an event is how far the date at the left edge moved across the renderer's
 * handling, in px: the snapshot's scale and the real `scrollLeft` before, against the same
 * after. A right compensation makes it 0; the user's own scrolling is not part of it, because
 * the browser has applied that before the event fires.
 */
export async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
    const root = document.querySelector<HTMLElement>('#chart .gantt');
    const handle = (window as unknown as { __ganttScroll?: PageHandle }).__ganttScroll;
    if (!scroller || !root || !handle) throw new Error('the scrolling page is not ready');
    const dayMs = 86_400_000;
    const state: RecorderState = { events: [], frames: [], stop: () => undefined };
    (window as unknown as { __ganttRecorder?: RecorderState }).__ganttRecorder = state;
    const abort = new AbortController();
    state.stop = () => {
      abort.abort();
    };

    /** The chart before a stretch of the renderer's work. */
    interface Look {
      readonly left: number;
      readonly edge: number;
      readonly start: number;
      readonly end: number;
      readonly request: number | undefined;
    }
    const look = (): Look => {
      const { timeline, scrollRequest } = handle.core.getSnapshot();
      const left = scroller.scrollLeft;
      return {
        left,
        edge: timeline.scale.xToDate(left),
        start: timeline.range.start,
        end: timeline.range.end,
        request: scrollRequest?.id,
      };
    };
    // What the renderer's work since `since` did to the chart (`ignoreJump`: it performed a
    // request, which moves the edge on purpose).
    const handled = (since: Look, ignoreJump: boolean): Handling => {
      const { timeline, contentWidth } = handle.core.getSnapshot();
      const left = scroller.scrollLeft;
      // The finest header row's cell with the sticky label is the one under the left edge.
      const rows = [...root.querySelectorAll<HTMLElement>('.gantt__header-row')];
      const cell = rows
        .at(-1)
        ?.querySelector<HTMLElement>('.gantt__header-label[data-sticky]')
        ?.closest<HTMLElement>('.gantt__header-cell');
      const x = Number.parseFloat(cell?.style.left ?? 'NaN');
      const width = Number.parseFloat(cell?.style.width ?? 'NaN');
      return {
        jump: ignoreJump
          ? 0
          : ((timeline.scale.xToDate(left) - since.edge) / dayMs) * timeline.scale.pxPerDay,
        startMoved: timeline.range.start !== since.start,
        endMoved: timeline.range.end !== since.end,
        compensated: left !== since.left,
        headerAtEdge: x <= left + 0.5 && left < x + width + 0.5,
        widthInSync:
          root.style.getPropertyValue('--gantt-content-width') === `${String(contentWidth)}px`,
      };
    };

    let before: Look | undefined;
    document.addEventListener(
      'scroll',
      (event) => {
        if (event.target !== scroller) return;
        before = look();
      },
      { capture: true, signal: abort.signal },
    );
    scroller.addEventListener(
      'scroll',
      () => {
        if (!before) return;
        state.events.push(handled(before, false));
        before = undefined;
      },
      { signal: abort.signal },
    );
    // What a frame painted: the page calls `beforeFrame` and `onFrame` around the renderer's frame
    // callbacks (not a timer after the frame, which can read the next frame's scroll position
    // next to this frame's snapshot), so the snapshot, the DOM and `scrollLeft` are those of one
    // picture, and what the callbacks did can be told from what they found.
    let beforeFrame: Look | undefined;
    // The request the snapshot had when the last frame ended: one the next frame finds that is
    // another is the one that frame performs.
    let seenRequest = handle.core.getSnapshot().scrollRequest?.id;
    handle.beforeFrame = (): void => {
      beforeFrame = look();
    };
    handle.onFrame = (): void => {
      const { timeline, scrollRequest } = handle.core.getSnapshot();
      const left = scroller.scrollLeft;
      const finest = [...root.querySelectorAll('.gantt__header-row')].at(-1);
      const cells = [...(finest?.querySelectorAll<HTMLElement>('.gantt__header-cell') ?? [])];
      let first = Number.POSITIVE_INFINITY;
      let last = Number.NEGATIVE_INFINITY;
      for (const cell of cells) {
        const x = Number.parseFloat(cell.style.left);
        first = Math.min(first, x);
        last = Math.max(last, x + Number.parseFloat(cell.style.width));
      }
      const since = beforeFrame ?? look();
      beforeFrame = undefined;
      const performed = since.request !== seenRequest;
      seenRequest = scrollRequest?.id;
      state.frames.push({
        ...handled(since, performed),
        edge: timeline.scale.xToDate(left),
        pxPerDay: timeline.scale.pxPerDay,
        left,
        nodes: root.getElementsByTagName('*').length,
        bars: root.querySelectorAll('.gantt__bar').length,
        covered: first <= left + 1 && last >= left + scroller.clientWidth - 1,
      });
    };
    abort.signal.addEventListener('abort', () => {
      handle.beforeFrame = undefined;
      handle.onFrame = undefined;
    });
  });
}

/** Stops the recording and returns it. */
export async function stopRecording(page: Page): Promise<Recording> {
  const { events, frames } = await page.evaluate(() => {
    const state = (window as unknown as { __ganttRecorder?: RecorderState }).__ganttRecorder;
    if (!state) throw new Error('no recording was started');
    state.stop();
    return { events: state.events, frames: state.frames };
  });
  return {
    events,
    frames,
    maxNodes: Math.max(0, ...frames.map((frame) => frame.nodes)),
    maxBars: Math.max(0, ...frames.map((frame) => frame.bars)),
  };
}

/**
 * How many times so far the range start / end moved, in a scroll event or in a frame (the
 * renderer extends and trims in whichever sees the scroller's new position first), read while a
 * recording runs.
 */
export async function countMoves(page: Page): Promise<{ startMoves: number; endMoves: number }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __ganttRecorder?: RecorderState }).__ganttRecorder;
    if (!state) throw new Error('no recording was started');
    const handlings = [...state.events, ...state.frames];
    return {
      startMoves: handlings.filter((handling) => handling.startMoved).length,
      endMoves: handlings.filter((handling) => handling.endMoved).length,
    };
  });
}

/** What the renderer did in every scroll event and every frame of a recording. */
export const handlings = (recording: Recording): readonly Handling[] => [
  ...recording.events,
  ...recording.frames,
];

/** How many times the range start moved (an extension or a trim of that side) and the end. */
export const startMoves = (recording: Recording): number =>
  handlings(recording).filter((handling) => handling.startMoved).length;
export const endMoves = (recording: Recording): number =>
  handlings(recording).filter((handling) => handling.endMoved).length;

/**
 * The most the date at the left edge moved across the renderer's work in any event or frame, in
 * px (a frame that performed a request does not count: the request moves it).
 */
export const worstJump = (recording: Recording): number =>
  Math.max(0, ...handlings(recording).map((handling) => Math.abs(handling.jump)));

/** A box in viewport coordinates. */
export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Where the chart's parts are on the page now, in viewport coordinates, read in one task. */
export interface PageLayout {
  readonly scrollY: number;
  readonly scrollX: number;
  readonly innerHeight: number;
  /** Whether the page itself scrolls sideways (it should not: the scroller does). */
  readonly pageScrollsSideways: boolean;
  readonly root: Box;
  readonly scroller: Box;
  /** Client height of the scroller (what its content can show, without a scrollbar). */
  readonly scrollerClientHeight: number;
  readonly scrollerScrollLeft: number;
  readonly scrollerScrollTop: number;
  readonly header: Box;
  /** The body (the SVG of the rows): the header's labels are over the bars when both start at the same x. */
  readonly body: Box;
  /** The header pin and its scroll offset, `undefined` while the header is in the scroller. */
  readonly pin: Box | undefined;
  readonly pinScrollLeft: number | undefined;
  /** Whether the header's parent is the pin, the scroller, or something else. */
  readonly headerIn: 'pin' | 'scroller' | 'other';
}

/** Reads {@link PageLayout}. */
export async function pageLayout(page: Page): Promise<PageLayout> {
  return page.evaluate((): PageLayout => {
    const box = (element: Element): Box => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const find = (selector: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`no ${selector}`);
      return element;
    };
    const scroller = find('#chart .gantt__scroller');
    const header = find('#chart .gantt__header');
    const body = find('#chart .gantt__body');
    const pin = document.querySelector<HTMLElement>('#chart .gantt__pin');
    const parent = header.parentElement;
    const doc = document.documentElement;
    return {
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      innerHeight: window.innerHeight,
      pageScrollsSideways: doc.scrollWidth > doc.clientWidth,
      root: box(find('#chart .gantt')),
      scroller: box(scroller),
      scrollerClientHeight: scroller.clientHeight,
      scrollerScrollLeft: scroller.scrollLeft,
      scrollerScrollTop: scroller.scrollTop,
      header: box(header),
      body: box(body),
      pin: pin ? box(pin) : undefined,
      pinScrollLeft: pin?.scrollLeft,
      headerIn: parent === pin ? 'pin' : parent === scroller ? 'scroller' : 'other',
    };
  });
}

/** The box of a task's bar in the viewport, `undefined` when the bar is not drawn. */
export async function barBox(page: Page, id: string | number): Promise<Box | undefined> {
  return page.evaluate((taskId): Box | undefined => {
    const bar = [...document.querySelectorAll('#chart .gantt__bar')].find(
      (element) => element.getAttribute('data-task-id') === String(taskId),
    );
    const track = bar?.querySelector('.gantt__bar-track') ?? bar;
    if (!track) return undefined;
    const { top, bottom, left, right } = track.getBoundingClientRect();
    return { top, bottom, left, right };
  }, id);
}

/** What the height spec calls on the page's handle. */
interface CoreHandle {
  readonly taskIds: readonly (string | number)[];
  readonly core: {
    getRowMetrics(id: string | number): unknown;
    getBarRect(id: string | number): unknown;
    scrollToTask(id: string | number, options?: object): unknown;
    scrollToToday(options?: object): unknown;
    scrollToDate(date: string, options?: object): unknown;
  };
}

/** The last task that has a row and a bar: as far below as the plan goes. */
export async function farTask(page: Page): Promise<string | number> {
  return taskAt(page, 1);
}

/**
 * The task at `fraction` of the way down the tasks that have a row and a bar (0 the first, 1 the
 * last). The last rows cannot be scrolled to the top of the chart (the content ends), so a test
 * that aims a row at the top needs one with rows below it.
 */
export async function taskAt(page: Page, fraction: number): Promise<string | number> {
  return page.evaluate((at): string | number => {
    const handle = (window as unknown as { __ganttScroll?: CoreHandle }).__ganttScroll;
    if (!handle) throw new Error('the scrolling page is not ready');
    const drawn = handle.taskIds.filter(
      (id) =>
        handle.core.getRowMetrics(id) !== undefined && handle.core.getBarRect(id) !== undefined,
    );
    const found = drawn[Math.min(drawn.length - 1, Math.floor(drawn.length * at))];
    if (found === undefined) throw new Error('no task with a bar');
    return found;
  }, fraction);
}

/** A call of the core's scrolling API, made on the page. */
export type ScrollCall =
  | { readonly method: 'scrollToTask'; readonly id: string | number; readonly options?: object }
  | { readonly method: 'scrollToToday'; readonly options?: object }
  | { readonly method: 'scrollToDate'; readonly date: string; readonly options?: object };

/** Calls `core.scrollToTask` / `scrollToToday` / `scrollToDate` on the page. */
export async function scrollCall(page: Page, call: ScrollCall): Promise<void> {
  await page.evaluate((input) => {
    const handle = (window as unknown as { __ganttScroll?: CoreHandle }).__ganttScroll;
    if (!handle) throw new Error('the scrolling page is not ready');
    if (input.method === 'scrollToTask') handle.core.scrollToTask(input.id, input.options);
    else if (input.method === 'scrollToToday') handle.core.scrollToToday(input.options);
    else handle.core.scrollToDate(input.date, input.options);
  }, call);
}

/** A point in the page's viewport, in CSS px. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Pans with one finger through the Chromium DevTools protocol (`Input.dispatchTouchEvent`):
 * touch down on `from`, drag by `by` in steps of 16 ms, lift. The browser turns it into a pan
 * as it does a real one (`pointercancel` when it takes the touch for itself, scroll events,
 * `touch-action` honoured). Chromium only: Playwright has no touch pan for Firefox and WebKit.
 *
 * With `fling` the finger lifts while it is still moving at `speed`, and the browser carries on
 * scrolling (momentum); without it the finger rests for a moment before it lifts, so that
 * nothing is left over. The events carry their own timestamps, so the speed is the one asked
 * for however busy the machine is.
 *
 * It is not `Input.synthesizeScrollGesture`, which would do the same in one call: with
 * `gestureSourceType: 'touch'` that gesture scrolls nothing on Linux, headless or not (the page
 * gets `pointermove` events for the finger but never a `touchmove`, and the browser never takes
 * the touch for a pan), while `Input.dispatchTouchEvent` works on every platform.
 *
 * @param cdp - A DevTools session of the page (`page.context().newCDPSession(page)`).
 * @param from - Where the finger lands.
 * @param by - How far it moves, the content following it: negative `dx` scrolls towards the end.
 * @param options - `speed` in px per second (default 1500), `fling` (default `false`).
 */
export async function touchPan(
  cdp: CDPSession,
  from: Point,
  by: { readonly dx?: number; readonly dy?: number },
  options: { readonly speed?: number; readonly fling?: boolean } = {},
): Promise<void> {
  const { dx = 0, dy = 0 } = by;
  const { speed = 1500, fling = false } = options;
  const interval = 16;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / ((speed * interval) / 1000)));
  const start = Date.now() / 1000;
  const send = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: readonly Point[],
    ms: number,
  ): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...touchPoints],
      timestamp: start + ms / 1000,
    });
  };
  await send('touchStart', [from], 0);
  for (let step = 1; step <= steps; step += 1) {
    await send(
      'touchMove',
      [{ x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps }],
      step * interval,
    );
  }
  await send('touchEnd', [], steps * interval + (fling ? 0 : 150));
}

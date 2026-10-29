import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  DAY_MS,
  expectDateAt,
  openScrollPage,
  sample,
  settle,
  startRecording,
  stopRecording,
  trackErrors,
} from './scroll-support';

/**
 * E2E of the review of plan step 4.9 (FR-SCROLL-2, FR-TL-2, FR-TL-6), in Chromium, Firefox and
 * WebKit: a scroll request made while the browser is in the middle of a smooth scroll (or a
 * momentum scroll) of the same chart. The browser goes on firing `scroll` events in the old
 * picture's coordinates until the frame that performs the request has run; reporting one of them
 * to the core used to undo the request: the header showed 0 to 18 of 34 cells for a frame, and
 * near the start edge a second extension left the view 640 px off for good.
 *
 * The request is made from a task between two frames, so that the next frame's scroll event comes
 * before the frame that performs it, which is the order that matters. Every frame the renderer
 * ran in is sampled (see `startRecording`), and none may show a hole in the header.
 */

/** The chart: a fortnight (560 px) per extension, within 400 px of an edge, from 2026-03-09. */
const QUERY = 'extendBy=2w&threshold=400&initial=2026-03-09&align=0';

/** What the application asks for while a smooth scroll is under way. */
type Interruption =
  | {
      readonly kind: 'scrollToDate';
      readonly date: string;
      readonly behavior: 'smooth' | 'instant';
    }
  | { readonly kind: 'setViewMode'; readonly id: string }
  | { readonly kind: 'zoomTo'; readonly pxPerDay: number };

/** The date at a viewport x of the core's picture when the request was made. */
interface Before {
  /** Where the smooth scroll was, and where it was going. */
  readonly scrollLeft: number;
  readonly from: number;
  readonly to: number;
  /** The dates at viewport x = 400 and at the middle of the viewport. */
  readonly at400: number;
  readonly middle: number;
}

/** The part of the page's handle this spec calls. */
interface Handle {
  readonly core: {
    getSnapshot(): {
      readonly timeline: {
        readonly scrollLeft: number;
        readonly viewportWidth: number;
        readonly scale: { xToDate(x: number): number };
      };
    };
    scrollToDate(date: string, options: object): unknown;
    setViewMode(id: string): unknown;
    zoomTo(pxPerDay: number, options: object): unknown;
  };
}

/**
 * Starts a smooth scroll of months, waits until it is under way (the scroller has moved 300 px
 * and has thousands to go), then makes `interruption` from a task between frames.
 */
async function interruptSmoothScroll(page: Page, interruption: Interruption): Promise<Before> {
  return page.evaluate(async (what): Promise<Before> => {
    const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
    const handle = (window as unknown as { __ganttScroll?: Handle }).__ganttScroll;
    if (!scroller || !handle) throw new Error('the scrolling page is not ready');
    const { core } = handle;
    const from = scroller.scrollLeft;
    core.scrollToDate('2026-10-05', { behavior: 'smooth', align: 0 });
    await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const look = (): void => {
        if (Math.abs(scroller.scrollLeft - from) > 300) resolve();
        else if (performance.now() - start > 5000) reject(new Error('no smooth scroll under way'));
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    // A task after the frame: the next frame's scroll event comes before its render.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const { timeline } = core.getSnapshot();
    const before: Before = {
      scrollLeft: scroller.scrollLeft,
      from,
      to: Number.NaN,
      at400: timeline.scale.xToDate(timeline.scrollLeft + 400),
      middle: timeline.scale.xToDate(timeline.scrollLeft + timeline.viewportWidth / 2),
    };
    if (what.kind === 'scrollToDate') {
      core.scrollToDate(what.date, { behavior: what.behavior, align: 0 });
    } else if (what.kind === 'setViewMode') core.setViewMode(what.id);
    else core.zoomTo(what.pxPerDay, { anchor: 400 });
    return before;
  }, interruption);
}

test.describe('a request during a smooth scroll (FR-SCROLL-2, FR-TL-2, FR-TL-6)', () => {
  const dates = [
    // Months before the plan: the range grows at its start, so every coordinate moves.
    ['2025-06-02', 'smooth'],
    ['2025-06-02', 'instant'],
    ['2027-02-01', 'smooth'],
    ['2026-04-06', 'instant'],
  ] as const;
  for (const [date, behavior] of dates) {
    test(`FR-SCROLL-2, FR-TL-6: scrollToDate ${date} (${behavior}) lands on its date and never leaves a hole in the header`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openScrollPage(page, QUERY);
      await startRecording(page);

      const before = await interruptSmoothScroll(page, { kind: 'scrollToDate', date, behavior });
      expect(Math.abs(before.scrollLeft - before.from)).toBeGreaterThan(300);
      await expectDateAt(page, date);
      await settle(page, 8);

      const recording = await stopRecording(page);
      const reading = await sample(page);
      const target = Date.parse(`${date}T00:00:00Z`);
      expect(Math.abs(((reading.edge - target) / DAY_MS) * reading.pxPerDay)).toBeLessThanOrEqual(
        1,
      );
      expect(recording.frames.length).toBeGreaterThan(0);
      expect(recording.frames.filter((frame) => !frame.covered)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('FR-SCALE-3, FR-SCROLL-2: a view mode switch keeps the centre date, whatever the scroll in flight was doing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    await startRecording(page);

    const before = await interruptSmoothScroll(page, { kind: 'setViewMode', id: 'week' });
    await settle(page, 8);

    const recording = await stopRecording(page);
    const reading = await sample(page);
    // The picture the core had when the switch was made is the one that stays (a week is 20 px
    // wide, so a pixel is a third of a day).
    const centre = reading.edge + ((reading.viewportWidth / 2) * DAY_MS) / reading.pxPerDay;
    expect(Math.abs(((centre - before.middle) / DAY_MS) * reading.pxPerDay)).toBeLessThanOrEqual(2);
    expect(recording.frames.filter((frame) => !frame.covered)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-SCALE-6, FR-SCROLL-2: zoomTo keeps the date under its anchor, whatever the scroll in flight was doing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    await startRecording(page);

    const before = await interruptSmoothScroll(page, { kind: 'zoomTo', pxPerDay: 80 });
    await settle(page, 8);

    const recording = await stopRecording(page);
    const reading = await sample(page);
    const anchored = reading.edge + (400 * DAY_MS) / reading.pxPerDay;
    expect(reading.pxPerDay).toBe(80);
    expect(Math.abs(((anchored - before.at400) / DAY_MS) * reading.pxPerDay)).toBeLessThanOrEqual(
      2,
    );
    expect(recording.frames.filter((frame) => !frame.covered)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

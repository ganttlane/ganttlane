import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  boxOf,
  centre,
  changeOf,
  changesOf,
  committed,
  DAY,
  MINUTE,
  openEdit,
  press,
  root,
  scroller,
  settled,
  track,
  trackErrors,
} from './edit-harness';

/**
 * E2E of plan step 4.7 (FR-EDIT-6, FR-TL-5): dragging a bar to the edge of the viewport scrolls
 * the chart, an infinite timeline grows as the drag goes on, and through all of it the bar stays
 * under the pointer and the date at the left edge never jumps; in Chromium, Firefox and WebKit.
 *
 * A sampler in the page records the chart on every animation frame while the pointer is held
 * still at the edge, which is the only way to see a bar one frame behind the scroll.
 */

/** The hour mode draws 960 px a day and a minute is 0.67 px: a bar can be placed within 1 px. */
const CHART = {
  tasks: [{ id: 't', name: 'Timed', start: '2026-03-02T09:00', end: '2026-03-02T12:00' }],
  viewMode: 'hour',
  calendar: { weekends: [] },
  scheduling: { granularity: '1min', snap: '1min' },
  timeline: { infinite: true },
  scroll: { initial: 'first-task' },
  today: '2026-03-02',
  width: 1000,
} as const;
const PX_PER_MS = 960 / DAY;

/** One animation frame of the chart. */
interface Sample {
  readonly scrollLeft: number;
  readonly coreLeft: number;
  /** The date under the left edge of the viewport, per the core. */
  readonly leftEdge: number;
  readonly barLeft: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/** Starts recording a `Sample` on every frame (until `stopSampling`). */
const startSampling = (page: Page): Promise<void> =>
  page.evaluate(() => {
    interface Core {
      getSnapshot(): {
        timeline: {
          scrollLeft: number;
          range: { start: number; end: number };
          scale: { xToDate(x: number): number };
        };
      };
    }
    const hook = (window as unknown as { __ganttEdit: { core: Core } }).__ganttEdit;
    const surface = document.querySelector<HTMLElement>('#gantt .gantt__scroller')!;
    const samples: Sample[] = [];
    const target = window as unknown as { __samples: Sample[]; __sampling: boolean };
    target.__samples = samples;
    target.__sampling = true;
    const tick = (): void => {
      const { timeline } = hook.core.getSnapshot();
      const bar = document.querySelector('#gantt .gantt__bar[data-task-id="t"] .gantt__bar-track');
      samples.push({
        scrollLeft: surface.scrollLeft,
        coreLeft: timeline.scrollLeft,
        leftEdge: timeline.scale.xToDate(timeline.scrollLeft),
        barLeft: bar?.getBoundingClientRect().left ?? Number.NaN,
        rangeStart: timeline.range.start,
        rangeEnd: timeline.range.end,
      });
      if (target.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Stops recording and returns the samples. */
const stopSampling = (page: Page): Promise<Sample[]> =>
  page.evaluate(() => {
    const target = window as unknown as { __samples: Sample[]; __sampling: boolean };
    target.__sampling = false;
    return target.__samples;
  });

/** What the core says about the timeline right now. */
const timelineOf = (
  page: Page,
): Promise<{ scrollLeft: number; rangeStart: number; rangeEnd: number; leftEdge: number }> =>
  page.evaluate(() => {
    const hook = (
      window as unknown as {
        __ganttEdit: {
          core: {
            getSnapshot(): {
              timeline: {
                scrollLeft: number;
                range: { start: number; end: number };
                scale: { xToDate(x: number): number };
              };
            };
          };
        };
      }
    ).__ganttEdit;
    const { timeline } = hook.core.getSnapshot();
    return {
      scrollLeft: timeline.scrollLeft,
      rangeStart: timeline.range.start,
      rangeEnd: timeline.range.end,
      leftEdge: timeline.scale.xToDate(timeline.scrollLeft),
    };
  });

/** Waits until the core reports no autoscroll, then a couple of frames more. */
async function idle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const hook = (
          window as unknown as {
            __ganttEdit: { core: { getSnapshot(): { autoScroll: number } } };
          }
        ).__ganttEdit;
        return hook.core.getSnapshot().autoScroll;
      }),
    )
    .toBe(0);
  await settled(page);
}

/**
 * The drag of a bar to an edge of the viewport and, once the timeline has grown there, back to
 * the middle and a release: the frame-by-frame checks and the final date.
 */
async function dragToEdge(page: Page, edge: 'right' | 'left'): Promise<void> {
  const errors = trackErrors(page);
  await openEdit(page, CHART);
  const view = await boxOf(scroller(page));
  const bar = await boxOf(track(page, 't'));
  const from = centre(bar);
  const grab = from.x - bar.x;
  const start = await timelineOf(page);
  const parked = edge === 'right' ? view.x + view.width - 12 : view.x + 12;
  const middle = Math.round(view.x + view.width / 2);

  // Down on the bar, and to the edge: the pointer stays there, and the chart scrolls under it.
  await press(page, from, { x: parked, y: from.y }, 20);
  await expect(root(page)).toHaveAttribute('data-cursor', 'grabbing');
  await startSampling(page);
  await expect
    .poll(
      async () => {
        const now = await timelineOf(page);
        return edge === 'right' ? now.rangeEnd > start.rangeEnd : now.rangeStart < start.rangeStart;
      },
      { timeout: 25_000 },
    )
    .toBe(true);
  // A little longer: more frames, past the extension.
  await page.waitForTimeout(300);
  const samples = await stopSampling(page);

  // The range grew where the pointer was, and the chart really scrolled to get there.
  const grown = await timelineOf(page);
  if (edge === 'right') expect(grown.rangeEnd).toBeGreaterThan(start.rangeEnd);
  else expect(grown.rangeStart).toBeLessThan(start.rangeStart);
  expect(samples.length).toBeGreaterThan(20);

  // (1) The bar stays under the pointer in every frame, extension included: its distance from
  //     the pointer is what it was at the press, to the pixel.
  const usable = samples.slice(3);
  const offsets = usable.map((sample) => sample.barLeft - (parked - grab));
  expect(offsets.filter((offset) => Math.abs(offset) > 1)).toEqual([]);

  // (2) The date under the left edge never jumps: it moves by what the scroll moved, a few
  //     frames' worth at most, and only the way the autoscroll goes.
  const frame = 20 / PX_PER_MS; // the autoscroll's fastest step, in ms
  const direction = edge === 'right' ? 1 : -1;
  for (let i = 1; i < samples.length; i++) {
    const step = (samples[i]!.leftEdge - samples[i - 1]!.leftEdge) * direction;
    expect(step, `frame ${String(i)}`).toBeGreaterThanOrEqual(0);
    expect(step, `frame ${String(i)}`).toBeLessThanOrEqual(8 * frame);
  }
  // The DOM and the core agree on where the scroller is, in every frame.
  expect(usable.filter((sample) => Math.abs(sample.scrollLeft - sample.coreLeft) > 1)).toEqual([]);

  // (3) Back to the middle, wait for the scroll to end, release: the bar is where the pointer
  //     is in time, however far the chart scrolled and grew in between.
  await page.mouse.move(middle, from.y, { steps: 10 });
  await idle(page);
  const before = await timelineOf(page);
  await page.mouse.up();
  const changeSet = await committed(page);
  const change = changeOf(changeSet, 't');
  const scrolled = before.leftEdge - start.leftEdge;
  const travelled = (middle - from.x) / PX_PER_MS;
  expect(
    Math.abs(change.after.start - change.before.start - (scrolled + travelled)),
  ).toBeLessThanOrEqual(MINUTE);
  expect(change.after.endExclusive - change.after.start).toBe(
    change.before.endExclusive - change.before.start,
  );
  // The drag went a long way in time, for a long way it scrolled.
  expect(Math.abs(change.after.start - change.before.start)).toBeGreaterThan(DAY / 2);

  // (4) The release ended it all: no autoscroll, no cursor, nothing moves any more.
  await expect(root(page)).not.toHaveAttribute('data-cursor');
  const rest = await timelineOf(page);
  await page.waitForTimeout(200);
  expect((await timelineOf(page)).scrollLeft).toBe(rest.scrollLeft);
  expect(errors).toEqual([]);
}

test.describe('drag to the edge of an infinite timeline (FR-EDIT-6, FR-TL-5)', () => {
  test('FR-TL-5: to the right edge: scrolls and extends, the bar stays under the pointer, no jump', async ({
    page,
  }) => {
    await dragToEdge(page, 'right');
  });

  test('FR-TL-5: to the left edge: the start is extended and compensated, the date under the left edge does not jump', async ({
    page,
  }) => {
    await dragToEdge(page, 'left');
  });

  test('FR-EDIT-1: releasing past the edge, outside the chart, still commits and ends the autoscroll', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, CHART);
    const view = await boxOf(scroller(page));
    const from = centre(await boxOf(track(page, 't')));
    const start = await timelineOf(page);

    await press(page, from, { x: view.x + view.width - 12, y: from.y }, 20);
    await expect
      .poll(async () => (await timelineOf(page)).scrollLeft, { timeout: 10_000 })
      .toBeGreaterThan(start.scrollLeft + 200);
    // Out of the chart on the right and below it: capture keeps the gesture alive and the
    // pointer past the edge still means "scroll right".
    const outside = {
      x: Math.min(view.x + view.width + 100, (page.viewportSize()?.width ?? 1280) - 4),
      y: Math.min(view.y + view.height + 100, (page.viewportSize()?.height ?? 720) - 4),
    };
    await page.mouse.move(outside.x, outside.y, { steps: 6 });
    await page.mouse.up();

    const change = changeOf(await committed(page), 't');
    expect(change.after.start - change.before.start).toBeGreaterThan(DAY / 4);
    await idle(page);
    const rest = await timelineOf(page);
    await page.waitForTimeout(200);
    expect((await timelineOf(page)).scrollLeft).toBe(rest.scrollLeft);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-4: Escape while autoscrolling restores the bar and stops the scroll', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, CHART);
    const view = await boxOf(scroller(page));
    const from = centre(await boxOf(track(page, 't')));
    const start = await timelineOf(page);

    await press(page, from, { x: view.x + view.width - 12, y: from.y }, 20);
    await expect
      .poll(async () => (await timelineOf(page)).scrollLeft, { timeout: 10_000 })
      .toBeGreaterThan(start.scrollLeft + 100);
    await page.keyboard.press('Escape');
    await idle(page);
    const rest = await timelineOf(page);
    await page.waitForTimeout(200);

    expect((await timelineOf(page)).scrollLeft).toBe(rest.scrollLeft);
    await page.mouse.up();
    await settled(page);
    expect(await changesOf(page)).toEqual([]);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-6: scroll.autoScroll false turns the edge autoscroll off', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, { ...CHART, scroll: { initial: 'first-task', autoScroll: false } });
    const view = await boxOf(scroller(page));
    const from = centre(await boxOf(track(page, 't')));
    const start = await timelineOf(page);

    await press(page, from, { x: view.x + view.width - 12, y: from.y }, 20);
    await page.waitForTimeout(400);

    expect((await timelineOf(page)).scrollLeft).toBe(start.scrollLeft);
    await page.mouse.up();
    await committed(page);
    expect(errors).toEqual([]);
  });
});

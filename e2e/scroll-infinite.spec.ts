import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { Recording, Sample } from './scroll-support';
import {
  countMoves,
  DAY_MS,
  edgeMovement,
  expectDateAt,
  openScrollPage,
  sample,
  settle,
  startRecording,
  stopRecording,
  trackErrors,
  worstJump,
} from './scroll-support';

/**
 * E2E of plan step 4.6 (FR-TL-2 … FR-TL-6, FR-TL-8): the infinite timeline in the DOM, driven by
 * every source of scrolling, in Chromium, Firefox and WebKit. The page (`/scroll/`) is a chart
 * over a generated plan whose range grows by a fortnight (560 px) whenever the viewport comes
 * within 400 px of an edge, so a few thousand pixels of scrolling extend it several times at each
 * side.
 *
 * After each source the same things are asserted (`expectStable`):
 *
 * - **no jump.** For every `scroll` event, the date at the left edge moved by at most 1 px across
 *   the renderer's handling, which is where the range changes and `scrollLeft` is compensated
 *   (FR-TL-3); the header row drawn in that same task agrees with the new `scrollLeft`, and so
 *   does the content width (one render before paint);
 * - **bounded DOM.** The number of bar nodes and of all nodes stays within the window's, however
 *   far the chart has been scrolled;
 * - **no errors** on the page.
 *
 * Touch needs a real pan gesture, which Playwright can only synthesize through the Chromium
 * DevTools protocol (`Input.synthesizeScrollGesture`); Firefox and WebKit skip that test.
 */

/** The chart: a fortnight (560 px) per extension, within 400 px of an edge, from 2026-03-09. */
const QUERY = 'extendBy=2w&threshold=400&initial=2026-03-09';

/** The scroller's centre in the page, and the mouse parked on it (wheel events go where it is). */
async function parkMouse(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#chart .gantt__scroller').boundingBox();
  if (!box) throw new Error('the scroller has no box');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  return centre;
}

/** Waits for `count` animation frames. */
async function frames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }, count);
}

/** The assertions every source has to satisfy. */
function expectStable(recording: Recording, first: Sample, label = 'run', scrolled = true): void {
  // A scroll to a date outside the range may move nothing but the range (same offset, new origin).
  if (scrolled) expect(recording.events.length, label).toBeGreaterThan(0);
  // FR-TL-3: no jump across any event's handling, whatever the source scrolled.
  expect(worstJump(recording)).toBeLessThanOrEqual(1);
  // FR-TL-5: the content was resized in the event, and a compensated one also redrew the layers
  // (a header whose sticky cell is the one under the new `scrollLeft`) before the task ended.
  expect(recording.events.filter((event) => !event.widthInSync)).toEqual([]);
  expect(recording.events.filter((event) => event.compensated && !event.headerAtEdge)).toEqual([]);
  // A range that grew at its start was compensated by a write to scrollLeft.
  expect(recording.events.filter((event) => event.startMoved && !event.compensated)).toEqual([]);
  // FR-TL-4: the DOM is bounded by the window, not by the length of the timeline.
  expect(recording.maxBars).toBeLessThanOrEqual(30);
  expect(recording.maxNodes).toBeLessThanOrEqual(first.nodes * 1.5 + 50);
}

/** How many events moved the start (an extension or a trim of that side) and the end. */
const startMoves = (recording: Recording): number =>
  recording.events.filter((event) => event.startMoved).length;
const endMoves = (recording: Recording): number =>
  recording.events.filter((event) => event.endMoved).length;

/** Keeps nothing but the page's own console noise out of the way: errors are what matters. */
test.describe('infinite timeline in the DOM (FR-TL-8)', () => {
  test('FR-TL-2, FR-TL-3: the wheel extends both edges without a jump', async ({ page }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    await parkMouse(page);
    const first = await sample(page);
    await startRecording(page);

    // Towards the start: far more than one extension (a month is 1200 px at this zoom).
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.wheel(-600, 0);
      await frames(page);
    }
    // And back, past where it began, to the end.
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.wheel(1000, 0);
      await frames(page);
    }
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('FR-TL-2: dragging the scrollbar thumb (absolute positions, big steps) extends both edges', async ({
    page,
  }) => {
    // A native scrollbar cannot be grabbed in headless browsers (they hide it), so the thumb
    // drag is what it makes the page see: one scroll event per frame with a large step, each
    // written as an absolute position, with nothing like a wheel's momentum in between.
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    const first = await sample(page);
    await startRecording(page);

    await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
      if (!scroller) throw new Error('no scroller');
      const frame = async (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      // The thumb goes to the start in 900 px steps, then to the end in 1500 px steps.
      for (let i = 0; i < 16; i += 1) {
        scroller.scrollLeft = Math.max(scroller.scrollLeft - 900, 0);
        await frame();
        await frame();
      }
      for (let i = 0; i < 30; i += 1) {
        scroller.scrollLeft += 1500;
        await frame();
        await frame();
      }
    });
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('FR-TL-2: the arrow keys on the focused scroller extend both edges', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      "Playwright's WebKit does not scroll a focused element with the arrow keys, not even a plain <div tabindex=0 style=overflow:auto> (PageDown and End work, see the next test)",
    );
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    const scroller = page.locator('#chart .gantt__scroller');
    // The scroller is a focusable region (tabindex 0, labelled): it takes keyboard focus.
    await scroller.focus();
    await expect(scroller).toBeFocused();
    const first = await sample(page);
    await startRecording(page);

    // The browser scrolls its own step (about 40 px, smoothly) per press: press at a typist's
    // pace, in batches, until each side has been extended three times.
    const pressUntil = async (key: string, moves: 'startMoves' | 'endMoves'): Promise<void> => {
      for (let batch = 0; batch < 100; batch += 1) {
        for (let i = 0; i < 10; i += 1) {
          await page.keyboard.press(key);
          await page.waitForTimeout(12);
        }
        if ((await countMoves(page))[moves] >= 3) return;
      }
    };
    await pressUntil('ArrowLeft', 'startMoves');
    await settle(page);
    const afterLeft = await sample(page);
    await pressUntil('ArrowRight', 'endMoves');
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(edgeMovement(first, afterLeft)).toBeLessThan(-500);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('FR-TL-2: PageDown, End and Home on the focused scroller scroll the rows and leave the time axis alone', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    await page.locator('#chart .gantt__scroller').focus();
    const first = await sample(page);
    await startRecording(page);

    await page.keyboard.press('PageDown');
    await settle(page);
    const paged = await sample(page);
    await page.keyboard.press('End');
    await settle(page);
    const end = await sample(page);
    await page.keyboard.press('Home');
    await settle(page);
    const home = await sample(page);

    const recording = await stopRecording(page);
    expect(paged.scrollTop).toBeGreaterThan(0);
    expect(end.scrollTop).toBeGreaterThan(paged.scrollTop);
    expect(home.scrollTop).toBe(0);
    for (const reading of [paged, end, home]) {
      expect(Math.abs(edgeMovement(first, reading))).toBeLessThanOrEqual(1);
    }
    expectStable(recording, first);
    expect(errors).toEqual([]);
  });

  test('FR-TL-2: touch swipes (and a fling) extend both edges', async ({ page, browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright can only synthesize native touch pans through the Chromium DevTools protocol',
    );
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    const centre = await parkMouse(page);
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (xDistance: number, preventFling: boolean): Promise<void> => {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: centre.x,
        y: centre.y,
        xDistance,
        gestureSourceType: 'touch',
        speed: 6000,
        preventFling,
      });
    };
    const first = await sample(page);
    await startRecording(page);

    // A positive distance drags the content to the right: towards the start.
    for (let i = 0; i < 6; i += 1) await swipe(1000, true);
    await swipe(900, false);
    await settle(page);
    for (let i = 0; i < 14; i += 1) await swipe(-1000, true);
    await swipe(-1100, false);
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('FR-TL-6, FR-SCROLL-2: scrollToDate far outside the range extends it first, instantly or smoothly', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, QUERY);
    const first = await sample(page);

    // Years before and after the plan, instantly and smoothly, in both directions.
    const legs = [
      ['2023-05-17', 'instant'],
      ['2029-09-03', 'instant'],
      ['2022-02-09', 'smooth'],
      ['2030-11-21', 'smooth'],
      ['2026-03-09', 'smooth'],
    ] as const;
    for (const [date, behavior] of legs) {
      const before = await sample(page);
      await startRecording(page);
      await page.evaluate(
        ([target, how]) => {
          const handle = (
            window as unknown as {
              __ganttScroll?: {
                core: { scrollToDate(date: string, options: { behavior: string }): unknown };
              };
            }
          ).__ganttScroll;
          if (!handle || !target || !how) throw new Error('page not ready');
          handle.core.scrollToDate(target, { behavior: how });
        },
        [date, behavior],
      );
      // Polled: under load a browser may start a smooth scroll many frames late, and a chart that
      // is still for a few frames has not necessarily got there (it may not have left yet).
      await expectDateAt(page, date);
      await settle(page, 6);
      const recording = await stopRecording(page);
      const reading = await sample(page);

      const target = Date.parse(`${date}T00:00:00Z`);
      const label = `${behavior} to ${date}`;
      // The date lands at the left edge (align `start`), inside a range that was grown to hold it.
      const off = ((reading.edge - target) / DAY_MS) * reading.pxPerDay;
      expect(Math.abs(off), label).toBeLessThanOrEqual(1);
      expect(reading.rangeStart, label).toBeLessThanOrEqual(target);
      expect(reading.rangeEnd, label).toBeGreaterThan(target);
      expectStable(recording, first, label, false);
      // The date at the left edge goes one way, frame after frame: a smooth scroll starts where
      // the picture was and never jumps elsewhere or turns back.
      const direction = Math.sign(target - before.edge);
      const edges = recording.frames.map((frame) => (frame.edge / DAY_MS) * frame.pxPerDay);
      for (let i = 1; i < edges.length; i += 1) {
        const step = (edges[i] ?? 0) - (edges[i - 1] ?? 0);
        expect(step * direction, `${label}, frame ${String(i)}`).toBeGreaterThanOrEqual(-1);
      }
    }
    expect(errors).toEqual([]);
  });

  test('FR-TL-4: bounds stop the timeline, and the scroller can reach both ends', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, `${QUERY}&min=2026-01-01&max=2026-06-30`);
    await parkMouse(page);
    const first = await sample(page);
    await startRecording(page);

    for (let i = 0; i < 20; i += 1) {
      await page.mouse.wheel(-600, 0);
      await frames(page);
    }
    await settle(page);
    const atStart = await sample(page);
    for (let i = 0; i < 30; i += 1) {
      await page.mouse.wheel(600, 0);
      await frames(page);
    }
    await settle(page);
    const atEnd = await sample(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    // Never past the bounds (a date-only `max` includes its whole day), and the content stops
    // growing: the scroller is at its real ends.
    expect(atStart.rangeStart).toBeGreaterThanOrEqual(Date.UTC(2025, 11, 1));
    expect(atStart.scrollLeft).toBe(0);
    expect(atEnd.rangeEnd).toBeLessThanOrEqual(Date.UTC(2026, 6, 1) + 31 * DAY_MS);
    expect(atEnd.scrollLeft + atEnd.viewportWidth).toBeGreaterThanOrEqual(atEnd.contentWidth - 1);
    expect(errors).toEqual([]);
  });

  test('FR-TL-4: maxSpan trims the far side, so the content stays bounded while scrolling on', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, `${QUERY}&maxSpan=3mo`);
    await parkMouse(page);
    const first = await sample(page);
    await startRecording(page);

    for (let i = 0; i < 40; i += 1) {
      await page.mouse.wheel(-600, 0);
      await frames(page);
    }
    await settle(page);
    const left = await sample(page);
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.wheel(600, 0);
      await frames(page);
    }
    await settle(page);
    const right = await sample(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    // Both sides were trimmed at least once, and the span never got near what was scrolled.
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(3);
    for (const reading of [left, right]) {
      expect((reading.rangeEnd - reading.rangeStart) / DAY_MS).toBeLessThanOrEqual(200);
      expect(reading.contentWidth).toBeLessThanOrEqual(200 * reading.pxPerDay);
    }
    expect(errors).toEqual([]);
  });

  test('FR-TL-3: the bars in view keep their nodes while the range grows under them', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    // Opens on the plan's first bars, with the start edge 1500 px (the threshold) away.
    await openScrollPage(page, 'extendBy=2w&threshold=1500&initial=2026-03-02&align=0');
    const scroller = page.locator('#chart .gantt__scroller');
    // One pixel outside the threshold: nothing to extend yet; the bars of this view get a mark.
    await scroller.evaluate((element) => {
      element.scrollTo({ left: 1501, behavior: 'instant' });
    });
    await settle(page);
    const marked = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('#chart .gantt__bar')];
      for (const bar of bars) (bar as unknown as { __kept?: boolean }).__kept = true;
      return bars.length;
    });
    expect(marked).toBeGreaterThan(3);
    const before = await sample(page);
    await startRecording(page);

    // One more pixel to the start: the threshold is reached and the range grows under the bars.
    await scroller.evaluate((element) => {
      element.scrollTo({ left: 1500, behavior: 'instant' });
    });
    await settle(page);

    const recording = await stopRecording(page);
    const after = await sample(page);
    const kept = await page.evaluate(
      () =>
        [...document.querySelectorAll('#chart .gantt__bar')].filter(
          (bar) => (bar as unknown as { __kept?: boolean }).__kept === true,
        ).length,
    );
    expect(startMoves(recording)).toBeGreaterThanOrEqual(1);
    expect(after.rangeStart).toBeLessThan(before.rangeStart);
    // Not a single bar node was recreated: the extension moved them, it did not redraw them.
    expect(kept).toBe(marked);
    expect(after.bars).toBe(marked);
    expectStable(recording, before);
    expect(errors).toEqual([]);
  });

  test('FR-TL-3: an application stylesheet with `scroll-behavior: smooth` does not turn the compensation into a slide', async ({
    page,
  }) => {
    // The `scrollLeft` setter follows that CSS property, so a compensation written with it would
    // slide over a few hundred ms: a visible jump that the scroll in progress also fights.
    const errors = trackErrors(page);
    await openScrollPage(page, `${QUERY}&appcss=smooth`);
    await parkMouse(page);
    const first = await sample(page);
    await startRecording(page);

    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(-600, 0);
      await frames(page);
    }
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('FR-I18N-3, FR-TL-2: a host page that is right to left does not turn the chart around', async ({
    page,
  }) => {
    // An RTL scroller counts `scrollLeft` from its right edge, down to negative numbers. The chart
    // sets `direction: ltr` on itself, so the page's `dir` changes nothing about its scrolling.
    const errors = trackErrors(page);
    await openScrollPage(page, `${QUERY}&dir=rtl&align=0`);
    const directions = await page.evaluate(() => [
      getComputedStyle(document.documentElement).direction,
      getComputedStyle(document.querySelector('#chart .gantt__scroller') ?? document.body)
        .direction,
    ]);
    expect(directions).toEqual(['rtl', 'ltr']);
    // The initial scroll reached its date, and `scrollLeft` is a plain offset from the start.
    await expectDateAt(page, '2026-03-09');
    expect((await sample(page)).scrollLeft).toBeGreaterThan(0);
    await parkMouse(page);
    const first = await sample(page);
    await startRecording(page);

    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(-600, 0);
      await frames(page);
    }
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel(1000, 0);
      await frames(page);
    }
    await settle(page);

    const recording = await stopRecording(page);
    expectStable(recording, first);
    expect(recording.frames.filter((frame) => frame.left < 0)).toEqual([]);
    expect(startMoves(recording)).toBeGreaterThanOrEqual(2);
    expect(endMoves(recording)).toBeGreaterThanOrEqual(2);
    // And a request goes where it says, in either direction.
    await page.evaluate(() => {
      (
        window as unknown as {
          __ganttScroll?: { core: { scrollToDate(d: string, o: object): unknown } };
        }
      ).__ganttScroll?.core.scrollToDate('2026-05-04', { behavior: 'instant', align: 0 });
    });
    await expectDateAt(page, '2026-05-04');
    expect(errors).toEqual([]);
  });

  test.describe('fractional device pixels', () => {
    test.use({ deviceScaleFactor: 1.25 });

    test('FR-TL-3: no jump larger than a pixel when scrollLeft snaps to device pixels', async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openScrollPage(page, QUERY);
      await parkMouse(page);
      const first = await sample(page);
      await startRecording(page);

      for (let i = 0; i < 24; i += 1) {
        await page.mouse.wheel(-333, 0);
        await frames(page);
      }
      for (let i = 0; i < 30; i += 1) {
        await page.mouse.wheel(777, 0);
        await frames(page);
      }
      await settle(page);

      const recording = await stopRecording(page);
      expectStable(recording, first);
      expect(startMoves(recording)).toBeGreaterThanOrEqual(2);
      expect(errors).toEqual([]);
    });
  });
});

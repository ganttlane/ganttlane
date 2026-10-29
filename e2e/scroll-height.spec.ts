import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { Box, PageLayout } from './scroll-support';
import {
  barBox,
  DAY_MS,
  expectDateAt,
  farTask,
  openScrollPage,
  pageLayout,
  sample,
  scrollCall,
  settle,
  startRecording,
  stopRecording,
  taskAt,
  trackErrors,
  worstJump,
} from './scroll-support';

/**
 * E2E of plan step 4.9 (FR-SCROLL-1 … FR-SCROLL-3): the initial scroll, `scrollToDate`,
 * `scrollToToday` and `scrollToTask` on both axes, and the chart's height, in Chromium, Firefox
 * and WebKit. The page (`/scroll/`) shows a plan of 300 rows, so the rows far below are not even
 * in the DOM until the chart scrolls to them, in three shapes of chart:
 *
 * - **fill**: no `height` option, the chart fills a 24rem container and scrolls inside it;
 * - **fixed**: `height: 320`, the same with the chart's own height;
 * - **auto**: `height: 'auto'` between 500 px of page above and 900 below it: the chart is as
 *   tall as its 300 rows, the page scrolls it, the header sticks to the page, and the scroller
 *   only scrolls sideways.
 */

const MODES = [
  { name: 'fill', query: '' },
  { name: 'fixed', query: 'height=320' },
  { name: 'auto', query: 'height=auto&above=500&below=900' },
] as const;
type Mode = (typeof MODES)[number];

/** The plan's "today" in these tests, and the date at the left edge as a time stamp. */
const NOW = '2026-04-10';
const dateMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** How far the date at the left edge of a sample is from a date, in px. */
const offBy = (reading: { edge: number; pxPerDay: number }, date: string): number =>
  ((reading.edge - dateMs(date)) / DAY_MS) * reading.pxPerDay;

/** The part of the chart that shows rows, in viewport coordinates: below the header. */
function rowsArea(layout: PageLayout, mode: Mode): Box {
  const headerHeight = layout.header.bottom - layout.header.top;
  if (mode.name === 'auto') {
    // The header sticks to the top of the page, and the page is `innerHeight` tall.
    return {
      top: headerHeight,
      bottom: layout.innerHeight,
      left: layout.scroller.left,
      right: layout.scroller.right,
    };
  }
  return {
    top: layout.scroller.top + headerHeight,
    bottom: layout.scroller.top + layout.scrollerClientHeight,
    left: layout.scroller.left,
    right: layout.scroller.right,
  };
}

/** Scrolls the page so that the top of the chart is near the top of the viewport. */
async function bringChartIntoView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('#chart .gantt');
    if (!root) throw new Error('no chart');
    window.scrollTo({
      top: window.scrollY + root.getBoundingClientRect().top - 40,
      behavior: 'instant',
    });
  });
  await settle(page);
}

/** Parks the mouse over the middle of what shows of the scroller. */
async function parkMouseOnChart(page: Page): Promise<void> {
  const layout = await pageLayout(page);
  const top = Math.max(layout.scroller.top, 0);
  const bottom = Math.min(layout.scroller.bottom, layout.innerHeight);
  await page.mouse.move((layout.scroller.left + layout.scroller.right) / 2, (top + bottom) / 2);
}

test.describe('scrolling and height (FR-SCROLL-1 … FR-SCROLL-3)', () => {
  for (const mode of MODES) {
    for (const finite of [false, true]) {
      const shape = `${mode.name}${finite ? ', fixed range' : ', infinite timeline'}`;
      const query = (extra: string): string =>
        [mode.query, finite ? 'infinite=0' : '', extra].filter(Boolean).join('&');

      test(`FR-SCROLL-1: the initial scroll puts a date, today or the first task at the left edge (${shape})`, async ({
        page,
      }) => {
        const errors = trackErrors(page);

        await openScrollPage(page, query('initial=2026-03-30&align=0'));
        const onDate = await sample(page);
        expect(Math.abs(offBy(onDate, '2026-03-30'))).toBeLessThanOrEqual(1);

        await openScrollPage(page, query(`initial=today&now=${NOW}&align=0`));
        const onToday = await sample(page);
        expect(Math.abs(offBy(onToday, NOW))).toBeLessThanOrEqual(1);

        // `align`: the date lands at that fraction of the viewport.
        await openScrollPage(page, query(`initial=today&now=${NOW}&align=0.5`));
        const centred = await sample(page);
        expect(Math.abs(offBy(centred, NOW) + centred.viewportWidth / 2)).toBeLessThanOrEqual(1);

        await openScrollPage(page, query('initial=first-task&align=0'));
        const first = await sample(page);
        expect(first.scrollLeft).toBeGreaterThan(0);
        expect(first.bars).toBeGreaterThan(0);

        // Whatever the mode, the header agrees with the rows and the page does not move sideways.
        const layout = await pageLayout(page);
        if (mode.name === 'auto') {
          expect(layout.headerIn).toBe('pin');
          expect(
            Math.abs((layout.pinScrollLeft ?? -1) - layout.scrollerScrollLeft),
          ).toBeLessThanOrEqual(1);
        } else {
          expect(layout.headerIn).toBe('scroller');
        }
        expect(layout.pageScrollsSideways).toBe(false);
        expect(layout.scrollerScrollTop).toBe(0);
        expect(errors).toEqual([]);
      });
    }

    for (const behavior of ['instant', 'smooth'] as const) {
      test(`FR-SCROLL-2: scrollToTask on a row far below makes it visible, ${behavior} (${mode.name})`, async ({
        page,
      }) => {
        const errors = trackErrors(page);
        await openScrollPage(page, `${mode.query}&initial=first-task`);
        const id = await farTask(page);
        // Far: not even in the DOM, thanks to the virtualization of rows.
        expect(await barBox(page, id)).toBeUndefined();

        await scrollCall(page, { method: 'scrollToTask', id, options: { behavior } });
        // Visible: drawn, below the sticky header, above the bottom of what shows, inside
        // sideways. Polled, because a smooth scroll may pause between frames under load.
        const visible = async (): Promise<boolean> => {
          const bar = await barBox(page, id);
          if (!bar) return false;
          const area = rowsArea(await pageLayout(page), mode);
          return (
            bar.top >= area.top - 1 &&
            bar.bottom <= area.bottom + 1 &&
            bar.right > area.left &&
            bar.left < area.right
          );
        };
        await expect.poll(visible, { message: 'the row is visible', timeout: 10_000 }).toBe(true);
        await settle(page, 8);
        expect(await visible()).toBe(true);

        const layout = await pageLayout(page);
        if (mode.name === 'auto') {
          // The page scrolled, not the scroller.
          expect(layout.scrollY).toBeGreaterThan(0);
          expect(layout.scrollerScrollTop).toBe(0);
        } else {
          expect(layout.scrollerScrollTop).toBeGreaterThan(0);
        }
        // The rows between the first and this one were never drawn: the DOM stays small.
        const reading = await sample(page);
        expect(reading.bars).toBeLessThanOrEqual(40);
        expect(errors).toEqual([]);
      });
    }

    test(`FR-SCROLL-2: scrollToTask aligns the row (alignY) in the visible part of the chart (${mode.name})`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openScrollPage(page, `${mode.query}&initial=first-task`);
      // Neither the first rows nor the last: there is room to centre it.
      const id = await page.evaluate((): string | number => {
        const handle = (
          window as unknown as {
            __ganttScroll?: {
              taskIds: (string | number)[];
              core: {
                getRowMetrics(id: string | number): unknown;
                getBarRect(id: string | number): unknown;
              };
            };
          }
        ).__ganttScroll;
        const drawn = (handle?.taskIds ?? []).filter(
          (task) =>
            handle?.core.getRowMetrics(task) !== undefined &&
            handle.core.getBarRect(task) !== undefined,
        );
        const middle = drawn[Math.floor(drawn.length / 2)];
        if (middle === undefined) throw new Error('no task with a bar');
        return middle;
      });

      await scrollCall(page, {
        method: 'scrollToTask',
        id,
        options: { behavior: 'instant', alignY: 'center' },
      });
      await settle(page, 8);

      const bar = await barBox(page, id);
      const layout = await pageLayout(page);
      const area = rowsArea(layout, mode);
      const centre = ((bar?.top ?? 0) + (bar?.bottom ?? 0)) / 2;
      expect(Math.abs(centre - (area.top + area.bottom) / 2)).toBeLessThanOrEqual(30);
      expect(errors).toEqual([]);
    });

    for (const behavior of ['instant', 'smooth'] as const) {
      test(`FR-SCROLL-2: scrollToToday and scrollToDate move the time axis, ${behavior} (${mode.name})`, async ({
        page,
      }) => {
        const errors = trackErrors(page);
        await openScrollPage(page, `${mode.query}&now=${NOW}&initial=2026-03-02&align=0`);
        const scrollY = (await pageLayout(page)).scrollY;

        await scrollCall(page, { method: 'scrollToToday', options: { behavior, align: 0 } });
        await expectDateAt(page, NOW);

        await scrollCall(page, { method: 'scrollToToday', options: { behavior, align: 0.5 } });
        await expectDateAt(page, NOW, 0.5);

        await scrollCall(page, {
          method: 'scrollToDate',
          date: '2026-05-04',
          options: { behavior, align: 0 },
        });
        await expectDateAt(page, '2026-05-04');
        await settle(page, 8);

        // Sideways only: no row was asked for, so the page and the rows stay where they were.
        const layout = await pageLayout(page);
        expect(layout.scrollY).toBe(scrollY);
        expect(layout.scrollerScrollTop).toBe(0);
        if (mode.name === 'auto') {
          expect(
            Math.abs((layout.pinScrollLeft ?? -1) - layout.scrollerScrollLeft),
          ).toBeLessThanOrEqual(1);
        }
        expect(errors).toEqual([]);
      });
    }

    test(`FR-SCROLL-2: a request is applied once: a redraw does not scroll back to it (${mode.name})`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openScrollPage(page, `${mode.query}&initial=first-task`);
      const id = await farTask(page);
      await scrollCall(page, { method: 'scrollToTask', id, options: { behavior: 'instant' } });
      await settle(page, 8);

      // The user scrolls away: back to the top of the rows.
      await page.evaluate((auto) => {
        const scroller = document.querySelector<HTMLElement>('#chart .gantt__scroller');
        if (auto) window.scrollTo({ top: 0, behavior: 'instant' });
        else scroller?.scrollTo({ top: 0, behavior: 'instant' });
      }, mode.name === 'auto');
      await settle(page, 8);
      const away = await pageLayout(page);

      // A redraw of the same snapshot (the request is still in it) does not replay the request.
      await page.evaluate(() => {
        const handle = (
          window as unknown as { __ganttScroll?: { renderer: { setDisplay(o: object): void } } }
        ).__ganttScroll;
        handle?.renderer.setDisplay({ rowStripes: 'row' });
      });
      await settle(page, 8);

      const after = await pageLayout(page);
      expect(after.scrollY).toBe(away.scrollY);
      expect(after.scrollerScrollTop).toBe(away.scrollerScrollTop);
      expect(errors).toEqual([]);
    });
  }

  test('FR-SCROLL-3: a fixed height keeps the header at the top of the scroller, whatever scrolls', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=320&above=300&below=300');

    const before = await pageLayout(page);
    expect(before.headerIn).toBe('scroller');
    expect(before.root.bottom - before.root.top).toBeCloseTo(320, 0);

    await page.evaluate(() => {
      document
        .querySelector('#chart .gantt__scroller')
        ?.scrollTo({ top: 900, left: 700, behavior: 'instant' });
    });
    await settle(page);

    const after = await pageLayout(page);
    expect(after.scrollerScrollTop).toBeGreaterThan(500);
    // Stuck: the header is where the scroller starts, though its rows are 900 px further down.
    expect(Math.abs(after.header.top - after.scroller.top)).toBeLessThanOrEqual(1);
    expect(after.header.bottom).toBeGreaterThan(after.header.top);
    // And it moved sideways with the rows: its scroller is the one that scrolls them.
    expect(after.scrollerScrollLeft).toBeGreaterThan(0);
    // The page was not touched.
    expect(after.scrollY).toBe(before.scrollY);
    expect(errors).toEqual([]);
  });

  test("FR-SCROLL-3: with 'auto' the header sticks to the page, and goes with the chart when it ends", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=500&below=900');

    const top = await pageLayout(page);
    expect(top.headerIn).toBe('pin');
    // The chart is as tall as its rows: far taller than the window.
    expect(top.root.bottom - top.root.top).toBeGreaterThan(top.innerHeight * 5);
    // Not stuck yet: the header is where the page puts it.
    expect(top.header.top).toBeGreaterThan(400);

    // Deep inside the chart: the header is stuck to the top of the window.
    await page.evaluate(() => {
      window.scrollTo({ top: 3000, behavior: 'instant' });
    });
    await settle(page);
    const inside = await pageLayout(page);
    expect(inside.root.top).toBeLessThan(-1000);
    expect(Math.abs(inside.header.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((inside.pin?.top ?? 1e9) - 0)).toBeLessThanOrEqual(1);
    expect(inside.scrollerScrollTop).toBe(0);

    // It keeps up with the rows sideways.
    await page.evaluate(() => {
      document
        .querySelector('#chart .gantt__scroller')
        ?.scrollTo({ left: 1500, behavior: 'instant' });
    });
    await settle(page);
    const sideways = await pageLayout(page);
    expect(sideways.scrollerScrollLeft).toBeGreaterThan(1000);
    expect(
      Math.abs((sideways.pinScrollLeft ?? -1) - sideways.scrollerScrollLeft),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(sideways.header.top)).toBeLessThanOrEqual(1);
    expect(sideways.pageScrollsSideways).toBe(false);

    // At the end of the page: the header went up with the end of the chart instead of hanging
    // over the 900 px of page below it.
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await settle(page);
    const end = await pageLayout(page);
    expect(end.root.bottom).toBeLessThan(end.innerHeight);
    expect(end.pin?.bottom ?? 1e9).toBeLessThanOrEqual(end.root.bottom + 1);

    // And back at the top it is in its own place again.
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await settle(page);
    const back = await pageLayout(page);
    expect(Math.abs(back.header.top - back.root.top)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("FR-SCROLL-3: with 'auto' only the rows in view are drawn, and they follow the page", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=500&below=900');
    const first = await sample(page);
    const seen = new Set<string>();
    // The rows drawn now, by index (a bar is drawn only where its time is in view too).
    const rows = async (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('#chart .gantt__row')].map(
          (row) => row.getAttribute('data-row') ?? '',
        ),
      );
    for (const row of await rows()) seen.add(row);

    // A tall page, walked down in 1500 px steps: rows come and go with what the page shows.
    for (let i = 1; i <= 8; i += 1) {
      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'instant' });
      }, i * 1500);
      await settle(page);
      const drawn = await rows();
      expect(drawn.length).toBeLessThanOrEqual(40);
      expect(drawn.length).toBeGreaterThan(5);
      expect((await sample(page)).nodes).toBeLessThanOrEqual(first.nodes * 2 + 200);
      for (const row of drawn) seen.add(row);
    }
    // Far more rows were drawn over the whole walk than at any moment: the window followed.
    expect(seen.size).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  test("FR-SCROLL-3, FR-TL-2: with 'auto' the infinite timeline extends both edges without a jump, and the header follows", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(
      page,
      'height=auto&above=300&below=600&extendBy=2w&threshold=400&initial=2026-03-09',
    );
    await bringChartIntoView(page);
    await parkMouseOnChart(page);
    await startRecording(page);

    // The wheel scrolls the scroller sideways, not the page.
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(-600, 0);
      await settle(page, 2);
    }
    for (let i = 0; i < 26; i += 1) {
      await page.mouse.wheel(1000, 0);
      await settle(page, 2);
    }
    await settle(page);

    const recording = await stopRecording(page);
    const layout = await pageLayout(page);
    expect(worstJump(recording)).toBeLessThanOrEqual(1);
    expect(recording.events.filter((event) => event.compensated && !event.headerAtEdge)).toEqual(
      [],
    );
    expect(recording.events.filter((event) => event.startMoved).length).toBeGreaterThanOrEqual(3);
    expect(recording.events.filter((event) => event.endMoved).length).toBeGreaterThanOrEqual(3);
    expect(Math.abs((layout.pinScrollLeft ?? -1) - layout.scrollerScrollLeft)).toBeLessThanOrEqual(
      1,
    );
    expect(layout.pageScrollsSideways).toBe(false);
    expect(layout.scrollX).toBe(0);
    expect(errors).toEqual([]);
  });

  test('FR-SCROLL-3: the height changes at runtime, both ways, and the chart keeps working', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=320&above=400&below=600&initial=2026-03-09');
    const setHeight = async (height: number | 'auto'): Promise<void> => {
      await page.evaluate((next) => {
        const handle = (
          window as unknown as {
            __ganttScroll?: { renderer: { setHeight(h: number | 'auto'): void } };
          }
        ).__ganttScroll;
        handle?.renderer.setHeight(next);
      }, height);
      await settle(page, 6);
    };

    await setHeight('auto');
    const auto = await pageLayout(page);
    expect(auto.headerIn).toBe('pin');
    expect(auto.root.bottom - auto.root.top).toBeGreaterThan(auto.innerHeight * 5);
    await page.evaluate(() => {
      window.scrollTo({ top: 2500, behavior: 'instant' });
    });
    await settle(page);
    expect(Math.abs((await pageLayout(page)).header.top)).toBeLessThanOrEqual(1);
    const id = await farTask(page);
    await scrollCall(page, { method: 'scrollToTask', id, options: { behavior: 'instant' } });
    await settle(page, 8);
    expect(await barBox(page, id)).toBeDefined();

    await setHeight(260);
    const fixed = await pageLayout(page);
    expect(fixed.headerIn).toBe('scroller');
    expect(Math.round(fixed.root.bottom - fixed.root.top)).toBe(260);
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await scrollCall(page, { method: 'scrollToTask', id, options: { behavior: 'instant' } });
    await settle(page, 8);
    const again = await pageLayout(page);
    expect(again.scrollerScrollTop).toBeGreaterThan(0);
    expect(await barBox(page, id)).toBeDefined();
    expect(errors).toEqual([]);
  });
});

/** The ids of the rows drawn now (by index; a bar is drawn only where its time is in view too). */
async function drawnRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#chart .gantt__row')].map(
      (row) => row.getAttribute('data-row') ?? '',
    ),
  );
}

/** The box of an element of the page in the viewport. */
async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((query): Box => {
    const element = document.querySelector(query);
    if (!element) throw new Error(`no ${query}`);
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  }, selector);
}

test.describe("height: 'auto' next to the application's own layout (review of step 4.9)", () => {
  test('FR-SCROLL-3: inside a wrapper that has only overflow-x the page scrolls the chart, and only the rows in view are drawn', async ({
    page,
  }) => {
    // `overflow-x: auto` computes to `overflow-y: auto` as well, but the wrapper is as tall as the
    // chart and never scrolls: taking it for the host drew all 300 rows.
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=500&below=900&wrap=x');
    const seen = new Set<string>();
    expect((await drawnRows(page)).length).toBeLessThanOrEqual(40);

    for (let i = 1; i <= 6; i += 1) {
      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'instant' });
      }, i * 1500);
      await settle(page);
      const drawn = await drawnRows(page);
      expect(drawn.length).toBeLessThanOrEqual(40);
      expect(drawn.length).toBeGreaterThan(5);
      for (const row of drawn) seen.add(row);
    }
    // The window followed the page.
    expect(seen.size).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  test('FR-SCROLL-3, FR-SCROLL-2: inside an element that scrolls it is the host: its rows, its padding, its sticky header', async ({
    page,
  }) => {
    // 480 px tall, `overflow-y: auto`, 30 px of padding on top. At mount the chart has no height,
    // so nothing in the wrapper scrolls yet: the host is looked for again after the first render.
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&wrap=scroll&initial=first-task');
    expect((await drawnRows(page)).length).toBeLessThanOrEqual(40);
    expect((await pageLayout(page)).scrollY).toBe(0);
    const id = await taskAt(page, 0.6);
    expect(await barBox(page, id)).toBeUndefined();

    // At the top of what shows rows, which is where a header that covers the padding is least
    // forgiving: a row a screenful below it is visible whatever the header does.
    await scrollCall(page, {
      method: 'scrollToTask',
      id,
      options: { behavior: 'instant', alignY: 'start' },
    });
    const visible = async (): Promise<boolean> => {
      const bar = await barBox(page, id);
      if (!bar) return false;
      const wrap = await boxOf(page, '#wrap');
      const pin = await boxOf(page, '#chart .gantt__pin');
      return bar.top >= pin.bottom - 1 && bar.top < pin.bottom + 60 && bar.bottom <= wrap.bottom;
    };
    await expect.poll(visible, { message: 'the row is visible', timeout: 10_000 }).toBe(true);
    await settle(page, 8);

    // The wrapper scrolled, not the page; the pin sticks 30 px (the padding) below its top edge.
    const wrap = await boxOf(page, '#wrap');
    const pin = await boxOf(page, '#chart .gantt__pin');
    expect((await pageLayout(page)).scrollY).toBe(0);
    expect(Math.abs(pin.top - (wrap.top + 30))).toBeLessThanOrEqual(1);
    expect((await drawnRows(page)).length).toBeLessThanOrEqual(40);
    expect(await visible()).toBe(true);
    expect(errors).toEqual([]);
  });

  test("FR-SCROLL-2: scrollToTask puts the row below a header of the application's, which the pin sticks under", async ({
    page,
  }) => {
    // `.gantt__pin { top: 80px }`: the page's own header takes the first 80 px.
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=500&below=900&initial=first-task&pintop=80');
    const id = await taskAt(page, 0.6);

    // At the top of what shows rows: a row a screenful below the header is visible anyway.
    await scrollCall(page, {
      method: 'scrollToTask',
      id,
      options: { behavior: 'instant', alignY: 'start' },
    });
    const visible = async (): Promise<boolean> => {
      const bar = await barBox(page, id);
      if (!bar) return false;
      const pin = await boxOf(page, '#chart .gantt__pin');
      return bar.top >= pin.bottom - 1 && bar.top < pin.bottom + 60;
    };
    await expect.poll(visible, { message: 'the row is below the pin', timeout: 10_000 }).toBe(true);
    await settle(page, 8);

    const pin = await boxOf(page, '#chart .gantt__pin');
    expect(Math.abs(pin.top - 80)).toBeLessThanOrEqual(1);
    expect(await visible()).toBe(true);
    expect(errors).toEqual([]);
  });

  test('FR-SCROLL-3: a sideways wheel over the header scrolls the chart, as it does over the rows', async ({
    page,
  }) => {
    // The header pin is in front of the scroller and scrolls nothing by hand: without help a
    // trackpad swipe or a tilt wheel over the header goes nowhere.
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=300&below=900&initial=2026-03-09&align=0');
    await bringChartIntoView(page);
    const { pin } = await pageLayout(page);
    if (!pin) throw new Error('no pin');
    await page.mouse.move((pin.left + pin.right) / 2, (pin.top + pin.bottom) / 2);
    const before = (await pageLayout(page)).scrollerScrollLeft;

    await page.mouse.wheel(400, 0);

    await expect
      .poll(async () => (await pageLayout(page)).scrollerScrollLeft - before, {
        message: 'the chart scrolled sideways',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(300);
    await settle(page);
    const after = await pageLayout(page);
    // The header went with it, and the page did not move.
    expect(Math.abs((after.pinScrollLeft ?? -1) - after.scrollerScrollLeft)).toBeLessThanOrEqual(1);
    expect(after.pageScrollsSideways).toBe(false);
    expect(after.scrollY).toBe((await pageLayout(page)).scrollY);
    expect(errors).toEqual([]);
  });

  test('FR-SCROLL-3: the wheel with Shift over the header scrolls the chart sideways', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      "Playwright's WebKit dispatches a wheel event with Shift held to another element (the row under the header, an SVG rect), not to the one under the pointer; a plain sideways wheel over the header is tested in all three",
    );
    // (Whether a synthetic vertical wheel with Shift also scrolls the page depends on the platform:
    // a real one comes from the OS already turned sideways on macOS, and is turned by the browser
    // when it scrolls on Windows and Linux. Only the chart is asserted.)
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=300&below=900&initial=2026-03-09&align=0');
    await bringChartIntoView(page);
    const { pin } = await pageLayout(page);
    if (!pin) throw new Error('no pin');
    await page.mouse.move((pin.left + pin.right) / 2, (pin.top + pin.bottom) / 2);
    const before = (await pageLayout(page)).scrollerScrollLeft;

    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Shift');

    await expect
      .poll(async () => (await pageLayout(page)).scrollerScrollLeft - before, {
        message: 'the chart scrolled sideways',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(200);
    await settle(page);
    expect(errors).toEqual([]);
  });

  test('FR-SCROLL-3: a touch that drags sideways over the header scrolls the chart; a vertical one scrolls the page', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright can only synthesize native touch pans through the Chromium DevTools protocol',
    );
    const errors = trackErrors(page);
    await openScrollPage(page, 'height=auto&above=300&below=900&initial=2026-03-09&align=0');
    await bringChartIntoView(page);
    const { pin, scrollY } = await pageLayout(page);
    if (!pin) throw new Error('no pin');
    const x = (pin.left + pin.right) / 2;
    const y = (pin.top + pin.bottom) / 2;
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (xDistance: number, yDistance: number): Promise<void> => {
      await cdp.send('Input.synthesizeScrollGesture', {
        x,
        y,
        xDistance,
        yDistance,
        gestureSourceType: 'touch',
        speed: 800,
        preventFling: true,
      });
    };
    const before = (await pageLayout(page)).scrollerScrollLeft;

    // The finger moves left: the chart follows it, towards its end.
    await swipe(-300, 0);

    await expect
      .poll(async () => (await pageLayout(page)).scrollerScrollLeft - before, {
        message: 'the chart followed the finger',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(200);
    await settle(page);
    expect((await pageLayout(page)).scrollY).toBe(scrollY);

    // A vertical drag is the browser's: the page scrolls, the chart stays where it is.
    const sideways = (await pageLayout(page)).scrollerScrollLeft;
    await swipe(0, -300);
    await expect
      .poll(async () => (await pageLayout(page)).scrollY, { timeout: 10_000 })
      .toBeGreaterThan(scrollY + 100);
    await settle(page);
    expect(Math.abs((await pageLayout(page)).scrollerScrollLeft - sideways)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

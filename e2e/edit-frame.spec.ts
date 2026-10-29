import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  bar,
  boxOf,
  centre,
  changeOf,
  changesOf,
  committed,
  DAY,
  drag,
  eventsOf,
  linkHandle,
  linkPreview,
  openEdit,
  type Point,
  press,
  pxPerDay,
  root,
  scroller,
  settled,
  track,
  trackErrors,
} from './edit-harness';

/**
 * E2E of the review of plan step 4.7 (FR-EDIT-1, FR-EDIT-8, FR-LINK-4, FR-SCROLL-3): where the
 * pointer is, as the page puts it, in Chromium, Firefox and WebKit. The chart sits in a page that
 * scrolls (a chart of automatic height, or filler around a fixed one) or under a CSS `scale()`,
 * and the pointer is held over the sticky header or outside the chart.
 */

/** A plan of `count` rows, `t1` to `t<count>`, all in one column so that rows line up. */
const rows = (count: number): { id: string; name: string; start: string; end: string }[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `t${String(index + 1)}`,
    name: `Task ${String(index + 1)}`,
    start: '2026-03-02',
    end: '2026-03-06',
  }));

const PLAN = {
  tasks: rows(30),
  viewMode: 'day',
  calendar: { weekends: [] },
  today: '2026-03-04',
  scroll: { initial: 'first-task' },
  width: 1000,
} as const;

/** The page is the chart's host and is scrolled: the chart is as tall as its rows. */
const AUTO = { ...PLAN, height: 'auto' } as const;

/** The part of the core's snapshot these specs read, through the page's test hook. */
interface Peek {
  getSnapshot(): { scrollTop: number; feedback: { phase: string } };
}
const scrollTopOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const hook = (window as unknown as { __ganttEdit: { core: Peek } }).__ganttEdit;
    return hook.core.getSnapshot().scrollTop;
  });
const phaseOf = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const hook = (window as unknown as { __ganttEdit: { core: Peek } }).__ganttEdit;
    return hook.core.getSnapshot().feedback.phase;
  });

/** Scrolls the page to `top` and waits until the chart has heard of it. */
async function scrollPage(page: Page, top: number): Promise<void> {
  await page.evaluate((to) => {
    window.scrollTo({ top: to, behavior: 'instant' });
  }, top);
  await settled(page);
}

test.describe('a chart whose page scrolls it (FR-SCROLL-3)', () => {
  /** Opens the plan with the page scrolled well past the top of the chart. */
  async function open(page: Page): Promise<void> {
    await openEdit(page, AUTO);
    await scrollPage(page, 400);
    // The chart's top is above the viewport now: the scroller's rectangle carries that offset.
    await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(150);
  }

  test('FR-EDIT-1: dragging a bar moves it by the distance, whatever the page is scrolled to', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);
    const px = await pxPerDay(page);
    const from = centre(await boxOf(track(page, 't9')));

    await drag(page, from, { x: from.x + 2 * px, y: from.y + 4 });

    const change = changeOf(await committed(page), 't9');
    expect(change.after.start - change.before.start).toBe(2 * DAY);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: a link drag from t9 onto t11 creates t9 > t11, not a link to a row 300 px lower', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);
    const from = centre(await boxOf(linkHandle(page, 't9', 'end')));
    const target = centre(await boxOf(track(page, 't11')));

    await press(page, from, { x: from.x + 40, y: from.y + 4 });
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(linkPreview(page)).toHaveAttribute('data-valid', '');
    await page.mouse.up();

    await expect.poll(() => eventsOf(page)).toEqual(['linkCreate:t9>t11']);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: click-click from t9 to t11 links t9 > t11 as well', async ({ page }) => {
    const errors = trackErrors(page);
    await open(page);
    const from = centre(await boxOf(linkHandle(page, 't9', 'end')));
    const target = centre(await boxOf(track(page, 't11')));

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.click(target.x, target.y);

    await expect.poll(() => eventsOf(page)).toEqual(['linkCreate:t9>t11']);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: released over the header, which sticks to the page, a link drag links nothing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);
    const from = centre(await boxOf(linkHandle(page, 't9', 'end')));
    const pin = await boxOf(page.locator('#gantt .gantt__pin'));
    // The bar of t5 is scrolled under the header: aim at it, where the layout has a bar.
    const hidden = centre(await boxOf(track(page, 't5')));
    expect(hidden.y).toBeLessThan(pin.y + pin.height);
    const over: Point = hidden;

    await press(page, from, { x: from.x + 40, y: from.y + 4 });
    await page.mouse.move(over.x, over.y, { steps: 12 });
    await expect(linkPreview(page)).toBeAttached();
    await expect(linkPreview(page)).toHaveAttribute('data-valid', '');
    await page.mouse.up();

    await settled(page);
    expect(await eventsOf(page)).toEqual([]);
    await expect(linkPreview(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: the second click of click-click on the sticky header links nothing either', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);
    const from = centre(await boxOf(linkHandle(page, 't9', 'end')));
    const pin = await boxOf(page.locator('#gantt .gantt__pin'));
    const over: Point = { x: centre(await boxOf(track(page, 't9'))).x, y: pin.y + pin.height / 2 };

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.mouse.move(over.x, over.y, { steps: 10 });
    await page.mouse.click(over.x, over.y);

    await settled(page);
    // The header of such a chart is the page's, outside the scroller: the click never reaches
    // a bar that is scrolled under it, so nothing is linked (the link stays armed, as for any
    // click outside the rows) and Escape cancels it.
    expect(await eventsOf(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(linkPreview(page)).toHaveCount(0);
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('a chart with its own height, in a page that scrolls (FR-LINK-4, FR-EDIT-8)', () => {
  /** The body scrolled 200 px: the rows t4 and t5 are behind the sticky header. */
  async function openScrolled(page: Page): Promise<void> {
    await openEdit(page, PLAN);
    await scroller(page).evaluate((element) => {
      element.scrollTop = 200;
    });
    await expect.poll(() => scrollTopOf(page)).toBe(200);
    await settled(page);
  }

  test('FR-LINK-4: released over the sticky header, a link drag links nothing to a bar that is scrolled under it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrolled(page);
    const from = centre(await boxOf(linkHandle(page, 't8', 'end')));
    const header = await boxOf(page.locator('#gantt .gantt__header'));
    // t4's bar (body y 153 to 183) is now at y 28 to 58 of the scroller: under the header.
    const over: Point = { x: from.x - 40, y: header.y + 43 };

    await press(page, from, { x: from.x - 30, y: from.y + 4 });
    await page.mouse.move(over.x, over.y, { steps: 12 });
    await page.mouse.up();

    await settled(page);
    expect(await eventsOf(page)).toEqual([]);
    expect(await phaseOf(page)).toBe('idle');
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: the second click of click-click on the sticky header links nothing, and ends the armed link', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openScrolled(page);
    const from = centre(await boxOf(linkHandle(page, 't8', 'end')));
    const header = await boxOf(page.locator('#gantt .gantt__header'));
    const over: Point = { x: from.x - 40, y: header.y + 43 };

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.mouse.move(over.x, over.y, { steps: 10 });
    await page.mouse.click(over.x, over.y);

    await expect(linkPreview(page)).toHaveCount(0);
    expect(await eventsOf(page)).toEqual([]);
    expect(await phaseOf(page)).toBe('idle');
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: released below the chart, a link drag links nothing to a row that is scrolled out of view', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, PLAN);
    const from = centre(await boxOf(linkHandle(page, 't2', 'end')));
    const chart = await boxOf(scroller(page));
    const below: Point = { x: from.x - 40, y: Math.round(chart.y + chart.height + 40) };
    // The page has room for it, and the rows t8 and further are in that column, below the view.
    expect(below.y).toBeLessThan(page.viewportSize()?.height ?? 720);

    await press(page, from, { x: from.x - 30, y: from.y + 4 });
    await page.mouse.move(below.x, below.y, { steps: 12 });
    await page.mouse.up();

    await settled(page);
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-EDIT-8: hovering a bar still works after the page scrolled under a pointer that stayed', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openEdit(page, { ...PLAN, above: 800, below: 800 });
    // The chart is 200 px below the top of the viewport.
    await page.evaluate(() => {
      const top = document.querySelector('#gantt')!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - 200, behavior: 'instant' });
    });
    await settled(page);
    const third = centre(await boxOf(track(page, 't3')));
    await page.mouse.move(third.x, third.y, { steps: 4 });
    await expect(bar(page, 't3')).toHaveAttribute('data-hovered', '');

    // The page scrolls 150 px: the chart is that much higher, and the first row is under a
    // pointer that has not moved.
    await page.evaluate(() => {
      window.scrollBy({ top: 150, behavior: 'instant' });
    });
    await settled(page);
    const first = centre(await boxOf(track(page, 't1')));
    await page.mouse.move(first.x + 1, first.y, { steps: 3 });

    await expect(bar(page, 't1')).toHaveAttribute('data-hovered', '');
    await expect(bar(page, 't3')).not.toHaveAttribute('data-hovered');
    expect(errors).toEqual([]);
  });
});

test.describe('a chart under a CSS scale() (FR-EDIT-1)', () => {
  const CHART = {
    tasks: [
      { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'Beta', start: '2026-03-09', end: '2026-03-13' },
    ],
    viewMode: 'day',
    calendar: { weekends: [] },
    today: '2026-03-04',
    scroll: { initial: 'first-task' },
  } as const;

  for (const scale of [2, 0.5]) {
    test(`FR-EDIT-1: scale(${String(scale)}): a drag of 2 days moves the bar by 2 days`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openEdit(page, { ...CHART, width: 500 / scale, scale });
      const px = await pxPerDay(page);
      const from = centre(await boxOf(track(page, 'a')));

      await drag(page, from, { x: from.x + 2 * px * scale, y: from.y });

      const change = changeOf(await committed(page), 'a');
      expect(change.after.start - change.before.start).toBe(2 * DAY);
      expect(errors).toEqual([]);
    });
  }

  test('FR-EDIT-1: scale(2): a bar in the right half of the chart can be dragged, it is not the scrollbar', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    // 500 px of chart, shown 1000 px wide; the middle of the second bar (x 280 to 480) is in its
    // right half, outside the autoscroll zone of the edge (the last 40 px).
    await openEdit(page, { ...CHART, width: 500, scale: 2 });
    const px = await pxPerDay(page);
    const from = centre(await boxOf(track(page, 'b')));
    const chart = await boxOf(scroller(page));
    expect(from.x - chart.x).toBeGreaterThan(chart.width / 2);

    // One day back (80 page px): away from the right edge, where a drag would autoscroll.
    await drag(page, from, { x: from.x - px * 2, y: from.y });

    const change = changeOf(await committed(page), 'b');
    expect(change.before.start - change.after.start).toBe(DAY);
    expect(errors).toEqual([]);
  });
});

test.describe('an armed link (FR-LINK-4)', () => {
  const CHART = {
    tasks: [
      { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'Beta', start: '2026-03-09', end: '2026-03-13' },
    ],
    viewMode: 'day',
    calendar: { weekends: [] },
    today: '2026-03-04',
    scroll: { initial: 'first-task' },
    width: 1000,
  } as const;

  test('FR-LINK-4: a press outside the chart disarms it', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, CHART);
    const from = centre(await boxOf(linkHandle(page, 'a', 'end')));

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await expect(root(page)).toHaveAttribute('data-cursor', 'crosshair');
    await page.mouse.click(8, 8);

    await expect(linkPreview(page)).toHaveCount(0);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    // The page's own clicks are not the chart's: no link, no refusal.
    expect(await eventsOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: the window losing focus disarms it', async ({ page }) => {
    const errors = trackErrors(page);
    await openEdit(page, CHART);
    const from = centre(await boxOf(linkHandle(page, 'a', 'end')));

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await expect(linkPreview(page)).toHaveCount(0);
    await expect(root(page)).not.toHaveAttribute('data-cursor');
    expect(errors).toEqual([]);
  });

  test('FR-LINK-4: and Escape cancels it, as before', async ({ page }) => {
    await openEdit(page, CHART);
    const from = centre(await boxOf(linkHandle(page, 'a', 'end')));

    await page.mouse.click(from.x, from.y);
    await expect(linkPreview(page)).toBeAttached();
    await page.keyboard.press('Escape');

    await expect(linkPreview(page)).toHaveCount(0);
    expect(await changesOf(page)).toEqual([]);
  });
});

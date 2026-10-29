import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { boxOf, frames, openChart, POPOVER, track } from './popover-support';

/**
 * Popovers of a chart whose height follows its rows (`layout.height: 'auto'`, FR-SCROLL-3,
 * FR-TIP-2): the page scrolls the chart, the header sticks to the page in `div.gantt__pin`, and
 * the core's scroll offset is how far the page is scrolled past the top of the chart. The vanilla
 * page of the playground takes it as `?height=auto`.
 */

const AUTO = { height: 'auto' };
const SCROLLER = '#gantt .gantt__scroller';

/** The part of the chart's core these specs read. */
interface PageWindow {
  __ganttPlayground?: { core(): { getSnapshot(): { scrollTop: number } } | undefined };
}

/** The core's vertical scroll offset: with an automatic height, the page's offset past the chart. */
const scrollTopOf = async (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as PageWindow).__ganttPlayground?.core()?.getSnapshot().scrollTop ?? 0,
  );

/** Scrolls the page until the top of the chart is `above` px above the top of the viewport. */
async function scrollPastTop(page: Page, above: number): Promise<void> {
  await page.evaluate((px) => {
    const top = document.querySelector('#gantt')?.getBoundingClientRect().top ?? 0;
    window.scrollBy(0, top + px);
  }, above);
  await expect.poll(async () => scrollTopOf(page)).toBeGreaterThan(above - 5);
  await frames(page);
}

test.describe('popovers with an automatic height (FR-SCROLL-3, FR-TIP-2)', () => {
  test('the tooltip sits next to its bar while the page is scrolled past the top of the chart', async ({
    page,
  }) => {
    await openChart(page, { tooltip: { delay: 0 } }, AUTO);
    await scrollPastTop(page, 160);
    expect(await scrollTopOf(page)).toBeGreaterThan(150);
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('no viewport');
    // A bar that is in view and clear of the header, which sticks to the top of the page.
    const bars = await page
      .locator('#gantt .gantt__bar')
      .evaluateAll((nodes) => nodes.map((node) => (node as SVGElement).dataset.taskId ?? ''));
    let hovered: { id: string; box: Awaited<ReturnType<typeof boxOf>> } | undefined;
    for (const id of bars) {
      const box = await boxOf(track(page, id));
      if (box.y > 140 && box.y + box.height < viewport.height - 120) {
        hovered = { id, box };
        break;
      }
    }
    if (hovered === undefined) throw new Error('no bar is in view');
    const { box } = hovered;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    const tip = await boxOf(tooltip);
    const gap =
      tip.y + tip.height <= box.y ? box.y - (tip.y + tip.height) : tip.y - (box.y + box.height);
    // One gap (8 px) from the bar, not the scroll offset of the page further off.
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
  });

  test('a sideways scroll of the chart keeps the tooltip, which follows its bar (the pin scrolls with it)', async ({
    page,
  }) => {
    await openChart(page, { tooltip: { trigger: 'click' } }, AUTO);
    const barBox = await boxOf(track(page, 'group-1'));
    await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    const before = await boxOf(tooltip);

    await page.locator(SCROLLER).evaluate((scroller) => {
      scroller.scrollLeft += 40;
    });

    // It moves with its bar (by half the shift: it is centred on the part of the bar in view).
    await expect.poll(async () => (await boxOf(tooltip)).x).toBeLessThan(before.x - 10);
    await expect(tooltip).toHaveCount(1);
  });

  test('a scroll of the page closes the tooltip that is open', async ({ page }) => {
    await openChart(page, { tooltip: { trigger: 'click' } }, AUTO);
    const barBox = await boxOf(track(page, 'group-1'));
    await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.evaluate(() => {
      window.scrollBy(0, 30);
    });

    await expect(page.locator(POPOVER)).toHaveCount(0);
  });
});

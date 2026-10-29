import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  bar,
  boxOf,
  frames,
  hoverBar,
  movePointer,
  openChart,
  POPOVER,
  scrollBarToRightEdge,
  scrollToDate,
  track,
  viewportOf,
} from './popover-support';

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

const CHART = '#gantt .gantt';

// That hovering a bar opens a tooltip next to it, with the name, the dates and the progress, and
// that leaving closes it, is a journey shared with React (`journeys/chart.ts`). These are the
// places where it has to be put with care.
test.describe('tooltips (plan step 4.8, FR-TIP-1, FR-TIP-2)', () => {
  test('the tooltip of the first bar, which has the header above it, stays inside the chart', async ({
    page,
  }) => {
    await openChart(page, { tooltip: { delay: 0 } });

    await hoverBar(page, 'group-1');

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    const chart = await boxOf(page.locator(CHART));
    const tip = await boxOf(tooltip);
    expect(tip.y).toBeGreaterThanOrEqual(chart.y);
    expect(tip.y + tip.height).toBeLessThanOrEqual(chart.y + chart.height);
  });

  test('it stays inside the chart and the viewport at the right edge', async ({ page }) => {
    // A narrow page, so that a bar well to the right can be scrolled to the right edge.
    await page.setViewportSize({ width: 600, height: 800 });
    await openChart(page, { tooltip: { delay: 0 } });
    // Only the first 24 px of the bar of group 2 are in view, at the right edge of the chart.
    await scrollBarToRightEdge(page, 'group-2', 24);
    await expect(bar(page, 'group-2')).toBeAttached();
    const scroller = await boxOf(page.locator('#gantt .gantt__scroller'));
    await expect
      .poll(async () => (await boxOf(track(page, 'group-2'))).x)
      .toBeGreaterThan(scroller.x + scroller.width - 40);
    const barBox = await boxOf(track(page, 'group-2'));
    await frames(page);

    await movePointer(page, scroller.x + scroller.width - 10, barBox.y + barBox.height / 2);

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    const tip = await boxOf(tooltip);
    const chart = await boxOf(page.locator(CHART));
    const viewport = await viewportOf(page);
    expect(tip.x + tip.width).toBeLessThanOrEqual(chart.x + chart.width);
    expect(tip.x + tip.width).toBeLessThanOrEqual(viewport.width);
    expect(tip.x).toBeGreaterThanOrEqual(chart.x);
  });

  test('it stays inside the viewport at the bottom edge, flipping above a bar near it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await openChart(page, { tooltip: { delay: 0, placement: 'bottom' } });
    // The chart reaches below the fold: its top is at 260 and the viewport ends at 520.
    await page.evaluate(() => {
      const chart = document.querySelector('#gantt')!;
      window.scrollTo(0, chart.getBoundingClientRect().top + window.scrollY - 260);
    });
    await frames(page);
    const viewport = await viewportOf(page);
    const chart = await boxOf(page.locator('#gantt'));
    expect(chart.y + chart.height).toBeGreaterThan(viewport.height);
    // The lowest bar that is wholly in view.
    const target = await page.evaluate((limit) => {
      const bars = [...document.querySelectorAll<SVGElement>('#gantt .gantt__bar')];
      const visible = bars
        .map((node) => ({
          id: node.dataset.taskId ?? '',
          bottom: node.getBoundingClientRect().bottom,
        }))
        .filter((entry) => entry.bottom <= limit - 20)
        .sort((a, b) => b.bottom - a.bottom);
      return visible[0]?.id;
    }, viewport.height);
    expect(target).toBeDefined();

    await hoverBar(page, target!);

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    // `placement: bottom` has no room below the bar inside the viewport: it flips above it.
    await expect(tooltip).toHaveAttribute('data-placement', 'top');
    const tip = await boxOf(tooltip);
    expect(tip.y + tip.height).toBeLessThanOrEqual(viewport.height);
    expect(tip.y).toBeGreaterThanOrEqual(chart.y);
  });

  test('hovering a named holiday shows its name, from real mouse movement alone', async ({
    page,
  }) => {
    await openChart(page, { tooltip: { delay: 0 } });
    // Spring Holiday, 2026-04-03: scroll it to the middle, and put the mouse in the first row,
    // where nothing is planned that day.
    const headerHeight = await scrollToDate(page, '2026-04-03');
    const holiday = page.locator('#gantt .gantt__nonworking-day[data-reason="holiday"]').first();
    const scroller = await boxOf(page.locator('#gantt .gantt__scroller'));
    // Wait for the scroll: the day is in view when it has come to the middle.
    await expect
      .poll(async () => {
        const { x, width } = await boxOf(holiday);
        return (
          x + width / 2 > scroller.x + 100 && x + width / 2 < scroller.x + scroller.width - 100
        );
      })
      .toBe(true);
    const day = await boxOf(holiday);
    await frames(page);

    await movePointer(page, day.x + day.width / 2, scroller.y + headerHeight + 8);

    await expect(page.locator(POPOVER)).toHaveText('Spring Holiday');
    await expect(page.locator(POPOVER)).toHaveAttribute('data-kind', 'day');
  });

  test('a tooltip that is open when the chart is replaced goes with it', async ({ page }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } });
    await hoverBar(page, 'group-1');
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.locator('#fixture').selectOption({ index: 1 });

    await expect(page.locator('#gantt .gantt__popover')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

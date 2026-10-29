import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  boxOf,
  clickLink,
  movePointer,
  openChart,
  POPOVER,
  removableLink,
  viewportOf,
} from './popover-support';

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

// That "Remove dependency" removes the link is a journey shared with React (`journeys/editing.ts`).
test.describe('link menu (plan step 4.8, FR-TIP-4, FR-SEL-1)', () => {
  test('a click on a link opens the menu, and Escape closes it', async ({ page }) => {
    const errors = trackErrors(page);
    await openChart(page);
    const link = await removableLink(page);

    await clickLink(page, link);

    const menu = page.locator(POPOVER);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu).toHaveAttribute('data-kind', 'link');
    const item = menu.getByRole('menuitem', { name: 'Remove dependency' });
    await expect(item).toBeVisible();
    await expect(item).toBeFocused();
    // Inside the viewport, and near the link.
    const box = await boxOf(menu);
    const viewport = await viewportOf(page);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const hit = await boxOf(page.locator(`#gantt .gantt__link-hit[data-link-id="${link}"]`));
    expect(Math.abs(box.x + box.width / 2 - (hit.x + hit.width / 2))).toBeLessThan(box.width);

    await page.keyboard.press('Escape');

    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a press outside the menu closes it, a press inside does not', async ({ page }) => {
    await openChart(page);
    await clickLink(page, await removableLink(page));
    const menu = page.locator(POPOVER);
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitem').dispatchEvent('pointerdown');
    await expect(menu).toBeVisible();
    await page.locator('h1').click();

    await expect(menu).toHaveCount(0);
  });

  test('a scroll of the chart closes the menu', async ({ page }) => {
    await openChart(page);
    await clickLink(page, await removableLink(page));
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#gantt .gantt__scroller')!.scrollLeft += 60;
    });

    await expect(page.locator(POPOVER)).toHaveCount(0);
  });

  test('the menu replaces a tooltip, and a tooltip does not come back under it', async ({
    page,
  }) => {
    await openChart(page, { tooltip: { delay: 0 } });
    const bar = page.locator('#gantt .gantt__bar[data-task-id="group-1"]');
    const barBox = await boxOf(bar);
    await movePointer(page, barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await expect(page.locator(POPOVER)).toHaveAttribute('data-kind', 'task');

    await clickLink(page, await removableLink(page));

    await expect(page.locator(POPOVER)).toHaveAttribute('data-kind', 'link');
    await expect(page.locator('#gantt .gantt__popover')).toHaveCount(1);
  });
});

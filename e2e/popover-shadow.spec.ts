import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { boxOf, clickLink, hoverBar, openChart, POPOVER, removableLink } from './popover-support';

/**
 * Popovers of a chart that lives inside an open shadow root (FR-TIP-1, FR-TIP-4), the way a web
 * component hosts it: the vanilla page of the playground with `?shadow=1` mounts the chart in a
 * box inside the shadow root of `#gantt`, with the stylesheet adopted into it. Locators go into
 * open shadow roots, so the selectors are the ones of the light DOM chart.
 *
 * At the document an event that started inside the shadow root has the host as its target, so a
 * press on a button of the menu looked like a press outside it, and the menu closed before the
 * click. The focus too: `document.activeElement` names the host, not what is focused inside.
 */

const SHADOW = { shadow: '1' };
const SCROLLER = '#gantt .gantt__scroller';
const HOST = '#gantt';

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

test.describe('popovers inside a shadow root (FR-TIP-1, FR-TIP-4)', () => {
  test('the chart is really inside the shadow root of its host', async ({ page }) => {
    await openChart(page, undefined, SHADOW);

    expect(
      await page.evaluate((host) => {
        const element = document.querySelector(host);
        return {
          lightChildren: element?.querySelectorAll('.gantt').length,
          shadowChildren: element?.shadowRoot?.querySelectorAll('.gantt').length,
        };
      }, HOST),
    ).toEqual({ lightChildren: 0, shadowChildren: 1 });
    // Styled: the adopted sheet reaches it (a bar has a size).
    expect((await boxOf(page.locator('#gantt .gantt__bar').first())).width).toBeGreaterThan(0);
  });

  test('a hover tooltip opens next to its bar', async ({ page }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } }, SHADOW);

    const barBox = await hoverBar(page, 'group-1');

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.gantt__popover-title')).toHaveText('Planning');
    const tip = await boxOf(tooltip);
    const gap =
      tip.y + tip.height <= barBox.y
        ? barBox.y - (tip.y + tip.height)
        : tip.y - (barBox.y + barBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
    expect(errors).toEqual([]);
  });

  test('choosing "Remove dependency" with the mouse removes the link: a press on the menu is no press outside it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, undefined, SHADOW);
    const link = await removableLink(page);
    await clickLink(page, link);
    const menu = page.locator(POPOVER);
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitem', { name: 'Remove dependency' }).click();

    await expect(page.locator(`#gantt .gantt__link[data-link-id="${link}"]`)).toHaveCount(0);
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a press on the chart outside the menu closes it', async ({ page }) => {
    await openChart(page, undefined, SHADOW);
    await clickLink(page, await removableLink(page));
    const menu = page.locator(POPOVER);
    await expect(menu).toBeVisible();

    await page.locator('h1').click();

    await expect(menu).toHaveCount(0);
  });

  test('the focus goes to the menu, and back to where it was on Escape and after an action', async ({
    page,
  }) => {
    await openChart(page, undefined, SHADOW);
    const scroller = page.locator(SCROLLER);
    const link = await removableLink(page);

    // Escape.
    await scroller.focus();
    await clickLink(page, link);
    const item = page.locator(POPOVER).getByRole('menuitem');
    await expect(item).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(scroller).toBeFocused();

    // An action: the focus is back before it ran, so the button that held it is not missed.
    await clickLink(page, link);
    await expect(item).toBeFocused();
    await item.click();
    await expect(page.locator(`#gantt .gantt__link[data-link-id="${link}"]`)).toHaveCount(0);
    await expect(scroller).toBeFocused();
  });

  test('a scroll of the chart closes the menu (the event stays inside the shadow root)', async ({
    page,
  }) => {
    await openChart(page, undefined, SHADOW);
    await clickLink(page, await removableLink(page));
    await expect(page.locator(POPOVER)).toBeVisible();

    await page.locator(SCROLLER).evaluate((scroller) => {
      scroller.scrollLeft += 60;
    });

    await expect(page.locator(POPOVER)).toHaveCount(0);
  });
});

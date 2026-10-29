/**
 * Helpers of the journeys: finding the chart's parts, and the few steps that several journeys
 * share (a drag of a bar, the link menu, waiting for a change set). They work on the DOM the
 * renderer draws, which is the same under every renderer, and on the driver for the rest.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { boxOf, centre, drag } from '../edit-harness';
import { clickLink, POPOVER } from '../popover-support';
import type { ChartDriver } from './driver';

// `committed` takes the driver of a journey as well as the editing page (`edit-harness.ts`).
export {
  bar,
  committed,
  handle,
  linkHandle,
  linkPreview,
  root,
  scroller,
  track,
} from '../edit-harness';

/** The link `id` as drawn, and its menu (`POPOVER`). */
export const linkOf = (page: Page, id: string): Locator =>
  page.locator(`#gantt .gantt__link[data-link-id="${id}"]`);

/**
 * The dates of a task as its owner holds them (under React, the page's own tasks).
 *
 * @param driver - The driver.
 * @param id - The task id.
 * @returns `start` and `end` as ISO dates, or `undefined` for a task the owner does not have.
 */
export async function datesOf(
  driver: ChartDriver,
  id: string,
): Promise<{ readonly start: string; readonly end: string } | undefined> {
  const task = await driver.owned(id);
  return task === undefined ? undefined : { start: task.start, end: task.end };
}

/**
 * Drags the body of a task's bar by whole days with the real mouse.
 *
 * @param driver - The driver.
 * @param id - The task id.
 * @param days - How far, in days (negative: back).
 * @returns Where the bar's left edge was before, and the distance dragged in px.
 */
export async function dragBar(
  driver: ChartDriver,
  id: string,
  days: number,
): Promise<{ readonly before: number; readonly distance: number }> {
  const { page } = driver;
  const distance = Math.round(days * (await driver.state()).pxPerDay);
  const box = await boxOf(
    page.locator(`#gantt .gantt__bar[data-task-id="${id}"] .gantt__bar-track`),
  );
  const from = centre(box);
  await drag(page, from, { x: from.x + distance, y: from.y });
  return { before: box.x, distance };
}

/**
 * Removes a link the way a user does: a click on the arrow, then "Remove dependency" in its menu.
 *
 * @param page - The page.
 * @param id - The link id.
 */
export async function removeLink(page: Page, id: string): Promise<void> {
  await expect(linkOf(page, id)).toBeAttached();
  await clickLink(page, id);
  const menu = page.locator(POPOVER);
  await expect(menu).toHaveAttribute('role', 'menu');
  const item = menu.getByRole('menuitem', { name: 'Remove dependency' });
  await expect(item).toBeFocused();
  await item.click();
  await expect(menu).toHaveCount(0);
}

/** Whether the bar of a task lies inside the chart's scroller, horizontally. */
export async function isInView(page: Page, id: string): Promise<boolean> {
  const view = await page.locator('#gantt .gantt__scroller').boundingBox();
  const box = await page
    .locator(`#gantt .gantt__bar[data-task-id="${id}"] .gantt__bar-track`)
    .boundingBox();
  return (
    view !== null &&
    box !== null &&
    box.x >= view.x - 1 &&
    box.x + box.width <= view.x + view.width + 1
  );
}

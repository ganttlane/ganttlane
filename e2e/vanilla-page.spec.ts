import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { watchPage } from './edit-harness';

/**
 * The wiring of the vanilla page of the playground (`/vanilla/`, `apps/playground/src/vanilla.ts`,
 * FR-API-2, FR-API-3, FR-EDIT-7): the page is a plain consumer of `createGantt`, and what is
 * tested here is the part of it that the shared journeys (`journeys-vanilla.spec.ts`, which run on
 * `/edit/`) and `facade.spec.ts` do not touch: its controls and what they are wired to. The
 * view-mode select drives the chart and follows `setViewMode()` from code (`onViewModeChange`),
 * "Scroll to last task" is `scrollToTask`, and `?mode=view` is `editing: false` from the start.
 *
 * The specs read their ids from the page (the first and the last row of its debug table), so they
 * do not depend on the data it shows.
 */

/** The part of the page's hook and of the chart that these specs use. */
interface PageWindow {
  __ganttPlayground?: { gantt(): ChartHandle | undefined };
}
interface ChartHandle {
  setViewMode(id: string): void;
  scrollToTask(id: string, options?: object): void;
  readonly edit: { readonly isOpen: boolean };
  readonly core: {
    getSnapshot(): { viewMode: { id: string }; editing: { move: boolean } };
  };
}

/**
 * Opens the page and waits for the chart to be mounted. The chart opens on today, far from the
 * plan, so no bar is drawn yet.
 */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/vanilla/${query}`);
  await expect(page.locator('#gantt .gantt__scroller')).toBeVisible();
  await expect.poll(() => chartState(page)).toBeDefined();
}

const track = (page: Page, id: string): Locator =>
  page.locator(`#gantt .gantt__bar[data-task-id="${id}"] .gantt__bar-track`);
const events = (page: Page): Locator => page.getByTestId('gantt-events');
const changes = (page: Page): Locator => page.getByTestId('edit-changes');
const modeSelect = (page: Page): Locator => page.getByLabel('Mode', { exact: true });
const viewModeSelect = (page: Page): Locator => page.getByLabel('View mode');

/** What the chart says about itself, read from the page. */
const chartState = (
  page: Page,
): Promise<{ viewMode: string; canMove: boolean; open: boolean } | undefined> =>
  page.evaluate(() => {
    const chart = (window as unknown as PageWindow).__ganttPlayground?.gantt();
    if (chart === undefined) return undefined;
    const snapshot = chart.core.getSnapshot();
    return {
      viewMode: snapshot.viewMode.id,
      canMove: snapshot.editing.move,
      open: chart.edit.isOpen,
    };
  });

/** The id of the first or the last task of the page's debug table (the page's own tasks). */
async function taskId(page: Page, which: 'first' | 'last'): Promise<string> {
  const row = page.locator(`[data-testid="debug-table"] tbody tr:${which}-child td:nth-child(2)`);
  // The id column shows a number id as `7 (number)`.
  return ((await row.textContent()) ?? '').replace(/ \(number\)$/, '');
}

/** Whether the bar of a task is drawn and lies inside the chart's scroller, horizontally. */
async function isInView(page: Page, id: string): Promise<boolean> {
  // `boundingBox()` waits for the element to exist: a bar that is not drawn is not in view.
  if ((await track(page, id).count()) === 0) return false;
  const view = await page.locator('#gantt .gantt__scroller').boundingBox();
  const box = await track(page, id).boundingBox();
  return (
    view !== null &&
    box !== null &&
    box.x >= view.x - 1 &&
    box.x + box.width <= view.x + view.width + 1
  );
}

test.describe('the vanilla page (FR-API-2, FR-API-3, FR-EDIT-7)', () => {
  test('FR-API-3, FR-SCALE-3: the view-mode select drives the chart, and follows setViewMode() from code', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page);
    const select = viewModeSelect(page);
    await expect(select).toHaveValue('day');
    expect((await chartState(page))?.viewMode).toBe('day');

    // The select is the chart's view mode ...
    await select.selectOption('week');
    await expect.poll(async () => (await chartState(page))?.viewMode).toBe('week');
    await expect(events(page)).toContainText('viewModeChange: week');
    await expect(page.locator('#gantt .gantt__header-row[data-unit="week"]')).toBeAttached();

    // ... and a change from code is followed by the page's own select, through `onViewModeChange`.
    await page.evaluate(() => {
      (window as unknown as PageWindow).__ganttPlayground?.gantt()?.setViewMode('month');
    });
    await expect(select).toHaveValue('month');
    expect((await chartState(page))?.viewMode).toBe('month');
    await expect(events(page)).toContainText('viewModeChange: month');
    await expect(page.locator('#gantt .gantt__header-row[data-unit="month"]')).toBeAttached();

    // Back to a mode the select started with: the two stay one and the same value.
    await page.evaluate(() => {
      (window as unknown as PageWindow).__ganttPlayground?.gantt()?.setViewMode('day');
    });
    await expect(select).toHaveValue('day');
    expect(problems.list).toEqual([]);
  });

  test('FR-API-3, FR-SCROLL-2: "Scroll to last task" scrolls the chart to the last task of the page', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page);
    const first = await taskId(page, 'first');
    const last = await taskId(page, 'last');
    expect(last).not.toBe(first);
    await page.locator('#gantt').scrollIntoViewIfNeeded();
    // The chart opens on today. Put the first task in view: the last one is far to the right, and
    // not even drawn, so that the button has something to do.
    await page.evaluate((id) => {
      (window as unknown as PageWindow).__ganttPlayground
        ?.gantt()
        ?.scrollToTask(id, { behavior: 'instant' });
    }, first);
    await expect.poll(() => isInView(page, first)).toBe(true);
    expect(await isInView(page, last)).toBe(false);

    await page.getByRole('button', { name: 'Scroll to last task' }).click();

    await expect(track(page, last)).toBeAttached();
    await expect.poll(() => isInView(page, last)).toBe(true);
    expect(problems.list).toEqual([]);
  });

  test('FR-EDIT-7: ?mode=view is editing: false from the start, and the page starts no session', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, '?mode=view');

    await expect(modeSelect(page)).toHaveValue('view');
    await expect(page.getByRole('button', { name: 'Begin editing', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(changes(page)).toContainText('No edit session');
    expect(await chartState(page)).toMatchObject({ canMove: false, open: false });

    // The page's mode is the chart's `editing`, at runtime too: the same chart can begin now.
    await modeSelect(page).selectOption('edit');
    await expect(page.getByRole('button', { name: 'Begin editing', exact: true })).toBeEnabled();
    await expect.poll(async () => (await chartState(page))?.canMove).toBe(true);
    await modeSelect(page).selectOption('view');
    await expect(page.getByRole('button', { name: 'Begin editing', exact: true })).toBeDisabled();
    await expect.poll(async () => (await chartState(page))?.canMove).toBe(false);
    expect(problems.list).toEqual([]);
  });
});

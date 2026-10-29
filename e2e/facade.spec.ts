import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { hoverBar, POPOVER } from './popover-support';

/**
 * E2E of plan step 4.12 (FR-API-1 … FR-API-6, FR-EVT-2): the `createGantt` facade in Chromium,
 * Firefox and WebKit. The vanilla page of the playground is a plain consumer of the facade: it
 * creates the chart with `createGantt`, changes it with `setOptions`, `setViewMode`,
 * `scrollToTask` and `edit.*`, and destroys it with `destroy()`. The specs press its controls
 * and drag with the real mouse; `window.__ganttPlayground.gantt()` is the chart itself, for
 * reading and for what no control does.
 *
 * What a chart does (mounts, switches the view mode, scrolls to a task, takes a theme and a locale
 * at runtime, is dragged, edited in a session, read-only) is a journey shared with React
 * (`journeys-vanilla.spec.ts`); what is left here is what only the vanilla page has: its
 * Begin / Save / Cancel buttons, the strings that follow its locale picker through a remount,
 * `destroy()` and the issues of its options.
 */

/** The part of the facade's chart these specs read; a function given to `page.evaluate` runs in the page. */
interface PageWindow {
  __ganttPlayground?: {
    gantt(): ChartHandle | undefined;
  };
}
interface ChartHandle {
  getTask(id: string): { start: Date } | undefined;
  getBarRect(id: string): { x: number } | undefined;
  getIssues(): { data: unknown[]; options: unknown[] };
  scrollToTask(id: string, options?: object): void;
  setOptions(patch: object): unknown[];
  destroy(): void;
  readonly edit: { readonly isOpen: boolean; readonly isDirty: boolean };
  readonly core: {
    getSnapshot(): {
      viewMode: { id: string };
      editing: { move: boolean };
      timeline: { scale: { pxPerDay: number } };
    };
  };
}

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/**
 * Opens the vanilla page, with the chart of the sample project drawn: it opens on today, which
 * is far from the plan, so the chart is asked to scroll to the first group.
 */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/vanilla/${query}`);
  await expect(page.locator('#gantt .gantt__scroller')).toBeVisible();
  await reveal(page, 'group-1');
}

const scroller = (page: Page): Locator => page.locator('#gantt .gantt__scroller');
const bar = (page: Page, id: string): Locator =>
  page.locator(`#gantt .gantt__bar[data-task-id="${id}"]`);
const track = (page: Page, id: string): Locator => bar(page, id).locator('.gantt__bar-track');
const events = (page: Page): Locator => page.getByTestId('gantt-events');
const changes = (page: Page): Locator => page.getByTestId('edit-changes');

/** Asks the chart to scroll to a task at once, and brings the chart into the page's view. */
async function reveal(page: Page, id: string): Promise<void> {
  await page.evaluate((taskId) => {
    const chart = (window as unknown as PageWindow).__ganttPlayground?.gantt();
    if (chart === undefined) throw new Error('there is no chart');
    chart.scrollToTask(taskId, { behavior: 'instant', align: 'center' });
  }, id);
  await expect(track(page, id)).toBeAttached();
  await page.locator('#gantt').scrollIntoViewIfNeeded();
}

/** Where a bar is drawn, in px of the chart's own coordinates (`getBarRect`). */
const barX = async (page: Page, id: string): Promise<number | undefined> =>
  page.evaluate(
    (taskId) => (window as unknown as PageWindow).__ganttPlayground?.gantt()?.getBarRect(taskId)?.x,
    id,
  );

/** What the chart reports about itself. */
const chartState = async (
  page: Page,
): Promise<{ viewMode: string; canMove: boolean; pxPerDay: number; open: boolean } | undefined> =>
  page.evaluate(() => {
    const chart = (window as unknown as PageWindow).__ganttPlayground?.gantt();
    if (chart === undefined) return undefined;
    const snapshot = chart.core.getSnapshot();
    return {
      viewMode: snapshot.viewMode.id,
      canMove: snapshot.editing.move,
      pxPerDay: snapshot.timeline.scale.pxPerDay,
      open: chart.edit.isOpen,
    };
  });

/** Drags the body of a bar sideways with the real mouse. */
async function dragBar(page: Page, id: string, dx: number): Promise<void> {
  const box = await track(page, id).boundingBox();
  if (box === null) throw new Error(`the bar of ${id} has no box`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test.describe('createGantt (plan step 4.12)', () => {
  test('FR-TX-4: the page’s Begin, Cancel and Save buttons are edit.begin / rollback / commit', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);
    await reveal(page, 'group-2');
    const begin = page.getByRole('button', { name: 'Begin editing' });
    const save = page.getByRole('button', { name: 'Save' });
    const cancel = page.getByRole('button', { name: 'Cancel' });
    const px = (await chartState(page))?.pxPerDay ?? 0;
    const start = await barX(page, 'group-2');
    await expect(save).toBeDisabled();

    // Cancel puts everything back.
    await begin.click();
    await expect(changes(page)).toContainText('Editing, not changed yet');
    expect((await chartState(page))?.open).toBe(true);
    await dragBar(page, 'group-2', 2 * px);
    await expect(changes(page)).toContainText('Editing, changed');
    await expect(changes(page)).toContainText('group-2:');
    expect(await barX(page, 'group-2')).toBeGreaterThan((start ?? 0) + px);
    await cancel.click();
    await expect(changes(page)).toContainText('Cancelled');
    await expect(changes(page)).toContainText('group-2:');
    expect((await chartState(page))?.open).toBe(false);
    await expect.poll(async () => barX(page, 'group-2')).toBe(start);

    // Save keeps them.
    await begin.click();
    await dragBar(page, 'group-2', 2 * px);
    const moved = await barX(page, 'group-2');
    await save.click();
    await expect(changes(page)).toContainText('Saved');
    await expect(changes(page)).toContainText('group-2:');
    expect((await chartState(page))?.open).toBe(false);
    expect(await barX(page, 'group-2')).toBe(moved);
    await expect(save).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('FR-I18N-2: the strings of the picked locale survive a remount, and the URL’s overrides survive a switch of locale', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const tooltip = { tooltip: { delay: 0 } };
    await open(page, `?display=${encodeURIComponent(JSON.stringify(tooltip))}`);

    // The picked locale brings the Ukrainian words, and a chart mounted again keeps them.
    await page.getByLabel('Locale').selectOption('uk');
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Діаграма Ганта');
    await page.getByRole('button', { name: 'Destroy' }).click();
    await page.getByRole('button', { name: 'Mount' }).click();
    await reveal(page, 'group-1');
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Діаграма Ганта');
    await hoverBar(page, 'group-1');
    await expect(page.locator(`${POPOVER} .gantt__popover-details`)).toContainText('виконано');

    // Back to English: every key of the pack is put back, not only the ones the page names.
    await page.getByLabel('Locale').selectOption('en');
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Gantt chart');
    await expect(page.locator(`${POPOVER} .gantt__popover-details`)).toContainText('done');
    await expect(page.locator(`${POPOVER} .gantt__popover-details`)).not.toContainText('виконано');

    // What the URL sets stays on top of whichever pack the locale brings.
    await open(
      page,
      `?display=${encodeURIComponent(JSON.stringify(tooltip))}&strings=${encodeURIComponent(JSON.stringify({ chartLabel: 'Plan' }))}`,
    );
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Plan');
    await page.getByLabel('Locale').selectOption('uk');
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Plan');
    await hoverBar(page, 'group-1');
    await expect(page.locator(`${POPOVER} .gantt__popover-details`)).toContainText('виконано');
    await page.getByRole('button', { name: 'Destroy' }).click();
    await page.getByRole('button', { name: 'Mount' }).click();
    await expect(scroller(page)).toHaveAttribute('aria-label', 'Plan');
    expect(errors).toEqual([]);
  });

  test('FR-API-4: destroy leaves the container empty, a second destroy is harmless, and a chart can be mounted again', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page);

    for (let round = 0; round < 3; round++) {
      await page.getByRole('button', { name: 'Destroy' }).click();
      await expect(page.locator('#gantt > *')).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as unknown as PageWindow).__ganttPlayground?.gantt()),
      ).toBeUndefined();
      await expect(page.getByRole('button', { name: 'Mount' })).toBeEnabled();

      await page.getByRole('button', { name: 'Mount' }).click();
      await expect(page.locator('#gantt > .gantt')).toHaveCount(1);
      // The new chart opens on today, far from the plan: it draws the plan once it is shown it.
      await reveal(page, 'group-1');
      const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
      expect(new Set(ids).size).toBe(ids.length);
    }

    // Twice in a row, from code: the second does nothing.
    await page.evaluate(() => {
      const chart = (window as unknown as PageWindow).__ganttPlayground?.gantt();
      chart?.destroy();
      chart?.destroy();
    });
    await expect(page.locator('#gantt > *')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('FR-API-2: the options of the page reach the chart, and a bad one is an issue with its path', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await open(page, `?display=${encodeURIComponent(JSON.stringify({ tooltip: { delay: -3 } }))}`);

    const issues = await page.evaluate(
      () =>
        (window as unknown as PageWindow).__ganttPlayground?.gantt()?.getIssues().options as {
          code: string;
          path: string;
        }[],
    );

    expect(issues).toMatchObject([{ code: 'invalid-option', path: 'tooltip.delay' }]);
    await expect(events(page)).toContainText('issues (options): tooltip.delay');
    // The same list comes back from `setOptions`, and fixing the option empties it.
    const fixed = await page.evaluate(() =>
      (window as unknown as PageWindow).__ganttPlayground
        ?.gantt()
        ?.setOptions({ tooltip: { delay: 0 } }),
    );
    expect(fixed).toEqual([]);
    await expect(events(page)).toContainText('issues (options): none');
    expect(errors).toEqual([]);
  });
});

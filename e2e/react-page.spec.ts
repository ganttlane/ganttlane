import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  boxOf,
  BUILDS,
  button,
  centre,
  CHART,
  chartRoot,
  dragBar,
  eventLog,
  openReact,
  pageDates,
  revealTask,
  settled,
  trackOf,
  watchPage,
} from './react-support';

/**
 * The React page as a whole (plan step 5.4, FR-REACT-1, FR-REACT-3, FR-REACT-4, FR-REACT-5): one
 * chart however it is mounted (the page wraps itself in `<StrictMode>`), a new fixture is a new
 * chart with new data, and the slots (the `renderTooltip` and `renderBarLabel` props) can be given
 * and taken away while it runs.
 *
 * Every spec runs on all the builds of `BUILDS` (production, development, and development with
 * React 18.3). `<StrictMode>` only does anything in the development ones: its effects run twice
 * there, and React reports what it dislikes through `console.error`. Nothing may be reported.
 */

interface PageWindow {
  __reactLabels?: number;
  __ganttReact?: { getTask(id: string): { name: string } | undefined } | null;
}

/** The labels of React that are mounted and not unmounted: what a left-behind portal would add to. */
const mountedLabels = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as PageWindow).__reactLabels ?? 0);

/** The name of a task as the `ref` handle the page has says it, or `undefined` for no handle. */
const handleKnows = (page: Page, id: string): Promise<string | undefined> =>
  page.evaluate(
    (taskId) => (window as unknown as PageWindow).__ganttReact?.getTask(taskId)?.name,
    id,
  );

for (const build of BUILDS) {
  test.describe(`React page, ${build.name}`, () => {
    test('mounts one chart, drawn by the vanilla renderer, with the page’s controls', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);

      // One container, one chart in it: the renderer's skeleton, once.
      await expect(page.locator(CHART)).toHaveCount(1);
      await expect(page.locator(`${CHART} > .gantt`)).toHaveCount(1);
      await expect(page.locator('.gantt__scroller')).toHaveCount(1);
      await expect(page.locator('svg.gantt__body')).toHaveCount(1);
      // It is the React the build is named for (the 18.3 build is a real 18.3, not 19 under another name).
      await expect(page.getByTestId('react-version')).toHaveText(
        new RegExp(`^React ${build.react}\\.`),
      );
      await expect(page.getByLabel('Mode')).toHaveValue('edit');
      await expect(page.getByLabel('Theme')).toHaveValue('auto');
      await expect(page.getByLabel('Locale')).toHaveValue('en');
      // The `ref` handle is the one chart's (set once the chart is committed).
      expect(await handleKnows(page, 'group-1')).toBe('Planning');
      // The chart sizes itself from its container: the page is not blank.
      await expect(chartRoot(page)).toHaveCSS('--gantt-content-width', /^\d+(\.\d+)?px$/);
      expect(problems.list).toEqual([]);
    });

    test('a new fixture is a new chart: one chart, the data of the new fixture, settings kept', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      await page.getByLabel('Theme').selectOption('dark');
      await page.getByLabel('Locale').selectOption('uk');
      await dragBar(page, 'task-9', 1);
      await expect(eventLog(page)).toContainText('tasksChange');
      await expect.poll(async () => (await pageDates(page, 'task-9')).start).toBe('2026-05-01');

      await page.getByLabel('Fixture').selectOption('generated-1k');
      await expect(page.getByTestId('debug-table')).toHaveAttribute('data-fixture', 'generated-1k');
      await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();
      await page.getByLabel('Fixture').selectOption('sample-project');
      await expect(page.getByTestId('debug-table')).toHaveAttribute(
        'data-fixture',
        'sample-project',
      );
      await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();

      // Replaced, not stacked; every id of the page is still unique.
      await expect(page.locator('.stub .gantt')).toHaveCount(1);
      await expect(page.locator('.stub .gantt__scroller')).toHaveCount(1);
      const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
      expect(new Set(ids).size).toBe(ids.length);
      // The page's data and log belong to the fixture's view: they start again.
      expect(await pageDates(page, 'task-9')).toEqual({
        start: '2026-04-30',
        end: '2026-05-06',
      });
      await expect(eventLog(page).locator('li')).toHaveCount(0);
      // The settings belong to the page: they stay, and the new chart has them from its start.
      await expect(chartRoot(page)).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator(`${CHART} .gantt__scroller`)).toHaveAttribute(
        'aria-label',
        'Діаграма Ганта',
      );
      // The handle is the new chart's (a stale one would be `null` or know no task).
      expect(await handleKnows(page, 'group-1')).toBe('Planning');
      expect(problems.list).toEqual([]);
    });

    test('a fixture the URL does not know is reported, and the default is shown, once', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build, { fixture: 'nope' });

      await expect(page.getByRole('status')).toContainText('Unknown fixture "nope"');
      await expect(page.getByTestId('debug-table')).toHaveAttribute(
        'data-fixture',
        'sample-project',
      );
      await expect(page.locator(`${CHART} > .gantt`)).toHaveCount(1);
      expect(problems.list).toEqual([]);
    });

    test('the slots can be given and taken away while the chart runs, and no portal is left behind', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      const labels = page.locator(`${CHART} .gantt__bar-label .react-label`);
      await expect(labels).toHaveCount(0);
      expect(await mountedLabels(page)).toBe(0);

      await page.getByLabel('React slots').check();

      // One React label for every bar that is drawn (the chart's own text labels are gone).
      await expect(labels.first()).toBeVisible();
      await expect(labels.first()).toHaveAttribute('data-page', 'playground');
      await expect(labels).toHaveCount(await page.locator(`${CHART} .gantt__bar`).count());
      await expect(page.locator(`${CHART} text.gantt__bar-label`)).toHaveCount(0);
      // StrictMode runs the effects twice in the development build, and still each is mounted once.
      await settled(page);
      expect(await mountedLabels(page)).toBe(await labels.count());

      await page.getByLabel('React slots').uncheck();

      await expect(labels).toHaveCount(0);
      await expect(page.locator(`${CHART} text.gantt__bar-label`).first()).toBeAttached();
      await settled(page);
      expect(await mountedLabels(page)).toBe(0);
      await expect(page.locator(`${CHART} > .gantt`)).toHaveCount(1);
      expect(problems.list).toEqual([]);
    });

    test('a click opens the tooltip of React, whose state is its own, and Escape closes it', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build, { slots: '1' });
      await revealTask(page, 'group-1');
      const box = await boxOf(trackOf(page, 'group-1'));
      const at = centre(box);

      await page.mouse.click(at.x, at.y);

      const popover = page.locator('.gantt__layer > .gantt__popover');
      await expect(popover).toBeVisible();
      await expect(popover.getByTestId('react-tooltip-title')).toHaveText('Planning');
      // It reads the page's context, and counts with a state of its own (the popover takes pointer events).
      await expect(popover.getByTestId('react-tooltip-context')).toHaveText('playground');
      const counter = popover.getByTestId('react-tooltip-counter');
      await counter.click();
      await counter.click();
      await expect(counter).toHaveText('Clicked 2');

      await page.keyboard.press('Escape');

      await expect(popover).toHaveCount(0);
      await expect(page.locator('[data-slot="tooltip"]')).toHaveCount(0);
      expect(problems.list).toEqual([]);
    });

    test('with the slots, a drag moves the bar and the React label with it, and Cancel brings both back', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build, { slots: '1' });
      await expect(page.getByLabel('React slots')).toBeChecked();
      await button(page, 'Begin editing').click();

      await dragBar(page, 'task-9', 1);
      await expect.poll(async () => (await pageDates(page, 'task-9')).start).toBe('2026-05-01');
      const labels = page.locator(`${CHART} .gantt__bar-label .react-label`);
      await expect(labels).toHaveCount(await page.locator(`${CHART} .gantt__bar`).count());

      await button(page, 'Cancel').click();

      await expect.poll(async () => (await pageDates(page, 'task-9')).start).toBe('2026-04-30');
      await settled(page);
      await expect(labels).toHaveCount(await page.locator(`${CHART} .gantt__bar`).count());
      expect(await mountedLabels(page)).toBe(await labels.count());
      expect(problems.list).toEqual([]);
    });
  });
}

/**
 * Helpers of the React page specs (`e2e/react-*.spec.ts`, plan step 5.4): opening the React page
 * of the playground in one of its builds, watching what the browser reports, finding bars and
 * the page's own data, and dragging with the real mouse. The page is `apps/playground/src/react-app.tsx`;
 * its test hook is `window.__ganttReact`, the `ref` handle of the mounted chart.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { boxOf, centre, drag, settled } from './edit-harness';

export type { PageProblems } from './edit-harness';
export { boxOf, centre, drag, expectX, settled, watchPage } from './edit-harness';

/**
 * The builds of the playground (`pnpm --filter playground build`) that the React specs run on:
 *
 * - the production build, which is what an application ships;
 * - one made with React's development bundles (`/dev/`), the only kind where `<StrictMode>` runs
 *   effects twice and React warns about what it dislikes;
 * - the same development build with React 18.3.1 in place of 19 (`/react-18/`, the React of the
 *   `react-18` Vitest project): the real-browser half of the React 18.3 matrix.
 */
export const BUILDS = [
  { name: 'production build', base: '', react: '19' },
  {
    name: 'development build (StrictMode doubles effects, React warns)',
    base: '/dev',
    react: '19',
  },
  {
    name: 'React 18.3 development build (StrictMode, React warns)',
    base: '/react-18',
    react: '18',
  },
] as const;
export type Build = (typeof BUILDS)[number];

/** The chart of the React page. */
export const CHART = '.stub .chart';

/** What the specs read of the `ref` handle the page puts on `window`. */
interface HandleWindow {
  __ganttReact?: {
    scrollToTask(id: string, options?: object): void;
    core: { getSnapshot(): { timeline: { scale: { pxPerDay: number } } } };
  } | null;
}

/**
 * Opens the React page and waits for the chart to be drawn.
 *
 * @param page - The page.
 * @param build - Which build of the playground.
 * @param params - Query parameters of the page (`fixture`, `mode`, `theme`, `locale`, `slots`).
 */
export async function openReact(
  page: Page,
  build: Build,
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  const query = new URLSearchParams(params);
  await page.goto(`${build.base}/react/${query.size === 0 ? '' : `?${query.toString()}`}`);
  await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();
  await settled(page);
}

/** The root of the chart (`.gantt`). */
export const chartRoot = (page: Page): Locator => page.locator(`${CHART} > .gantt`);

/** The drawn bar of a task, and the shape of the bar itself (its group may hold a label). */
export const barOf = (page: Page, id: string): Locator =>
  page.locator(`${CHART} .gantt__bar[data-task-id="${id}"]`);
export const trackOf = (page: Page, id: string): Locator =>
  barOf(page, id).locator('.gantt__bar-track');

/** The row of a task in the page's debug table, which shows the page's own tasks. */
const rowOf = (page: Page, id: string): Locator =>
  page.locator(
    `[data-testid="debug-table"] tbody tr:has(td:nth-child(2):text-is(${JSON.stringify(id)}))`,
  );

/**
 * The dates the page holds for a task, as its debug table shows them (the page's state, not the
 * chart's: the table follows `tasks`).
 *
 * @param page - The page.
 * @param id - The task id.
 * @returns `start` and `end`, as the task has them (ISO dates here).
 */
export async function pageDates(
  page: Page,
  id: string,
): Promise<{ readonly start: string; readonly end: string }> {
  const row = rowOf(page, id);
  return {
    start: (await row.locator('td:nth-child(6)').textContent()) ?? '',
    end: (await row.locator('td:nth-child(7)').textContent()) ?? '',
  };
}

/** The button of the edit controls with this name. */
export const button = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

/** The panel of `edit.getChanges()`, and the log of what the chart reported (newest first). */
export const changesPanel = (page: Page): Locator => page.getByTestId('edit-changes');
export const eventLog = (page: Page): Locator => page.getByTestId('react-events');

/**
 * Brings a task's bar into view, in the chart and on the page, so that the real mouse can use it.
 *
 * @param page - The page.
 * @param id - The task id.
 */
export async function revealTask(page: Page, id: string): Promise<void> {
  await page.locator(CHART).scrollIntoViewIfNeeded();
  await page.evaluate((taskId) => {
    (window as unknown as HandleWindow).__ganttReact?.scrollToTask(taskId, { behavior: 'instant' });
  }, id);
  await expect(barOf(page, id)).toBeAttached();
  // The scroll events of that scroll come a frame late.
  await settled(page);
  await trackOf(page, id).scrollIntoViewIfNeeded();
  await settled(page);
}

/** Pixels per day of the chart's scale. */
export const pxPerDay = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as HandleWindow).__ganttReact?.core.getSnapshot().timeline.scale
        .pxPerDay ?? Number.NaN,
  );

/**
 * Drags a task's bar by whole days with the real mouse and lets what the release set going settle.
 *
 * @param page - The page.
 * @param id - The task id.
 * @param days - How far, in days (negative: back).
 * @returns The left edge of the bar before the drag, and the distance dragged in px.
 */
export async function dragBar(
  page: Page,
  id: string,
  days: number,
): Promise<{ readonly before: number; readonly distance: number }> {
  await revealTask(page, id);
  const box = await boxOf(trackOf(page, id));
  const distance = days * (await pxPerDay(page));
  const from = centre(box);
  await drag(page, from, { x: from.x + Math.round(distance), y: from.y });
  await settled(page);
  return { before: box.x, distance: Math.round(distance) };
}

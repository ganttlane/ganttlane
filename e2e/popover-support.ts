import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Helpers of the popover specs (plan step 4.8). They drive the real mouse: the renderer's pointer
 * input (`mountInput`) tells the core what the mouse does, and the popover layer follows the
 * core's hover and clicks and tracks the pointer from the DOM. The playground's hook
 * (`window.__ganttPlayground.core()`) is only for reading and for scrolling the chart.
 */

/** The parts of the chart's core these specs use. */
interface PlaygroundCore {
  getSnapshot(): {
    layout: {
      rows: { headerHeight: number };
      getBarRect(id: string): { x: number; y: number; width: number; height: number } | undefined;
    };
  };
  getLink(id: string): { editable: boolean } | undefined;
  scrollToTask(id: string, options?: object): unknown;
  scrollToDate(date: string, options?: object): unknown;
}
interface PlaygroundWindow {
  __ganttPlayground?: { core(): PlaygroundCore | undefined };
}

/** Where the popover is, and what the specs measure it against. */
export const POPOVER = '#gantt .gantt__layer > .gantt__popover';

/** A rectangle in page coordinates. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Opens the vanilla playground with the sample project, the chart scrolled to its first group.
 *
 * @param page - The page.
 * @param display - Renderer display options, as `?display=` JSON.
 * @param params - Other query parameters of the playground (`locale`, `strings`).
 */
export async function openChart(
  page: Page,
  display?: object,
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  const query = new URLSearchParams(params);
  if (display !== undefined) query.set('display', JSON.stringify(display));
  const search = query.size === 0 ? '' : `?${query.toString()}`;
  await page.goto(`/vanilla/${search}`);
  await expect(page.locator('#gantt .gantt__scroller')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as PlaygroundWindow).__ganttPlayground
      ?.core()
      ?.scrollToTask('group-1', { behavior: 'instant' });
  });
  await expect(bar(page, 'group-1')).toBeAttached();
  await page.locator('#gantt').scrollIntoViewIfNeeded();
  await frames(page);
}

/**
 * Lets two animation frames pass. The `scroll` events of a scroll that was asked for come a frame
 * late, and one that arrives after a popover opened closes it: wait them out before the pointer
 * goes where a popover is expected.
 *
 * @param page - The page.
 */
export async function frames(page: Page): Promise<void> {
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** The drawn bar of a task. */
export const bar = (page: Page, id: string) =>
  page.locator(`#gantt .gantt__bar[data-task-id="${id}"]`);

/** The shape of the bar itself (its group also holds an outside label, which widens its box). */
export const track = (page: Page, id: string) =>
  bar(page, id).locator('.gantt__bar-track, .gantt__bar-milestone').first();

/**
 * The bounding box of a located element.
 *
 * @param locator - Something visible.
 * @returns Its box.
 */
export async function boxOf(locator: { boundingBox(): Promise<Box | null> }): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return box;
}

/**
 * Scrolls the chart so that only the first `visible` px of a bar are in view, at the right edge
 * of the chart, and its row is in view (the real mouse can only hover what is on screen).
 *
 * @param page - The page.
 * @param id - The task id.
 * @param visible - How much of the bar's start stays in view, px.
 */
export async function scrollBarToRightEdge(page: Page, id: string, visible: number): Promise<void> {
  await page.evaluate(
    ({ taskId, px }) => {
      const core = (window as unknown as PlaygroundWindow).__ganttPlayground?.core();
      const scroller = document.querySelector<HTMLElement>('#gantt .gantt__scroller');
      const rect = core?.getSnapshot().layout.getBarRect(taskId);
      if (!scroller || !rect) throw new Error('no such bar');
      scroller.scrollLeft = rect.x - (scroller.clientWidth - px);
      // The body starts under the sticky header: this puts the row a little below it.
      scroller.scrollTop = Math.max(0, rect.y - 60);
    },
    { taskId: id, px: visible },
  );
}

/**
 * Asks the chart to scroll a date to the middle (the renderer applies it in its next frame, so
 * wait for what you need to be in view).
 *
 * @param page - The page.
 * @param date - An ISO date.
 * @returns The height of the chart's header, which is what the first row starts below.
 */
export async function scrollToDate(page: Page, date: string): Promise<number> {
  const header = await page.evaluate((day) => {
    const core = (window as unknown as PlaygroundWindow).__ganttPlayground?.core();
    if (!core) throw new Error('no chart');
    core.scrollToDate(day, { align: 'center', behavior: 'instant' });
    return core.getSnapshot().layout.rows.headerHeight;
  }, date);
  return header;
}

/**
 * Moves the real mouse to a point of the page; the renderer's input tells the core.
 *
 * @param page - The page.
 * @param x - Page x.
 * @param y - Page y.
 */
export async function movePointer(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
}

/**
 * Moves the pointer onto the middle of a bar.
 *
 * @param page - The page.
 * @param id - The task id.
 * @returns The box of the bar's shape.
 */
export async function hoverBar(page: Page, id: string): Promise<Box> {
  const box = await boxOf(track(page, id));
  await movePointer(page, box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

/**
 * Clicks a link with the real mouse, on the middle of its route (the middle of its box may lie
 * off the route of a link that bends).
 *
 * @param page - The page.
 * @param id - The link id.
 * @param root - Selector of what holds the chart; default `#gantt`.
 */
export async function clickLink(page: Page, id: string, root = '#gantt'): Promise<void> {
  const point = await page
    .locator(`${root} .gantt__link-hit[data-link-id="${id}"]`)
    .evaluate((hit) => {
      const path = hit as unknown as SVGGeometryElement;
      const at = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      if (matrix === null) throw new Error('the link is not drawn');
      return {
        x: at.x * matrix.a + at.y * matrix.c + matrix.e,
        y: at.x * matrix.b + at.y * matrix.d + matrix.f,
      };
    });
  await page.mouse.click(point.x, point.y);
}

/**
 * The id of the first drawn link that can be removed (the sample project has chained groups).
 *
 * @param page - The page.
 * @param root - Selector of what holds the chart; default `#gantt`. Locators go into open shadow
 *   roots, so this finds the links of a chart hosted in one too.
 * @returns The link id.
 */
export async function removableLink(page: Page, root = '#gantt'): Promise<string> {
  const drawn = await page
    .locator(`${root} .gantt__link`)
    .evaluateAll((links) => links.map((link) => (link as SVGElement).dataset.linkId ?? ''));
  const id = await page.evaluate((candidates) => {
    const core = (window as unknown as PlaygroundWindow).__ganttPlayground?.core();
    return candidates.find((linkId) => core?.getLink(linkId)?.editable === true);
  }, drawn);
  if (id === undefined) throw new Error('no removable link is drawn');
  return id;
}

/**
 * The size of the visible page, without scrollbars (what a popover must stay in).
 *
 * @param page - The page.
 * @returns The width and height.
 */
export async function viewportOf(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
}

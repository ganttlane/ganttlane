import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The composition example (`examples/react-compound/`, React only) on the built site: a chart, a
 * task list, a toolbar and a panel that are separate components sharing one chart through
 * `GanttRoot`, and a panel that follows the selected bar (`useGanttBar`) while it is dragged,
 * while the chart scrolls and while the scale changes.
 */

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Opens the page with the demo, in the middle of the window for the mouse to reach. */
async function open(page: Page): Promise<Locator> {
  await page.goto('examples/react-compound/');
  const pane = page.locator('.demo__pane[data-pane="react"]');
  await expect(pane.locator('.gantt__bar').first()).toBeVisible();
  await expect(pane.locator('.gantt-task-list__row').first()).toBeVisible();
  await page.locator('.demo__stage').evaluate((stage) => stage.scrollIntoView({ block: 'center' }));
  return pane;
}

const track = (pane: Locator, id: string): Locator =>
  pane.locator(`.gantt__bar[data-task-id="${id}"] .gantt__bar-track`);

/** The middle of a bar, in the page. */
async function middleOf(pane: Locator, id: string): Promise<{ x: number; y: number }> {
  const box = await track(pane, id).boundingBox();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/**
 * Where the panel is, compared with where the bar is: both in the page. The panel keeps inside the
 * chart's left edge, so a bar that is cut off there is measured from the edge.
 */
async function offsetFromBar(pane: Locator, id: string): Promise<{ x: number; y: number }> {
  const bar = await track(pane, id).boundingBox();
  const panel = await pane.locator('.compound-panel').boundingBox();
  const chart = await pane.locator('.compound-chart').boundingBox();
  return { x: panel!.x - Math.max(bar!.x, chart!.x), y: panel!.y - (bar!.y + bar!.height) };
}

/** Whether the panel is under the bar, at its left edge. */
const isUnder = async (pane: Locator, id: string): Promise<boolean> => {
  const offset = await offsetFromBar(pane, id);
  return Math.abs(offset.x) <= 2 && offset.y > 3 && offset.y < 10;
};

/** A day of the week view, in px: Design runs over nine calendar days, Mar 5 to Mar 13. */
async function dayWidth(pane: Locator): Promise<number> {
  return (await track(pane, 'design').boundingBox())!.width / 9;
}

/** Selects a task with a click on its bar, and waits for the panel. */
async function select(page: Page, pane: Locator, id: string): Promise<Locator> {
  const { x, y } = await middleOf(pane, id);
  await page.mouse.click(x, y);
  const panel = pane.locator('.compound-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('the composition example', () => {
  test('FR-REACT-6: the list, the toolbar and the panel use the chart of the root without a prop', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const pane = await open(page);
    // The list drew the root's rows, and the toolbar's select shows the root's view mode.
    await expect(pane.locator('.gantt-task-list__row')).toHaveCount(7);
    await expect(pane.getByRole('combobox')).toHaveValue('week');
    const panel = await select(page, pane, 'design');
    await expect(panel).toContainText('Design');
    await expect(panel).toContainText('Mar 5 to Mar 13');
    await expect(panel).toContainText('70% done');
    // Under the bar, at its left edge.
    const { x, y } = await offsetFromBar(pane, 'design');
    expect(Math.abs(x)).toBeLessThanOrEqual(2);
    expect(y).toBeGreaterThan(3);
    expect(y).toBeLessThan(10);
    // An empty click clears the selection, and the panel goes.
    const box = await pane.locator('.gantt__scroller').boundingBox();
    await page.mouse.click(box!.x + box!.width - 30, box!.y + box!.height - 10);
    await expect(pane.locator('.compound-panel')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('FR-REACT-6: the panel goes with the bar and shows its draft dates while it is dragged', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const pane = await open(page);
    const panel = await select(page, pane, 'design');
    await expect(panel).not.toHaveAttribute('data-dragging', /.*/);

    const day = await dayWidth(pane);
    const { x, y } = await middleOf(pane, 'design');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2 * day, y, { steps: 8 });
    await expect(panel).toHaveAttribute('data-dragging', '');
    await expect(panel).toContainText('Mar 9 to Mar 17');
    await expect(panel).toContainText('being dragged');
    // Still under the bar. Two working days on, it starts on the Monday: the weekend is skipped.
    await expect.poll(() => isUnder(pane, 'design')).toBe(true);

    await page.mouse.up();
    await expect(panel).not.toHaveAttribute('data-dragging', /.*/);
    await expect(panel).toContainText('Mar 9 to Mar 17');
    await expect(panel).not.toContainText('being dragged');
    // The drop was recorded: the toolbar's Undo, which reads the same chart, turned on.
    await expect(pane.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('FR-REACT-6: the panel follows the bar when the chart scrolls and the scale changes, and goes when the bar is out of view', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const pane = await open(page);
    const panel = await select(page, pane, 'design');
    const scroller = pane.locator('.gantt__scroller');

    await scroller.evaluate((element) => {
      element.scrollLeft += 15;
    });
    await expect.poll(() => isUnder(pane, 'design')).toBe(true);

    await pane.getByRole('combobox').selectOption('day');
    await expect.poll(() => isUnder(pane, 'design')).toBe(true);

    // At the far end of the day view the bar is long gone to the left.
    const before = await scroller.evaluate((element) => element.scrollLeft);
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(pane.locator('.compound-panel')).toHaveCount(0);
    // And back: the panel is there again, under the bar.
    await scroller.evaluate((element, left) => {
      element.scrollLeft = left;
    }, before);
    await expect(panel).toBeVisible();
    expect(errors).toEqual([]);
  });
});

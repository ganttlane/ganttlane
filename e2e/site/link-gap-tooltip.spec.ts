import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The link gaps example (`examples/link-gap-tooltip/`) on the built site, in both modes: the rows of
 * its tooltip are the distance between the bars, also while a bar is dragged, and not the `lag` of
 * the link records, which stays where it was during a drag and can differ from the bars after a drop.
 */
const MODES = ['vanilla', 'react'] as const;
type Mode = (typeof MODES)[number];

/** A day of the week view, in px. */
const DAY = 20;

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Opens the page with the demo in a mode, in the middle of the window for the mouse to reach. */
async function open(page: Page, mode: Mode): Promise<Locator> {
  await page.goto('examples/link-gap-tooltip/');
  const pane = page.locator(`.demo__pane[data-pane="${mode}"]`);
  if (mode === 'react') await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(pane.locator('.gantt__bar').first()).toBeVisible();
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

/** Opens the tooltip of a bar: the pointer leaves first, and comes in on the bar. */
async function hover(page: Page, pane: Locator, id: string): Promise<void> {
  const { x, y } = await middleOf(pane, id);
  await page.mouse.move(2, 2);
  await page.mouse.move(x, y);
}

/** The rows of the tooltip that is open, as a reader sees them: `Design: 3 days after FS`. */
const rows = (pane: Locator): Promise<string[]> =>
  pane
    .locator('.gantt__popover li')
    .evaluateAll((items) =>
      items.map((item) => [...item.children].map((cell) => cell.textContent).join(' ')),
    );

/** The days on the screen from the end of one bar to the start of another. */
async function daysBetween(pane: Locator, from: string, to: string): Promise<number> {
  const [end, start] = [await track(pane, from).boundingBox(), await track(pane, to).boundingBox()];
  return Math.round((start!.x - (end!.x + end!.width)) / DAY);
}

for (const mode of MODES) {
  test.describe(`the link gaps example (${mode})`, () => {
    test(`FR-EDIT-8: while Build is dragged its rows follow the bar, and the drop keeps them (${mode})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const pane = await open(page, mode);
      const note = pane.locator('.gantt__popover .gap-card-note').first();

      // At rest: two predecessors, one row per link.
      await hover(page, pane, 'build');
      await expect
        .poll(() => rows(pane))
        .toEqual(['Design: 3 days after FS', 'Backend: 1 day before FS']);
      await expect(note).toHaveText('Mar 10, 2026 to Mar 12, 2026');

      // Two days later, the button still down: the link records have not changed, the bars have.
      const { x, y } = await middleOf(pane, 'build');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 2 * DAY, y, { steps: 8 });
      await expect
        .poll(() => rows(pane))
        .toEqual(['Design: 5 days after FS', 'Backend: 1 day after FS']);
      await expect(note).toHaveText('Mar 12, 2026 to Mar 14, 2026 (moving)');
      // And that is the distance on the screen.
      await expect.poll(() => daysBetween(pane, 'design', 'build')).toBe(5);
      await expect.poll(() => daysBetween(pane, 'backend', 'build')).toBe(1);

      await page.mouse.up();
      await expect(note).toHaveText('Mar 12, 2026 to Mar 14, 2026');
      expect(await rows(pane)).toEqual(['Design: 5 days after FS', 'Backend: 1 day after FS']);
      expect(errors).toEqual([]);
    });

    test(`FR-TIP-1: with propagation 'none', a drop that leaves an explicit lag unkept shows the measured gap (${mode})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const pane = await open(page, mode);

      // The link asks for 3 days from the start of Review to the start of Docs, and has them.
      await hover(page, pane, 'docs');
      await expect.poll(() => rows(pane)).toEqual(['Review: 3 days after SS']);
      await expect(pane.locator('.gantt__link[data-link-id="review:SS:docs"]')).not.toHaveAttribute(
        'data-conflict',
        /.*/,
      );

      // Review goes from the Friday to the Monday, the day Docs starts, and Docs stays where it is.
      await pane.getByLabel('Propagation').selectOption('none');
      const { x, y } = await middleOf(pane, 'review');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 3 * DAY, y, { steps: 8 });
      await page.mouse.up();

      // The link still asks for 3 days, and is reported as broken. The row says what there is.
      await expect(pane.locator('.gantt__link[data-link-id="review:SS:docs"]')).toHaveAttribute(
        'data-conflict',
        /.*/,
      );
      await hover(page, pane, 'docs');
      await expect.poll(() => rows(pane)).toEqual(['Review: no gap SS']);
      const [review, docs] = [
        await track(pane, 'review').boundingBox(),
        await track(pane, 'docs').boundingBox(),
      ];
      expect(Math.abs(review!.x - docs!.x)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });

    test(`FR-TIP-1: the rows say no gap, working days, and that a task has no predecessors (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);

      await hover(page, pane, 'review');
      await expect.poll(() => rows(pane)).toEqual(['Build: no gap FS']);
      // Launch counts working days: 4 days on the screen after Review, of which 2 are working days.
      await hover(page, pane, 'launch');
      await expect
        .poll(() => rows(pane))
        .toEqual(['Review: 2 working days after FS', 'Docs: 1 working day after FS']);
      expect(await daysBetween(pane, 'review', 'launch')).toBe(4);
      await hover(page, pane, 'design');
      await expect(pane.locator('.gantt__popover')).toContainText('No predecessors');
      expect(await rows(pane)).toEqual([]);
    });
  });
}

import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The task list example (`examples/task-list/`) on the built site, in both modes: that a reader sees
 * what its README says. How the list behaves is `e2e/task-list.spec.ts`, in all three engines.
 */
const MODES = ['vanilla', 'react'] as const;
type Mode = (typeof MODES)[number];

async function open(page: Page, mode: Mode): Promise<Locator> {
  await page.goto('examples/task-list/');
  const pane = page.locator(`.demo__pane[data-pane="${mode}"]`);
  if (mode === 'react') await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(pane.locator('.gantt__bar').first()).toBeVisible();
  await expect(pane.locator('.gantt-task-list__row').first()).toBeVisible();
  await page.locator('.demo__stage').evaluate((stage) => stage.scrollIntoView({ block: 'center' }));
  return pane;
}

const row = (pane: Locator, id: string): Locator =>
  pane.locator(`.gantt-task-list__row[data-task-id="${id}"]`);

for (const mode of MODES) {
  test.describe(`the task list example (${mode})`, () => {
    test(`FR-ROW-6: the rows lie on the chart's, whichever height the select chooses (${mode})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const pane = await open(page, mode);
      const aligned = async (): Promise<boolean> => {
        const label = await row(pane, 'research').boundingBox();
        const area = await pane.locator('.gantt__row[data-task-id="research"]').boundingBox();
        return label !== null && area !== null && Math.abs(label.y - area.y) <= 1;
      };
      await expect.poll(aligned).toBe(true);
      await expect(row(pane, 'research').locator('[data-column="dates"]')).toContainText('Mar');

      await pane.getByLabel('Height').selectOption('auto');
      await expect(pane.locator('.gantt-task-list')).toHaveAttribute('data-height', 'auto');
      await expect.poll(aligned).toBe(true);

      await pane.getByLabel('Height').selectOption('fixed');
      await expect(pane.locator('.gantt-task-list')).not.toHaveAttribute('data-height', /.*/);
      await expect.poll(aligned).toBe(true);
      expect(errors).toEqual([]);
    });

    test(`FR-ROW-6: names and bars select each other, and the theme reaches the list (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      await row(pane, 'scope').click();
      await expect(row(pane, 'scope')).toHaveAttribute('aria-selected', 'true');
      await expect(pane.locator('p')).toContainText('Selected: scope');
      // The mouse, which does not scroll, as a reader's does.
      const box = await pane
        .locator('.gantt__bar[data-task-id="research"] .gantt__bar-track')
        .boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(row(pane, 'research')).toHaveAttribute('aria-selected', 'true');
      await pane.getByLabel('Theme').selectOption('dark');
      await expect(pane.locator('.gantt-task-list')).toHaveAttribute('data-theme', 'dark');
      await pane.getByRole('button', { name: 'Collapse all' }).click();
      await expect(row(pane, 'research')).toHaveCount(0);
    });
  });
}

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

// Specs run in Node; the root package does not depend on @ganttlane/fixtures, so import its source.
import { edgeCase, sampleProject } from '../internal/fixtures/src/index';

const DEMOS = [
  { name: 'vanilla', path: '/vanilla/' },
  { name: 'react', path: '/react/' },
] as const;

const tableRows = (page: Page) => page.getByTestId('debug-table').locator('tbody tr');

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

test.describe('playground smoke', () => {
  test('index links to both demos', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Gantt playground' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Vanilla/ })).toHaveAttribute('href', '/vanilla/');
    await expect(page.getByRole('link', { name: /React/ })).toHaveAttribute('href', '/react/');
  });

  test('vanilla chart sizes the core from its container and reports scrolling to it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/vanilla/');
    const status = page.getByTestId('gantt-status');
    const scroller = page.locator('#gantt .gantt__scroller');

    // The ResizeObserver reached the core: a real viewport, measured from the page.
    await expect(status).toContainText(/viewport [1-9]\d*×[1-9]\d*/);
    const box = await scroller.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    await expect(status).toContainText(`viewport ${String(box.width)}×${String(box.height)}`);

    // A resize of the container is followed.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect
      .poll(async () => scroller.evaluate((element) => element.clientWidth))
      .toBeLessThan(box.width);
    const resized = await scroller.evaluate((element) => element.clientWidth);
    await expect(status).toContainText(`viewport ${String(resized)}×`);

    // A user scroll is reported back to the core.
    await scroller.evaluate((element) => {
      element.scrollLeft = 123;
    });
    await expect(status).toContainText('scroll 123, 0');
    expect(errors).toEqual([]);
  });

  test('vanilla chart is replaced, not stacked, when the fixture changes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/vanilla/');

    await page.getByLabel('Fixture').selectOption('generated-1k');
    await page.getByLabel('Fixture').selectOption('edge-no-dates');

    await expect(page.locator('#gantt > .gantt')).toHaveCount(1);
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(errors).toEqual([]);
  });

  test('react chart is replaced, not stacked, when the fixture changes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/react/');

    await page.getByLabel('Fixture').selectOption('generated-1k');
    await page.getByLabel('Fixture').selectOption('edge-no-dates');

    await expect(page.locator('.stub .gantt')).toHaveCount(1);
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(errors).toEqual([]);
  });
});

for (const demo of DEMOS) {
  test.describe(`${demo.name} fixture debug page`, () => {
    test('shows sample-project by default', async ({ page }) => {
      const errors = trackErrors(page);

      await page.goto(demo.path);

      await expect(page.getByLabel('Fixture')).toHaveValue('sample-project');
      await expect(tableRows(page)).toHaveCount(sampleProject.tasks.length);
      await expect(page.getByTestId('fixture-summary')).toContainText(
        `${sampleProject.tasks.length} tasks`,
      );
      expect(errors).toEqual([]);
    });

    test('picking a fixture updates the table and the URL', async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(demo.path);

      await page.getByLabel('Fixture').selectOption('generated-1k');
      await expect(tableRows(page)).toHaveCount(1000);
      await expect(page).toHaveURL(/\?fixture=generated-1k$/);

      await page.getByLabel('Fixture').selectOption('edge-no-dates');
      await expect(tableRows(page)).toHaveCount(edgeCase('no-dates').tasks.length);
      await expect(tableRows(page).first()).toContainText('no dates');
      expect(errors).toEqual([]);
    });

    test('restores the fixture from the URL and survives a reload', async ({ page }) => {
      await page.goto(`${demo.path}?fixture=edge-link-cycle`);

      await expect(page.getByLabel('Fixture')).toHaveValue('edge-link-cycle');
      await expect(tableRows(page)).toHaveCount(edgeCase('link-cycle').tasks.length);

      await page.reload();
      await expect(page.getByLabel('Fixture')).toHaveValue('edge-link-cycle');
    });

    test('falls back to sample-project for an unknown fixture', async ({ page }) => {
      await page.goto(`${demo.path}?fixture=does-not-exist`);

      await expect(page.getByRole('status')).toContainText('does-not-exist');
      await expect(tableRows(page)).toHaveCount(sampleProject.tasks.length);
    });
  });
}

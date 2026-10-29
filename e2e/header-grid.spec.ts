import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/** What the header layer drew, read in one task: rows, cells and the sticky label per row. */
interface HeaderState {
  readonly scrollLeft: number;
  readonly rows: readonly {
    readonly unit: string | undefined;
    readonly cells: number;
    readonly sticky: readonly { readonly x: number; readonly width: number }[];
  }[];
}

const readHeader = async (page: Page): Promise<HeaderState> =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#gantt .gantt__scroller');
    const length = (element: HTMLElement, name: string): number =>
      Number.parseFloat(element.style.getPropertyValue(name));
    return {
      scrollLeft: scroller?.scrollLeft ?? -1,
      rows: [...document.querySelectorAll<HTMLElement>('#gantt .gantt__header-row')].map((row) => ({
        unit: row.dataset.unit,
        cells: row.querySelectorAll('.gantt__header-cell').length,
        sticky: [...row.querySelectorAll<HTMLElement>('.gantt__header-label[data-sticky]')].map(
          (label) => {
            const cell = label.closest<HTMLElement>('.gantt__header-cell')!;
            return {
              x: length(cell, 'left'),
              width: length(cell, 'width'),
            };
          },
        ),
      })),
    };
  });

test.describe('header and grid layers (plan step 4.2)', () => {
  test('vanilla chart draws the header rows and the grid groups of the unstyled contract', async ({
    page,
  }) => {
    const errors = trackErrors(page);

    await page.goto('/vanilla/');

    const root = page.locator('#gantt > .gantt');
    // Two header rows in the day mode, top first, each with cells of its own unit.
    await expect(root.locator('.gantt__header > .gantt__header-row')).toHaveCount(2);
    await expect(root.locator('.gantt__header-row[data-row="0"]')).toHaveAttribute(
      'data-unit',
      'month',
    );
    await expect(root.locator('.gantt__header-row[data-row="1"]')).toHaveAttribute(
      'data-unit',
      'day',
    );
    await expect(
      root.locator('.gantt__header-row[data-row="1"] .gantt__header-cell').first(),
    ).toBeAttached();
    await expect(
      root.locator('.gantt__header-cell').first().locator('.gantt__header-label'),
    ).not.toBeEmpty();
    // The grid: its groups in order, with a background per drawn row.
    const groups = await root
      .locator('svg.gantt__body > g.gantt__grid > g')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('class')));
    expect(groups).toEqual([
      'gantt__rows',
      'gantt__nonworking',
      'gantt__highlights',
      'gantt__gridlines',
    ]);
    expect(await root.locator('.gantt__row').count()).toBeGreaterThan(0);
    expect(
      await root.locator('.gantt__gridline[data-orientation="vertical"]').count(),
    ).toBeGreaterThan(10);
    expect(
      await root.locator('.gantt__gridline[data-orientation="horizontal"]').count(),
    ).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('scrolling keeps the drawn nodes, moves the sticky label and bounds the cell count', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/vanilla/');
    const scroller = page.locator('#gantt .gantt__scroller');
    await expect(scroller.locator('.gantt__header-cell').first()).toBeAttached();

    // Mark the drawn nodes: a node that is redrawn keeps its mark, a new one has none.
    const count = async (): Promise<{ marked: number; total: number }> =>
      page.evaluate(() => {
        const nodes = [
          ...document.querySelectorAll('#gantt .gantt__header *, #gantt .gantt__grid *'),
        ];
        return {
          marked: nodes.filter((node) => (node as unknown as { __kept?: boolean }).__kept === true)
            .length,
          total: nodes.length,
        };
      });
    const total = await page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll('#gantt .gantt__header *, #gantt .gantt__grid *'),
      ];
      for (const node of nodes) (node as unknown as { __kept?: boolean }).__kept = true;
      return nodes.length;
    });
    const before = await readHeader(page);
    expect(before.rows).toHaveLength(2);
    // Each row has exactly one sticky label, in the cell under the left edge.
    for (const row of before.rows) {
      expect(row.sticky).toHaveLength(1);
      expect(row.sticky[0]!.x).toBeLessThanOrEqual(before.scrollLeft);
      expect(row.sticky[0]!.x + row.sticky[0]!.width).toBeGreaterThan(before.scrollLeft);
    }

    // A few px (the chart opens at the far end, so scroll back): inside the drawn window, nothing is
    // redrawn.
    const start = before.scrollLeft;
    await scroller.evaluate((element, left) => {
      element.scrollLeft = left;
    }, start - 3);
    await expect.poll(async () => (await readHeader(page)).scrollLeft).toBe(start - 3);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await count()).toEqual({ marked: total, total });

    // A long way: the window moves, most cells are new, the count stays bounded.
    await scroller.evaluate((element, left) => {
      element.scrollLeft = left;
    }, start - 1500);
    await expect.poll(async () => (await readHeader(page)).scrollLeft).toBe(start - 1500);
    await expect.poll(async () => (await count()).marked).toBeLessThan(total);
    const after = await readHeader(page);
    for (const row of after.rows) {
      expect(row.cells).toBeLessThan(100);
      expect(row.sticky).toHaveLength(1);
      expect(row.sticky[0]!.x).toBeLessThanOrEqual(after.scrollLeft);
      expect(row.sticky[0]!.x + row.sticky[0]!.width).toBeGreaterThan(after.scrollLeft);
    }
    expect((await count()).total).toBeLessThan(total * 2);
    expect(errors).toEqual([]);
  });

  test('replacing the fixture leaves one header and one grid, with no stale nodes', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/vanilla/');

    await page.getByLabel('Fixture').selectOption('generated-1k');
    await page.getByLabel('Fixture').selectOption('edge-no-dates');

    await expect(page.locator('#gantt .gantt__header')).toHaveCount(1);
    await expect(page.locator('#gantt .gantt__grid')).toHaveCount(1);
    // A fixture of undated tasks still draws its rows, as placeholders.
    await expect(page.locator('#gantt .gantt__row[data-placeholder]').first()).toBeAttached();
    expect(errors).toEqual([]);
  });

  test('every fixture of the playground draws a header and a grid without errors', async ({
    page,
  }) => {
    // Twenty-odd fixtures, some large, in one test: under a full parallel run it needs more than
    // the default 30 s.
    test.slow();
    const errors = trackErrors(page);
    await page.goto('/vanilla/');
    const ids = await page
      .getByLabel('Fixture')
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(ids.length).toBeGreaterThan(20);

    for (const id of ids) {
      await page.getByLabel('Fixture').selectOption(id);
      await expect(page.locator('#gantt .gantt__header-row')).toHaveCount(2);
      await expect(page.locator('#gantt .gantt__grid > .gantt__rows')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });
});

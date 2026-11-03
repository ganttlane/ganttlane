import { expect, type Locator, type Page, test } from '@playwright/test';

import { BUILDS } from './react-support';

/**
 * The built-in task list (plan step 7.2, FR-ROW-6, FR-REACT-8), on both renderers, written once:
 * `/task-list/` is `createTaskList`, `/react-task-list/` is `<TaskList>`. What is checked is what a
 * browser alone can say: that the rows lie where the chart's rows lie, whatever scrolls, and that
 * the real wheel, mouse and keyboard do what they should. The pages' settings are in
 * `apps/playground/src/task-list-plan.ts`.
 */
const RENDERERS = [
  { name: 'vanilla', path: '/task-list/' },
  { name: 'React', path: '/react-task-list/' },
] as const;
type Renderer = (typeof RENDERERS)[number];

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function open(
  page: Page,
  renderer: Renderer,
  params: Readonly<Record<string, string>> = {},
  base = '',
): Promise<void> {
  const query = new URLSearchParams(params).toString();
  await page.goto(`${base}${renderer.path}?${query}`);
  await expect(page.locator('.gantt__bar').first()).toBeVisible();
  await expect(page.locator('.gantt-task-list__row').first()).toBeVisible();
  // React's page sets its hook in an effect, after the commit that draws the bars.
  await page.waitForFunction(() => '__gantt' in window);
  await page.evaluate(() => document.fonts.ready);
}

const row = (page: Page, id: string): Locator =>
  page.locator(`.gantt-task-list__row[data-task-id="${id}"]`);
const chartRow = (page: Page, id: string): Locator =>
  page.locator(`.gantt__row[data-task-id="${id}"]`);
const bar = (page: Page, id: string): Locator => page.locator(`.gantt__bar[data-task-id="${id}"]`);
const toggle = (page: Page, id: string): Locator => row(page, id).locator('[data-toggle]');

/** How far the rows the list and the chart both drew are from each other. */
async function misalignment(page: Page): Promise<{ rows: number; worst: number }> {
  return page.evaluate(() => {
    let rows = 0;
    let worst = 0;
    for (const item of document.querySelectorAll<HTMLElement>('.gantt-task-list__row')) {
      const area = document.querySelector(
        `.gantt__row[data-task-id="${item.dataset.taskId ?? ''}"]`,
      );
      if (!area) continue;
      const a = item.getBoundingClientRect();
      const b = area.getBoundingClientRect();
      rows += 1;
      worst = Math.max(worst, Math.abs(a.top - b.top), Math.abs(a.height - b.height));
    }
    return { rows, worst };
  });
}

/** Asserts that at least `rows` rows are drawn on both sides, within a pixel of each other. */
async function expectAligned(page: Page, rows = 8): Promise<void> {
  await expect.poll(async () => (await misalignment(page)).rows).toBeGreaterThanOrEqual(rows);
  await expect.poll(async () => (await misalignment(page)).worst).toBeLessThanOrEqual(1);
}

/** What the page's hook says. */
const scrollTopOf = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __gantt: { core: { getSnapshot(): { scrollTop: number } } };
        }
      ).__gantt.core.getSnapshot().scrollTop,
  );

/** What the page's hook says the focused task is. */
const focusedTaskOf = (page: Page): Promise<unknown> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __gantt: { core: { getSnapshot(): { focusedTask: unknown } } };
        }
      ).__gantt.core.getSnapshot().focusedTask,
  );

const scroller = (page: Page): Locator => page.locator('.gantt__scroller');
const listBody = (page: Page): Locator => page.locator('.gantt-task-list__body');

for (const renderer of RENDERERS) {
  test.describe(`the task list (${renderer.name})`, () => {
    test(`FR-ROW-6: the rows lie on the chart's rows, the headers are one band (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer);
      await expectAligned(page);
      const heights = await page.evaluate(() => ({
        list: document.querySelector('.gantt-task-list__header')?.getBoundingClientRect().height,
        chart: document.querySelector('.gantt__header')?.getBoundingClientRect().height,
      }));
      expect(heights.list).toBeGreaterThan(0);
      expect(heights.list).toBe(heights.chart);
      expect(errors).toEqual([]);
    });

    test(`FR-ROW-6: the chart scrolling moves the list, down to the very last row (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await scroller(page).hover();
      await page.mouse.wheel(0, 300);
      await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(200);
      await expectAligned(page);

      await scroller(page).evaluate((element) => {
        element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
      });
      await expectAligned(page);
      await expect(row(page, 't59')).toBeVisible();
      await expect(chartRow(page, 't59')).toBeVisible();
      const [listTop, chartTop] = await Promise.all([
        listBody(page).evaluate((element) => element.scrollTop),
        scroller(page).evaluate((element) => element.scrollTop),
      ]);
      expect(Math.abs(listTop - chartTop)).toBeLessThanOrEqual(1);
    });

    test(`FR-ROW-6: the list scrolling moves the chart: wheel over the names, and sideways stays (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await row(page, 't2').hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(300);
      await expectAligned(page);
      expect(await scroller(page).evaluate((element) => element.scrollLeft)).toBe(0);
      // Back to the top: nothing stays behind.
      await page.mouse.wheel(0, -2000);
      await expect.poll(() => scrollTopOf(page)).toBe(0);
      await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBe(0);
      await expectAligned(page);
    });

    test(`FR-SCROLL-3: with a height of 'auto' one box scrolls both, and the headers stick (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { height: 'auto' });
      await expect(page.locator('.gantt-task-list')).toHaveAttribute('data-height', 'auto');
      await expectAligned(page);
      const box = page.locator('.plan');
      await row(page, 't2').hover();
      await page.mouse.wheel(0, 500);
      // How far a tick goes is the engine's business.
      await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
      await expectAligned(page);
      // The body of the list does not scroll: the box does.
      expect(await listBody(page).evaluate((element) => element.scrollTop)).toBe(0);
      const [boxTop, list, chart] = await Promise.all([
        box.boundingBox(),
        page.locator('.gantt-task-list__header').boundingBox(),
        page.locator('.gantt__pin').boundingBox(),
      ]);
      expect(Math.abs(list!.y - boxTop!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(chart!.y - list!.y)).toBeLessThanOrEqual(1);

      await box.evaluate((element) => {
        element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
      });
      await expectAligned(page);
      await expect(row(page, 't59')).toBeInViewport();

      // The keys scroll the box, below the sticky header.
      await box.evaluate((element) => {
        element.scrollTo({ top: 0, behavior: 'instant' });
      });
      // The chart reads where its host is once a frame.
      await expect.poll(() => scrollTopOf(page)).toBe(0);
      await row(page, 't0').focus();
      await page.keyboard.press('End');
      await expect(row(page, 't59')).toBeFocused();
      await expect(row(page, 't59')).toBeInViewport();
      await page.keyboard.press('Home');
      await expect(row(page, 't0')).toBeFocused();
      const header = (await page.locator('.gantt-task-list__header').boundingBox())!;
      await expect
        .poll(async () => (await row(page, 't0').boundingBox())!.y)
        .toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(errors).toEqual([]);
    });

    test(`FR-ROW-2: a toggle collapses the group in both, and selects nothing (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await expect(row(page, 't0')).toHaveAttribute('aria-expanded', 'true');
      await expect(row(page, 't1')).toHaveAttribute('aria-level', '2');
      await expect(row(page, 't1')).not.toHaveAttribute('aria-expanded', /.*/);

      await toggle(page, 't0').click();
      await expect(row(page, 't0')).toHaveAttribute('aria-expanded', 'false');
      await expect(row(page, 't1')).toHaveCount(0);
      await expect(bar(page, 't1')).toHaveCount(0);
      await expect(row(page, 't0')).toHaveAttribute('aria-selected', 'false');
      await expectAligned(page);

      await toggle(page, 't0').click();
      await expect(row(page, 't1')).toBeVisible();
      await expect(bar(page, 't1')).toHaveCount(1);
      await expectAligned(page);
    });

    test(`FR-SCROLL-2: a click on a name selects the task and scrolls sideways to its bar, not down (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await scroller(page).evaluate((element) => {
        element.scrollTo({ top: 1000, behavior: 'instant' });
      });
      await expectAligned(page);
      const top = await scrollTopOf(page);
      const name = 't35';
      await expect(row(page, name)).toBeInViewport();
      await row(page, name).locator('.gantt-task-list__text').click();

      await expect(row(page, name)).toHaveAttribute('aria-selected', 'true');
      await expect(bar(page, name)).toHaveAttribute('data-selected', /.*/);
      await expect
        .poll(() => scroller(page).evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(1000);
      // The whole bar is in the chart's view, and the row has not moved away from the pointer.
      await expect
        .poll(async () => {
          const area = await scroller(page).boundingBox();
          const shape = await bar(page, name).locator('.gantt__bar-track').boundingBox();
          return (
            shape !== null &&
            area !== null &&
            shape.x >= area.x - 1 &&
            shape.x + shape.width <= area.x + area.width + 1
          );
        })
        .toBe(true);
      expect(Math.abs((await scrollTopOf(page)) - top)).toBeLessThanOrEqual(1);
      await expectAligned(page);

      // A bar already in view does not move the chart.
      const left = await scroller(page).evaluate((element) => element.scrollLeft);
      await row(page, name).click();
      expect(await scroller(page).evaluate((element) => element.scrollLeft)).toBe(left);
    });

    test(`FR-SEL-2: a click on a bar selects its row, and a click on empty space clears it (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      await bar(page, 't2').locator('.gantt__bar-track').click();
      await expect(row(page, 't2')).toHaveAttribute('aria-selected', 'true');
      await expect(bar(page, 't2')).toHaveAttribute('data-selected', /.*/);
      const area = (await scroller(page).boundingBox())!;
      await page.mouse.click(area.x + area.width - 20, area.y + 80);
      await expect(row(page, 't2')).toHaveAttribute('aria-selected', 'false');
    });

    test(`FR-ROW-6: hover lights both sides, in the theme's colour, and leaving puts it out (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      const tint = page.locator('.gantt__row-hover');
      await expect(tint).toHaveAttribute('display', 'none');

      await row(page, 't3').hover();
      await expect(row(page, 't3')).toHaveAttribute('data-hovered', /.*/);
      await expect(chartRow(page, 't3')).toHaveAttribute('data-hovered', /.*/);
      await expect(tint).not.toHaveAttribute('display', /.*/);
      const lit = (await tint.boundingBox())!;
      const label = (await row(page, 't3').boundingBox())!;
      expect(Math.abs(lit.y - label.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.height - label.height)).toBeLessThanOrEqual(1);
      const fill = await tint.evaluate((element) => getComputedStyle(element).fill);
      expect(fill).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

      await page.mouse.move(2, 2);
      await expect(page.locator('.gantt-task-list__row[data-hovered]')).toHaveCount(0);
      await expect(page.locator('.gantt__row[data-hovered]')).toHaveCount(0);
      await expect(tint).toHaveAttribute('display', 'none');

      // The pointer on the chart's side, off any bar: the row of the list lights.
      const area = (await chartRow(page, 't1').boundingBox())!;
      const view = (await scroller(page).boundingBox())!;
      await page.mouse.move(view.x + view.width - 30, area.y + area.height / 2);
      await expect(row(page, 't1')).toHaveAttribute('data-hovered', /.*/);
    });

    test(`FR-ROW-6: a chart without a list shows no row hover, and the attribute is there for who wants it (${renderer.name})`, async ({
      page,
    }) => {
      await page.goto(`${renderer.path}?list=0`);
      await expect(page.locator('.gantt__bar').first()).toBeVisible();
      await expect(page.locator('.gantt')).not.toHaveAttribute('data-row-hover', /.*/);
      const area = (await chartRow(page, 't1').boundingBox())!;
      const view = (await scroller(page).boundingBox())!;
      await page.mouse.move(view.x + view.width - 30, area.y + area.height / 2);
      await expect(chartRow(page, 't1')).toHaveAttribute('data-hovered', /.*/);
      const tint = page.locator('.gantt__row-hover');
      const fill = await tint.evaluate((element) => getComputedStyle(element).fill);
      expect(fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    });

    test(`FR-A11Y-2: a treegrid that the keys walk, one tab stop, the focus ring on the row (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      const grid = page.getByRole('treegrid', { name: 'Tasks' });
      await expect(grid).toBeVisible();
      await expect(grid).toHaveAttribute('aria-rowcount', '61');
      await expect(page.locator('.gantt-task-list__row[tabindex="0"]')).toHaveCount(1);

      await row(page, 't0').focus();
      await page.keyboard.press('ArrowDown');
      await expect(row(page, 't1')).toBeFocused();
      await expect(page.locator('.gantt-task-list__row[tabindex="0"]')).toHaveCount(1);
      await expect(row(page, 't1')).toHaveAttribute('tabindex', '0');
      await expect(chartRow(page, 't1')).toHaveAttribute('data-focused', /.*/);
      await page.keyboard.press('ArrowUp');
      await expect(row(page, 't0')).toBeFocused();

      // Left shuts the group, Right opens it, and again goes into it.
      await page.keyboard.press('ArrowLeft');
      await expect(row(page, 't0')).toHaveAttribute('aria-expanded', 'false');
      await expect(row(page, 't1')).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(row(page, 't1')).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(row(page, 't1')).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(row(page, 't0')).toBeFocused();

      // Enter selects and shows the bar.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(row(page, 't1')).toHaveAttribute('aria-selected', 'true');
    });

    test(`FR-A11Y-2: moving past the window scrolls the row in below the header, on both sides (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { tasks: '400' });
      await row(page, 't0').focus();
      await page.keyboard.press('End');
      await expect(row(page, 't399')).toBeFocused();
      await expect(row(page, 't399')).toBeInViewport();
      await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(10_000);
      await expectAligned(page);
      await page.keyboard.press('Home');
      await expect(row(page, 't0')).toBeFocused();
      const header = (await page.locator('.gantt-task-list__header').boundingBox())!;
      await expect
        .poll(async () => (await row(page, 't0').boundingBox())!.y)
        .toBeGreaterThanOrEqual(header.y + header.height - 1);
      await expectAligned(page);
      // Page Down moves about a screen, and walking down follows.
      await page.keyboard.press('PageDown');
      await expect(page.locator('.gantt-task-list__row:focus')).toHaveCount(1);
      const focused = await page.locator('.gantt-task-list__row:focus').getAttribute('data-row');
      expect(Number(focused)).toBeGreaterThan(5);
    });

    test(`FR-SEL-3: the focus stays on its row when the row scrolls away (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { tasks: '400' });
      await row(page, 't1').focus();
      await scroller(page).evaluate((element) => {
        element.scrollTo({ top: 8000, behavior: 'instant' });
      });
      await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(7000);
      await expect(row(page, 't1')).toBeFocused();
      await expectAligned(page);
    });

    test(`FR-SEL-3: a sort leaves the focus on its row, the focused task as it was, and no null is heard (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer, { tasks: '9' });
      await page.evaluate(() => {
        const w = window as unknown as {
          __gantt: {
            getRows(): readonly {
              id: string;
              name: string;
              record: { start: Date; end: Date };
            }[];
            setTasks(tasks: readonly unknown[]): void;
            on(name: string, handler: (record: { id: string } | null) => void): () => void;
          };
          __sort: () => void;
          __heard: unknown[];
        };
        let tasks = w.__gantt.getRows().map(({ id, name, record: { start, end } }) => {
          return { id, name, start, end };
        });
        w.__gantt.setTasks(tasks);
        w.__sort = () => {
          tasks = [...tasks].reverse();
          w.__gantt.setTasks(tasks);
        };
        w.__heard = [];
        w.__gantt.on('focusChange', (record) => {
          w.__heard.push(record?.id ?? null);
        });
      });
      const ids = (): Promise<(string | undefined)[]> =>
        page
          .locator('.gantt-task-list__row')
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.taskId));
      const heard = (): Promise<unknown[]> =>
        page.evaluate(() => (window as unknown as { __heard: unknown[] }).__heard);
      await expect.poll(ids).toHaveLength(9);
      const before = await ids();

      await row(page, 't5').focus();
      // The tab stop is drawn: the row is settled before the rows move.
      await expect(row(page, 't5')).toHaveAttribute('tabindex', '0');
      await page.evaluate(() => {
        (window as unknown as { __sort: () => void }).__sort();
      });
      await expect.poll(ids).toEqual([...before].reverse());
      await expect(row(page, 't5')).toBeFocused();
      expect(await focusedTaskOf(page)).toBe('t5');
      expect(await heard()).toEqual(['t5']);

      // And back: a second sort is no different.
      await page.evaluate(() => {
        (window as unknown as { __sort: () => void }).__sort();
      });
      await expect.poll(ids).toEqual(before);
      await expect(row(page, 't5')).toBeFocused();
      expect(await focusedTaskOf(page)).toBe('t5');
      expect(await heard()).toEqual(['t5']);
      expect(errors).toEqual([]);
    });

    test(`NFR-PERF-3: the list draws the rows the chart draws, not all of them (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { tasks: '2000' });
      const counted = await page.locator('.gantt-task-list__row').count();
      expect(counted).toBeLessThan(40);
      await expect(page.getByRole('treegrid')).toHaveAttribute('aria-rowcount', '2001');
      await scroller(page).evaluate((element) => {
        element.scrollTo({ top: 30_000, behavior: 'instant' });
      });
      await expectAligned(page);
      expect(await page.locator('.gantt-task-list__row').count()).toBeLessThan(40);
    });

    test(`FR-EDIT-1: a drag changes the dates in the list when it is dropped, and the rows stay (${renderer.name})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await open(page, renderer);
      const cell = row(page, 't2').locator('[data-column="dates"]');
      await expect(cell).toHaveText('03-08');
      const box = (await bar(page, 't2').locator('.gantt__bar-track').boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 80, from.y, { steps: 8 });
      await page.mouse.up();
      await expect(cell).not.toHaveText('03-08');
      await expectAligned(page);
      expect(errors).toEqual([]);
    });

    test(`FR-ROW-6: the splitter drags the width, the chart takes the rest, and the rows stay (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer);
      const list = page.locator('.gantt-task-list');
      const before = (await list.boundingBox())!;
      const chartBefore = (await scroller(page).boundingBox())!;
      const splitter = (await page.locator('.gantt-task-list__splitter').boundingBox())!;
      await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + 100);
      await page.mouse.down();
      await page.mouse.move(splitter.x + 60, splitter.y + 100, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await list.boundingBox())!.width)
        .toBeGreaterThan(before.width + 40);
      const after = (await list.boundingBox())!;
      await expect
        .poll(async () => (await scroller(page).boundingBox())!.width)
        .toBeLessThan(chartBefore.width - 40);
      await expectAligned(page);

      await page.locator('.gantt-task-list__splitter').focus();
      await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => (await list.boundingBox())!.width).toBe(after.width - 16);
      await expect(page.getByRole('separator')).toHaveAttribute(
        'aria-valuenow',
        String(Math.round(after.width - 16)),
      );
    });

    test(`FR-THEME-2: the list has the tokens and the theme of the chart (${renderer.name})`, async ({
      page,
    }) => {
      await open(page, renderer, { theme: 'dark' });
      const list = page.locator('.gantt-task-list');
      await expect(list).toHaveAttribute('data-theme', 'dark');
      const [listBackground, chartBackground] = await Promise.all([
        list.evaluate((element) => getComputedStyle(element).backgroundColor),
        page
          .locator('.gantt')
          .evaluate((element) =>
            getComputedStyle(element).getPropertyValue('--gantt-background-color').trim(),
          ),
      ]);
      expect(chartBackground).toBe('#15171c');
      expect(listBackground).toBe('rgb(21, 23, 28)');
      // The theme's blocks say the hover is transparent; a list lights its rows all the same.
      await row(page, 't3').hover();
      await expect(row(page, 't3')).toHaveAttribute('data-hovered', /.*/);
      const lit = await row(page, 't3').evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      );
      expect(lit).toContain('gradient');
      expect(lit).not.toContain('rgba(0, 0, 0, 0)');
      await page.evaluate(() => {
        (
          window as unknown as { __gantt: { setOptions(options: object): void } }
        ).__gantt.setOptions({ theme: 'light' });
      });
      await expect(list).toHaveAttribute('data-theme', 'light');
    });
  });
}

// The rest of the React matrix: what depends on React itself, in the development builds (effects
// run twice, React warns) and with React 18.3.
for (const build of BUILDS.filter((candidate) => candidate.base !== '')) {
  test(`FR-REACT-5: the React list works in the ${build.name}, and React has nothing to say`, async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page, RENDERERS[1], {}, build.base);
    await expectAligned(page);
    await row(page, 't1').click();
    await expect(row(page, 't1')).toHaveAttribute('aria-selected', 'true');
    await toggle(page, 't0').click();
    await expect(row(page, 't1')).toHaveCount(0);
    await row(page, 't0').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 't10')).toBeFocused();
    await row(page, 't0').hover();
    await expect(page.locator('.gantt')).toHaveAttribute('data-row-hover', /.*/);
    expect(errors).toEqual([]);
  });
}

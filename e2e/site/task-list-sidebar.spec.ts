import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The task list beside the chart (`examples/task-list-sidebar/`), on the built site, in both modes:
 * a row of the list for every row of the chart, at the same height and place, whatever scrolls,
 * collapses or changes size; the toggles, the selection and the keys; and the dates that follow a
 * drag.
 */
const MODES = ['vanilla', 'react'] as const;
type Mode = (typeof MODES)[number];

/** Where one row of the list is, compared with the same task's row and bar in the chart. */
interface Alignment {
  readonly id: string;
  /** Distance between the top edges of the list's row and of the chart's row, and of their heights. */
  readonly top: number;
  readonly height: number;
  /** Distance between the centre of the list's row and of the bar; `undefined` when no bar is drawn. */
  readonly bar: number | undefined;
}

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Opens the page with the demo in a mode, and waits until its chart has drawn bars. */
async function open(page: Page, mode: Mode): Promise<Locator> {
  await page.goto('examples/task-list-sidebar/');
  const pane = page.locator(`.demo__pane[data-pane="${mode}"]`);
  if (mode === 'react') await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(pane.locator('.gantt__bar').first()).toBeVisible();
  await expect(pane.locator('.task-list__row').first()).toBeVisible();
  // The text of the page is above the demo: bring the demo into the middle of the window, under the
  // site's header, so that the mouse (which does not scroll) reaches it.
  await page.locator('.demo__stage').evaluate((stage) => stage.scrollIntoView({ block: 'center' }));
  return pane;
}

/** Scrolls the box that holds the list and the chart. */
async function scrollBox(pane: Locator, top: number | 'end'): Promise<void> {
  await pane
    .locator('.task-list-scroller')
    .evaluate(
      (box, to) => box.scrollTo({ top: to === 'end' ? box.scrollHeight : to, behavior: 'instant' }),
      top,
    );
}

/**
 * How far each row of the list is from the same task's row and bar in the chart. The chart draws
 * the rows in view and a few more (and the bars in its horizontal window), so only those are
 * listed.
 */
async function alignment(pane: Locator): Promise<Alignment[]> {
  return pane.locator('.task-list').evaluate((list) => {
    const chart = list.parentElement?.querySelector('.task-list-chart');
    const found: Alignment[] = [];
    for (const row of list.querySelectorAll<HTMLElement>('.task-list__row')) {
      const id = row.dataset.taskId ?? '';
      const area = chart?.querySelector(`.gantt__row[data-task-id="${id}"]`);
      if (!area) continue;
      const bar = chart?.querySelector(
        `.gantt__bar[data-task-id="${id}"] :is(.gantt__bar-track, .gantt__bar-milestone)`,
      );
      const label = row.getBoundingClientRect();
      const areaBox = area.getBoundingClientRect();
      const barBox = bar?.getBoundingClientRect();
      found.push({
        id,
        top: Math.abs(label.top - areaBox.top),
        height: Math.abs(label.height - areaBox.height),
        bar: barBox && Math.abs(label.top + label.height / 2 - (barBox.top + barBox.height / 2)),
      });
    }
    return found;
  });
}

/**
 * Asserts that every row of the list that the chart has drawn is where the chart has it: the same
 * top, the same height, and the centre of its bar at the centre of the label. The chart draws what
 * is in view a frame or two after the box scrolled, so it first waits for `rows` rows, `bars` of
 * which have a bar.
 */
async function expectAligned(pane: Locator, rows: number, bars = 0): Promise<void> {
  await expect
    .poll(async () => {
      const found = await alignment(pane);
      return found.length >= rows && found.filter((row) => row.bar !== undefined).length >= bars;
    })
    .toBe(true);
  for (const row of await alignment(pane)) {
    expect(row.top, `${row.id}: top of the label and of the row`).toBeLessThanOrEqual(1);
    expect(row.height, `${row.id}: height of the label and of the row`).toBeLessThanOrEqual(1);
    if (row.bar !== undefined) {
      expect(row.bar, `${row.id}: centre of the label and of the bar`).toBeLessThanOrEqual(1);
    }
  }
}

const row = (pane: Locator, id: string): Locator =>
  pane.locator(`.task-list__row[data-task-id="${id}"]`);
const bar = (pane: Locator, id: string): Locator =>
  pane.locator(`.gantt__bar[data-task-id="${id}"]`);
/** What of a bar is the bar: its track, or the diamond of a milestone. */
const shape = (pane: Locator, id: string): Locator =>
  bar(pane, id).locator(':is(.gantt__bar-track, .gantt__bar-milestone)');

/** The middle of a bar, in the page. */
async function middleOf(pane: Locator, id: string): Promise<{ x: number; y: number }> {
  const box = await shape(pane, id).boundingBox();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

for (const mode of MODES) {
  test.describe(`the task list beside the chart (${mode})`, () => {
    test(`FR-ROW-5: the labels line up with the bars, at the top, after scrolling down and at the end (${mode})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const pane = await open(page, mode);
      // The month view has the whole plan in a screen, so every row in view has its bar.
      await pane.locator('select').nth(0).selectOption('month');

      await expectAligned(pane, 8, 8);
      await scrollBox(pane, 300);
      await expectAligned(pane, 8, 8);
      await scrollBox(pane, 'end');
      await expectAligned(pane, 8, 8);
      // The headers are one band: the list's header is as tall as the chart's.
      const heights = await pane.locator('.task-list-scroller').evaluate((box) => ({
        list: box.querySelector('.task-list__header')?.getBoundingClientRect().height,
        chart: box.querySelector('.gantt__pin')?.getBoundingClientRect().height,
      }));
      expect(heights.list).toBeGreaterThan(0);
      expect(heights.list).toBe(heights.chart);
      expect(errors).toEqual([]);
    });

    test(`FR-ROW-5: the rows still line up after a row height, a view mode, a collapse and a theme change (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      const select = (index: number) => pane.locator('select').nth(index);

      await expectAligned(pane, 8, 3);
      await select(1).selectOption('44');
      await scrollBox(pane, 200);
      await expectAligned(pane, 6);
      await select(1).selectOption('28');
      await scrollBox(pane, 100);
      await expectAligned(pane, 8);
      await select(0).selectOption('month');
      await expectAligned(pane, 8, 8);
      await select(0).selectOption('day');
      await expectAligned(pane, 8);
      await pane.getByRole('button', { name: 'Collapse all' }).click();
      await expectAligned(pane, 4);
      await select(2).selectOption('dark');
      await expect(pane.locator('.gantt')).toHaveAttribute('data-theme', 'dark');
      await expectAligned(pane, 4);
      await pane.getByRole('button', { name: 'Expand all' }).click();
      await scrollBox(pane, 150);
      await expectAligned(pane, 8);
    });

    test(`FR-SCROLL-3: scrolling the list scrolls the chart with it, and the headers stay (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      const before = await bar(pane, 'research').boundingBox();

      // A wheel over the list, not over the chart: the box that holds both scrolls.
      await row(pane, 'plan').hover();
      await page.mouse.wheel(0, 120);
      await expect
        .poll(async () => (await bar(pane, 'research').boundingBox())?.y ?? 0)
        .toBeLessThan((before?.y ?? 0) - 100);
      await expectAligned(pane, 8, 3);
      // The list's header stays at the top of the box, and so does the chart's.
      const box = (await pane.locator('.task-list-scroller').boundingBox())!;
      const list = (await pane.locator('.task-list__header').boundingBox())!;
      const chart = (await pane.locator('.gantt__pin').boundingBox())!;
      expect(Math.abs(list.y - (box.y + 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(chart.y - list.y)).toBeLessThanOrEqual(1);
    });

    test(`FR-ROW-2: a toggle in the list collapses the group in both, and the list follows a collapse from elsewhere (${mode})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const pane = await open(page, mode);
      const rows = pane.locator('.task-list__row');
      const all = await rows.count();
      expect(all).toBeGreaterThanOrEqual(25);
      await expect(row(pane, 'build')).toHaveAttribute('aria-expanded', 'true');
      await expect(row(pane, 'backend')).toHaveAttribute('aria-level', '2');
      await expect(row(pane, 'data-layer')).toHaveAttribute('aria-level', '3');
      await expect(row(pane, 'data-layer')).not.toHaveAttribute('aria-expanded', /.*/);

      // The chevron of Build: its nine tasks leave the list and the chart.
      await row(pane, 'build').locator('.task-list__toggle').click();
      await expect(row(pane, 'build')).toHaveAttribute('aria-expanded', 'false');
      await expect(row(pane, 'backend')).toHaveCount(0);
      await expect(row(pane, 'integration')).toHaveCount(0);
      await expect(bar(pane, 'backend')).toHaveCount(0);
      await expect(bar(pane, 'integration')).toHaveCount(0);
      // Build itself is still there, and the rows under it moved up: the list and the chart agree.
      await expect(bar(pane, 'build')).toHaveCount(1);
      await expect(rows).toHaveCount(all - 9);
      await expect(pane.locator('p')).toContainText('Open:');
      await expectAligned(pane, 8);
      // Collapsing does not select the group.
      await expect(row(pane, 'build')).toHaveAttribute('aria-selected', 'false');

      await row(pane, 'build').locator('.task-list__toggle').click();
      await expect(row(pane, 'backend')).toBeVisible();
      await expect(rows).toHaveCount(all);

      // From anywhere else (here a button of the page): the list follows `expandedChange`.
      await pane.getByRole('button', { name: 'Collapse all' }).click();
      await expect(rows).toHaveCount(4);
      await expect(bar(pane, 'research')).toHaveCount(0);
      await pane.getByRole('button', { name: 'Expand all' }).click();
      await expect(rows).toHaveCount(all);
      expect(errors).toEqual([]);
    });

    test(`FR-SCROLL-2: a click on a label scrolls the chart to the bar and selects it (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      const scroller = pane.locator('.gantt__scroller');
      const left = (): Promise<number> => scroller.evaluate((element) => element.scrollLeft);
      const start = await left();

      // The last task is weeks to the right of the first screen.
      await scrollBox(pane, 'end');
      const box = pane.locator('.task-list-scroller');
      const down = await box.evaluate((element) => element.scrollTop);
      await row(pane, 'release').locator('.task-list__name').click();

      await expect.poll(left).toBeGreaterThan(start + 400);
      await expect(row(pane, 'release')).toHaveAttribute('aria-selected', 'true');
      await expect(bar(pane, 'release')).toHaveAttribute('data-selected', /.*/);
      // The bar is in the chart's viewport (the scroll is smooth: wait for it to end), and the box
      // did not scroll away from the row that was clicked.
      const inChart = async (): Promise<boolean> => {
        const area = await scroller.boundingBox();
        const milestone = await shape(pane, 'release').boundingBox();
        return (
          milestone !== null &&
          area !== null &&
          milestone.x >= area.x &&
          milestone.x + milestone.width <= area.x + area.width + 1
        );
      };
      await expect.poll(inChart).toBe(true);
      // The scroll was sideways only: the box is where it was.
      expect(Math.abs((await box.evaluate((element) => element.scrollTop)) - down)).toBeLessThan(2);
      await expect(row(pane, 'release')).toBeInViewport();
      await expectAligned(pane, 8, 1);

      // Another label: the selection moves, and so does the chart.
      await scrollBox(pane, 0);
      await row(pane, 'research').locator('.task-list__name').click();
      await expect(row(pane, 'research')).toHaveAttribute('aria-selected', 'true');
      await expect(row(pane, 'release')).toHaveAttribute('aria-selected', 'false');
      await expect.poll(left).toBeLessThan(start + 40);
    });

    test(`FR-ROW-6: a click on a bar selects its row in the list, and a hover on one lights the other (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      const band = pane.locator('.task-list__band');

      const scope = await middleOf(pane, 'scope');
      await page.mouse.click(scope.x, scope.y);
      await expect(row(pane, 'scope')).toHaveAttribute('aria-selected', 'true');
      await expect(bar(pane, 'scope')).toHaveAttribute('data-selected', /.*/);

      // The pointer on a label lights the row of the chart (the band), and leaving puts it out.
      await row(pane, 'research').hover();
      await expect(row(pane, 'research')).toHaveAttribute('data-hovered', /.*/);
      await expect(band).toBeVisible();
      const label = (await row(pane, 'research').boundingBox())!;
      const lit = (await band.boundingBox())!;
      expect(Math.abs(lit.y - label.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(lit.height - label.height)).toBeLessThanOrEqual(1);
      await page.mouse.move(2, 2);
      await expect(band).toBeHidden();
      await expect(pane.locator('.task-list__row[data-hovered]')).toHaveCount(0);

      // The pointer on a bar of the chart lights its label (and the band is that row of the chart).
      const research = await middleOf(pane, 'research');
      await page.mouse.move(research.x, research.y);
      await expect(row(pane, 'research')).toHaveAttribute('data-hovered', /.*/);
      await expect(band).toBeVisible();
    });

    test(`FR-A11Y-2: the list is a tree that the keys walk: arrows, Left and Right, Enter (${mode})`, async ({
      page,
    }) => {
      const pane = await open(page, mode);
      const tree = pane.getByRole('tree', { name: 'Tasks' });
      await expect(tree).toBeVisible();
      await expect(tree.getByRole('treeitem').first()).toHaveAttribute('aria-level', '1');
      // One tab stop.
      await expect(pane.locator('.task-list__row[tabindex="0"]')).toHaveCount(1);

      await row(pane, 'plan').focus();
      await page.keyboard.press('ArrowDown');
      await expect(row(pane, 'research')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(row(pane, 'plan')).toBeFocused();
      // Left on an open group shuts it; Right opens it, and again goes into it.
      await page.keyboard.press('ArrowLeft');
      await expect(row(pane, 'plan')).toHaveAttribute('aria-expanded', 'false');
      await expect(row(pane, 'research')).toHaveCount(0);
      await expect(bar(pane, 'research')).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(row(pane, 'plan')).toHaveAttribute('aria-expanded', 'true');
      await expect(row(pane, 'research')).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(row(pane, 'research')).toBeFocused();
      // Left on a task goes to the group it is in.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(row(pane, 'system-design')).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await expect(row(pane, 'architecture')).toBeFocused();

      // Enter selects and scrolls to the bar.
      await page.keyboard.press('End');
      await expect(row(pane, 'release')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(row(pane, 'release')).toHaveAttribute('aria-selected', 'true');
      await expect(bar(pane, 'release')).toHaveAttribute('data-selected', /.*/);
      await expect(shape(pane, 'release')).toBeInViewport();
      // Going back to the first row scrolls it into view below the sticky header, not under it.
      await page.keyboard.press('Home');
      await expect(row(pane, 'plan')).toBeFocused();
      const header = (await pane.locator('.task-list__header').boundingBox())!;
      await expect
        .poll(async () => (await row(pane, 'plan').boundingBox())!.y)
        .toBeGreaterThanOrEqual(header.y + header.height - 1);
      await expectAligned(pane, 8);
    });

    test(`FR-EDIT-1: dragging a bar changes the dates in the list, and the rows still line up (${mode})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const pane = await open(page, mode);
      const dates = row(pane, 'research').locator('.task-list__dates');
      await expect(dates).toHaveText('2–6 Mar');
      const from = await middleOf(pane, 'research');

      // Four days to the right (20 px a day in the week view).
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y, { steps: 8 });
      await page.mouse.move(from.x + 80, from.y, { steps: 8 });
      await page.mouse.up();

      await expect(dates).toHaveText('6–10 Mar');
      // The successor moved with the link, and its dates followed too.
      await expect(row(pane, 'scope').locator('.task-list__dates')).not.toHaveText('9–10 Mar');
      await expect(pane.locator('p')).toContainText('Research: +4d');
      await expectAligned(pane, 8, 3);
      expect(errors).toEqual([]);
    });
  });
}

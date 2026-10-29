/**
 * The journeys of the chart as a whole, for every renderer (plan step 6.1): it mounts, changes its
 * view mode, scrolls to a task, takes a theme and a locale at runtime, is read-only when told so,
 * extends an infinite timeline as it is scrolled, and shows a tooltip on hover. The editing ones
 * (drag, resize, progress, links, sessions, undo) are in `editing.ts`.
 */
import { expect } from '@playwright/test';

import { boxOf, expectX, settled } from '../edit-harness';
import { POPOVER } from '../popover-support';
import type { ChartDriver } from './driver';
import type { Journey } from './journey';
import { FAR_TASK, LINKED, PLAN, TASKS } from './plans';
import { bar, committed, dragBar, isInView, root, scroller, track } from './support';

const MONTHS = {
  uk: [
    'січень',
    'лютий',
    'березень',
    'квітень',
    'травень',
    'червень',
    'липень',
    'серпень',
    'вересень',
    'жовтень',
    'листопад',
    'грудень',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
} as const;

/** The background of the chart in the light and in the dark theme (`--gantt-background-color`). */
const LIGHT = 'rgb(255, 255, 255)';
const DARK = 'rgb(21, 23, 28)';

/** The labels of the first header row (the months of the day view). */
const MONTH_LABELS = '#gantt .gantt__header-row[data-row="0"] .gantt__header-label';

const startsWithOneOf = (label: string, names: readonly string[]): boolean =>
  names.some((name) => label.startsWith(name));

/** Marks the chart's root element, so that a later check can tell the same element from a new one. */
async function markRoot(driver: ChartDriver): Promise<void> {
  await root(driver.page).evaluate((element) => {
    (element as unknown as { __marked?: boolean }).__marked = true;
  });
}

/** Whether the chart's root is the element that {@link markRoot} marked. */
const isMarked = (driver: ChartDriver): Promise<boolean> =>
  root(driver.page).evaluate(
    (element) => (element as unknown as { __marked?: boolean }).__marked === true,
  );

export const mounts: Journey = {
  name: 'FR-API-1, FR-REACT-1: mounts one chart on the plan, drawn and measured, and mounts a new one in its place',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount(PLAN);

    // Architecture §8: root > scroller > header + body (grid, links, bars, overlay), layer.
    const chart = root(page);
    await expect(page.locator('#gantt > .gantt')).toHaveCount(1);
    await expect(chart).toHaveAttribute('data-theme', 'auto');
    await expect(chart.locator('> .gantt__scroller > .gantt__header')).toBeAttached();
    await expect(chart.locator('> .gantt__scroller > svg.gantt__body')).toBeAttached();
    for (const layer of ['grid', 'links', 'bars', 'overlay']) {
      await expect(chart.locator(`svg.gantt__body > g.gantt__${layer}`)).toBeAttached();
    }
    await expect(chart.locator('> .gantt__layer')).toBeAttached();
    // Every task of the plan has its bar, and the chart is measured: the content is wider than
    // the viewport it was given.
    for (const task of TASKS) await expect(bar(page, task.id)).toBeAttached();
    await expect(chart).toHaveCSS('--gantt-content-width', /^\d+(\.\d+)?px$/);
    expect(
      await scroller(page).evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    expect(await driver.state()).toMatchObject({ viewMode: 'day', canMove: true });
    expect((await driver.state()).viewportWidth).toBeGreaterThan(0);
    expect((await driver.call('getIssues')).options).toEqual([]);
    expect(await driver.read('edit.isOpen')).toBe(false);
    // Nothing happened yet, so nothing is reported. Two frames first: a handler that React calls
    // from an effect gets its chance, and the check is not true just because it came too early.
    await settled(page);
    expect(await driver.changes()).toEqual([]);
    expect(await driver.events()).toEqual([]);

    // A new chart replaces the old one: it is not stacked on it, and ids stay unique.
    await markRoot(driver);
    await driver.mount(LINKED);
    await expect(page.locator('#gantt > .gantt')).toHaveCount(1);
    expect(await isMarked(driver)).toBe(false);
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  },
};

export const viewMode: Journey = {
  name: 'FR-API-3, FR-SCALE-3: switches the view mode, and the chart reports it',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount(PLAN);
    const day = (await driver.state()).pxPerDay;

    await driver.call('setViewMode', 'week');

    await expect.poll(async () => (await driver.state()).viewMode).toBe('week');
    expect((await driver.state()).pxPerDay).toBeLessThan(day);
    await expect.poll(() => driver.events()).toEqual(['viewMode:week']);
    await expect(page.locator('#gantt .gantt__header-row[data-unit="week"]')).toBeAttached();

    await driver.call('setViewMode', 'month');
    await expect.poll(async () => (await driver.state()).viewMode).toBe('month');
    await expect(page.locator('#gantt .gantt__header-row[data-unit="month"]')).toBeAttached();

    await driver.call('setViewMode', 'day');
    await expect.poll(async () => (await driver.state()).viewMode).toBe('day');
    expect((await driver.state()).pxPerDay).toBe(day);
    await expect
      .poll(() => driver.events())
      .toEqual(['viewMode:week', 'viewMode:month', 'viewMode:day']);
  },
};

export const scrollsToTask: Journey = {
  name: 'FR-API-3, FR-SCROLL-2: scrolls to a task that is far away, smoothly and at once',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    await driver.mount({ ...PLAN, tasks: [...TASKS, FAR_TASK] });
    // Half a year to the right: not drawn until the chart gets there.
    await expect(bar(page, FAR_TASK.id)).toHaveCount(0);

    await driver.call('scrollToTask', FAR_TASK.id, { behavior: 'smooth' });

    await expect(track(page, FAR_TASK.id)).toBeAttached();
    await expect.poll(() => isInView(page, FAR_TASK.id)).toBe(true);

    // And back to an early one, at once.
    await driver.call('scrollToTask', 'a', { behavior: 'instant', align: 'center' });
    await expect(track(page, 'a')).toBeAttached();
    await expect.poll(() => isInView(page, 'a')).toBe(true);
  },
};

export const themeAndLocale: Journey = {
  name: 'FR-API-2, FR-THEME-2, FR-I18N-1, FR-I18N-2: the theme and the locale change at runtime, on the same chart',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await page.emulateMedia({ colorScheme: 'light' });
    // No `theme`: the default, `auto`, which follows the system.
    await driver.mount(PLAN);
    await markRoot(driver);
    const chart = root(page);
    // `--gantt-background-color`, the token that the theme swaps, as the stylesheet defines it.
    await expect(chart).toHaveAttribute('data-theme', 'auto');
    await expect(chart).toHaveCSS('background-color', LIGHT);

    // The theme: dark, light, and `auto` again, which follows the system.
    await driver.update({ theme: 'dark' });
    await expect(chart).toHaveAttribute('data-theme', 'dark');
    await expect(chart).toHaveCSS('background-color', DARK);
    await driver.update({ theme: 'light' });
    await expect(chart).toHaveAttribute('data-theme', 'light');
    await expect(chart).toHaveCSS('background-color', LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await driver.update({ theme: 'auto' });
    await expect(chart).toHaveAttribute('data-theme', 'auto');
    await expect(chart).toHaveCSS('background-color', DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(chart).toHaveCSS('background-color', LIGHT);

    // The locale gives the header its month names, and the strings of its language the chart its
    // name; going back puts every word back.
    const months = async (): Promise<string[]> => {
      await expect(page.locator(MONTH_LABELS).first()).toBeAttached();
      return page.locator(MONTH_LABELS).allTextContents();
    };
    const label = page.locator('#gantt .gantt__scroller');
    for (const text of await months()) expect(startsWithOneOf(text, MONTHS.en), text).toBe(true);
    await expect(label).toHaveAttribute('aria-label', 'Gantt chart');

    await driver.update({ locale: 'uk' });
    await expect(label).toHaveAttribute('aria-label', 'Діаграма Ганта');
    await expect
      .poll(async () => (await months()).every((text) => startsWithOneOf(text, MONTHS.uk)))
      .toBe(true);
    for (const text of await months()) {
      expect(
        MONTHS.en.some((name) => text.includes(name)),
        text,
      ).toBe(false);
    }

    await driver.update({ locale: 'en' });
    await expect(label).toHaveAttribute('aria-label', 'Gantt chart');
    await expect
      .poll(async () => (await months()).every((text) => startsWithOneOf(text, MONTHS.en)))
      .toBe(true);

    // The chart was never made again, and there is still one.
    expect(await isMarked(driver)).toBe(true);
    await expect(page.locator('#gantt .gantt')).toHaveCount(1);
  },
};

export const readOnly: Journey = {
  name: 'FR-EDIT-7: a chart with editing: false lets nothing move, and editing can be turned on and off',
  tier: 'lifecycle',
  async run(driver) {
    const { page } = driver;
    await driver.mount({ ...PLAN, editing: false });
    await expect(bar(page, 'a')).toHaveAttribute('data-readonly', '');
    expect((await driver.state()).canMove).toBe(false);
    const start = (await boxOf(track(page, 'a'))).x;

    await dragBar(driver, 'a', 2);

    await settled(page);
    await settled(page);
    expect(await driver.changes()).toEqual([]);
    await expectX(track(page, 'a'), start);

    // `editing` at runtime: the same chart can be moved now.
    await driver.update({ editing: true });
    await expect.poll(async () => (await driver.state()).canMove).toBe(true);
    await expect(bar(page, 'a')).not.toHaveAttribute('data-readonly');
    await dragBar(driver, 'a', 2);
    const changeSet = await committed(driver);
    expect(changeSet.reason).toBe('move');

    // ... and stops being movable when it is turned off again.
    await driver.update({ editing: false });
    await expect.poll(async () => (await driver.state()).canMove).toBe(false);
    const moved = (await boxOf(track(page, 'a'))).x;
    await dragBar(driver, 'a', -2);
    await settled(page);
    await settled(page);
    expect(await driver.changes()).toHaveLength(1);
    await expectX(track(page, 'a'), moved);
  },
};

/** Marks the position of a date on the screen every frame: see {@link infiniteTimeline}. */
interface Recording {
  stop: boolean;
  readonly offsets: number[];
}
type RecordingWindow = typeof window & {
  __ganttEdit?: { core: { getSnapshot(): unknown } };
  __journeyRecording?: Recording;
};

export const infiniteTimeline: Journey = {
  name: 'FR-TL-2, FR-TL-3: the infinite timeline grows at both edges as it is scrolled, without a jump',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    await driver.mount({
      ...PLAN,
      timeline: { infinite: { extendBy: '2w', threshold: 400 } },
    });
    await settled(page);
    const first = await driver.state();
    const view = await boxOf(scroller(page));
    // Wheel events go where the mouse is.
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);

    // Every frame, where on the screen a date is: the one under the left edge when it began. A
    // range that grows under it must not move it (a jump would be a whole extension, 560 px).
    await page.evaluate(() => {
      const hook = (window as RecordingWindow).__ganttEdit;
      const element = document.querySelector<HTMLElement>('#gantt .gantt__scroller');
      if (hook === undefined || element === null) throw new Error('there is no chart');
      interface Snapshot {
        timeline: { scale: { xToDate(x: number): number; dateToX(date: number): number } };
      }
      const anchor = (hook.core.getSnapshot() as Snapshot).timeline.scale.xToDate(
        element.scrollLeft,
      );
      const recording: Recording = { stop: false, offsets: [] };
      (window as RecordingWindow).__journeyRecording = recording;
      const tick = (): void => {
        if (recording.stop) return;
        const { scale } = (hook.core.getSnapshot() as Snapshot).timeline;
        recording.offsets.push(scale.dateToX(anchor) - element.scrollLeft);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // A wheel notch is 160 px here: two of them are still less than an extension (a fortnight is
    // 560 px at this zoom), so a frame that moves a date by more is a jump.
    const WHEEL = 160;
    // Towards the start: further than one extension ...
    for (let step = 0; step < 20; step += 1) {
      await page.mouse.wheel(-WHEEL, 0);
      await settled(page);
    }
    const grownAtStart = await driver.state();
    // ... and back, past where it began, towards the end.
    for (let step = 0; step < 50; step += 1) {
      await page.mouse.wheel(WHEEL, 0);
      await settled(page);
    }
    await settled(page);
    const grownAtEnd = await driver.state();

    const offsets = await page.evaluate(() => {
      const recording = (window as RecordingWindow).__journeyRecording;
      if (recording === undefined) return [];
      recording.stop = true;
      return recording.offsets;
    });

    // The range grew at the start while scrolling to it, and at the end while scrolling back.
    expect(grownAtStart.rangeStart).toBeLessThan(first.rangeStart);
    expect(grownAtStart.contentWidth).toBeGreaterThan(first.contentWidth);
    expect(grownAtEnd.rangeEnd).toBeGreaterThan(first.rangeEnd);
    expect(grownAtEnd.contentWidth).toBeGreaterThan(grownAtStart.contentWidth);
    // No jump: from one frame to the next the date moved by what the wheel scrolled, at most a
    // few events' worth, and never by an extension.
    expect(offsets.length).toBeGreaterThan(70);
    const worst = Math.max(...offsets.slice(1).map((offset, i) => Math.abs(offset - offsets[i]!)));
    expect(worst).toBeLessThanOrEqual(2 * WHEEL);
    // Only a window of bars is drawn, however far the chart has been scrolled.
    expect(await page.locator('#gantt .gantt__bar').count()).toBeLessThanOrEqual(TASKS.length);
  },
};

export const hoverTooltip: Journey = {
  name: 'FR-TIP-1, FR-TIP-2: hovering a bar opens a tooltip next to it with the name, the dates and the progress',
  tier: 'renderer',
  async run(driver) {
    const { page } = driver;
    const [first, ...rest] = TASKS;
    await driver.mount({ ...PLAN, tasks: [{ ...first, progress: 60 }, ...rest] });
    const box = await boxOf(track(page, 'a'));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const tooltip = page.locator(POPOVER);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute('role', 'tooltip');
    await expect(tooltip.locator('.gantt__popover-title')).toHaveText('Alpha');
    await expect(tooltip.locator('.gantt__popover-subtitle')).toContainText('2026');
    await expect(tooltip.locator('.gantt__popover-details')).toContainText('60% done');
    // The bar is described by it.
    await expect(bar(page, 'a')).toHaveAttribute('aria-describedby', /.+/);
    // Next to the bar: over it horizontally, and one gap above or below it.
    const tip = await boxOf(tooltip);
    const overlap = Math.min(tip.x + tip.width, box.x + box.width) - Math.max(tip.x, box.x);
    expect(overlap).toBeGreaterThan(0);
    const gap =
      tip.y + tip.height <= box.y ? box.y - (tip.y + tip.height) : tip.y - (box.y + box.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);

    // Leaving the bar closes it.
    await page.mouse.move(5, 5);
    await expect(tooltip).toHaveCount(0);
    expect(await driver.changes()).toEqual([]);
  },
};

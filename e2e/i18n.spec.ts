import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { hoverBar, openChart, POPOVER } from './popover-support';

/**
 * Locale and strings (plan step 4.11, FR-I18N-1, FR-I18N-2) on the playground's reference
 * project: `?locale=` is the core's `locale`, `?strings=uk` a Ukrainian pack of the renderer's
 * `strings` (the plural of the working days included).
 */

const UKRAINIAN_MONTHS = [
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
];
const ENGLISH_MONTHS = [
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
];

const SCROLLER = '#gantt .gantt__scroller';
/** The labels of the first header row (the months of the day view). */
const MONTH_LABELS = '#gantt .gantt__header-row[data-row="0"] .gantt__header-label';
const SUBTITLE = `${POPOVER} .gantt__popover-subtitle`;
const DETAILS = `${POPOVER} .gantt__popover-details`;

/** The parts of the chart's core these specs use. */
interface PlaygroundCore {
  setOptions(options: { locale?: string }): unknown;
}
interface PlaygroundChart {
  getIssues(): { options: unknown[] };
}
interface PlaygroundWindow {
  __ganttPlayground?: { core(): PlaygroundCore | undefined; gantt(): PlaygroundChart | undefined };
}

/** Collects uncaught page errors; assert it is empty at the end of a test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/** The text of the first header row's labels, each cell once. */
async function monthLabels(page: Page): Promise<string[]> {
  await expect(page.locator(MONTH_LABELS).first()).toBeAttached();
  return page.locator(MONTH_LABELS).allTextContents();
}

const startsWithOneOf = (label: string, names: readonly string[]): boolean =>
  names.some((name) => label.startsWith(name));

test.describe('locale and strings (plan step 4.11, FR-I18N-1, FR-I18N-2)', () => {
  test('the chart speaks English until it is told otherwise', async ({ page }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } });

    const labels = await monthLabels(page);
    expect(labels.every((label) => startsWithOneOf(label, ENGLISH_MONTHS))).toBe(true);
    await expect(page.locator(SCROLLER)).toHaveAttribute('aria-label', 'Gantt chart');
    await hoverBar(page, 'group-1');
    await expect(page.locator(DETAILS)).toHaveText(/^100% done · [\d.]+ working days?$/);
    expect(errors).toEqual([]);
  });

  test('locale uk gives the header Ukrainian month names, and a name to the chart from the strings', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, undefined, { locale: 'uk', strings: 'uk' });

    const labels = await monthLabels(page);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(startsWithOneOf(label, UKRAINIAN_MONTHS), label).toBe(true);
      expect(
        ENGLISH_MONTHS.some((name) => label.includes(name)),
        label,
      ).toBe(false);
    }
    await expect(page.locator(SCROLLER)).toHaveAttribute('aria-label', 'Діаграма Ганта');
    expect(errors).toEqual([]);
  });

  test('the tooltip takes its labels from the strings and its dates and numbers from the locale', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } }, { locale: 'uk', strings: 'uk' });

    await hoverBar(page, 'group-1');

    await expect(page.locator(POPOVER)).toBeVisible();
    await expect(page.locator(DETAILS)).toHaveText(
      /^100% виконано · [\d,]+ робоч(ий день|і дні|их днів|ого дня)$/,
    );
    // The range is the pack's (an em dash) over dates in Ukrainian, and no English month is left.
    const subtitle = (await page.locator(SUBTITLE).textContent()) ?? '';
    expect(subtitle).toMatch(/ — /);
    expect(ENGLISH_MONTHS.some((name) => subtitle.includes(name.slice(0, 3)))).toBe(false);
    expect(subtitle).toMatch(/[а-яіїєґ]{3}/);
    expect(errors).toEqual([]);
  });

  test('a locale given at runtime redraws the header and the open tooltip, without a remount', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } });
    await hoverBar(page, 'group-1');
    await expect(page.locator(POPOVER)).toBeVisible();
    const englishSubtitle = await page.locator(SUBTITLE).textContent();
    await page.evaluate(() => {
      document.querySelector('#gantt .gantt')?.setAttribute('data-mounted-once', '');
    });

    await page.evaluate(() => {
      (window as unknown as PlaygroundWindow).__ganttPlayground
        ?.core()
        ?.setOptions({ locale: 'uk' });
    });

    await expect
      .poll(async () =>
        (await monthLabels(page)).every((label) => startsWithOneOf(label, UKRAINIAN_MONTHS)),
      )
      .toBe(true);
    await expect(page.locator(SUBTITLE)).not.toHaveText(englishSubtitle ?? '');
    await expect(page.locator(SUBTITLE)).toHaveText(/[а-яіїєґ]{3}/);
    // The same chart, the same single popover.
    await expect(page.locator('#gantt .gantt[data-mounted-once]')).toHaveCount(1);
    await expect(page.locator(POPOVER)).toHaveCount(1);

    await page.evaluate(() => {
      (window as unknown as PlaygroundWindow).__ganttPlayground
        ?.core()
        ?.setOptions({ locale: 'en' });
    });
    await expect
      .poll(async () =>
        (await monthLabels(page)).every((label) => startsWithOneOf(label, ENGLISH_MONTHS)),
      )
      .toBe(true);
    await expect(page.locator(SUBTITLE)).toHaveText(englishSubtitle ?? '');
    expect(errors).toEqual([]);
  });

  test('a locale with its own calendar writes its years: the Buddhist era in the header and the tooltip', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, { tooltip: { delay: 0 } }, { locale: 'th-TH-u-ca-buddhist' });

    const labels = await monthLabels(page);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label, label).toMatch(/25\d\d/);
    await hoverBar(page, 'group-1');
    await expect(page.locator(SUBTITLE)).toHaveText(/25\d\d/);
    expect(errors).toEqual([]);
  });

  test('a locale that is not one is reported and the chart keeps drawing in English', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openChart(page, undefined, { locale: 'not a locale!' });

    const labels = await monthLabels(page);
    expect(labels.every((label) => startsWithOneOf(label, ENGLISH_MONTHS))).toBe(true);
    // Reported as an option issue (`onIssues`, `getIssues()`), with the value that was given.
    const issues = await page.evaluate(
      () =>
        (window as unknown as PlaygroundWindow).__ganttPlayground?.gantt()?.getIssues().options ??
        [],
    );
    expect(issues).toMatchObject([
      { code: 'invalid-option', path: 'locale', value: 'not a locale!' },
    ]);
    expect(errors).toEqual([]);
  });

  test.describe('in a browser whose own language is German', () => {
    test.use({ locale: 'de-DE' });

    test('a well-formed locale the browser does not have is drawn in English, not in German', async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openChart(page, { tooltip: { delay: 0 } }, { locale: 'xx' });

      const labels = await monthLabels(page);
      expect(labels.every((label) => startsWithOneOf(label, ENGLISH_MONTHS))).toBe(true);
      await hoverBar(page, 'group-1');
      await expect(page.locator(DETAILS)).toHaveText(/^100% done · [\d.]+ working days?$/);
      expect(errors).toEqual([]);
    });
  });
});

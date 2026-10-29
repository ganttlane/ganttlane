import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { BUILDS, CHART, chartRoot, openReact, settled, watchPage } from './react-support';

/**
 * The theme and the locale on the React demo page (plan step 5.4, FR-REACT-1, FR-I18N-1,
 * FR-THEME-2), driven through the page's selects and its URL. That they are props of `<Gantt>`,
 * which become a `setOptions` of that option alone on the same chart (no remount), is a journey of
 * its own, shared with the vanilla chart (`journeys-react.spec.ts`). What is left here is what the
 * page does with them: the start from a URL, and a session that outlives a change.
 *
 * Every spec runs on all the builds of `BUILDS` (production, development, and development with
 * React 18.3; StrictMode and React's warnings in the latter two): nothing may be reported.
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
const SCROLLER = `${CHART} .gantt__scroller`;
/** The labels of the first header row (the months of the day view). */
const MONTH_LABELS = `${CHART} .gantt__header-row[data-row="0"] .gantt__header-label`;

const startsWithOneOf = (label: string, names: readonly string[]): boolean =>
  names.some((name) => label.startsWith(name));

/** The text of the first header row's labels, each cell once. */
async function monthLabels(page: Page): Promise<string[]> {
  await expect(page.locator(MONTH_LABELS).first()).toBeAttached();
  return page.locator(MONTH_LABELS).allTextContents();
}

for (const build of BUILDS) {
  test.describe(`React page, theme and locale, ${build.name}`, () => {
    test('the theme and the locale a URL asks for are the chart’s from the start', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build, { theme: 'dark', locale: 'uk' });

      await expect(page.getByLabel('Theme')).toHaveValue('dark');
      await expect(page.getByLabel('Locale')).toHaveValue('uk');
      await expect(chartRoot(page)).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator(SCROLLER)).toHaveAttribute('aria-label', 'Діаграма Ганта');
      for (const label of await monthLabels(page)) {
        expect(startsWithOneOf(label, UKRAINIAN_MONTHS), label).toBe(true);
      }
      expect(problems.list).toEqual([]);
    });

    test('theme and locale together, with a session open, leave the session alone', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      await page.getByRole('button', { name: 'Begin editing', exact: true }).click();
      await expect(page.getByTestId('edit-changes')).toContainText('Editing, not changed yet');

      await page.getByLabel('Theme').selectOption('dark');
      await page.getByLabel('Locale').selectOption('uk');
      await settled(page);

      await expect(chartRoot(page)).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByTestId('edit-changes')).toContainText('Editing, not changed yet');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      expect(problems.list).toEqual([]);
    });
  });
}

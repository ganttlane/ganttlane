import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The hour row of the header in the hourly presets (FR-SCALE-4), measured in the real layout: the
 * three presets have 40 px columns, which leave about 27 px for a label after the cell's padding
 * and border. Labels such as `"5 PM"`, `"17 Uhr"` or `"오후 5시"` are wider, and the label's
 * ellipsis cut them to `"5 …"`: in `half-day` every cell read `"12 …"`, noon and midnight alike.
 * The presets now show the hour of the 24-hour clock as two digits, in every locale.
 */

/** English, Ukrainian, German and Japanese are the ones the fix is for; the others have long suffixes too. */
const LOCALES = ['en', 'uk', 'de', 'ja', 'fr', 'ko'] as const;

/**
 * The presets and the different labels their hour row shows: 00, 06, 12 and 18 in `quarter-day`,
 * 00 and 12 in `half-day`, and in `hour` every hour of the cells drawn (at least half of them).
 */
const PRESETS = [
  { id: 'hour', distinct: 12, exact: false },
  { id: 'quarter-day', distinct: 4, exact: true },
  { id: 'half-day', distinct: 2, exact: true },
] as const;

interface HourCell {
  readonly text: string;
  /** The label is cut by its ellipsis (its content is wider than the box it has). */
  readonly clipped: boolean;
  /** The same for the cell of the current hour, which is bold and so wider. */
  readonly clippedBold: boolean;
  readonly width: number;
}

/** The cells of the hour row, read in one task, and whether each label fits in its cell. */
async function readHourRow(page: Page): Promise<HourCell[]> {
  return page.evaluate((): HourCell[] => {
    const cells = document.querySelectorAll<HTMLElement>(
      '#gantt .gantt__header-row[data-unit="hour"] .gantt__header-cell',
    );
    return [...cells].map((cell) => {
      const label = cell.querySelector<HTMLElement>('.gantt__header-label');
      if (!label) throw new Error('a header cell without a label');
      const cut = (): boolean => label.scrollWidth > label.clientWidth;
      const clipped = cut();
      const wasCurrent = cell.hasAttribute('data-current');
      cell.setAttribute('data-current', '');
      const clippedBold = cut();
      if (!wasCurrent) cell.removeAttribute('data-current');
      return {
        text: label.textContent,
        clipped,
        clippedBold,
        width: cell.getBoundingClientRect().width,
      };
    });
  });
}

test.describe('hour labels of the hourly presets (FR-SCALE-4)', () => {
  for (const locale of LOCALES) {
    test(`no hour label is clipped at the default widths, locale ${locale}`, async ({ page }) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      await page.goto(`/vanilla/?locale=${locale}`);
      await expect(page.locator('#gantt .gantt__header-cell').first()).toBeVisible();

      for (const { id, distinct, exact } of PRESETS) {
        await page.evaluate((viewMode) => {
          const playground = (
            window as unknown as {
              __ganttPlayground: { gantt(): { setViewMode(id: string): void } };
            }
          ).__ganttPlayground;
          playground.gantt().setViewMode(viewMode);
        }, id);

        // The row is redrawn for the new mode (until then it is the previous mode's row, which
        // has more labels), and its labels are the hours of that mode.
        const drawn = expect.poll(
          async () => new Set((await readHourRow(page)).map((cell) => cell.text)).size,
          { message: `${id}: the hour row is drawn` },
        );
        await (exact ? drawn.toBe(distinct) : drawn.toBeGreaterThanOrEqual(distinct));
        const cells = await readHourRow(page);
        const texts = cells.map((cell) => cell.text);

        expect(cells.length, `${id} cells`).toBeGreaterThanOrEqual(8);
        // Premise of the test: the columns are narrow, so a long label would have been cut.
        for (const cell of cells) expect(cell.width, `${id} column`).toBeLessThanOrEqual(48);
        expect(
          cells.filter((cell) => cell.clipped).map((cell) => cell.text),
          `${id}: clipped labels`,
        ).toEqual([]);
        expect(
          cells.filter((cell) => cell.clippedBold).map((cell) => cell.text),
          `${id}: clipped labels of the current hour (bold)`,
        ).toEqual([]);
        // Two digits, so noon and midnight differ ("12" and "00") whatever the locale's clock.
        for (const text of texts) expect(text, `${id} label`).toMatch(/^\d{2}$/);
        texts.slice(1).forEach((text, index) => {
          expect(text, `${id}: label ${index + 1} differs from the one before it`).not.toBe(
            texts[index],
          );
        });
        if (id === 'quarter-day') expect(new Set(texts)).toEqual(new Set(['00', '06', '12', '18']));
        if (id === 'half-day') expect(new Set(texts)).toEqual(new Set(['00', '12']));
      }
      expect(errors).toEqual([]);
    });
  }
});

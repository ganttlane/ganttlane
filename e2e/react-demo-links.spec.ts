import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  BUILDS,
  button,
  changesPanel,
  CHART,
  openReact,
  settled,
  watchPage,
} from './react-support';

/**
 * The links of the React demo page are controlled like its tasks (plan step 5.4, FR-REACT-1,
 * FR-TX-6): the page owns `links`, `onLinksChange` writes every change into them, and
 * `onEditRollback` puts the links a session removed back with `restoreLinks`. The journeys
 * (`journeys-react.spec.ts`) do the same on `/react-edit/`; this is the demo page's own wiring, which
 * nothing else covers: take `setLinks(restoreLinks(…))` out of `react-app.tsx` and Cancel leaves
 * the page without the link while the chart has it back.
 *
 * The page shows what it holds in its summary (`<n> links`) and the session's changes in its
 * panel, so the specs read those, and press what a user presses: the arrow of a link, "Remove
 * dependency" in its menu, "Cancel", "Save". They take whichever link of the plan can be clicked,
 * and count against the page's own number, so they do not depend on the data of the page.
 *
 * Every spec runs on all the builds of `BUILDS`: in the development ones StrictMode calls the
 * state updater of `setLinks` twice, which `restoreLinks` must survive, and nothing may be
 * reported.
 */

const summary = (page: Page) => page.getByTestId('fixture-summary');
const link = (page: Page, id: string) =>
  page.locator(`${CHART} .gantt__link[data-link-id="${id}"]`);

/** How many links the page says it holds (`<n> links` in its summary). */
async function pageLinkCount(page: Page): Promise<number> {
  const text = (await summary(page).textContent()) ?? '';
  const count = /(\d+) links?\b/.exec(text)?.[1];
  if (count === undefined) throw new Error(`the summary has no link count: "${text}"`);
  return Number(count);
}

/**
 * Removes a link the way a user does: a click on its arrow, then "Remove dependency" in its menu.
 * The link is the first drawn one whose route has a point that the mouse reaches (inside the
 * chart's view, and not under another shape).
 *
 * @param page - The React demo page.
 * @returns The id of the link that was removed.
 */
async function removeALink(page: Page): Promise<string> {
  await page.locator(CHART).scrollIntoViewIfNeeded();
  await settled(page);
  const target = await page.evaluate((chart) => {
    const scroller = document.querySelector(`${chart} .gantt__scroller`);
    if (scroller === null) throw new Error('there is no chart');
    const view = scroller.getBoundingClientRect();
    for (const hit of document.querySelectorAll<SVGGeometryElement>(`${chart} .gantt__link-hit`)) {
      const id = hit.dataset.linkId;
      const matrix = hit.getScreenCTM();
      if (id === undefined || matrix === null) continue;
      const length = hit.getTotalLength();
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        // From the middle of the route outwards: 0.5, 0.5 + 1/160, 0.5 - 1/160, 0.5 + 2/160, …
        const offset = Math.ceil(i / 2) / (steps * 2);
        const at = hit.getPointAtLength((0.5 + (i % 2 === 0 ? offset : -offset)) * length);
        const x = at.x * matrix.a + at.y * matrix.c + matrix.e;
        const y = at.x * matrix.b + at.y * matrix.d + matrix.f;
        const inside =
          x > view.left + 4 && x < view.right - 4 && y > view.top + 4 && y < view.bottom - 4;
        const top = document.elementFromPoint(x, y)?.closest<SVGElement>('[data-link-id]');
        if (inside && top?.dataset.linkId === id) return { id, x, y };
      }
    }
    throw new Error('no drawn link can be clicked');
  }, CHART);

  await page.mouse.click(target.x, target.y);
  await page
    .locator(`${CHART} .gantt__layer > .gantt__popover`)
    .getByRole('menuitem', { name: 'Remove dependency' })
    .click();
  await settled(page);
  return target.id;
}

for (const build of BUILDS) {
  test.describe(`React page, controlled links, ${build.name}`, () => {
    test('FR-TX-6: a link removed in a session comes back with Cancel: the page restores its links', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      const total = await pageLinkCount(page);
      expect(total).toBeGreaterThan(1);
      await button(page, 'Begin editing').click();

      const id = await removeALink(page);

      // The page owns the links: it was told (`onLinksChange`) and passed the shorter list back.
      await expect(summary(page)).toContainText(`${String(total - 1)} links`);
      await expect(link(page, id)).toHaveCount(0);
      await expect(changesPanel(page)).toContainText('links removed: 1');

      await button(page, 'Cancel').click();

      // The inverse arrives as `onEditRollback`, and the page writes the link back into its own
      // list: the number on the page, and not only the arrow on the chart.
      await expect(summary(page)).toContainText(`${String(total)} links`);
      await expect(link(page, id)).toBeAttached();
      await expect(changesPanel(page)).toContainText('Cancelled:');
      await expect(changesPanel(page)).toContainText('links added: 1');
      await settled(page);
      expect(await pageLinkCount(page)).toBe(total);
      expect(problems.list).toEqual([]);
    });

    test('FR-TX-6: a link removed in a session stays removed with Save', async ({ page }) => {
      const problems = watchPage(page);
      await openReact(page, build);
      const total = await pageLinkCount(page);
      await button(page, 'Begin editing').click();
      const id = await removeALink(page);

      await button(page, 'Save').click();

      await expect(changesPanel(page)).toContainText('Saved:');
      await expect(changesPanel(page)).toContainText('links removed: 1');
      await expect(summary(page)).toContainText(`${String(total - 1)} links`);
      await expect(link(page, id)).toHaveCount(0);
      await settled(page);
      expect(await pageLinkCount(page)).toBe(total - 1);
      expect(problems.list).toEqual([]);
    });
  });
}

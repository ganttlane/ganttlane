import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  BUILDS,
  button,
  changesPanel,
  CHART,
  chartRoot,
  dragBar,
  pageDates,
  settled,
  watchPage,
} from './react-support';

/**
 * Server rendering of the React page (plan step 5.4, FR-REACT-5): `/react-ssr/` is the page of
 * `react-app.tsx` rendered by a server (`renderToString` of `src/react-ssr-server.tsx`, called by
 * the preview server on every request, see `ssrPage` in `apps/playground/vite.config.ts`) and
 * hydrated in the browser (`hydrateRoot`). A server draws no chart: it sends the container, and
 * the chart is drawn into it after hydration, with the page's own controls.
 *
 * It runs on all the builds of `BUILDS` (the React 18.3 one is rendered by React 18.3's server and
 * hydrated by its client). In the development builds React reports hydration mismatches (and its
 * other warnings): nothing may be reported, and the server's own elements must be the ones that
 * stay (a mismatch that React recovers from would replace them).
 */

/** The page of a build, rendered by the server; `params` is its query string. */
const url = (base: string, params: Readonly<Record<string, string>> = {}): string => {
  const query = new URLSearchParams(params);
  return `${base}/react-ssr/${query.size === 0 ? '' : `?${query.toString()}`}`;
};

/**
 * Remembers the debug table the browser parsed from the server's markup, before any script runs
 * (`window.__serverTable`), so that a later check can tell hydration from a client render.
 *
 * @param page - The page.
 */
async function rememberServerTable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const watch = new MutationObserver(() => {
      const table = document.querySelector('.debug-table');
      if (table !== null) {
        (window as unknown as { __serverTable?: Element }).__serverTable = table;
        watch.disconnect();
      }
    });
    watch.observe(document, { childList: true, subtree: true });
  });
}

/** Whether the debug table now is the one the server sent. */
const keptServerTable = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const kept = (window as unknown as { __serverTable?: Element }).__serverTable;
    return kept !== undefined && kept === document.querySelector('.debug-table');
  });

for (const build of BUILDS) {
  test.describe(`React page, server-rendered, ${build.name}`, () => {
    test('the server sends the page and the container of the chart, and no chart', async ({
      request,
    }) => {
      const response = await request.get(url(build.base));

      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toContain('text/html');
      const html = await response.text();
      // The page of `react-app.tsx`, rendered: its heading, the picker, the debug table of the
      // fixture and the container the chart goes into (a `div` with its class, and nothing in it).
      expect(html).toContain('<div id="app"><h1>React · fixtures</h1>');
      // Rendered by the React of the build.
      expect(html).toMatch(new RegExp(`>React ${build.react}\\.[\\d.]+</p>`));
      expect(html).toContain('<option value="sample-project" selected="">');
      expect(html).toContain('data-fixture="sample-project"');
      expect(html).toContain('<td>task-9</td>');
      expect(html).toContain('<div class="chart"></div>');
      // Nothing of the renderer: a server has no DOM to draw into.
      expect(html).not.toContain('gantt__');
      expect(html).not.toContain('class="gantt"');
      // The controls that need the chart (Save, Cancel) come with it, after hydration.
      expect(html).not.toContain('Begin editing');
    });

    test('the query string is part of what is rendered: the same page for the same URL', async ({
      request,
    }) => {
      const html = await (
        await request.get(
          url(build.base, { fixture: 'generated-1k', theme: 'dark', locale: 'uk', mode: 'view' }),
        )
      ).text();

      expect(html).toContain('data-fixture="generated-1k"');
      expect(html).toContain('<option value="generated-1k" selected="">');
      expect(html).toContain('<option value="dark" selected="">');
      expect(html).toContain('<option value="uk" selected="">');
      expect(html).toContain('<option value="view" selected="">');
      expect(html).toContain('<div class="chart"></div>');
    });

    test('the markup goes into the shell as it is: `$` patterns in it (text from the query) are not replacements', async ({
      request,
    }) => {
      // An unknown fixture id is printed in the page. `String.replace` with a string would read
      // `$&` as the matched shell text, `` $` `` as what comes before it and `$$` as one `$`.
      // React escapes `&` and `'` in the markup, so the page holds the escaped text.
      for (const [fixture, markup] of [
        ['$&', '$&amp;'],
        ['$`', '$`'],
        ["$'", '$&#x27;'],
        ['$$', '$$'],
        ['$1', '$1'],
      ] as const) {
        const html = await (await request.get(url(build.base, { fixture }))).text();

        expect(html, fixture).toContain(`Unknown fixture &quot;<!-- -->${markup}<!-- -->&quot;`);
        // The shell is in it once and whole.
        expect(html.match(/<div id="app">/g), fixture).toHaveLength(1);
        expect(html.match(/<\/html>/g), fixture).toHaveLength(1);
        expect(html, fixture).toContain('<div class="chart"></div>');
      }
    });

    test('hydration keeps the server’s page and draws the chart into its container, with nothing reported', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await rememberServerTable(page);

      await page.goto(url(build.base));

      // The chart is drawn after hydration: the container the server sent now holds it, once.
      await expect(page.locator(`${CHART} > .gantt`)).toHaveCount(1);
      await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();
      await expect(chartRoot(page)).toHaveCSS('--gantt-content-width', /^\d+(\.\d+)?px$/);
      // The controls that follow the chart's state are there once it is.
      await expect(button(page, 'Begin editing')).toBeEnabled();
      // Hydrated, not rendered again by the client (which is what recovering from a mismatch does).
      expect(await keptServerTable(page)).toBe(true);
      await settled(page);
      expect(problems.list).toEqual([]);
    });

    test('a query string that the server rendered is the state the page hydrates to', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await rememberServerTable(page);

      await page.goto(
        url(build.base, { fixture: 'generated-1k', theme: 'dark', locale: 'uk', mode: 'view' }),
      );

      await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();
      await expect(page.getByTestId('debug-table')).toHaveAttribute('data-fixture', 'generated-1k');
      await expect(chartRoot(page)).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator(`${CHART} .gantt__scroller`)).toHaveAttribute(
        'aria-label',
        'Діаграма Ганта',
      );
      await expect(button(page, 'Begin editing')).toBeDisabled();
      expect(await keptServerTable(page)).toBe(true);
      expect(problems.list).toEqual([]);
    });

    test('after hydration the page works as the client page does: options, a drag, Cancel', async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.goto(url(build.base));
      await expect(page.locator(`${CHART} .gantt__bar`).first()).toBeAttached();
      await expect(button(page, 'Begin editing')).toBeEnabled();

      await page.getByLabel('Theme').selectOption('dark');
      await expect(chartRoot(page)).toHaveAttribute('data-theme', 'dark');
      await button(page, 'Begin editing').click();
      await dragBar(page, 'task-9', 1);
      await expect.poll(async () => (await pageDates(page, 'task-9')).start).toBe('2026-05-01');
      await button(page, 'Cancel').click();

      await expect.poll(async () => (await pageDates(page, 'task-9')).start).toBe('2026-04-30');
      await expect(changesPanel(page)).toContainText('Cancelled:');
      await expect(page.locator(`${CHART} > .gantt`)).toHaveCount(1);
      expect(problems.list).toEqual([]);
    });
  });

  test.describe(`React page, server-rendered, no JavaScript, ${build.name}`, () => {
    test.use({ javaScriptEnabled: false });

    test('the page is the markup: the table and the picker are there, the chart is not', async ({
      page,
    }) => {
      await page.goto(url(build.base));

      await expect(page.getByRole('heading', { level: 1, name: 'React · fixtures' })).toBeVisible();
      await expect(page.getByLabel('Fixture')).toHaveValue('sample-project');
      await expect(page.getByTestId('debug-table').locator('tbody tr')).toHaveCount(38);
      await expect(page.getByTestId('fixture-summary')).toContainText('38 tasks · 8 links');
      await expect(page.locator(CHART)).toBeAttached();
      await expect(page.locator(`${CHART} > *`)).toHaveCount(0);
    });
  });
}

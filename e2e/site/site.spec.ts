import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { readExamples } from '../../examples/discover';

/**
 * The documentation site (`apps/site`), built and previewed under `/ganttlane/` (`pnpm
 * test:e2e:site`, see `playwright.config.ts`): the pages are there, every example folder has a page
 * whose chart is drawn in each mode it has, and the charts follow the theme of the site.
 */
const examples = readExamples(`${import.meta.dirname}/../../examples`);

/** The pages of the guides (`apps/site/src/content/docs/guides/`), in the order of the sidebar. */
const GUIDE_PAGES = [
  'guides/concepts/',
  'guides/concepts/tasks-and-records/',
  'guides/concepts/links-and-types/',
  'guides/concepts/dates-and-time/',
  'guides/concepts/granularity-and-alignment/',
  'guides/concepts/work-calendar/',
  'guides/concepts/hierarchy/',
  'guides/concepts/propagation-and-conflicts/',
  'guides/concepts/data-ownership/',
  'guides/concepts/change-sets-and-hooks/',
  'guides/concepts/edit-sessions-and-history/',
  'guides/concepts/issues/',
  'guides/options/',
  'guides/events/',
  'guides/methods/',
  'guides/theming/',
  'guides/react/',
  'guides/custom-renderers/',
  'guides/performance/',
  'guides/accessibility/',
  'guides/migration/',
  'guides/faq/',
];

/** What the TSDoc of the sources cites that is not published: requirement ids, decision records, local documents. */
const PRIVATE_REFERENCE =
  /\bN?FR-[A-Z0-9]+-(?:\d+|\*)|\bADR-\d+|docs\/[a-z]+(?:\/[\w.-]+)*\.md|\bplan steps?\b/;

const vanilla = '.demo__pane[data-pane="vanilla"]';
const react = '.demo__pane[data-pane="react"]';

/** Collects what the page logs as an error, to be checked at the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('NFR-DX-1: the home page has the title, the call to action and the groups of the sidebar', async ({
  page,
}) => {
  const errors = watchErrors(page);

  await page.goto('');

  await expect(page).toHaveTitle(/ganttlane/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ganttlane');
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/ganttlane\/getting-started\/introduction\/$/);
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  for (const group of ['Getting started', 'Guides', 'Examples', 'API reference']) {
    await expect(sidebar.getByText(group, { exact: true }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('NFR-DX-1: the Getting started and Guides pages exist', async ({ page }) => {
  for (const path of [
    'getting-started/introduction/',
    'getting-started/installation/',
    'getting-started/quick-start/',
    ...GUIDE_PAGES,
    'api/',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
  }
});

test('NFR-DX-1: the install and quick start pages show their code as code blocks', async ({
  page,
}) => {
  await page.goto('getting-started/installation/');
  await expect(page.locator('pre', { hasText: 'pnpm add @ganttlane/dom' }).first()).toBeAttached();
  await page.getByRole('tab', { name: 'React' }).first().click();
  await expect(
    page.locator('pre', { hasText: 'pnpm add @ganttlane/react react react-dom' }).first(),
  ).toBeVisible();

  // The tab chosen above is kept (`syncKey`), so choose each one.
  await page.goto('getting-started/quick-start/');
  await page.getByRole('tab', { name: 'Vanilla' }).first().click();
  await expect(page.locator('pre', { hasText: 'createGantt(container' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'React' }).first().click();
  await expect(page.locator('pre', { hasText: '<Gantt' }).first()).toBeVisible();
});

test('NFR-DX-1: the gallery and the sidebar list every example folder', async ({ page }) => {
  await page.goto('examples/');

  for (const { slug, title } of examples) {
    await expect(
      page.locator(`.sl-link-card a[href="/ganttlane/examples/${slug}/"]`),
      slug,
    ).toContainText(title);
    await expect(
      page.locator(`nav a[href="/ganttlane/examples/${slug}/"]`).first(),
      slug,
    ).toBeVisible();
  }
});

for (const example of examples) {
  const { slug, files, height } = example;
  const hasVanilla = files.includes('vanilla.ts');
  const hasReact = files.includes('react.tsx');

  test(`NFR-DX-1: the page of ${slug} draws its chart in each mode and lists its files`, async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await page.goto(`examples/${slug}/`);

    // The stage has its height before anything is drawn, and keeps it.
    const stage = page.locator('.demo__stage');
    await expect(stage).toHaveCSS('height', `${height}px`);
    await expect(page.locator('.demo__github')).toHaveAttribute(
      'href',
      `https://github.com/ganttlane/ganttlane/tree/main/examples/${slug}`,
    );

    if (hasVanilla) {
      await expect(page.locator(`${vanilla} .gantt__bar`).first()).toBeVisible();
    }
    if (hasVanilla && hasReact) {
      await page.getByRole('button', { name: 'React', exact: true }).click();
      await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();
      // The other mode is hidden and cleaned up, not kept in the background.
      await expect(page.locator(vanilla)).toBeHidden();
      await expect(page.locator(`${vanilla} .gantt`)).toHaveCount(0);
      await page.getByRole('button', { name: 'Vanilla', exact: true }).click();
      await expect(page.locator(`${vanilla} .gantt__bar`).first()).toBeVisible();
      await expect(page.locator(`${react} .gantt`)).toHaveCount(0);
    } else if (hasReact) {
      await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();
    }
    await expect(stage).toHaveCSS('height', `${height}px`);

    // One tab per file of the folder, with its code.
    for (const file of files) {
      await expect(page.getByRole('tab', { name: file, exact: true })).toBeAttached();
    }
    expect(errors).toEqual([]);
  });
}

test('NFR-DX-1: the code tabs show the files that run', async ({ page }) => {
  await page.goto('examples/basic/');

  await page.getByRole('tab', { name: 'react.tsx', exact: true }).click();

  const code = page.getByRole('tabpanel').filter({ hasText: '<Gantt' });
  await expect(code.first()).toBeVisible();
  await expect(code.first()).toContainText("import '@ganttlane/react/styles.css'");
});

/** How many rules of the library's `@layer gantt` the document has: its stylesheet, wherever it came from. */
const libraryRules = (page: Page): Promise<number> =>
  page.evaluate(() => {
    let count = 0;
    const visit = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSLayerBlockRule && rule.name === 'gantt') count++;
        else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules);
      } catch {
        // A sheet of another origin cannot be read; the site has none.
      }
    }
    return count;
  });

/** The value a chart's root has for a custom property: empty when no stylesheet declares it. */
const token = (page: Page, pane: string, name: string): Promise<string> =>
  page
    .locator(`${pane} .gantt`)
    .evaluate((root, property) => getComputedStyle(root).getPropertyValue(property).trim(), name);

test('NFR-DX-1: the stylesheets of an example are on its page while its demo is shown, and only then', async ({
  page,
}) => {
  const statusColour = (selector: string) =>
    page
      .locator(`${selector} .gantt__bar.is-done`)
      .first()
      .evaluate((bar) => getComputedStyle(bar).getPropertyValue('--gantt-bar-color').trim());
  await page.goto('examples/release-plan/');

  // The library's stylesheet and the example's own: one `<style>` each, in each mode.
  await expect(page.locator(`${vanilla} .gantt__bar.is-done`).first()).toBeVisible();
  expect(await statusColour(vanilla)).toBe('#2f9e44');
  await expect(page.locator('style[data-example-css="release-plan"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(page.locator(`${react} .gantt__bar.is-done`).first()).toBeVisible();
  expect(await statusColour(react)).toBe('#2f9e44');
  await expect(page.locator('style[data-example-css="release-plan"]')).toHaveCount(2);

  // Another example's page does not have the release plan's sheet, but has the library's. (It opens
  // in React: the mode the visitor chose last is kept.)
  await page.goto('examples/basic/');
  await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();
  await expect(page.locator('style[data-example-css="release-plan"]')).toHaveCount(0);
  await expect(page.locator('style[data-example-css="basic"]')).toHaveCount(1);
  expect(await libraryRules(page)).toBeGreaterThan(0);
  expect(await token(page, react, '--gantt-bar-color')).not.toBe('');
  await page.getByRole('button', { name: 'Vanilla', exact: true }).click();
  await expect(page.locator(`${vanilla} .gantt__bar`).first()).toBeVisible();
  await expect(page.locator('style[data-example-css="basic"]')).toHaveCount(1);
  expect(await token(page, vanilla, '--gantt-bar-color')).not.toBe('');
});

test('NFR-DX-1: the unstyled example has no default stylesheet, in either mode', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('examples/unstyled/');

  await expect(page.locator(`${vanilla} .gantt__bar`).first()).toBeVisible();
  // No rule of `@layer gantt` anywhere, and no token it declares: the chart is the example's own sheet.
  expect(await libraryRules(page)).toBe(0);
  expect(await token(page, vanilla, '--gantt-bar-color')).toBe('');
  expect(await token(page, vanilla, '--gantt-font-family')).toBe('');
  await expect(page.locator('style[data-example-css="unstyled"]')).toHaveCount(1);
  // Its own sheet does apply.
  expect(await token(page, vanilla, '--paper')).not.toBe('');

  await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();
  expect(await libraryRules(page)).toBe(0);
  expect(await token(page, react, '--gantt-bar-color')).toBe('');
  expect(await token(page, react, '--paper')).not.toBe('');
  await expect(page.locator('style[data-example-css="unstyled"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('NFR-DX-1: no page of the examples links a chart stylesheet in its head', async ({
  request,
}) => {
  test.setTimeout(120_000);
  // The build links into the head of a page every stylesheet its scripts can reach, dynamic imports
  // included, so a stylesheet imported by an example used to be on the page of every example.
  const text = new Map<string, Promise<string>>();
  const sheet = (href: string): Promise<string> => {
    let found = text.get(href);
    if (found === undefined) {
      found = request.get(href).then((response) => response.text());
      text.set(href, found);
    }
    return found;
  };

  const problems: string[] = [];
  for (const path of ['examples/', ...examples.map(({ slug }) => `examples/${slug}/`)]) {
    const html = await (await request.get(path)).text();
    for (const [tag] of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)) {
      const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
      if (href === undefined) continue;
      const css = await sheet(href);
      if (/@layer gantt\b|\.gantt__|\.paper\b/.test(css)) problems.push(`${path} links ${href}`);
    }
  }

  expect(problems).toEqual([]);
});

test('NFR-DX-1: an address that is nothing gets the 404 page, whose links work from anywhere', async ({
  page,
  request,
}) => {
  const response = await page.goto('no/such/page/');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) {
    // Absolute: the same HTML is served at every address.
    expect(href, href).toMatch(/^\/ganttlane\//);
    expect((await request.get(href)).status(), href).toBe(200);
  }
});

test('NFR-DX-1: the charts follow the theme of the site, in both modes', async ({ page }) => {
  await page.goto('examples/basic/');
  await expect(page.locator(`${vanilla} .gantt__bar`).first()).toBeVisible();
  // Two of them (the header's and the mobile menu's): the visible one.
  const theme = page.locator('starlight-theme-select select').filter({ visible: true });

  await theme.selectOption('dark');
  await expect(page.locator(`${vanilla} .gantt`)).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(page.locator(`${react} .gantt`)).toHaveAttribute('data-theme', 'dark');

  await theme.selectOption('light');
  await expect(page.locator(`${react} .gantt`)).toHaveAttribute('data-theme', 'light');
});

test('NFR-DX-1: the mode a visitor chooses is kept on the next example', async ({ page }) => {
  await page.goto('examples/basic/');
  await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();

  await page.goto('examples/custom-tooltip/');

  await expect(page.locator(`${react} .gantt__bar`).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'React', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('NFR-DX-1: the search finds an example', async ({ page }) => {
  await page.goto('');

  await page
    .getByRole('button', { name: /search/i })
    .first()
    .click();
  // The whole phrase of the title: "tooltip" alone also matches the guides and the API reference,
  // which fill the first results.
  await page.locator('.pagefind-ui__search-input').fill('custom tooltip');

  await expect(page.getByRole('link', { name: /Custom tooltip/ }).first()).toBeVisible();
});

test('NFR-DX-1: every guide has a title, a sidebar entry and no placeholder text', async ({
  page,
}) => {
  for (const path of GUIDE_PAGES) {
    await page.goto(path);
    // One title (the page's own), and the sidebar of the guides leads here.
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).locator(`a[href="/ganttlane/${path}"]`),
      path,
    ).toHaveCount(1);
    await expect(page.locator('main'), path).not.toContainText(/coming soon|not written yet/i);
    // The pages are long and have sections: the table of contents beside them lists some.
    await expect(page.locator('starlight-toc a').first(), path).toBeAttached();
  }
});

test('NFR-DX-1: the pages link only to pages and headings that exist, and the guides link every example', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  /** The ids of each page fetched, by URL path: a link to `#heading` is checked against them. */
  const ids = new Map<string, Set<string> | null>();
  const idsOf = async (path: string): Promise<Set<string> | null> => {
    if (!ids.has(path)) {
      const response = await request.get(path);
      const html = response.ok() ? await response.text() : null;
      ids.set(
        path,
        html === null
          ? null
          : new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? '')),
      );
    }
    return ids.get(path) ?? null;
  };

  const problems: string[] = [];
  /** The examples a page of the guides links to. */
  const linkedFromGuides = new Set<string>();
  const guides = new Set(GUIDE_PAGES);
  const pages = [
    '',
    'getting-started/introduction/',
    'getting-started/installation/',
    'getting-started/quick-start/',
    'examples/',
    ...GUIDE_PAGES,
    'api/',
  ];
  for (const path of pages) {
    await page.goto(path);
    const here = new URL(page.url());
    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href') ?? ''))]);
    for (const href of hrefs) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue; // Another site, `mailto:`.
      const target = new URL(href, here);
      const example = /\/examples\/([^/]+)\/$/.exec(target.pathname)?.[1];
      if (example !== undefined && guides.has(path)) linkedFromGuides.add(example);
      const found = await idsOf(target.pathname);
      if (found === null) {
        problems.push(`${path}: ${href} does not exist`);
      } else if (target.hash.length > 1 && !found.has(decodeURIComponent(target.hash.slice(1)))) {
        problems.push(`${path}: ${href} has no such heading`);
      }
    }
  }
  for (const { slug } of examples) {
    if (!linkedFromGuides.has(slug))
      problems.push(`no page of the guides links to examples/${slug}/`);
  }

  expect(problems).toEqual([]);
});

test('NFR-DX-1: the migration guide is generated from MIGRATION.md', async ({ page }) => {
  const source = readFileSync(`${import.meta.dirname}/../../MIGRATION.md`, 'utf8');
  // The headings of the file, without the Markdown of their text (`code`, links).
  const headings = [...source.matchAll(/^(#{1,2}) (.+)$/gm)]
    .map(([, marks, text]) => ({
      level: (marks ?? '').length,
      text: (text ?? '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
    }))
    // The list of contents is not carried over: the page has a table of contents of its own.
    .filter(({ text }) => text !== 'Contents');
  expect(headings.length).toBeGreaterThan(20);

  await page.goto('guides/migration/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Migration');
  // The title of the file is the page's own; the two parts are its sections (`h2`), and the
  // sections of the file are theirs (`h3`): one level down, so that the outline is well formed.
  for (const { level, text } of headings.slice(1)) {
    await expect(
      page.getByRole('heading', { level: level + 1, name: text, exact: true }),
      text,
    ).toHaveCount(1);
  }
  // Links to a file of the repository lead to it on GitHub.
  await expect(
    page
      .locator(
        'a[href="https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#height"]',
      )
      .first(),
  ).toBeAttached();
});

test('NFR-DX-1: the API reference has a page per package, grouped in the sidebar', async ({
  page,
}) => {
  await page.goto('api/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('API reference');
  for (const name of ['@ganttlane/core', '@ganttlane/dom', '@ganttlane/react']) {
    await expect(page.locator('main a').filter({ hasText: name }).first()).toBeVisible();
  }

  await page.goto('api/ganttlane/dom/functions/creategantt/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('createGantt');
  await expect(page.locator('main pre', { hasText: "from '@ganttlane/dom'" })).toBeVisible();
  // The package groups, the overview first, and the page being read is the current one.
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  for (const group of [
    '@ganttlane/core',
    '@ganttlane/dom',
    '@ganttlane/dom/facade',
    '@ganttlane/dom/dom-utils',
    '@ganttlane/react',
    '@ganttlane/react/core',
  ]) {
    await expect(sidebar.getByText(group, { exact: true }), group).toBeVisible();
  }
  await expect(sidebar.locator('a[href="/ganttlane/api/"]')).toHaveCount(1);
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveText('createGantt');
  // The source link points at GitHub, not at a local path.
  await expect(
    page.locator(
      'main a[href^="https://github.com/ganttlane/ganttlane/blob/main/packages/dom/src/create-gantt.ts"]',
    ),
  ).toBeVisible();
});

test('NFR-DX-1: the API pages cite no private reference', async ({ request }) => {
  test.setTimeout(120_000);
  const sitemap = await (await request.get('sitemap-0.xml')).text();
  const pages = [...sitemap.matchAll(/<loc>([^<]*\/ganttlane\/api\/[^<]*)<\/loc>/g)].map(
    (match) => match[1] ?? '',
  );
  // One page per export of the three packages, and the modules, and the overview.
  expect(pages.length).toBeGreaterThan(300);

  const dirty: string[] = [];
  for (const url of pages) {
    const html = await (await request.get(url)).text();
    const found = PRIVATE_REFERENCE.exec(html.replace(/<[^>]*>/g, ' '));
    if (found) dirty.push(`${url}: ${found[0]}`);
  }

  expect(dirty).toEqual([]);
});

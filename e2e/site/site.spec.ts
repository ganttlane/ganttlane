import { expect, type Page, test } from '@playwright/test';

import { readExamples } from '../../examples/discover';

/**
 * The documentation site (`apps/site`), built and previewed under `/ganttlane/` (`pnpm
 * test:e2e:site`, see `playwright.config.ts`): the pages are there, every example folder has a page
 * whose chart is drawn in each mode it has, and the charts follow the theme of the site.
 */
const examples = readExamples(`${import.meta.dirname}/../../examples`);

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
    'guides/concepts/',
    'guides/options/',
    'guides/events/',
    'guides/methods/',
    'guides/theming/',
    'guides/react/',
    'guides/migration/',
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

test('NFR-DX-1: the stylesheet of an example is on its page while its demo is shown', async ({
  page,
}) => {
  const statusColour = (selector: string) =>
    page
      .locator(`${selector} .gantt__bar.is-done`)
      .first()
      .evaluate((bar) => getComputedStyle(bar).getPropertyValue('--gantt-bar-color').trim());
  await page.goto('examples/release-plan/');

  await expect(page.locator(`${vanilla} .gantt__bar.is-done`).first()).toBeVisible();
  expect(await statusColour(vanilla)).toBe('#2f9e44');
  await page.getByRole('button', { name: 'React', exact: true }).click();
  await expect(page.locator(`${react} .gantt__bar.is-done`).first()).toBeVisible();
  expect(await statusColour(react)).toBe('#2f9e44');
  await expect(page.locator('style[data-example-css="release-plan"]')).toHaveCount(1);

  // Another example's page does not have it.
  await page.goto('examples/basic/');
  await expect(page.locator('style[data-example-css]')).toHaveCount(0);
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
  await page.locator('.pagefind-ui__search-input').fill('tooltip');

  await expect(page.getByRole('link', { name: /Custom tooltip/ }).first()).toBeVisible();
});

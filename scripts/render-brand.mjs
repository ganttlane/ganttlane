// Renders the brand SVGs (`apps/site/src/assets/brand/`) to PNG with Playwright's Chromium:
// the touch icon of the site (`apps/site/public/apple-touch-icon.png`) and, with `--out <dir>`,
// a 512 px avatar and the two logos at 2x for places that take only raster images. Run with
// `node scripts/render-brand.mjs [--out <dir>]` after changing a brand SVG.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'apps/site/src/assets/brand');
const outIndex = process.argv.indexOf('--out');
const out = outIndex === -1 ? undefined : resolve(process.argv[outIndex + 1] ?? '.');

/** A square with no transparent corners: avatars and touch icons get their rounding from the host. */
const fullBleed = (/** @type {string} */ svg) => svg.replace('rx="28"', 'rx="0"');

/** @type {{ file: string; width: number; height: number; to: string; edit?: (svg: string) => string }[]} */
const jobs = [
  {
    file: 'mark.svg',
    width: 180,
    height: 180,
    to: join(root, 'apps/site/public/apple-touch-icon.png'),
    edit: fullBleed,
  },
];
if (out !== undefined) {
  mkdirSync(out, { recursive: true });
  jobs.push(
    {
      file: 'mark.svg',
      width: 512,
      height: 512,
      to: join(out, 'ganttlane-avatar-512.png'),
      edit: fullBleed,
    },
    { file: 'logo-light.svg', width: 860, height: 240, to: join(out, 'ganttlane-logo-light.png') },
    { file: 'logo-dark.svg', width: 860, height: 240, to: join(out, 'ganttlane-logo-dark.png') },
  );
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const job of jobs) {
    await page.setViewportSize({ width: job.width, height: job.height });
    const source = readFileSync(join(brand, job.file), 'utf8');
    const svg = job.edit === undefined ? source : job.edit(source);
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${job.width}px;height:${job.height}px}</style>${svg}`,
    );
    const text = page.locator('text');
    const textWidth =
      (await text.count()) === 0
        ? undefined
        : await text.first().evaluate((element) => {
            const box = /** @type {SVGTextElement} */ (element).getBBox();
            return Math.ceil(box.x + box.width);
          });
    await page.locator('svg').screenshot({ path: job.to, omitBackground: true });
    process.stdout.write(
      `${job.file} -> ${job.to}${textWidth === undefined ? '' : ` (text ends at ${textWidth} of the viewBox)`}\n`,
    );
  }
} finally {
  await browser.close();
}

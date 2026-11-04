import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { build } from 'tsdown';

import {
  DEVELOPMENT_FILE,
  globalBuilds,
  PRODUCTION_FILE,
  STYLESHEET_FILE,
} from '../tsdown.global.config';

/**
 * NFR-PKG-2: the files for a plain `<script src>` and `<link>`, no bundler, no module loader. The
 * page is static HTML served by a server of its own (random port): the two bundles are built into
 * a temporary directory by the same configuration as the tarball's (`tsdown.global.config.ts`), so the
 * test needs neither a build of the packages nor the playground. Each file gets the same page: it
 * draws bars with the global, drags one and reads the task back.
 */
interface Chart {
  getTask(id: string): { start: Date } | undefined;
  getIssues(): { options: { code: string; path: string }[] };
  destroy(): void;
}
interface PageWindow {
  Ganttlane?: {
    VERSION: string;
    createGantt(container: HTMLElement, options: object): Chart;
  };
  chart?: Chart;
}

let dir: string;
let server: Server;
let origin: string;

const page = (script: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ganttlane from a script tag</title>
<link rel="stylesheet" href="/${STYLESHEET_FILE}">
<style>body { margin: 0 } #chart { height: 300px; width: 900px }</style>
</head>
<body>
<div id="chart"></div>
<script src="/${script}"></script>
<script>
  window.chart = Ganttlane.createGantt(document.getElementById('chart'), {
    tasks: [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-03-09', end: '2026-03-13' },
    ],
    now: () => '2026-03-04',
    bar_height: 24,
  });
</script>
</body>
</html>
`;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ganttlane-cdn-'));
  for (const config of globalBuilds) {
    await build({
      ...config,
      outDir: dir,
      cwd: join(import.meta.dirname, '../packages/dom'),
      config: false,
      logLevel: 'silent',
    });
  }
  server = createServer((request, response) => {
    const name = (request.url ?? '/').slice(1).split('?')[0] ?? '';
    const asset = [DEVELOPMENT_FILE, PRODUCTION_FILE, STYLESHEET_FILE].includes(name);
    const isPage = name === 'dev.html' || name === 'prod.html';
    if (!asset && !isPage) {
      response.writeHead(404).end();
      return;
    }
    const type = name.endsWith('.css')
      ? 'text/css'
      : name.endsWith('.html')
        ? 'text/html'
        : 'text/javascript';
    response.writeHead(200, { 'content-type': type });
    response.end(
      isPage
        ? page(name === 'dev.html' ? DEVELOPMENT_FILE : PRODUCTION_FILE)
        : readFileSync(join(dir, name)),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

for (const [file, route, development] of [
  [DEVELOPMENT_FILE, 'dev.html', true],
  [PRODUCTION_FILE, 'prod.html', false],
] as const) {
  test(`NFR-PKG-2: ${file} from a script tag draws bars, drags one and sets the global`, async ({
    page: tab,
  }) => {
    const errors: Error[] = [];
    tab.on('pageerror', (error) => errors.push(error));
    await tab.goto(`${origin}/${route}`);

    await expect(tab.locator('.gantt__bar[data-task-id="a"]')).toBeVisible();
    await expect(tab.locator('.gantt__bar')).toHaveCount(2);
    expect(await tab.evaluate(() => typeof (window as PageWindow).Ganttlane?.createGantt)).toBe(
      'function',
    );
    expect(await tab.evaluate(() => (window as PageWindow).Ganttlane?.VERSION)).toMatch(
      /^\d+\.\d+\.\d+/,
    );
    // The stylesheet is the minified file: its layer is in effect.
    expect(
      await tab.evaluate(() => getComputedStyle(document.querySelector('.gantt')!).position),
    ).toBe('relative');

    const startOf = (): Promise<number | undefined> =>
      tab.evaluate(() => (window as PageWindow).chart?.getTask('a')?.start.getTime());
    const before = await startOf();
    const track = tab.locator('.gantt__bar[data-task-id="a"] .gantt__bar-track');
    // The chart scrolls to `now` and re-measures after the first frames: drag a bar that stays put.
    let box = await track.boundingBox();
    await expect
      .poll(async () => {
        const next = await track.boundingBox();
        const still = JSON.stringify(next) === JSON.stringify(box);
        box = next;
        return still;
      })
      .toBe(true);
    if (box === null) throw new Error('the bar has no box');
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await tab.mouse.move(x, y);
    await tab.mouse.down();
    await tab.mouse.move(x + 40, y, { steps: 4 });
    await tab.mouse.move(x + 80, y, { steps: 4 });
    await tab.mouse.up();
    await expect.poll(startOf).toBeGreaterThan(before ?? Infinity);

    // Only the development file knows the old option name `bar_height`.
    const codes = await tab.evaluate(() =>
      (window as PageWindow).chart?.getIssues().options.map((issue) => issue.code),
    );
    expect(codes).toEqual(development ? ['unknown-option'] : []);

    await tab.evaluate(() => (window as PageWindow).chart?.destroy());
    await expect(tab.locator('.gantt')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

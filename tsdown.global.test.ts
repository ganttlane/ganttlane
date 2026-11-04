import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEVELOPMENT_FILE,
  globalBuilds,
  LICENSES_FILE,
  PRODUCTION_FILE,
  STYLESHEET_FILE,
} from './tsdown.global.config';

/**
 * NFR-PKG-2: the files for a `<script>` and `<link>` tag. They are built here the way
 * `packages/dom/tsdown.config.ts` builds them (`tsdown.global.config.ts`, into a temporary
 * directory), so the test needs no earlier build. What it cannot see, a chart drawn and dragged in
 * three browsers, is `e2e/cdn-global.spec.ts`; the published tarball is `scripts/check-pack.mjs`.
 */
let outDir: string;
const read = (file: string): string => readFileSync(join(outDir, file), 'utf8');

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'ganttlane-global-'));
  for (const config of globalBuilds) {
    await build({
      ...config,
      outDir,
      cwd: join(import.meta.dirname, 'packages/dom'),
      config: false,
      logLevel: 'silent',
    });
  }
}, 120_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/** Runs a file as a classic script in an empty global scope; what it leaves there is its output. */
function runAsScript(file: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  runInNewContext(read(file), scope);
  return scope;
}

/** The code of a file without its comments (the banner mentions what is inside). */
const codeOf = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

describe.each([DEVELOPMENT_FILE, PRODUCTION_FILE])('%s', (file) => {
  it('NFR-PKG-2: is self-contained: no import, export or require of another module', () => {
    const code = codeOf(file);
    expect(code).not.toMatch(/^\s*(?:import|export)\b/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/from\s*['"`](?:@ganttlane|@internationalized|valibot)/);
  });

  it('NFR-PKG-2: has no leftover build-time constant', () => {
    expect(read(file)).not.toContain('process.env');
    expect(read(file)).not.toContain('__GANTTLANE_DEV__');
  });

  it('NFR-PKG-2: names the code it includes and where the licences are', () => {
    const banner = /^\/\*![\s\S]*?\*\//.exec(read(file))?.[0] ?? '';
    expect(banner).toContain('@ganttlane/dom');
    expect(banner).toContain('@internationalized/date');
    expect(banner).toContain('Apache-2.0');
    expect(banner).toContain('valibot');
    expect(banner).toContain(LICENSES_FILE);
  });

  it('NFR-PKG-2: running it as a script leaves exactly one global, Ganttlane', () => {
    const scope = runAsScript(file);
    expect(Object.keys(scope)).toEqual(['Ganttlane']);
    const names = Object.keys(scope.Ganttlane as object);
    for (const name of [
      'VERSION',
      'createGantt',
      'createChart',
      'createTaskList',
      'mediateTaskList',
      'fromFrappeGanttOptions',
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('the two builds differ in the development messages only', () => {
  it('FR-DATA-12: the table of old option names is in the regular file and not in the minified one', () => {
    // `fromFrappeGanttOptions` carries its own copy of some of these names, so look for the
    // sentence of the warning and its issue code, which only the development build has.
    for (const text of ['is an option of frappe-gantt', 'unknown-option']) {
      expect(codeOf(DEVELOPMENT_FILE)).toContain(text);
      expect(codeOf(PRODUCTION_FILE)).not.toContain(text);
    }
  });

  it('NFR-PKG-2: the minified file is smaller, the regular one is readable', () => {
    expect(read(PRODUCTION_FILE).length).toBeLessThan(read(DEVELOPMENT_FILE).length / 1.5);
    expect(read(DEVELOPMENT_FILE).split('\n').length).toBeGreaterThan(5000);
    expect(read(PRODUCTION_FILE).split('\n').length).toBeLessThan(50);
  });
});

describe('the companions', () => {
  it('NFR-PKG-2: the licences file holds the full texts of the inlined packages', () => {
    const text = read(LICENSES_FILE);
    expect(text).toContain('@internationalized/date');
    expect(text).toContain('Apache License');
    expect(text).toContain('valibot');
    expect(text).toContain('Fabian Hiller');
  });

  it('NFR-PKG-2: the minified stylesheet is the same CSS, smaller', () => {
    const source = readFileSync(join(import.meta.dirname, 'packages/dom/src/styles.css'), 'utf8');
    const minified = read(STYLESHEET_FILE);
    expect(minified.length).toBeLessThan(source.length / 1.5);
    expect(minified.startsWith('@layer gantt{')).toBe(true);
    expect(minified).toContain('color-mix(');
    expect(minified).not.toMatch(/url\(|@import/);
  });
});

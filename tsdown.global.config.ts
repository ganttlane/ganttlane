import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { transform } from 'lightningcss';
import type { TsdownHooks, UserConfig } from 'tsdown';

import { DEVELOPMENT_DEFINE, PRODUCTION_DEFINE } from './packages/core/define.config.ts';

/**
 * The files for a plain `<script src>` and `<link>` (no bundler): two self-contained IIFE bundles
 * of `packages/dom/src/global.ts` that assign `Ganttlane`, and a minified stylesheet. They are shipped in the
 * tarball (`dist`) but are not in `exports`, so a bundler never picks them up; the `jsdelivr` and
 * `unpkg` fields of `package.json` point at the production one.
 *
 * - `ganttlane.global.js`: development build, readable, full issue messages and hints for old
 *   option names (`__GANTTLANE_DEV__` is `true`), like `vue.global.js`.
 * - `ganttlane.global.prod.js`: production build, minified, short messages.
 * - `styles.min.css`: `styles.css` minified.
 * - `THIRD-PARTY-LICENSES.txt`: the licences of the packages inlined into both bundles.
 *
 * The bundles are built from sources (the `@ganttlane/source` condition), so the build does not
 * wait for `@ganttlane/core` to be built, and the build test (`global.test.ts`) can run before any
 * build. `__GANTTLANE_DEV__` is replaced the way `packages/core/tsdown.config.ts` does it.
 */
export const GLOBAL_NAME = 'Ganttlane';
export const DEVELOPMENT_FILE = 'ganttlane.global.js';
export const PRODUCTION_FILE = 'ganttlane.global.prod.js';
export const STYLESHEET_FILE = 'styles.min.css';
export const LICENSES_FILE = 'THIRD-PARTY-LICENSES.txt';

/** The packages whose code the bundles inline besides our own. */
const INLINED = ['@internationalized/date', 'valibot'] as const;

interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

const require = createRequire(join(import.meta.dirname, 'packages/dom/package.json'));

/** The manifest and LICENSE of an installed package, found from where `@ganttlane/core` resolves it. */
function readPackage(name: string): PackageInfo {
  const coreDir = dirname(require.resolve('@ganttlane/core/package.json'));
  let dir = dirname(createRequire(join(coreDir, 'package.json')).resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version: string;
        license: string;
      };
      if (manifest.name === name) {
        const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
          .map((candidate) => join(dir, candidate))
          .find((candidate) => {
            try {
              readFileSync(candidate);
              return true;
            } catch {
              return false;
            }
          });
        if (file === undefined) throw new Error(`${name}: no LICENSE file in ${dir}`);
        return {
          name,
          version: manifest.version,
          license: manifest.license,
          text: readFileSync(file, 'utf8').trim(),
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name}: package.json not found`);
    dir = parent;
  }
}

/** The licences text of the inlined packages, written next to the bundles. */
export function thirdPartyLicenses(): string {
  const sections = INLINED.map((name) => {
    const info = readPackage(name);
    return `${info.name} ${info.version} (${info.license})\n${'='.repeat(60)}\n\n${info.text}\n`;
  });
  return [
    'The files ganttlane.global.js and ganttlane.global.prod.js contain code of the packages below,',
    'bundled in. Their licences and copyright notices follow. The licence of ganttlane itself is',
    'in the LICENSE file of the package.\n',
    ...sections,
  ].join('\n');
}

function banner(development: boolean): string {
  const dom = JSON.parse(
    readFileSync(join(import.meta.dirname, 'packages/dom/package.json'), 'utf8'),
  ) as {
    version: string;
  };
  const parts = INLINED.map((name) => {
    const info = readPackage(name);
    return `${info.name} ${info.version} (${info.license})`;
  });
  return [
    `/*! @ganttlane/dom ${dom.version} ${development ? 'development' : 'production'} build, global \`${GLOBAL_NAME}\` | MIT | https://github.com/ganttlane/ganttlane`,
    ` * Includes @ganttlane/core (MIT), ${parts.join(', ')}.`,
    ` * Their licences and copyright notices: ${LICENSES_FILE}, next to this file. */`,
  ].join('\n');
}

/** `build:done` hook of the first build: the minified stylesheet and the licences file. */
export const writeGlobalCompanions: TsdownHooks['build:done'] = ({ chunks }) => {
  const outDir = chunks[0]?.outDir;
  if (outDir === undefined) return;
  writeFileSync(join(outDir, LICENSES_FILE), thirdPartyLicenses());
  const source = readFileSync(join(import.meta.dirname, 'packages/dom/src/styles.css'));
  // No `targets`: the minifier must not rewrite `color-mix()` or `@layer` for older browsers.
  const { code } = transform({ filename: 'styles.css', code: source, minify: true });
  writeFileSync(join(outDir, STYLESHEET_FILE), code);
};

function bundle(name: string, development: boolean): UserConfig {
  return {
    entry: { [name]: join(import.meta.dirname, 'packages/dom/src/global.ts') },
    format: 'iife',
    globalName: GLOBAL_NAME,
    platform: 'browser',
    target: 'es2022',
    // Every dependency is inlined: the file is loaded by a `<script>` tag.
    deps: { alwaysBundle: [/.*/], onlyBundle: [...INLINED] },
    define: { ...(development ? DEVELOPMENT_DEFINE : PRODUCTION_DEFINE) },
    inputOptions: { resolve: { conditionNames: ['@ganttlane/source', 'import', 'default'] } },
    minify: !development,
    banner: banner(development),
    // Legal comments stay in the minified file, which keeps the banner. tsdown names an IIFE
    // `<entry>.iife.js`; the files are named like `vue.global.js`.
    outputOptions: {
      comments: { legal: true, annotation: true, jsdoc: false },
      entryFileNames: '[name].js',
    },
    sourcemap: false,
    dts: false,
    clean: false,
    publint: false,
    failOnWarn: true,
  };
}

/** The builds, appended to the module build in `tsdown.config.ts` (which cleans `dist` first). */
export const globalBuilds: UserConfig[] = [
  {
    ...bundle(DEVELOPMENT_FILE.replace(/\.js$/, ''), true),
    hooks: { 'build:done': writeGlobalCompanions },
  },
  bundle(PRODUCTION_FILE.replace(/\.js$/, ''), false),
];

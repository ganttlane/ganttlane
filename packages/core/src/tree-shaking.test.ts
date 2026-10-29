import { Rolldown } from 'tsdown';
import { beforeAll, describe, expect, it } from 'vitest';

import { PRODUCTION_DEFINE } from '../define.config';

/**
 * A single utility must cost what it needs, not what the rest of the package initialises
 * (NFR-SIZE-1, plan step 6.2, ADR-019). The published package is one flat module
 * (`dist/index.js`), so its `"sideEffects": false` cannot drop a module: what a consumer's
 * bundler keeps or drops is decided statement by statement. Module-level work it cannot prove
 * free of side effects (`new GregorianCalendar()`, `Object.freeze({ … })`, a table built by a
 * helper) stays in the bundle of every app that imports anything from the package; the cure is
 * `/* @__PURE__ *\/` on the initialiser, or building the value lazily.
 *
 * The test builds the package the way `tsdown.config.ts` does (one flat ES module, production
 * `define`, the dependencies left external) and then bundles `import { name } from <that
 * module>` the way an app's bundler does (Rolldown, tree-shaking, minification, the dependencies
 * inlined). It checks two things: the code of subsystems the utility does not use is absent
 * (found by strings that only that code holds), and the minified size stays under a ceiling. The
 * ceilings are the measured sizes plus about 10 %; `.size-limit.ts` holds the same check for the
 * real `dist`, in gzip bytes.
 *
 * Both are a backstop: a missing mark whose call is small survives under a ceiling (stripping one
 * mark went unnoticed in most cases). The guard against that is `pure-annotations.test.ts`, which
 * checks the sources themselves.
 */

/** Strings that exist only in the code of one subsystem (quotes differ after minification). */
const MARKERS = {
  /** `GregorianCalendar` of `@internationalized/date`: the calendar engine behind every date. */
  dateLibrary: 'gregory',
  /** The built-in view modes (`VIEW_MODE_PRESETS`). */
  viewModes: 'Quarter day',
  /** A valibot schema (`~standard` is on every schema object). */
  valibot: '~standard',
  /** The facade (`createGanttCore`). */
  facade: 'unknown-task',
  /** The change controller and its hooks. */
  events: 'beforeTaskChange',
  /** The interaction machine. */
  interaction: 'cancel-preview',
  /** The link graph. */
  schedule: 'preserve-lag',
} as const;
type Marker = keyof typeof MARKERS;

/** The subsystems above the data layer: no single utility of the lower layers needs them. */
const UPPER_LAYERS: readonly Marker[] = [
  'viewModes',
  'facade',
  'events',
  'interaction',
  'schedule',
];

interface Case {
  readonly name: string;
  /** Ceiling of the minified bundle, in bytes. */
  readonly maxBytes: number;
  /** Subsystems this utility does not use: their code must not be in its bundle. */
  readonly without: readonly Marker[];
}

const CASES: readonly Case[] = [
  {
    name: 'parseDuration',
    maxBytes: 3_000,
    without: ['dateLibrary', 'valibot', ...UPPER_LAYERS],
  },
  { name: 'createWorkCalendar', maxBytes: 22_400, without: ['valibot', ...UPPER_LAYERS] },
  {
    name: 'createTimeScale',
    maxBytes: 1_000,
    without: ['dateLibrary', 'valibot', ...UPPER_LAYERS],
  },
  { name: 'normalizeModel', maxBytes: 35_000, without: UPPER_LAYERS },
  { name: 'patchTasks', maxBytes: 21_900, without: ['valibot', ...UPPER_LAYERS] },
];

const DEPENDENCIES = ['@internationalized/date', 'valibot'];
const PACKAGE_MODULE = '\0ganttlane-core-package';
const ENTRY_MODULE = '\0ganttlane-single-import';

/** The repository root, from the path of this test file. */
function rootDir(): string {
  const path = expect.getState().testPath ?? '';
  return path.slice(0, path.lastIndexOf('/packages/core/src/'));
}

/** The package as published: one flat ES module, the production build, dependencies external. */
async function buildPackage(root: string): Promise<string> {
  const build = await Rolldown.rolldown({
    input: `${root}/packages/core/src/index.ts`,
    platform: 'neutral',
    treeshake: true,
    external: DEPENDENCIES,
    transform: { define: { ...PRODUCTION_DEFINE } },
  });
  const { output } = await build.generate({ format: 'esm' });
  await build.close();
  return output[0].code;
}

/** The bundle of an app that imports only `name` from the package, minified. */
async function bundleOf(packageCode: string, root: string, name: string): Promise<string> {
  const build = await Rolldown.rolldown({
    input: ENTRY_MODULE,
    platform: 'neutral',
    treeshake: true,
    plugins: [
      {
        name: 'single-import',
        async resolveId(id, importer) {
          if (id === ENTRY_MODULE || id === PACKAGE_MODULE) return id;
          // The dependencies of the package are found from its folder, as in `node_modules`.
          if (importer === PACKAGE_MODULE) {
            const resolved = await this.resolve(id, `${root}/packages/core/src/index.ts`);
            return resolved?.id ?? null;
          }
          return null;
        },
        load(id) {
          if (id === PACKAGE_MODULE) return packageCode;
          if (id === ENTRY_MODULE) {
            return `import { ${name} } from ${JSON.stringify(PACKAGE_MODULE)};\nconsole.log(${name});`;
          }
          return null;
        },
      },
    ],
  });
  // Minifiers drop the `/* @__PURE__ */` comments of what they keep; so does size-limit.
  const { output } = await build.generate({ minify: true, comments: { annotation: false } });
  await build.close();
  return output[0].code;
}

describe('tree-shaking of single utilities', () => {
  let root = '';
  let packageCode = '';

  beforeAll(async () => {
    root = rootDir();
    packageCode = await buildPackage(root);
  });

  it('NFR-SIZE-1: the markers are real, the facade bundle holds every subsystem', async () => {
    const code = await bundleOf(packageCode, root, 'createGanttCore');

    const missing = (Object.keys(MARKERS) as Marker[]).filter(
      (marker) => !code.includes(MARKERS[marker]),
    );
    expect(missing).toEqual([]);
  });

  for (const { name, maxBytes, without } of CASES) {
    it(`NFR-SIZE-1: importing only ${name} leaves out the code it does not use`, async () => {
      const code = await bundleOf(packageCode, root, name);

      expect(code.length).toBeGreaterThan(300);
      const present = without.filter((marker) => code.includes(MARKERS[marker]));
      expect(present).toEqual([]);
      expect(code.length).toBeLessThan(maxBytes);
    });
  }
});

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';

import { importedModules } from '../../../examples/imports.ts';

/**
 * The `examples/` folder, with a trailing slash. As the bundler names its files (symbolic links
 * resolved), so that the importers it reports can be compared with it.
 */
const EXAMPLES = `${realpathSync(fileURLToPath(new URL('../../../examples/', import.meta.url)))}/`;

/** The file that is the code of each mode of a demo. */
const MODE_FILES = { vanilla: 'vanilla.ts', react: 'react.tsx' } as const;

/** The module `src/lib/example-css.ts` imports: the stylesheets of every example, by mode. */
const MANIFEST = 'virtual:example-css';
const RESOLVED_MANIFEST = `\0${MANIFEST}`;
/** What a stylesheet imported by an example resolves to: nothing (an empty module). */
const STUB = '\0example-css:stub';

type Mode = keyof typeof MODE_FILES;
type Resolve = (specifier: string, importer: string) => Promise<string | undefined>;

/**
 * The query the manifest adds to the importer when it asks where a stylesheet is. Without it, the
 * answer of another plugin that asks again for the same importer (the alias of
 * `@ganttlane/react/styles.css`) would come back as the stub.
 */
const LOOKUP = '?example-css-lookup';

/** Whether `importer` is a source file of an example (an id may carry a `?query`). */
function isExampleFile(importer: string | undefined): boolean {
  if (importer === undefined || importer.endsWith(LOOKUP)) return false;
  const file = importer.split('?')[0] ?? '';
  return file.startsWith(EXAMPLES) && !file.includes('/node_modules/');
}

/** The file a relative import of `from` leads to, written with or without its extension. */
function sourceFile(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier);
  return ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((suffix) => `${base}${suffix}`)
    .find((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * The stylesheets `file` imports, and the files it imports from the same folder do, in the order
 * an application would load them. Each is an absolute path.
 */
async function stylesheetsOf(
  file: string,
  resolve: Resolve,
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(file)) return [];
  seen.add(file);
  const sheets: string[] = [];
  for (const specifier of importedModules(readFileSync(file, 'utf8'))) {
    if (specifier.endsWith('.css')) {
      const sheet = await resolve(specifier, file);
      if (sheet === undefined) {
        throw new Error(
          `${relative(EXAMPLES, file)} imports "${specifier}", which does not resolve.`,
        );
      }
      sheets.push(sheet);
    } else if (specifier.startsWith('.')) {
      const next = sourceFile(file, specifier);
      if (next !== undefined) sheets.push(...(await stylesheetsOf(next, resolve, seen)));
    }
  }
  return [...new Set(sheets)];
}

/** The text of the manifest: `{ [slug]: { [mode]: (() => Promise<{ default: string }>)[] } }`. */
function manifestSource(sheets: ReadonlyMap<string, Partial<Record<Mode, string[]>>>): string {
  const examples = [...sheets].map(([slug, modes]) => {
    const lines = Object.entries(modes).map(([mode, paths]) => {
      const loaders = paths.map((path) => `() => import(${JSON.stringify(`${path}?inline`)})`);
      return `    ${JSON.stringify(mode)}: [${loaders.join(', ')}],`;
    });
    return `  ${JSON.stringify(slug)}: {\n${lines.join('\n')}\n  },`;
  });
  return `export default {\n${examples.join('\n')}\n};\n`;
}

function exampleStylesPlugin(): Plugin {
  return {
    name: 'ganttlane:example-styles',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === MANIFEST) return RESOLVED_MANIFEST;
      // `import '@ganttlane/dom/styles.css'` or `import './styles.css'` in an example would put the
      // stylesheet in the module graph of the page, and the build links it into the head of every
      // page that can reach the demo, whichever example it is. It resolves to nothing, and the
      // manifest says which stylesheets a demo has instead.
      if (isExampleFile(importer) && source.endsWith('.css') && !source.includes('?')) return STUB;
      return null;
    },
    async load(id) {
      if (id === STUB) return 'export {};';
      if (id !== RESOLVED_MANIFEST) return null;
      const resolve: Resolve = async (specifier, importer) => {
        if (specifier.startsWith('.')) return join(dirname(importer), specifier);
        const resolved = await this.resolve(specifier, `${importer}${LOOKUP}`);
        return resolved?.id.split('?')[0];
      };
      const sheets = new Map<string, Partial<Record<Mode, string[]>>>();
      const slugs = readdirSync(EXAMPLES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !/^[._]/.test(entry.name))
        .map((entry) => entry.name)
        .filter((name) => name !== 'node_modules')
        .sort();
      for (const slug of slugs) {
        const modes: Partial<Record<Mode, string[]>> = {};
        for (const [mode, name] of Object.entries(MODE_FILES) as [Mode, string][]) {
          const file = join(EXAMPLES, slug, name);
          try {
            if (!statSync(file).isFile()) continue;
          } catch {
            continue;
          }
          this.addWatchFile(file);
          modes[mode] = await stylesheetsOf(file, resolve);
        }
        sheets.set(slug, modes);
      }
      return manifestSource(sheets);
    },
  };
}

/**
 * Keeps the stylesheets of the examples out of the pages that do not show them.
 *
 * An example is user code: `vanilla.ts` and `react.tsx` import the stylesheet of the library (and
 * their own, when they have one) the way an application does, and the examples' tests and the
 * code tabs of the site show exactly that. In the production build, Astro links every stylesheet
 * that a page's scripts can reach, dynamic imports included, into the head of that page, and each
 * example page reaches every demo (they load on demand). So the default stylesheet was on every
 * page of the examples, and an example without it (`unstyled`) could not be unstyled.
 *
 * This integration adds a Vite plugin that
 *
 * - resolves a stylesheet imported **by a file of `examples/`** to an empty module, so the build
 *   never sees it as part of a page;
 * - provides `virtual:example-css`, which lists, for each example and each mode, the stylesheets
 *   that mode's code imports (read from the files themselves, those they import from their folder
 *   included), each as an `import()` of its text (`?inline`), in import order.
 *
 * `src/lib/example-css.ts` puts those texts on the page while the demo of that mode is shown, and
 * takes them away after. It applies to `astro dev` as well, which is how `astro build` behaves.
 *
 * @returns The integration.
 */
export function exampleStyles(): AstroIntegration {
  return {
    name: 'example-styles',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [exampleStylesPlugin()] } });
      },
    },
  };
}

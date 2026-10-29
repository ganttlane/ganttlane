// A TypeDoc plugin of the documentation site (loaded through `typedoc/options.ts`).
//
// 1. TypeDoc names a module after its entry point's path (`core/src`, `dom/src/facade`, …). The
//    API reference should name them as they are imported, so this renames each one to the
//    specifier of its package entry (`@ganttlane/core`, `@ganttlane/dom/facade`, …). It runs
//    before the renderer derives the output paths from the names.
// 2. The output folder (`src/content/docs/api/`) holds the hand-written `index.mdx` and nothing
//    else that is not generated, so a run starts by removing everything but that file (a page of
//    an export that was removed must not outlive it), and ends by removing the page that lists the
//    modules, which `index.mdx` replaces.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Converter, RendererEvent } from 'typedoc';

/** The hand-written page of the output folder: the only file that is not generated. */
const OVERVIEW = 'index.mdx';

/** Module name by the entry point's path relative to `packages/` (no extension). */
const MODULE_NAMES = new Map([
  ['core/src', '@ganttlane/core'],
  ['dom/src', '@ganttlane/dom'],
  ['dom/src/facade', '@ganttlane/dom/facade'],
  ['dom/src/dom-utils', '@ganttlane/dom/dom-utils'],
  ['react/src', '@ganttlane/react'],
  ['react/src/core', '@ganttlane/react/core'],
]);

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const seen = new Set();
    for (const module of context.project.children ?? []) {
      const name = MODULE_NAMES.get(module.name);
      if (name === undefined) {
        app.logger.warn(
          `typedoc/plugin.mjs: no public name for the module "${module.name}"; add it to MODULE_NAMES.`,
        );
        continue;
      }
      module.name = name;
      seen.add(module.name);
    }
    for (const name of MODULE_NAMES.values()) {
      if (!seen.has(name)) app.logger.warn(`typedoc/plugin.mjs: the module "${name}" is missing.`);
    }
  });

  app.renderer.on(RendererEvent.BEGIN, (event) => {
    if (!existsSync(event.outputDirectory)) return;
    for (const entry of readdirSync(event.outputDirectory)) {
      if (entry !== OVERVIEW) {
        rmSync(join(event.outputDirectory, entry), { recursive: true, force: true });
      }
    }
  });

  app.renderer.on(RendererEvent.END, (event) => {
    rmSync(join(event.outputDirectory, 'index.md'), { force: true });
  });
}

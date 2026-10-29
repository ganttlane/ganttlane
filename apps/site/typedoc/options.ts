import { fileURLToPath } from 'node:url';

import type { StarlightTypeDocOptions } from 'starlight-typedoc';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * The API reference of the three packages (`starlight-typedoc` over TypeDoc and
 * `typedoc-plugin-markdown`): one program (`../tsconfig.typedoc.json`) with every public entry of
 * the `exports` of the packages, read from source. The pages are written to
 * `src/content/docs/api/` each time Astro starts (`astro dev`, `astro build`, `astro sync`) and are
 * not committed; `src/content/docs/api/index.mdx` is the hand-written overview.
 */
export const typeDocOptions: StarlightTypeDocOptions = {
  tsconfig: here('../tsconfig.typedoc.json'),
  entryPoints: [
    '../../../packages/core/src/index.ts',
    '../../../packages/dom/src/index.ts',
    '../../../packages/dom/src/facade.ts',
    '../../../packages/dom/src/dom-utils/index.ts',
    '../../../packages/react/src/index.ts',
    '../../../packages/react/src/core.ts',
  ].map(here),
  output: 'api',
  sidebar: { label: 'API reference', collapsed: true },
  typeDoc: {
    plugin: [here('./plugin.mjs')],
    // Modules are the packages' entries, in this order: the core first, so that a type the DOM
    // package re-exports is documented where it is defined and linked from the re-export.
    sort: ['kind', 'alphabetical'],
    // `@internal` members are not API. Private and protected ones are excluded by default.
    excludeInternal: true,
    // The output folder holds the hand-written `index.mdx`, so TypeDoc does not clean it; the
    // plugin does (see `plugin.mjs`). A module's own page is its `index`.
    cleanOutputDir: false,
    entryFileName: 'index',
    hideGenerator: true,
    // Where each member is defined, on GitHub (not read from the checkout, so a build on any
    // machine, in a worktree or a CI clone, has the same links).
    disableGit: true,
    // Paths are shown (and linked) relative to `packages/`; module names come from them too
    // (`plugin.mjs` renames those).
    displayBasePath: here('../../../packages'),
    sourceLinkTemplate: 'https://github.com/ganttlane/ganttlane/blob/main/packages/{path}#L{line}',
  },
};

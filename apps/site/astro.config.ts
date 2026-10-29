import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';
import { defaultClientConditions, defaultServerConditions, searchForWorkspaceRoot } from 'vite';

import { readExamples } from '../../examples/discover.ts';
import { groupByCategory } from '../../examples/meta.ts';
import { exampleAliases } from '../../examples/resolve.ts';
import { migrationPage } from './integrations/migration-page.ts';
import { typeDocOptions } from './typedoc/options.ts';
import { apiSidebar } from './typedoc/sidebar.ts';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The Examples group of the sidebar: one link per folder of `examples/`, grouped by `category`. */
function exampleSidebar() {
  const groups = groupByCategory(readExamples(here('../../examples')));
  return {
    label: 'Examples',
    items: [
      { label: 'All examples', link: '/examples/' },
      ...groups.map(({ category, examples }) => ({
        label: category,
        items: examples.map(({ slug, title }) => ({ label: title, link: `/examples/${slug}/` })),
      })),
    ],
  };
}

/** The concept pages, in the order a reader needs them (the overview first). */
const CONCEPTS = [
  'tasks-and-records',
  'links-and-types',
  'dates-and-time',
  'granularity-and-alignment',
  'work-calendar',
  'hierarchy',
  'propagation-and-conflicts',
  'data-ownership',
  'change-sets-and-hooks',
  'edit-sessions-and-history',
  'issues',
];

/** The Guides group of the sidebar: the concepts, then one page per topic. */
const guidesSidebar = {
  label: 'Guides',
  items: [
    {
      label: 'Concepts',
      items: [
        { slug: 'guides/concepts', label: 'Overview' },
        ...CONCEPTS.map((page) => ({ slug: `guides/concepts/${page}` })),
      ],
    },
    ...[
      'options',
      'events',
      'methods',
      'theming',
      'react',
      'custom-renderers',
      'performance',
      'accessibility',
      'migration',
      'faq',
    ].map((page) => ({ slug: `guides/${page}` })),
  ],
};

// https://ganttlane.github.io/ganttlane/ (GitHub Pages, project site: hence the base).
export default defineConfig({
  site: 'https://ganttlane.github.io',
  base: '/ganttlane/',
  integrations: [
    // Writes the Migration page from `MIGRATION.md` (before Starlight reads the content).
    migrationPage(),
    starlight({
      title: 'ganttlane',
      description:
        'An interactive Gantt chart library for the web: a framework-agnostic TypeScript core, a vanilla DOM renderer with a themable stylesheet, and React bindings.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ganttlane/ganttlane' }],
      editLink: { baseUrl: 'https://github.com/ganttlane/ganttlane/edit/main/apps/site/' },
      customCss: ['./src/styles/site.css'],
      // The API sidebar is finished by `apiSidebar`, so it must come after TypeDoc's plugin.
      plugins: [starlightTypeDoc(typeDocOptions), apiSidebar()],
      sidebar: [
        {
          label: 'Getting started',
          items: ['introduction', 'installation', 'quick-start'].map((page) => ({
            slug: `getting-started/${page}`,
          })),
        },
        guidesSidebar,
        exampleSidebar(),
        // Replaced by the groups `starlight-typedoc` generates (`typedoc/options.ts`).
        typeDocSidebarGroup,
      ],
    }),
    // The islands of the live demos (`src/components/ReactDemo.tsx`).
    react(),
  ],
  vite: {
    resolve: {
      // The packages from source, as the playground has them: no build step, and the examples
      // (which the site imports) are exactly what the tests run.
      conditions: ['@ganttlane/source', ...defaultClientConditions],
      dedupe: ['react', 'react-dom'],
      alias: exampleAliases(),
    },
    ssr: {
      resolve: { conditions: ['@ganttlane/source', ...defaultServerConditions] },
    },
    environments: {
      // The pages are prerendered (the site is static) from a bundle that has every dependency
      // inside it. Left to Vite, a dependency of Astro (`cookie`, …) stays an `import` when a
      // `node_modules` of a parent directory happens to have a package of that name, and Node
      // then loads that one from `dist/.prerender`, whatever version it is.
      prerender: { resolve: { noExternal: true } },
    },
    server: {
      fs: {
        // The examples and the packages are outside the site's folder.
        allow: [searchForWorkspaceRoot(here('.')), here('../../examples'), here('../../packages')],
      },
    },
  },
});

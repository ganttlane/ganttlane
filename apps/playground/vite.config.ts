import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Alias, Plugin } from 'vite';
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** What `src/react-ssr-server.tsx` exports. */
interface ServerEntry {
  render(search: string): string;
}

/**
 * The builds of the playground that `vite preview` serves, by the path they are served under (the
 * e2e specs run the React pages on every one, `e2e/react-support.ts`): the production build (`''`),
 * the same with React's development bundles (`/dev`), and that with React 18.3 in place of 19
 * (`/react-18`). Each has the server entry of its own, which renders the SSR page (`ssrPage`).
 */
const SERVER_ENTRIES: Readonly<Record<string, string>> = {
  '': 'ssr/react-ssr-server.js',
  '/dev': 'ssr/react-ssr-server.js',
  '/react-18': 'ssr-react-18/react-ssr-server.js',
};

/**
 * With `GANTTLANE_REACT_18=1`, `react` and `react-dom` (and every subpath of them) are the React
 * 18.3 of `internal/react-18`, the one the `react-18` Vitest project tests against, instead of the
 * playground's own 19: the playground built so (`pnpm --filter playground build:react-18`) is the
 * real-browser run of the same React 18.3 matrix.
 */
function react18Aliases(): Alias[] {
  if (process.env.GANTTLANE_REACT_18 !== '1') return [];
  const require = createRequire(page('../../internal/react-18/package.json'));
  const dirOf = (name: string): string => dirname(require.resolve(`${name}/package.json`));
  return ['react', 'react-dom'].flatMap((name) => [
    { find: new RegExp(`^${name}$`), replacement: dirOf(name) },
    { find: new RegExp(`^${name}/(.*)$`), replacement: `${dirOf(name)}/$1` },
  ]);
}

/**
 * The server-rendered React page (`/react-ssr/`, plan step 5.4, FR-REACT-5): the shell of
 * `react-ssr/index.html` with the markup of `src/react-ssr-server.tsx` in `#app`, made on every
 * request, which the browser then hydrates (`src/react-ssr.tsx`).
 *
 * - `pnpm dev`: the dev server renders it (`ssrLoadModule`), with HMR for both sides.
 * - `vite preview` (what the e2e specs run against): the shell is the page of a build
 *   (`/react-ssr/` of the production build, `/dev/react-ssr/` of the one with React's development
 *   bundles, where hydration mismatches are reported, `/react-18/react-ssr/` of the React 18.3 one),
 *   and the server entry is the SSR build of the same React (`build:server`, `build:react-18-server`).
 *
 * Nothing else is server code: the playground is otherwise static pages.
 */
function ssrPage(): Plugin {
  /** The build the request is for, the path of the page and its query string; or `undefined`. */
  const route = (
    url: string | undefined,
  ): { build: string; path: string; search: string } | undefined => {
    const { pathname, search } = new URL(url ?? '/', 'http://localhost');
    const match = /^((\/dev|\/react-18)?\/react-ssr)\/?$/.exec(pathname);
    return match?.[1] === undefined ? undefined : { build: match[2] ?? '', path: match[1], search };
  };
  const send = (response: ServerResponse, html: string): void => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  };
  /**
   * The shell with the markup in it: `hydrateRoot` needs `#app` to hold exactly the markup. The
   * replacement is a function, so that the markup is put in as it is: a string would have its `$&`,
   * `$'`, `` $` `` and `$$` read as patterns (text from the query string can be in the markup).
   */
  const withMarkup = (shell: string, markup: string): string =>
    shell.replace('<div id="app"></div>', () => `<div id="app">${markup}</div>`);

  return {
    name: 'ganttlane:ssr-page',
    configureServer(server) {
      server.middlewares.use((request: IncomingMessage, response, next) => {
        const asked = route(request.url);
        if (asked === undefined) {
          next();
          return;
        }
        void (async () => {
          const shell = await readFile(join(server.config.root, 'react-ssr/index.html'), 'utf8');
          const entry = (await server.ssrLoadModule('/src/react-ssr-server.tsx')) as ServerEntry;
          const html = await server.transformIndexHtml(
            asked.path,
            withMarkup(shell, entry.render(asked.search)),
          );
          send(response, html);
        })().catch(next);
      });
    },
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request: IncomingMessage, response, next) => {
        const asked = route(request.url);
        if (asked === undefined) {
          next();
          return;
        }
        void (async () => {
          const shell = await readFile(join(outDir, asked.path, 'index.html'), 'utf8');
          const entry = (await import(
            pathToFileURL(join(outDir, SERVER_ENTRIES[asked.build] ?? '')).href
          )) as ServerEntry;
          send(response, withMarkup(shell, entry.render(asked.search)));
        })().catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ssrPage()],
  resolve: {
    // Consume workspace packages from `src` (no build step, HMR on package edits).
    conditions: ['@ganttlane/source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom'],
    alias: react18Aliases(),
  },
  ssr: {
    // The server entry (the SSR build, and the dev server's `ssrLoadModule`) reads the same sources.
    resolve: { conditions: ['@ganttlane/source', ...defaultServerConditions] },
    // With React 18.3 it is bundled too: it is not a dependency of the playground, so Node could
    // not load it from the build.
    noExternal: process.env.GANTTLANE_REACT_18 === '1' ? true : [/^@ganttlane\//],
  },
  build: {
    rolldownOptions: {
      input: {
        main: page('./index.html'),
        vanilla: page('./vanilla/index.html'),
        react: page('./react/index.html'),
        reactSsr: page('./react-ssr/index.html'),
        bench: page('./bench/index.html'),
        edit: page('./edit/index.html'),
        reactEdit: page('./react-edit/index.html'),
        scroll: page('./scroll/index.html'),
      },
    },
  },
});

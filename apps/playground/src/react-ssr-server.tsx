/**
 * Server entry of the server-rendered React page (`/react-ssr/`, plan step 5.4, FR-REACT-5): the
 * markup of `react-app.tsx` for a query string, with no window, no document and no renderer (the
 * chart is drawn after hydration, `react-ssr.tsx`). `ssrPage` in `vite.config.ts` calls this on
 * every request, in the dev server (`ssrLoadModule`) and in `vite preview` (the build of
 * `pnpm --filter playground build:server`).
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App, PageContext } from './react-app';

/**
 * Renders the page.
 *
 * @param search - The query string of the request (`?fixture=…`), as `location.search` has it.
 * @returns The markup that goes into `#app`.
 */
export function render(search: string): string {
  return renderToString(
    <StrictMode>
      <PageContext.Provider value="playground">
        <App search={search} />
      </PageContext.Provider>
    </StrictMode>,
  );
}

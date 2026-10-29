/**
 * Client entry of the server-rendered React page (`/react-ssr/`, plan step 5.4, FR-REACT-5): the
 * server has put the markup of `react-app.tsx` into `#app` (`react-ssr-server.tsx`), and this
 * hydrates it. The chart is not in the markup: a server renders the container only, and the chart
 * is drawn into it after hydration.
 *
 * Server and client render the same tree for the same query string, which is what hydration needs.
 */
import '@ganttlane/dom/styles.css';
import './playground.css';

import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { App, PageContext } from './react-app';

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('#app not found');

hydrateRoot(
  container,
  <StrictMode>
    <PageContext.Provider value="playground">
      <App search={window.location.search} />
    </PageContext.Provider>
  </StrictMode>,
);

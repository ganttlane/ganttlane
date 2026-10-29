import '@ganttlane/dom/styles.css';
import './playground.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, PageContext } from './react-app';

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('#app not found');

createRoot(container).render(
  <StrictMode>
    <PageContext.Provider value="playground">
      <App search={window.location.search} />
    </PageContext.Provider>
  </StrictMode>,
);

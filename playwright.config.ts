import { defineConfig, devices } from '@playwright/test';

// Override to run several suites side by side (each builds and serves its own playground).
const PORT = Number(process.env.GANTTLANE_E2E_PORT ?? 4173);
const isCI = Boolean(process.env.CI);
// A server that already answers on the port is reused (a `vite preview` you left running keeps
// the runs short). `pnpm bench` sets this: a stale build must never be what it measures.
const reuseExistingServer = !isCI && process.env.GANTTLANE_E2E_NO_REUSE !== '1';

/**
 * E2E tests run against a production build of the playground (`vite build` + `vite preview`),
 * so they exercise the same bundling path users get. The playground consumes workspace packages
 * from `src` via the `@ganttlane/source` export condition, so packages need no separate build.
 *
 * `pnpm --filter playground build` makes more than that one build: the same pages with React's
 * development bundles (`/dev/`, where StrictMode runs effects twice and React reports warnings),
 * and with React 18.3 in place of 19 (`/react-18/`), plus the server builds of the server-rendered
 * React page.
 *
 * ## The matrix (plan step 6.1, NFR-QUAL-2)
 *
 * Every spec runs in all three engines (the `projects` below): Chromium, Firefox and WebKit differ
 * in scrolling, pointer events and layout, which is what a chart is made of. What varies besides
 * the engine is the renderer and, for React, the build:
 *
 * | Specs | Renderer, build | Why |
 * | --- | --- | --- |
 * | `journeys-vanilla` | vanilla chart (`/edit/`): all 13 journeys | the key user journeys, `e2e/journeys/` |
 * | `journeys-react` | `<Gantt>` (`/react-edit/`), production build: all 13 | the same journeys, as shipped |
 * | `journeys-react` | `<Gantt>`, development build (StrictMode, React 19) and React 18.3 build: the 7 `lifecycle` journeys | what depends on React (props to options, controlled data, handlers, effects twice, warnings) |
 * | `react-page`, `react-edit`, `react-options`, `react-demo-links` | the React demo page, all three builds | the page itself: fixtures, slots, its controls |
 * | `react-slots` | React demo page, production build | `ReactNode` slots and portals |
 * | `react-ssr` | the server-rendered page, all three builds | hydration |
 * | the rest (`edit-*`, `scroll-*`, `popover-*`, `header-grid`, `i18n`, `facade`, `vanilla-page`, `playground`, `bench`) | vanilla renderer, production build | renderer internals: React only wraps the renderer, so they gain nothing from a second run |
 *
 * The journeys are written once and run on both renderers through a driver (`e2e/journeys/driver.ts`);
 * the `renderer` ones (gestures, scrolling, popovers) are the vanilla renderer's, which React only
 * wraps, so they run on React's production build and not on its two development builds. The
 * journeys took the place of the tests that said the same thing twice (the facade's and the React
 * pages' copies of drag, session, theme, locale, link menu, tooltip): the suite got smaller, and
 * no slower, while React is exercised by the same scenarios as the vanilla chart, in every
 * engine. (`pnpm exec playwright test --list` ends with the current number of tests.) Most of the
 * time is `bench`, `scroll-*` and `edit-autoscroll` (renderer internals, kept as they are).
 *
 * ## CI
 *
 * `.github/workflows/ci.yml` runs this suite as a job of its own, one job per engine (`--project`),
 * so a failure names its engine and the engines run side by side. A failed job uploads its HTML
 * report, with the traces of the tests that were retried.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // `github`: annotations on the pull request; `dot`: the log; `html`: the report a failed job uploads.
  reporter: isCI ? [['github'], ['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm --filter playground build && pnpm --filter playground preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer,
    timeout: 120_000,
  },
});

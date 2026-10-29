import type { SizeLimitConfig } from 'size-limit';

/**
 * NFR-SIZE-1 budgets, min + gzip, measured on the built `dist` (run `pnpm build` first). The
 * numbers below are those of plan step 6.2; the budgets are the limits in the entries.
 *
 * Core budgets (plan step 3.9, ADR-019) were set at the size measured then plus about 10 %, rounded
 * up to a whole kB: the production entry with every export (59.81 kB now; `@internationalized/date`
 * and valibot included), what an app importing only `createGanttCore` ships (56.43 kB), and,
 * loosely, the development build with the full issue messages (64.08 kB). `pnpm size:report`
 * breaks a build down by core module and dependency.
 *
 * The single-utility entries (plan step 6.2) are set the same way, but rounded up to 0.1 kB: a
 * whole kB would leave `createTimeScale` (0.43 kB) a margin of 130 %, and the point of these entries
 * is to notice module-level work that a bundler cannot drop (see the comment above them). Before
 * step 6.2 any single import cost at least 4.9 kB, `VERSION` included.
 *
 * Each JS entry is bundled and minified by Rolldown (`@size-limit/preset-small-lib`). Budgets for
 * `@ganttlane/dom` and `@ganttlane/react` are "on top of what they are built on": the packages
 * below them are marked external via `ignore` (core for dom; core, dom with all its subpaths
 * (`/facade`, `/dom-utils`) and React for react), so the number is what the package adds to an app
 * that already ships those. dom is 20.15 kB of 22 (raised in Q14 for the disposal contract of
 * ADR-029, `DisposableNode`); react is 6.53 kB of 10. `pnpm size:report --package dom` breaks the
 * dom number down by layer, shared helper and file (plan step 4.5); `pnpm bench` prints every
 * entry next to its limit with the performance numbers (`docs/perf.md`).
 */
const REACT_EXTERNALS = ['react', 'react-dom'];

const config: SizeLimitConfig = [
  {
    name: '@ganttlane/core',
    path: 'packages/core/dist/index.js',
    limit: '62 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core: createGanttCore only',
    path: 'packages/core/dist/index.js',
    import: '{ createGanttCore }',
    limit: '58 kB',
    gzip: true,
  },
  // Single utilities (plan step 6.2, ADR-019): what an app pays for importing one function of the
  // core. `dist/index.js` is one flat module, so a bundler keeps or drops its module-level
  // statements one by one: a `new GregorianCalendar()`, an `Object.freeze({ … })` or a table built
  // by a helper stays unless it is marked `/* @__PURE__ */` (or built lazily). These byte ceilings
  // are a backstop, not the guard: they only fail when what leaks is larger than the margin of the
  // ceiling, and a small leak (a `new Set([…])`, a frozen constant) slips under it. The guard is
  // `src/pure-annotations.test.ts`, which reads the sources and fails on every call or `new` that
  // runs at import time without the mark. `src/tree-shaking.test.ts` repeats the byte check in
  // minified bytes and names the subsystem that leaked. The numbers (kB gzip):
  // parseDuration 1.20, createWorkCalendar 7.06, createTimeScale 0.43, normalizeModel 10.90,
  // patchTasks 7.08. What is left in them is what the function needs: the date library (about
  // 3.3 kB of the 7) and the core modules it calls.
  {
    name: '@ganttlane/core: parseDuration only',
    path: 'packages/core/dist/index.js',
    import: '{ parseDuration }',
    limit: '1.4 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core: createWorkCalendar only',
    path: 'packages/core/dist/index.js',
    import: '{ createWorkCalendar }',
    limit: '7.8 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core: createTimeScale only',
    path: 'packages/core/dist/index.js',
    import: '{ createTimeScale }',
    limit: '0.5 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core: normalizeModel only',
    path: 'packages/core/dist/index.js',
    import: '{ normalizeModel }',
    limit: '12 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core: patchTasks only',
    path: 'packages/core/dist/index.js',
    import: '{ patchTasks }',
    limit: '7.8 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/core development build (export condition `development`)',
    path: 'packages/core/dist/index.development.js',
    limit: '66 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/dom (on top of core)',
    path: 'packages/dom/dist/index.js',
    ignore: ['@ganttlane/core'],
    limit: '22 kB',
    gzip: true,
  },
  {
    name: '@ganttlane/react (on top of core and dom, without React)',
    path: 'packages/react/dist/index.js',
    ignore: ['@ganttlane/core', '@ganttlane/dom', ...REACT_EXTERNALS],
    limit: '10 kB',
    gzip: true,
  },
  {
    // Shipped as-is (not minified), so this gzip size is an upper bound of min + gzip.
    name: '@ganttlane/dom/styles.css',
    path: 'packages/dom/dist/styles.css',
    rolldown: false,
    limit: '8 kB',
    gzip: true,
  },
  {
    // The same file, copied into the React package at build time (`copy` in its tsdown config),
    // for apps that installed only `@ganttlane/react`. Same CSS budget: it is one stylesheet.
    name: '@ganttlane/react/styles.css (a copy of the one above)',
    path: 'packages/react/dist/styles.css',
    rolldown: false,
    limit: '8 kB',
    gzip: true,
  },
];

export default config;

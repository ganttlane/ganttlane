import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { Alias } from 'vite';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// Performance budgets (`*.perf.test.ts`) only run in `pnpm test:perf`: under coverage
// instrumentation, in six time zones or next to other heavy jobs their timings are noise.
const PERF = process.env.GANTTLANE_PERF === '1';
const PERF_TESTS = '**/*.perf.test.{ts,tsx}';
const files = PERF
  ? { include: [`src/${PERF_TESTS}`] }
  : { exclude: [...configDefaults.exclude, PERF_TESTS] };

/**
 * `react` and `react-dom` (every subpath: `react/jsx-runtime`, `react-dom/client`,
 * `react-dom/server`, ...) as `internal/react-18` has them: React 18.3.1, the oldest React the
 * peer range of `@ganttlane/react` promises (NFR-COMPAT-1). A workspace package of its own, not
 * an `npm:` alias in `packages/react`, so that pnpm gives `react-dom@18` its own `react@18` as its
 * peer. Both resolve to the real files of the store, so React DOM's own `require('react')` and
 * the tests' `import 'react'` are one module.
 */
function react18Aliases(): Alias[] {
  const require = createRequire(new URL('./internal/react-18/package.json', import.meta.url));
  const dirOf = (name: string): string => dirname(require.resolve(`${name}/package.json`));
  return ['react', 'react-dom'].flatMap((name) => [
    { find: new RegExp(`^${name}$`), replacement: dirOf(name) },
    { find: new RegExp(`^${name}/(.*)$`), replacement: `${dirOf(name)}/$1` },
  ]);
}

export default defineConfig({
  // Resolve workspace packages to their `src` (via the `@ganttlane/source` export
  // condition), so tests never need a build.
  resolve: {
    conditions: ['@ganttlane/source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['@ganttlane/source', ...defaultServerConditions],
    },
  },
  test: {
    // Property tests run hundreds of cases; under coverage on a loaded machine the 5 s default
    // fails them spuriously. Timing budgets live in the separate perf run instead.
    testTimeout: 30_000,
    // Perf budgets are wall-clock: a busy machine can blow one once. A real regression fails
    // every attempt, a load spike does not.
    retry: PERF ? 2 : 0,
    // `pnpm test:coverage` (part of `pnpm check`). Thresholds per NFR-QUAL-2.
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '**/*.config.*', '**/dist/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        'packages/core/src/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          ...files,
          root: 'packages/core',
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          ...files,
          root: 'packages/dom',
          environment: 'happy-dom',
        },
      },
      {
        extends: true,
        // `react-version.test.tsx` checks the React that is really loaded against this.
        define: { __REACT_MAJOR__: 19 },
        test: {
          name: 'react',
          ...files,
          root: 'packages/react',
          environment: 'happy-dom',
        },
      },
      {
        // The same tests against React 18.3 (the `react` project runs React 19).
        extends: true,
        define: { __REACT_MAJOR__: 18 },
        resolve: { alias: react18Aliases() },
        test: {
          name: 'react-18',
          ...files,
          root: 'packages/react',
          environment: 'happy-dom',
        },
      },
      {
        // Shared test data (`@ganttlane/fixtures`): plain data, so Node like core.
        extends: true,
        test: {
          name: 'fixtures',
          ...files,
          root: 'internal/fixtures',
          environment: 'node',
        },
      },
    ],
  },
});

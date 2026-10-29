import { defineConfig, type UserConfig } from 'tsdown';

// With the extension: tsdown loads its config with Node's own TypeScript support.
import { outputOptions, stripDanglingDeclarationMapComments } from '../../tsdown.shared.config.ts';
import { DEVELOPMENT_DEFINE, PRODUCTION_DEFINE } from './define.config.ts';

const shared: UserConfig = {
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  outputOptions,
  // Any warning (bundler, dts, publint) fails the build.
  failOnWarn: true,
};

/**
 * Two builds of the same entry (plan step 3.9, ADR-016, ADR-019):
 *
 * - `dist/index.js` (default export condition): production. `__GANTTLANE_DEV__` is `false`, so
 *   every `DEV ? text : ''` branch (`src/shared/dev.ts`) folds away: issues keep their codes and
 *   fields with short messages (`'<path>: <code>'`), the explanatory texts and hints are gone.
 * - `dist/index.development.js` (export condition `development`, picked by Vite, webpack and
 *   `node --conditions=development` in development): the same code with the full messages.
 *
 * Both builds share `dist/index.d.ts`, emitted by the production build only. tsdown cleans
 * `dist` once before both builds and runs publint after both have finished.
 */
export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    define: { ...PRODUCTION_DEFINE },
    // Only the development build has a source map (1.1 MB, it embeds the sources): that is the
    // build dev servers load, where a map helps; the production build is re-bundled and minified
    // by the consumer. No declaration maps: they point at `src`, which is not published. The hook
    // removes a `sourceMappingURL` comment a declaration file would keep without its map.
    sourcemap: false,
    dts: true,
    hooks: { 'build:done': stripDanglingDeclarationMapComments },
    clean: true,
    publint: true,
  },
  {
    ...shared,
    entry: { 'index.development': 'src/index.ts' },
    define: { ...DEVELOPMENT_DEFINE },
    dts: false,
    clean: false,
  },
]);

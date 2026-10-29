import { defineConfig } from 'tsdown';

import { outputOptions, stripDanglingDeclarationMapComments } from '../../tsdown.shared.config.ts';

export default defineConfig({
  // `index` is client code; `core` (`@ganttlane/react/core`: `patchTasks` and the types) is not, so
  // that a server component can import it.
  entry: { index: 'src/index.ts', core: 'src/core.ts' },
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // Every export of the main entry is a client component or hook (docs/architecture.md §9).
  // Rolldown drops module-level directives of non-entry modules, so the bundle gets it as a
  // banner, and not on `core`, which must stay a plain module.
  banner: ({ fileName }) => (fileName.startsWith('index') ? { js: "'use client';" } : undefined),
  // No declaration maps: they point at `src`, which is not published. The JS source maps embed
  // their sources (`sourcesContent`), so they work from the tarball alone. The hook removes the
  // `sourceMappingURL` comment that `sourcemap: true` still leaves in the declarations.
  dts: true,
  hooks: { 'build:done': stripDanglingDeclarationMapComments },
  sourcemap: true,
  outputOptions,
  clean: true,
  // `@ganttlane/react/styles.css`: the stylesheet of `@ganttlane/dom`, copied (never kept in two
  // places) so that an app that installed only this package, where strict pnpm hides
  // `@ganttlane/dom`, can import it. `pnpm build` builds `dom` first, but the source is the same file.
  // The stylesheet has declarations of its own (`src/styles.css.d.ts`, the `types` condition of the
  // subpath): TypeScript 6 rejects a side-effect import it finds no declarations for, TS2882.
  copy: [
    { from: '../dom/src/styles.css', to: 'dist' },
    { from: 'src/styles.css.d.ts', to: 'dist' },
  ],
  publint: true,
  // Any warning (bundler, dts, publint) fails the build.
  failOnWarn: true,
});

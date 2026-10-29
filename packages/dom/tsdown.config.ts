import { defineConfig } from 'tsdown';

import { outputOptions, stripDanglingDeclarationMapComments } from '../../tsdown.shared.config.ts';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'dom-utils': 'src/dom-utils/index.ts',
    facade: 'src/facade.ts',
  },
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // No declaration maps: they point at `src`, which is not published. The JS source maps embed
  // their sources (`sourcesContent`), so they work from the tarball alone. The hook removes the
  // `sourceMappingURL` comment that `sourcemap: true` still leaves in the declarations.
  dts: true,
  hooks: { 'build:done': stripDanglingDeclarationMapComments },
  sourcemap: true,
  outputOptions,
  clean: true,
  // The stylesheet and its declarations (`styles.css.d.ts`, the `types` condition of the subpath:
  // TypeScript 6 rejects a side-effect import it finds no declarations for, TS2882).
  copy: [
    { from: 'src/styles.css', to: 'dist' },
    { from: 'src/styles.css.d.ts', to: 'dist' },
  ],
  publint: true,
  // Any warning (bundler, dts, publint) fails the build.
  failOnWarn: true,
});

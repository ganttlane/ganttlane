import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import manifest from '../package.json';

describe('the manifest of @ganttlane/react', () => {
  it('NFR-COMPAT-1: the peer range is what the test matrix covers, React 18.3 and 19', () => {
    // The `react` project of `vitest.config.ts` runs React 19, `react-18` runs 18.3.
    const range = '^18.3.0 || ^19.0.0';
    expect(manifest.peerDependencies).toEqual({ react: range, 'react-dom': range });
  });

  it('NFR-SIZE-1: React is a peer and a dev dependency only; the runtime dependencies are ours', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@ganttlane/core',
      '@ganttlane/dom',
    ]);
    expect(Object.keys(manifest.devDependencies)).toEqual(
      expect.arrayContaining(['react', 'react-dom']),
    );
  });

  it('FR-REACT-1: the stylesheet is exported, so an app that installed only this package can import it', () => {
    // `dist/styles.css` is a copy of `@ganttlane/dom/styles.css` made by the build (`copy` in
    // `tsdown.config.ts`); strict pnpm hides `@ganttlane/dom` from such an app.
    expect(manifest.exports['./styles.css']).toMatchObject({ default: './dist/styles.css' });
    // What is published is `exports` without the `@ganttlane/source` condition
    // (`scripts/pack-hooks.mjs` checks all of it before every pack).
    expect(manifest.publishConfig.exports['./styles.css']).toMatchObject({
      default: './dist/styles.css',
    });
    expect(manifest.files).toContain('dist');
  });

  it('FR-REACT-1: the stylesheet has declarations, so `import "@ganttlane/react/styles.css"` type-checks under TypeScript 6', () => {
    // TypeScript 6 checks side-effect imports (`noUncheckedSideEffectImports` is on by default) and
    // reports TS2882 for a file it has no declarations for. The `types` condition points at an empty
    // declaration file that the build copies next to the stylesheet (`copy` in `tsdown.config.ts`).
    const entry = { types: './dist/styles.css.d.ts', default: './dist/styles.css' };
    expect(manifest.publishConfig.exports['./styles.css']).toEqual(entry);
    expect(manifest.exports['./styles.css']).toEqual(entry);
    const stub = readFileSync(`${import.meta.dirname}/styles.css.d.ts`, 'utf8');
    // Nothing is declared: a stylesheet import has no binding.
    expect(stub.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('export {};');
  });

  it('FR-REACT-1: patchTasks is also at @ganttlane/react/core, an entry without the client directive', () => {
    // The main entry starts with `'use client'` (`banner` in `tsdown.config.ts`), so a server
    // component that imports `patchTasks` from it gets a reference to the client module, not a function.
    const published = { types: './dist/core.d.ts', default: './dist/core.js' };
    expect(manifest.exports['./core']).toEqual({
      '@ganttlane/source': './src/core.ts',
      ...published,
    });
    expect(manifest.publishConfig.exports['./core']).toEqual(published);
  });

  it('FR-REACT-1: a bundler keeps the stylesheet import, however it treats the rest', () => {
    // `"sideEffects": false` tells a bundler that an import of this package nothing is used from may
    // be dropped, which a stylesheet import is (webpack does that to CSS). The CSS files are the
    // exception, as in `@ganttlane/dom` (Vite keeps CSS either way).
    expect(manifest.sideEffects).toEqual(['**/*.css']);
  });
});

describe('the scripts of the playground', () => {
  const scripts = (
    JSON.parse(
      readFileSync(`${import.meta.dirname}/../../../apps/playground/package.json`, 'utf8'),
    ) as { scripts: Record<string, string> }
  ).scripts;

  it('NFR-COMPAT-2: no script sets an environment variable with a POSIX prefix, which cmd.exe does not read', () => {
    // `NODE_ENV=development vite build` needs a shell of the POSIX kind; the builds that need a
    // variable go through `scripts/build.mjs`, which sets it for the process it starts.
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/(^|&&|;|\|)\s*[A-Z][A-Z0-9_]*=/);
    }
  });
});

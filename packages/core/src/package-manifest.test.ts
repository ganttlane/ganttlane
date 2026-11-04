import { describe, expect, it } from 'vitest';

import manifest from '../package.json';

describe('the manifest of @ganttlane/core', () => {
  it('FR-DATA-13: @ganttlane/core/schema is an entry point, with types, in the sources and in the package', () => {
    const entry = { types: './dist/schema.d.ts', default: './dist/schema.js' };

    expect(manifest.exports['./schema']).toEqual({
      '@ganttlane/source': './src/schema.ts',
      ...entry,
    });
    expect(manifest.publishConfig.exports['./schema']).toEqual(entry);
  });

  it('FR-DATA-10: @ganttlane/core/migrate is an entry point, with types, in the sources and in the package', () => {
    const entry = { types: './dist/migrate.d.ts', default: './dist/migrate.js' };

    expect(manifest.exports['./migrate']).toEqual({
      '@ganttlane/source': './src/migrate.ts',
      ...entry,
    });
    expect(manifest.publishConfig.exports['./migrate']).toEqual(entry);
  });

  it('FR-DATA-12: only the main entry has a development build; the subpaths are the same in both', () => {
    expect(manifest.exports['.']).toHaveProperty('development', './dist/index.development.js');
    expect(manifest.exports['./schema']).not.toHaveProperty('development');
    expect(manifest.exports['./migrate']).not.toHaveProperty('development');
  });
});

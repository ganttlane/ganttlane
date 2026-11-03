import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as dom from './index';
import { LAYER_ORDER, VERSION } from './index';

describe('@ganttlane/dom', () => {
  it('re-exports the core version, which is the version of its manifest too', () => {
    const manifest = readFileSync(`${import.meta.dirname}/../package.json`, 'utf8');
    expect(VERSION).toBe((JSON.parse(manifest) as { version: string }).version);
  });

  it('FR-API-1: exports the facade, the renderer and the layer order (the types are not values)', () => {
    expect(Object.keys(dom).sort()).toEqual([
      'DEFAULT_STRINGS',
      'DISPLAY_DEFAULTS',
      'LAYER_ORDER',
      'VERSION',
      'createGantt',
      'mountRenderer',
      'resolveDisplay',
      'resolveStrings',
    ]);
    expect(LAYER_ORDER).toEqual(['header', 'grid', 'links', 'bars', 'overlay', 'popover']);
  });
});

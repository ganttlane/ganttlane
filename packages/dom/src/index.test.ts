import { describe, expect, it } from 'vitest';

import * as dom from './index';
import { LAYER_ORDER, VERSION } from './index';

describe('@ganttlane/dom', () => {
  it('re-exports the core version', () => {
    expect(VERSION).toBe('0.0.0');
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

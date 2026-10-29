import { createBarsLayer } from './bars';
import { createGridLayer } from './grid';
import { createHeaderLayer } from './header';
import { createLinksLayer } from './links';
import { createOverlayLayer } from './overlay';
import { createPopoverLayer } from './popover';
import type { LayerFactories, LayerFactory, LayerName } from './types';

/**
 * The built-in layers, one per slot of the skeleton (`LAYER_ORDER`), each in its own folder
 * `layers/<name>/`. A new layer is one more entry here and in `LayerSlots`; callers replace one
 * by name through the `layers` option (`resolveLayerFactories`).
 */
export const BUILT_IN_LAYERS: { readonly [N in LayerName]: LayerFactory<N> } = {
  header: createHeaderLayer,
  grid: createGridLayer,
  links: createLinksLayer,
  bars: createBarsLayer,
  overlay: createOverlayLayer,
  popover: createPopoverLayer,
};

/**
 * The layer factories of an instance: the built-in ones with `overrides` swapped in by name.
 *
 * @param overrides - Replacement factories, usually none.
 * @returns A factory per layer name.
 */
export function resolveLayerFactories(overrides: LayerFactories | undefined): {
  readonly [N in LayerName]: LayerFactory<N>;
} {
  return { ...BUILT_IN_LAYERS, ...overrides };
}

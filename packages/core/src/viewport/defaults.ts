/**
 * Defaults of the viewport module (`docs/api.md` §3 `timeline`, `scroll`).
 */

import type { ScrollAlign } from './align';

/**
 * Default values of the viewport math and of the `timeline` / `scroll` options:
 * - `maxWidth` 4 000 000: the infinite timeline trims its content down to this width (like
 *   `maxSpan`, in pixels), never extends past twice it, and one `extendBy` reaches a quarter of
 *   it at most. Browsers cap the size of an element (about 17.9 million px in Firefox, 33.5
 *   million in Chromium and WebKit); 8 million stays well below. At the hour preset (960 px per
 *   day) 4 million px are about 11 years;
 * - `autoScrollEdge` 40 and `autoScrollMaxSpeed` 20: the drag autoscroll zone at each viewport
 *   edge, in px, and the speed at its outer side, in px per frame (FR-EDIT-6);
 * - `initialScroll` `'today'`, `align` `'start'` and `behavior` `'smooth'`: the fork's
 *   `scroll_to`, `scroll_to_viewport_position` (0) and `scroll_to_behavior`.
 */
export const VIEWPORT_DEFAULTS: {
  readonly maxWidth: number;
  readonly autoScrollEdge: number;
  readonly autoScrollMaxSpeed: number;
  readonly initialScroll: 'today';
  readonly align: ScrollAlign;
  readonly behavior: 'smooth';
} = /* @__PURE__ */ Object.freeze({
  maxWidth: 4_000_000,
  autoScrollEdge: 40,
  autoScrollMaxSpeed: 20,
  initialScroll: 'today',
  align: 'start',
  behavior: 'smooth',
});

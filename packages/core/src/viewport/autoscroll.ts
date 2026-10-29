/**
 * Autoscroll while dragging near a viewport edge (`scroll.autoScroll`). Combined with
 * `planExtension` on every frame, it carries a dragged bar past the range.
 */

import { VIEWPORT_DEFAULTS } from './defaults';
import { checkFinite } from './state';

/** The `scroll.autoScroll` option (when not `false`). */
export interface AutoScrollOptions {
  /** Width of the zone at each viewport edge, px, `0` or more. Default 40. */
  readonly edge?: number | undefined;
  /** Speed at the outer side of the zone and beyond, px per frame, `0` or more. Default 20. */
  readonly maxSpeed?: number | undefined;
}

/**
 * The horizontal autoscroll speed for a dragging pointer, in px per frame: negative
 * towards the start, positive towards the end, `0` outside the edge zones.
 *
 * Inside a zone the speed is proportional to how deep the pointer is in it: `0` at its inner
 * side, `maxSpeed` at the viewport edge, and `maxSpeed` beyond the edge (the pointer left the
 * viewport). It is continuous and never decreases as the pointer moves right. On a viewport
 * narrower than two zones, each zone is half the viewport. With `edge: 0` it scrolls only while
 * the pointer is outside the viewport, at `maxSpeed`.
 *
 * The result is fractional: accumulate it (`scrollLeft += velocity` on a float, written to the
 * scroller each frame), since browsers may drop sub-pixel steps on a scroll offset.
 *
 * @param pointerX - Pointer x relative to the viewport's left edge (may be outside it).
 * @param viewportWidth - Client width of the scroller, `0` or more.
 * @param options - Zone width and maximum speed; defaults 40 px and 20 px per frame.
 * @returns The signed speed in px per frame.
 * @throws RangeError for non-finite values or negative sizes.
 *
 * @example
 * ```ts
 * const velocity = autoScrollVelocity(event.clientX - rect.left, rect.width);
 * ```
 */
export function autoScrollVelocity(
  pointerX: number,
  viewportWidth: number,
  options: AutoScrollOptions = {},
): number {
  checkFinite(pointerX, 'pointerX');
  const edge = options.edge ?? VIEWPORT_DEFAULTS.autoScrollEdge;
  const maxSpeed = options.maxSpeed ?? VIEWPORT_DEFAULTS.autoScrollMaxSpeed;
  for (const [value, what] of [
    [viewportWidth, 'viewportWidth'],
    [edge, 'edge'],
    [maxSpeed, 'maxSpeed'],
  ] as const) {
    if (!(Number.isFinite(value) && value >= 0)) {
      throw new RangeError(`${what} must be a finite number, 0 or more, got ${value}.`);
    }
  }
  const zone = Math.min(edge, viewportWidth / 2);
  let depth = 0;
  if (pointerX < zone) depth = zone > 0 ? -Math.min((zone - pointerX) / zone, 1) : -1;
  else if (pointerX > viewportWidth - zone) {
    depth = zone > 0 ? Math.min((pointerX - (viewportWidth - zone)) / zone, 1) : 1;
  }
  return depth * maxSpeed + 0;
}

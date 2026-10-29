/** A rectangle in CSS pixels; a `DOMRect` is one. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A size in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The side of the anchor a popover sits on. */
export type Side = 'top' | 'bottom';

/** What {@link placePopover} needs. All rectangles share one coordinate space (the viewport). */
export interface PlacementInput {
  /** What the popover is attached to: a bar, or {@link pointRect} for the cursor. */
  readonly anchor: Rect;
  /** The popover's measured size. */
  readonly size: Size;
  /** Where the popover must stay: the chart's box clipped to the viewport. */
  readonly bounds: Rect;
  /** The preferred side; default `'top'` (above). */
  readonly side?: Side | undefined;
  /** Gap between the anchor and the popover, px; default `8`. */
  readonly offset?: number | undefined;
  /** Least distance to the edges of `bounds`, px; default `4`. */
  readonly padding?: number | undefined;
}

/** Where {@link placePopover} puts a popover. */
export interface Placement {
  /** Left edge, whole px, in the coordinate space of the input. */
  readonly x: number;
  /** Top edge, whole px. */
  readonly y: number;
  /** The side it ended up on: the preferred one, or the opposite one after a flip. */
  readonly side: Side;
}

/** Height of the mouse cursor image below its hot spot, px: what a popover below a point clears. */
export const CURSOR_SIZE = 16;

/**
 * The anchor of "above the cursor": a point whose box reaches down over the cursor image, so a
 * popover that flips below it does not sit on the cursor.
 *
 * @param x - Pointer x (`clientX`).
 * @param y - Pointer y (`clientY`).
 * @returns A zero-width rectangle.
 */
export function pointRect(x: number, y: number): Rect {
  return { x, y, width: 0, height: CURSOR_SIZE };
}

/**
 * The overlap of two rectangles.
 *
 * @param a - A rectangle.
 * @param b - Another one.
 * @returns The overlap; `undefined` when they are apart or only touch.
 */
export function intersectRects(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/**
 * The visible area of the page: the document element's client box, which leaves the scrollbars
 * out. Reads layout.
 *
 * @param document - The chart's document.
 * @returns The rectangle at the origin.
 */
export function viewportRect(document: Document): Rect {
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  return { x: 0, y: 0, width, height };
}

/** `min` wins when the popover is larger than the room: its start edge stays visible. */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/**
 * Places a popover above or below an anchor, inside the bounds (FR-TIP-2). Pure: it reads no
 * layout, so the caller measures once (when the popover opens or its content or anchor changes)
 * and calls it again for every move of the cursor or the scroll position.
 *
 * - The anchor is first clipped to `bounds`, so a bar that is partly scrolled out is centred on
 *   what is visible. An anchor wholly outside is used as it is.
 * - **Flip:** the preferred side is used unless it lacks room for the popover plus `offset` and
 *   the opposite side has more.
 * - **Shift:** the popover is centred on the anchor and moved inside `bounds` (less `padding`)
 *   across the side and along it, so along it the result may overlap the anchor when neither
 *   side fits.
 * - "Above the cursor" is `anchor: pointRect(clientX, clientY)` with the default side.
 *
 * @param input - See {@link PlacementInput}.
 * @returns Whole-pixel position and the side used.
 */
export function placePopover(input: PlacementInput): Placement {
  const { size, bounds, side = 'top', offset = 8, padding = 4 } = input;
  const a = intersectRects(input.anchor, bounds) ?? input.anchor;
  const above = a.y - bounds.y - padding;
  const below = bounds.y + bounds.height - padding - (a.y + a.height);
  const room = side === 'top' ? above : below;
  const top =
    (side === 'top') !== (room < size.height + offset && (side === 'top' ? below : above) > room);
  return {
    x: Math.round(
      clamp(
        a.x + (a.width - size.width) / 2,
        bounds.x + padding,
        bounds.x + bounds.width - padding - size.width,
      ),
    ),
    y: Math.round(
      clamp(
        top ? a.y - offset - size.height : a.y + a.height + offset,
        bounds.y + padding,
        bounds.y + bounds.height - padding - size.height,
      ),
    ),
    side: top ? 'top' : 'bottom',
  };
}

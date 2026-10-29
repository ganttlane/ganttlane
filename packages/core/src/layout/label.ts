/**
 * Bar label placement (FR-BAR-1, `display.barLabel`): inside the bar when it fits, else to its
 * right. Measuring the text is the renderer's job; this decides where a label of a given width
 * goes.
 */

import { LAYOUT_DEFAULTS } from './dimensions';

/**
 * Where bar labels go (`display.barLabel`):
 * - `'auto'` (default): inside, centred, when the label fits; otherwise to the right of the bar;
 * - `'inside'`: always centred in the bar, even when it overflows (the renderer may clip it);
 * - `'outside'`: always to the right of the bar;
 * - `'none'`: no label.
 */
export type BarLabelMode = 'auto' | 'inside' | 'outside' | 'none';

/** Options of {@link placeLabel}. */
export interface LabelOptions {
  /**
   * The margin a label inside needs on each side to count as fitting, and the room an outside
   * label keeps beyond the link handle, in pixels. Default 5.
   */
  readonly padding?: number | undefined;
  /**
   * How far the link handle reaches beyond the bar's end, in pixels: an outside label starts
   * `handleReach + padding` after the bar, so it never overlaps the handle. Default 16, the
   * default handle (`INTERACTION_DEFAULTS.handles`: centre 10 px out, radius 6).
   *
   * A renderer passes `linkOffset + link` of the sizes it draws, for every bar: the gap is a
   * property of the chart, not of a bar. It stays the same for a read-only chart and for a task
   * that may not be linked (which have no handle), so that labels keep one line and do not jump
   * when `editing` is switched. Pass `0` only to close the gap on purpose (a renderer without
   * link handles at all).
   */
  readonly handleReach?: number | undefined;
}

/** Where a label goes, in the bar's coordinates (body pixels). Frozen. */
export interface LabelPlacement {
  /** Horizontal position of the text anchor. */
  readonly x: number;
  /** Vertical centre of the bar: the label's middle line. */
  readonly y: number;
  /** Text anchor (SVG `text-anchor`): `'middle'` inside, `'start'` outside. */
  readonly anchor: 'start' | 'middle';
  /** Whether the label is on the bar (a contrasting colour) or next to it. */
  readonly inside: boolean;
}

/** The part of a bar's geometry a label is placed against. */
export interface LabelBox {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, `0` or more. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/**
 * Places a bar's label (FR-BAR-1). Pure; the result is frozen.
 *
 * Inside, the label is centred on the bar (`anchor: 'middle'`); outside, it starts
 * `handleReach + padding` pixels after the bar's end (`anchor: 'start'`), clear of the link
 * handle (21 px by default). In `'auto'` mode a label fits inside when
 * `labelWidth + 2 * padding <= bar.width`, so a zero-width bar or a milestone with a long name
 * gets its label outside.
 *
 * @param bar - The bar's box (`BarGeometry`).
 * @param labelWidth - The measured width of the label text, in pixels.
 * @param mode - `display.barLabel`.
 * @param options - The padding (default 5) and the handle reach (default 16).
 * @returns The frozen placement, or `undefined` for `'none'`.
 *
 * @example
 * ```ts
 * const label = placeLabel(bar, measureText(name), 'auto');
 * if (label) text.setAttribute('x', String(label.x));
 * ```
 */
export function placeLabel(
  bar: LabelBox,
  labelWidth: number,
  mode: BarLabelMode,
  options: LabelOptions = {},
): LabelPlacement | undefined {
  if (mode === 'none') return undefined;
  const padding = options.padding ?? LAYOUT_DEFAULTS.labelPadding;
  const reach = options.handleReach ?? LAYOUT_DEFAULTS.labelHandleReach;
  const inside = mode === 'inside' || (mode === 'auto' && labelWidth + 2 * padding <= bar.width);
  return Object.freeze({
    x: inside ? bar.x + bar.width / 2 : bar.x + bar.width + reach + padding,
    y: bar.y + bar.height / 2,
    anchor: inside ? 'middle' : 'start',
    inside,
  });
}

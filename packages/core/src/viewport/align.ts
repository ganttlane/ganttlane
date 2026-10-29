/**
 * Where a scroll target lands in the viewport (the `scroll.align` option).
 */

/**
 * Where a scroll target lands in the viewport, along the scrolled axis: a fraction from `0`
 * (the target at the start edge) to `1` (at the end edge), or a keyword for `0`, `0.5` and `1`.
 * For a target with a length (a bar, a row) the same fraction of the target meets that
 * fraction of the viewport: `'start'` shows its start at
 * the start edge, `'end'` its end at the end edge, `'center'` centres it.
 */
export type ScrollAlign = number | 'start' | 'center' | 'end';

/**
 * The fraction of a {@link ScrollAlign}; numbers are clamped to `[0, 1]`.
 *
 * @throws RangeError for a number that is not finite.
 * @internal
 */
export function alignFraction(align: ScrollAlign): number {
  switch (align) {
    case 'start':
      return 0;
    case 'center':
      return 0.5;
    case 'end':
      return 1;
    default:
      if (!Number.isFinite(align)) throw new RangeError(`align must be finite, got ${align}.`);
      return Math.min(Math.max(align, 0), 1);
  }
}

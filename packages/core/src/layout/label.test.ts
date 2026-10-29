import { describe, expect, it } from 'vitest';

import { type BarLabelMode, type LabelBox, placeLabel } from './label';

/** A 100 px bar at x = 40 in a row starting at y = 48 (bar 30 px tall, centred). */
const bar: LabelBox = { x: 40, y: 57, width: 100, height: 30 };
const MIDDLE = 57 + 15;

describe('layout/label', () => {
  it('FR-BAR-1: auto puts a label that fits inside, centred on the bar', () => {
    expect(placeLabel(bar, 60, 'auto')).toEqual({
      x: 90,
      y: MIDDLE,
      anchor: 'middle',
      inside: true,
    });
    // Exactly fits with 5 px on each side.
    expect(placeLabel(bar, 90, 'auto')?.inside).toBe(true);
    expect(Object.isFrozen(placeLabel(bar, 60, 'auto'))).toBe(true);
  });

  it('FR-BAR-1: auto puts a label that does not fit to the right of the bar', () => {
    // The bar ends at 140; the link handle reaches 16 px past it, the padding adds 5 more.
    expect(placeLabel(bar, 91, 'auto')).toEqual({
      x: 161,
      y: MIDDLE,
      anchor: 'start',
      inside: false,
    });
    const point: LabelBox = { x: 200, y: 57, width: 0, height: 30 };
    expect(placeLabel(point, 0, 'auto')).toEqual({
      x: 221,
      y: MIDDLE,
      anchor: 'start',
      inside: false,
    });
    // A milestone diamond (30 × 30) only holds a tiny label.
    const diamond: LabelBox = { x: 105, y: 57, width: 30, height: 30 };
    expect(placeLabel(diamond, 40, 'auto')).toMatchObject({ x: 156, inside: false });
  });

  it('FR-BAR-1: inside keeps the label centred even on a too-narrow bar', () => {
    const narrow: LabelBox = { x: 40, y: 57, width: 12, height: 30 };
    expect(placeLabel(narrow, 80, 'inside')).toEqual({
      x: 46,
      y: MIDDLE,
      anchor: 'middle',
      inside: true,
    });
  });

  it('FR-BAR-1: outside always places the label after the bar', () => {
    expect(placeLabel(bar, 10, 'outside')).toEqual({
      x: 161,
      y: MIDDLE,
      anchor: 'start',
      inside: false,
    });
  });

  it('FR-BAR-1: none places no label', () => {
    expect(placeLabel(bar, 10, 'none')).toBeUndefined();
  });

  it('FR-BAR-1: the padding is configurable', () => {
    expect(placeLabel(bar, 80, 'auto', { padding: 10 })?.inside).toBe(true);
    expect(placeLabel(bar, 81, 'auto', { padding: 10 })).toMatchObject({ x: 166, inside: false });
    expect(placeLabel(bar, 100, 'auto', { padding: 0 })?.inside).toBe(true);
  });

  it('FR-BAR-1, FR-LINK-4: an outside label clears the link handle, whose reach is configurable', () => {
    // 16 px: the default handle (centre 10 px out, radius 6) plus the 5 px padding is 21 px.
    expect(placeLabel(bar, 200, 'auto')?.x).toBe(bar.x + bar.width + 16 + 5);
    // Bigger handles push the label out, no handles bring it back to the padding.
    expect(placeLabel(bar, 200, 'auto', { handleReach: 30 })?.x).toBe(bar.x + bar.width + 35);
    expect(placeLabel(bar, 200, 'auto', { handleReach: 0 })?.x).toBe(bar.x + bar.width + 5);
    // The reach does not change what fits inside.
    expect(placeLabel(bar, 90, 'auto', { handleReach: 30 })?.inside).toBe(true);
  });

  it('every mode puts the label on the bar centre line', () => {
    const modes: BarLabelMode[] = ['auto', 'inside', 'outside'];
    for (const mode of modes) expect(placeLabel(bar, 500, mode)?.y).toBe(MIDDLE);
  });
});

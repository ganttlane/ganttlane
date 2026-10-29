import { describe, expect, it } from 'vitest';

import {
  CURSOR_SIZE,
  intersectRects,
  type PlacementInput,
  placePopover,
  pointRect,
  type Rect,
  type Side,
  viewportRect,
} from './position';

const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
const size = { width: 100, height: 40 };
const base: PlacementInput = { anchor: { x: 150, y: 150, width: 100, height: 20 }, size, bounds };

describe('placePopover', () => {
  // [name, input, expected x, expected y, expected side]
  const cases: readonly (readonly [string, PlacementInput, number, number, Side])[] = [
    ['FR-TIP-2: above the anchor, centred on it', base, 150, 102, 'top'],
    [
      'FR-TIP-2: flips below when there is no room above',
      { ...base, anchor: { x: 150, y: 10, width: 100, height: 20 } },
      150,
      38,
      'bottom',
    ],
    [
      'FR-TIP-2: a preferred side below is honoured',
      { ...base, side: 'bottom' },
      150,
      178,
      'bottom',
    ],
    [
      'FR-TIP-2: flips above when there is no room below',
      { ...base, side: 'bottom', anchor: { x: 150, y: 270, width: 100, height: 20 } },
      150,
      222,
      'top',
    ],
    [
      'FR-TIP-2: shifts left at the right edge',
      { ...base, anchor: { x: 380, y: 150, width: 10, height: 20 } },
      296,
      102,
      'top',
    ],
    [
      'FR-TIP-2: shifts right at the left edge',
      { ...base, anchor: { x: 0, y: 150, width: 10, height: 20 } },
      4,
      102,
      'top',
    ],
    ['FR-TIP-2: the offset is the gap to the anchor', { ...base, offset: 20 }, 150, 90, 'top'],
    [
      'FR-TIP-2: the padding is the least distance to the bounds',
      { ...base, padding: 10, anchor: { x: 0, y: 150, width: 10, height: 20 } },
      10,
      102,
      'top',
    ],
    [
      'FR-TIP-2: both sides short: takes the roomier one and stays inside the bounds',
      {
        ...base,
        bounds: { x: 0, y: 0, width: 400, height: 60 },
        anchor: { x: 150, y: 35, width: 100, height: 20 },
      },
      150,
      4,
      'top',
    ],
    [
      'FR-TIP-2: a popover wider than the bounds sits at the near edge',
      { ...base, size: { width: 500, height: 40 } },
      4,
      102,
      'top',
    ],
    [
      'FR-TIP-2: an anchor partly outside the bounds is centred on its visible part',
      { ...base, anchor: { x: -300, y: 150, width: 800, height: 20 } },
      150,
      102,
      'top',
    ],
    [
      'FR-TIP-2: an anchor wholly outside the bounds is used as it is, then shifted in',
      { ...base, anchor: { x: 900, y: 150, width: 100, height: 20 } },
      296,
      102,
      'top',
    ],
    [
      'FR-TIP-2: bounds that do not start at the origin',
      {
        ...base,
        bounds: { x: 100, y: 50, width: 300, height: 200 },
        anchor: { x: 110, y: 60, width: 20, height: 20 },
      },
      104,
      88,
      'bottom',
    ],
    [
      'FR-TIP-2: results are whole pixels',
      { ...base, anchor: { x: 150.4, y: 150.4, width: 101, height: 20 } },
      151,
      102,
      'top',
    ],
  ];

  it.each(cases)('%s', (_name, input, x, y, side) => {
    expect(placePopover(input)).toEqual({ x, y, side });
  });

  it('FR-TIP-2: above the cursor, and below it with the cursor clear of the popover', () => {
    const above = placePopover({ ...base, anchor: pointRect(200, 150) });
    expect(above).toEqual({ x: 150, y: 102, side: 'top' });

    const below = placePopover({ ...base, anchor: pointRect(200, 10) });
    expect(below).toEqual({ x: 150, y: 10 + CURSOR_SIZE + 8, side: 'bottom' });
  });

  it('is pure: the input is not changed', () => {
    const input: PlacementInput = {
      ...base,
      anchor: Object.freeze({ x: 380, y: 10, width: 10, height: 20 }),
      size: Object.freeze(size),
      bounds: Object.freeze(bounds),
    };
    expect(() => placePopover(input)).not.toThrow();
    expect(placePopover(input)).toEqual(placePopover(input));
  });
});

describe('pointRect', () => {
  it('FR-TIP-2: the cursor is a point with the height of the cursor image below it', () => {
    expect(pointRect(12, 34)).toEqual({ x: 12, y: 34, width: 0, height: CURSOR_SIZE });
  });
});

describe('intersectRects', () => {
  it('returns the overlap, or undefined when the rects are apart or only touch', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(intersectRects(a, { x: 50, y: 60, width: 100, height: 100 })).toEqual({
      x: 50,
      y: 60,
      width: 50,
      height: 40,
    });
    expect(intersectRects(a, { x: 100, y: 0, width: 10, height: 10 })).toBeUndefined();
    expect(intersectRects(a, { x: 200, y: 200, width: 10, height: 10 })).toBeUndefined();
  });
});

describe('viewportRect', () => {
  it('is the client box of the document element, without scrollbars', () => {
    const fake = {
      documentElement: { clientWidth: 800, clientHeight: 600 },
    } as unknown as Document;
    expect(viewportRect(fake)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

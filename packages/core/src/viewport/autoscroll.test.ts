import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { autoScrollVelocity } from './autoscroll';

describe('viewport/autoScrollVelocity', () => {
  it('FR-EDIT-6: 0 outside the edge zones, proportional inside, capped beyond', () => {
    const v = (x: number): number => autoScrollVelocity(x, 1000);
    expect(v(500)).toBe(0);
    expect(v(40)).toBe(0);
    expect(v(960)).toBe(0);
    expect(v(20)).toBe(-10);
    expect(v(0)).toBe(-20);
    expect(v(-50)).toBe(-20);
    expect(v(980)).toBe(10);
    expect(v(1000)).toBe(20);
    expect(v(1500)).toBe(20);
    expect(autoScrollVelocity(50, 1000, { edge: 100, maxSpeed: 10 })).toBe(-5);
  });

  it('FR-EDIT-6: on a narrow viewport each zone is half of it', () => {
    expect(autoScrollVelocity(30, 60)).toBe(0);
    expect(autoScrollVelocity(15, 60)).toBe(-10);
    expect(autoScrollVelocity(45, 60)).toBe(10);
  });

  it('FR-EDIT-6: edge 0 scrolls only outside the viewport; maxSpeed 0 never', () => {
    expect(autoScrollVelocity(-1, 1000, { edge: 0 })).toBe(-20);
    expect(autoScrollVelocity(0, 1000, { edge: 0 })).toBe(0);
    expect(autoScrollVelocity(1000, 1000, { edge: 0 })).toBe(0);
    expect(autoScrollVelocity(1001, 1000, { edge: 0 })).toBe(20);
    expect(Object.is(autoScrollVelocity(-5, 1000, { maxSpeed: 0 }), 0)).toBe(true);
  });

  it('FR-EDIT-6: monotonic in the pointer position and bounded by maxSpeed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 3500, noNaN: true }),
        fc.double({ min: -500, max: 3500, noNaN: true }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 50 }),
        (a, b, width, edge, maxSpeed) => {
          const [left, right] = a <= b ? [a, b] : [b, a];
          const options = { edge, maxSpeed };
          const slow = autoScrollVelocity(left, width, options);
          const fast = autoScrollVelocity(right, width, options);
          expect(slow).toBeLessThanOrEqual(fast);
          expect(Math.abs(slow)).toBeLessThanOrEqual(maxSpeed);
          // Never scrolls away from the side the pointer is on.
          if (left > width / 2) expect(slow).toBeGreaterThanOrEqual(0);
          if (left < width / 2) expect(slow).toBeLessThanOrEqual(0);
        },
      ),
    );
  });

  it('throws for non-finite values or negative sizes', () => {
    expect(() => autoScrollVelocity(NaN, 1000)).toThrow(/pointerX/);
    expect(() => autoScrollVelocity(0, -1)).toThrow(/viewportWidth/);
    expect(() => autoScrollVelocity(0, 1000, { edge: -1 })).toThrow(/edge/);
    expect(() => autoScrollVelocity(0, 1000, { maxSpeed: Infinity })).toThrow(/maxSpeed/);
  });
});

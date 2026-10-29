import { describe, expect, it } from 'vitest';

import type { LinkType } from '../model';
import { linkBBox, type LinkRect, type LinkRouteInput, routeLink } from './index';

/** Rows are 40 px tall with 20 px bars: the bar of row `n` spans `y = 40n + 10 … 40n + 30`. */
const bar = (row: number, x: number, width = 100): LinkRect => ({
  x,
  y: row * 40 + 10,
  width,
  height: 20,
});
/** Row height minus bar height. */
const ROW_GAP = 20;
/** The source bar: row 1, `x = 100 … 200`, anchors at `y = 60`. */
const SOURCE = bar(1, 100);
const TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];
/** Row of the target bar. */
const ROWS = { below: 2, above: 0, 'same row': 1 } as const;
/** Left edge of the 100 px target bar, relative to the source bar (`100 … 200`). */
const PLACES = {
  'forward with gap': 240,
  touching: 200,
  overlapping: 150,
  backward: -40,
} as const;

function matrix(): [name: string, input: LinkRouteInput][] {
  const cases: [string, LinkRouteInput][] = [];
  for (const type of TYPES) {
    for (const [rowName, row] of Object.entries(ROWS)) {
      for (const [placeName, x] of Object.entries(PLACES)) {
        cases.push([
          `${type} ${rowName}, ${placeName}`,
          { type, source: SOURCE, target: bar(row, x), options: { rowGap: ROW_GAP } },
        ]);
      }
    }
  }
  return cases;
}

describe('routeLink', () => {
  it('FR-LINK-3: FS leaves the source end and enters the target start through a rounded step', () => {
    const route = routeLink({ type: 'FS', source: SOURCE, target: bar(2, 240) });
    expect(route).toEqual({
      d: 'M200 60H207a5 5 0 0 1 5 5V95a5 5 0 0 0 5 5H240',
      arrow: 'M240 100l-5 -5v10z',
      points: [
        { x: 200, y: 60 },
        { x: 212, y: 60 },
        { x: 212, y: 100 },
        { x: 240, y: 100 },
      ],
      bbox: { x: 200, y: 60, width: 40, height: 45 },
    });
  });

  it('FR-LINK-1, FR-LINK-3: every type attaches to its own edges (the fork drew all as FS, I3)', () => {
    const target = bar(2, 240);
    const ends = TYPES.map((type) => {
      const { points, arrow } = routeLink({ type, source: SOURCE, target });
      return [type, points[0], points.at(-1), arrow];
    });
    expect(ends).toEqual([
      // Source end → target start: the arrow points right, into the start.
      ['FS', { x: 200, y: 60 }, { x: 240, y: 100 }, 'M240 100l-5 -5v10z'],
      ['SS', { x: 100, y: 60 }, { x: 240, y: 100 }, 'M240 100l-5 -5v10z'],
      // Into an end: the arrow points left.
      ['FF', { x: 200, y: 60 }, { x: 340, y: 100 }, 'M340 100l5 -5v10z'],
      ['SF', { x: 100, y: 60 }, { x: 340, y: 100 }, 'M340 100l5 -5v10z'],
    ]);
  });

  it('FR-LINK-3: links that go up turn the other way and mirror links that go down (upstream #624)', () => {
    const down = routeLink({ type: 'FS', source: SOURCE, target: bar(2, 240) });
    const up = routeLink({ type: 'FS', source: SOURCE, target: bar(0, 240) });
    expect(down.d).toBe('M200 60H207a5 5 0 0 1 5 5V95a5 5 0 0 0 5 5H240');
    expect(up.d).toBe('M200 60H207a5 5 0 0 0 5 -5V25a5 5 0 0 1 5 -5H240');
    expect(up.points.map(({ x, y }) => ({ x, y: 120 - y }))).toEqual(down.points);

    const backDown = routeLink({ type: 'FS', source: SOURCE, target: bar(2, -40) });
    const backUp = routeLink({ type: 'FS', source: SOURCE, target: bar(0, -40) });
    expect(backDown.d).toBe(
      'M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H-47a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H-40',
    );
    expect(backUp.d).toBe(
      'M200 60H207a5 5 0 0 0 5 -5V45a5 5 0 0 0 -5 -5H-47a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H-40',
    );
  });

  it('FR-LINK-3: routes the matrix of types × rows × positions (snapshot)', () => {
    const table = Object.fromEntries(matrix().map(([name, input]) => [name, routeLink(input).d]));
    expect(table).toMatchInlineSnapshot(`
      {
        "FF above, backward": "M200 60H207a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H60",
        "FF above, forward with gap": "M200 60H347a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H340",
        "FF above, overlapping": "M200 60H257a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H250",
        "FF above, touching": "M200 60H307a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H300",
        "FF below, backward": "M200 60H207a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H60",
        "FF below, forward with gap": "M200 60H347a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H340",
        "FF below, overlapping": "M200 60H257a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H250",
        "FF below, touching": "M200 60H307a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H300",
        "FF same row, backward": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H77a5 5 0 0 1 -5 -5V65a5 5 0 0 0 -5 -5H60",
        "FF same row, forward with gap": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 0 5 5H347a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H340",
        "FF same row, overlapping": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 0 5 5H257a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H250",
        "FF same row, touching": "M200 60V75a5 5 0 0 0 5 5H307a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H300",
        "FS above, backward": "M200 60H207a5 5 0 0 0 5 -5V45a5 5 0 0 0 -5 -5H-47a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H-40",
        "FS above, forward with gap": "M200 60H207a5 5 0 0 0 5 -5V25a5 5 0 0 1 5 -5H240",
        "FS above, overlapping": "M200 60H207a5 5 0 0 0 5 -5V45a5 5 0 0 0 -5 -5H143a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H150",
        "FS above, touching": "M200 60H207a5 5 0 0 0 5 -5V45a5 5 0 0 0 -5 -5H193a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H200",
        "FS below, backward": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H-47a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H-40",
        "FS below, forward with gap": "M200 60H207a5 5 0 0 1 5 5V95a5 5 0 0 0 5 5H240",
        "FS below, overlapping": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H143a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H150",
        "FS below, touching": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H193a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H200",
        "FS same row, backward": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H-47a5 5 0 0 1 -5 -5V65a5 5 0 0 1 5 -5H-40",
        "FS same row, forward with gap": "M200 60H240",
        "FS same row, overlapping": "M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H143a5 5 0 0 1 -5 -5V65a5 5 0 0 1 5 -5H150",
        "FS same row, touching": "M200 60",
        "SF above, backward": "M100 60H93a5 5 0 0 1 -5 -5V25a5 5 0 0 0 -5 -5H60",
        "SF above, forward with gap": "M100 60H93a5 5 0 0 1 -5 -5V45a5 5 0 0 1 5 -5H347a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H340",
        "SF above, overlapping": "M100 60H93a5 5 0 0 1 -5 -5V45a5 5 0 0 1 5 -5H257a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H250",
        "SF above, touching": "M100 60H93a5 5 0 0 1 -5 -5V45a5 5 0 0 1 5 -5H307a5 5 0 0 0 5 -5V25a5 5 0 0 0 -5 -5H300",
        "SF below, backward": "M100 60H93a5 5 0 0 0 -5 5V95a5 5 0 0 1 -5 5H60",
        "SF below, forward with gap": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H347a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H340",
        "SF below, overlapping": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H257a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H250",
        "SF below, touching": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H307a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H300",
        "SF same row, backward": "M100 60H60",
        "SF same row, forward with gap": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H347a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H340",
        "SF same row, overlapping": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H257a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H250",
        "SF same row, touching": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H307a5 5 0 0 0 5 -5V65a5 5 0 0 0 -5 -5H300",
        "SS above, backward": "M100 60H-47a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H-40",
        "SS above, forward with gap": "M100 60H93a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H240",
        "SS above, overlapping": "M100 60H93a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H150",
        "SS above, touching": "M100 60H93a5 5 0 0 1 -5 -5V25a5 5 0 0 1 5 -5H200",
        "SS below, backward": "M100 60H-47a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H-40",
        "SS below, forward with gap": "M100 60H93a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H240",
        "SS below, overlapping": "M100 60H93a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H150",
        "SS below, touching": "M100 60H93a5 5 0 0 0 -5 5V95a5 5 0 0 0 5 5H200",
        "SS same row, backward": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 1 -5 5H-47a5 5 0 0 1 -5 -5V65a5 5 0 0 1 5 -5H-40",
        "SS same row, forward with gap": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H223a5 5 0 0 0 5 -5V65a5 5 0 0 1 5 -5H240",
        "SS same row, overlapping": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H133a5 5 0 0 0 5 -5V65a5 5 0 0 1 5 -5H150",
        "SS same row, touching": "M100 60H93a5 5 0 0 0 -5 5V75a5 5 0 0 0 5 5H195a5 5 0 0 0 5 -5V60",
      }
    `);
  });

  it('FR-LINK-3: a step needs 2 × gap between the edges; anything closer takes a detour', () => {
    const shape = (x: number, gap?: number): number =>
      routeLink({ type: 'FS', source: SOURCE, target: bar(2, x), options: { gap } }).points.length;
    expect([shape(224), shape(223), shape(200), shape(150)]).toEqual([4, 6, 6, 6]);
    expect([shape(208, 4), shape(207, 4)]).toEqual([4, 6]);
    // SF steps leftwards: the target end must lie 2 × gap left of the source start.
    const sf = (right: number): number =>
      routeLink({ type: 'SF', source: SOURCE, target: bar(2, right - 100) }).points.length;
    expect([sf(76), sf(77)]).toEqual([4, 6]);
  });

  it('FR-LINK-3: SS and FF brackets sit gap outside the outermost edge, wherever the target is', () => {
    for (const x of Object.values(PLACES)) {
      const ss = routeLink({ type: 'SS', source: SOURCE, target: bar(2, x) });
      expect(ss.points).toEqual([
        { x: 100, y: 60 },
        { x: Math.min(100, x) - 12, y: 60 },
        { x: Math.min(100, x) - 12, y: 100 },
        { x, y: 100 },
      ]);
      const ff = routeLink({ type: 'FF', source: SOURCE, target: bar(0, x) });
      expect(ff.points).toEqual([
        { x: 200, y: 60 },
        { x: Math.max(200, x + 100) + 12, y: 60 },
        { x: Math.max(200, x + 100) + 12, y: 20 },
        { x: x + 100, y: 20 },
      ]);
    }
  });

  it('FR-LINK-3: detours run between the rows, next to the target row when rowGap is known', () => {
    const detourY = (row: number, rowGap?: number): number | undefined =>
      routeLink({ type: 'FS', source: SOURCE, target: bar(row, 150), options: { rowGap } })
        .points[2]?.y;
    // Adjacent rows: the boundary between them, either way.
    expect([detourY(2), detourY(2, ROW_GAP), detourY(0), detourY(0, ROW_GAP)]).toEqual([
      80, 80, 40, 40,
    ]);
    // Far rows: half-way between the bars without rowGap, else the boundary above / below the
    // target row, never past half-way.
    expect([detourY(5), detourY(5, ROW_GAP), detourY(5, 1000)]).toEqual([140, 200, 140]);
    const farAbove = bar(-4, 150);
    const above = (rowGap?: number): number | undefined =>
      routeLink({ type: 'FS', source: SOURCE, target: farAbove, options: { rowGap } }).points[2]?.y;
    expect([above(), above(ROW_GAP), above(1000)]).toEqual([-40, -120, -40]);
  });

  it('FR-LINK-3: in the same row, a link ahead is straight and any other goes under both bars', () => {
    const sameRow = (type: LinkType, x: number, rowGap?: number): string =>
      routeLink({ type, source: SOURCE, target: bar(1, x), options: { rowGap } }).d;
    expect(sameRow('FS', 240)).toBe('M200 60H240');
    expect(sameRow('SF', -40)).toBe('M100 60H60');
    // Touching bars leave no room: the path is a point under the arrowhead.
    expect(sameRow('FS', 200)).toBe('M200 60');
    // Under the bars: rowGap / 2, or gap / 2 by default.
    expect(sameRow('FS', -40, ROW_GAP)).toBe(
      'M200 60H207a5 5 0 0 1 5 5V75a5 5 0 0 1 -5 5H-47a5 5 0 0 1 -5 -5V65a5 5 0 0 1 5 -5H-40',
    );
    expect(sameRow('FS', -40)).toBe(
      'M200 60H207a5 5 0 0 1 5 5V71a5 5 0 0 1 -5 5H-47a5 5 0 0 1 -5 -5V65a5 5 0 0 1 5 -5H-40',
    );
    // Bars with different heights in one row: a step through the gap between them.
    const tall: LinkRect = { x: 230, y: 40, width: 50, height: 60 };
    expect(routeLink({ type: 'FS', source: SOURCE, target: tall }).d).toBe(
      'M200 60H207a5 5 0 0 1 5 5a5 5 0 0 0 5 5H230',
    );
  });

  it('FR-LINK-3: a same-row detour turns half-way to a closer bar instead of inside it', () => {
    // SS with the target 6 px after the source: the way back up lies between the bars.
    const ss = routeLink({ type: 'SS', source: SOURCE, target: bar(1, 206) });
    expect(ss.points).toEqual([
      { x: 100, y: 60 },
      { x: 88, y: 60 },
      { x: 88, y: 76 },
      { x: 203, y: 76 },
      { x: 203, y: 60 },
      { x: 206, y: 60 },
    ]);
    // FF with the target 6 px before the source.
    const ff = routeLink({ type: 'FF', source: SOURCE, target: bar(1, 0, 94) });
    expect(ff.points.slice(-3)).toEqual([
      { x: 97, y: 76 },
      { x: 97, y: 60 },
      { x: 94, y: 60 },
    ]);
  });

  it('FR-LINK-3: corner radii shrink to fit short segments and never overlap', () => {
    const target = bar(2, 240);
    const touching = bar(2, 200);
    const d = (input: Omit<LinkRouteInput, 'source'>): string =>
      routeLink({ source: SOURCE, ...input }).d;
    // A large radius: the first corner takes the whole first run, the second half the vertical.
    expect(d({ type: 'FS', target, options: { curveRadius: 20 } })).toBe(
      'M200 60a12 12 0 0 1 12 12V80a20 20 0 0 0 20 20H240',
    );
    // Floored to 0.5 px; 0 gives sharp corners.
    expect(d({ type: 'FS', target, options: { curveRadius: 3.7 } })).toBe(
      'M200 60H208.5a3.5 3.5 0 0 1 3.5 3.5V96.5a3.5 3.5 0 0 0 3.5 3.5H240',
    );
    expect(d({ type: 'FS', target, options: { curveRadius: 0 } })).toBe('M200 60H212V100H240');
    // A short gap: radii of 3; the last run is shorter than the arrowhead, so its corner is sharp.
    expect(d({ type: 'FS', target: touching, options: { gap: 3 } })).toBe(
      'M200 60a3 3 0 0 1 3 3V77a3 3 0 0 1 -3 3a3 3 0 0 0 -3 3V100H200',
    );
    // Rows 5 px apart with 3 px bars: 2.5 px verticals, radii of 1.
    const tiny = routeLink({
      type: 'FS',
      source: { x: 100, y: 1, width: 100, height: 3 },
      target: { x: 150, y: 6, width: 100, height: 3 },
      options: { rowGap: 2 },
    });
    expect(tiny.d).toBe(
      'M200 2.5H211a1 1 0 0 1 1 1V4a1 1 0 0 1 -1 1H139a1 1 0 0 0 -1 1V6.5a1 1 0 0 0 1 1H150',
    );
  });

  it('FR-LINK-3: draws the arrowhead at the target anchor, pointing into the target edge', () => {
    const arrow = (type: LinkType, arrowSize?: number): string =>
      routeLink({ type, source: SOURCE, target: bar(2, 240), options: { arrowSize } }).arrow;
    expect(arrow('FS')).toBe('M240 100l-5 -5v10z');
    expect(arrow('SF', 8)).toBe('M340 100l8 -8v16z');
    expect(arrow('FS', 2.3)).toBe('M240 100l-2.5 -2.5v5z');
    expect(arrow('FF', 0)).toBe('M340 100l0 0v0z');
  });

  it('FR-LINK-3: rounds every coordinate to 0.5 px', () => {
    const route = routeLink({
      type: 'FS',
      source: { x: 100.3, y: 50.1, width: 99.9, height: 20.2 },
      target: { x: 239.8, y: 89.6, width: 50, height: 20.4 },
      options: { gap: 11.9, curveRadius: 4.9 },
    });
    expect(route.points).toEqual([
      { x: 200, y: 60 },
      { x: 212, y: 60 },
      { x: 212, y: 100 },
      { x: 240, y: 100 },
    ]);
    expect(route.d).toBe('M200 60H207.5a4.5 4.5 0 0 1 4.5 4.5V95.5a4.5 4.5 0 0 0 4.5 4.5H240');
    expect(route.d.match(/-?\d+(\.\d+)?/g)?.every((n) => Number.isInteger(Number(n) * 2))).toBe(
      true,
    );
  });

  it('FR-SEL-1: the line path doubles as the hit path; the box covers line and arrowhead', () => {
    const route = routeLink({ type: 'FF', source: SOURCE, target: bar(2, -40) });
    expect(route.d).toBe('M200 60H207a5 5 0 0 1 5 5V95a5 5 0 0 1 -5 5H60');
    expect(route.bbox).toEqual({ x: 60, y: 60, width: 152, height: 45 });
    for (const [, input] of matrix()) expect(linkBBox(input)).toEqual(routeLink(input).bbox);
  });

  it('does not mutate its input and is deterministic', () => {
    const input: LinkRouteInput = Object.freeze({
      type: 'SS',
      source: Object.freeze({ ...SOURCE }),
      target: Object.freeze(bar(3, 20)),
      options: Object.freeze({ curveRadius: 4, gap: 10, arrowSize: 4, rowGap: 12 }),
    });
    expect(routeLink(input)).toEqual(routeLink(input));
    expect(linkBBox(input)).toEqual(routeLink(input).bbox);
  });

  it('throws RangeError for invalid geometry and options', () => {
    const route = (input: Partial<LinkRouteInput>) => () =>
      routeLink({ type: 'FS', source: SOURCE, target: bar(2, 240), ...input });
    expect(route({ source: { ...SOURCE, x: Number.NaN } })).toThrow(
      new RangeError(
        'source must have a finite x and y and a finite width and height ≥ 0, got {x: NaN, y: 50, width: 100, height: 20}.',
      ),
    );
    expect(route({ target: { ...SOURCE, y: Infinity } })).toThrow(/^target must have/);
    expect(route({ target: { ...SOURCE, width: -1 } })).toThrow(RangeError);
    expect(route({ source: { ...SOURCE, height: Infinity } })).toThrow(RangeError);
    expect(route({ options: { curveRadius: -1 } })).toThrow(
      new RangeError('curveRadius must be a finite number ≥ 0, got -1.'),
    );
    expect(route({ options: { gap: Number.NaN } })).toThrow(/^gap must be/);
    expect(route({ options: { arrowSize: Infinity } })).toThrow(/^arrowSize must be/);
    expect(route({ options: { rowGap: -0.5 } })).toThrow(/^rowGap must be/);
    expect(() => linkBBox({ type: 'XX' as LinkType, source: SOURCE, target: SOURCE })).toThrow();
  });
});

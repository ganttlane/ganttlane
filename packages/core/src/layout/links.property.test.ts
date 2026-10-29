import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { LinkType } from '../model';
import { linkAnchors } from '../schedule';
import {
  linkBBox,
  type LinkPoint,
  type LinkRect,
  type LinkRoute,
  type LinkRouteInput,
  type LinkRouteOptions,
  routeLink,
} from './index';

const TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** Quarter-pixel values in `[min, max]`: they exercise the rounding to 0.5 px. */
const quarters = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: min * 4, max: max * 4 }).map((n) => n / 4);

const optionsArb: fc.Arbitrary<LinkRouteOptions> = fc.record({
  curveRadius: fc.option(quarters(0, 20), { nil: undefined }),
  gap: fc.option(quarters(0, 30), { nil: undefined }),
  arrowSize: fc.option(quarters(0, 10), { nil: undefined }),
  rowGap: fc.option(quarters(0, 30), { nil: undefined }),
});

/** Any two boxes, overlapping or not. */
const anyInput: fc.Arbitrary<LinkRouteInput> = fc.record({
  type: fc.constantFrom(...TYPES),
  source: fc.record({
    x: quarters(-500, 500),
    y: quarters(-500, 500),
    width: quarters(0, 300),
    height: quarters(0, 60),
  }),
  target: fc.record({
    x: quarters(-500, 500),
    y: quarters(-500, 500),
    width: quarters(0, 300),
    height: quarters(0, 60),
  }),
  options: optionsArb,
});

/**
 * Bars laid out in rows (one bar per row, vertically centered, `rowGap` = row height minus bar
 * height) whose boxes do not overlap: two bars in the same row are horizontally apart.
 */
const rowInput: fc.Arbitrary<LinkRouteInput> = fc
  .record({
    type: fc.constantFrom(...TYPES),
    rowHeight: quarters(4, 60),
    inset: quarters(0, 20),
    sourceRow: fc.integer({ min: 0, max: 20 }),
    targetRow: fc.integer({ min: 0, max: 20 }),
    sourceX: quarters(-400, 400),
    sourceWidth: quarters(0, 300),
    targetWidth: quarters(0, 300),
    offset: quarters(-400, 400),
    after: fc.boolean(),
    apart: quarters(0, 60),
    knownRowGap: fc.boolean(),
    options: optionsArb,
  })
  .map((c): LinkRouteInput => {
    const inset = Math.min(c.inset, c.rowHeight / 2);
    const height = c.rowHeight - 2 * inset;
    const source = {
      x: c.sourceX,
      y: c.sourceRow * c.rowHeight + inset,
      width: c.sourceWidth,
      height,
    };
    let x = c.sourceX + c.offset;
    if (c.sourceRow === c.targetRow) {
      x = c.after ? c.sourceX + c.sourceWidth + c.apart : c.sourceX - c.targetWidth - c.apart;
    }
    const target = { x, y: c.targetRow * c.rowHeight + inset, width: c.targetWidth, height };
    const rowGap = c.knownRowGap ? 2 * inset : undefined;
    return { type: c.type, source, target, options: { ...c.options, rowGap } };
  });

/** Integer geometry: no rounding happens, so mirrored input must give mirrored output. */
const integerInput: fc.Arbitrary<LinkRouteInput> = fc.record({
  type: fc.constantFrom(...TYPES),
  source: fc.record({
    x: fc.integer({ min: -300, max: 300 }),
    y: fc.integer({ min: -300, max: 300 }),
    width: fc.integer({ min: 0, max: 200 }),
    height: fc.integer({ min: 0, max: 40 }),
  }),
  target: fc.record({
    x: fc.integer({ min: -300, max: 300 }),
    y: fc.integer({ min: -300, max: 300 }),
    width: fc.integer({ min: 0, max: 200 }),
    height: fc.integer({ min: 0, max: 40 }),
  }),
  options: fc.record({
    curveRadius: fc.integer({ min: 0, max: 12 }),
    gap: fc.integer({ min: 0, max: 24 }),
    arrowSize: fc.integer({ min: 0, max: 8 }),
    rowGap: fc.option(fc.integer({ min: 0, max: 24 }), { nil: undefined }),
  }),
});

const round = (value: number): number => Math.round(value * 2) / 2 + 0;

/** The rounded anchor of a bar edge (the middle of the edge). */
function anchor(rect: LinkRect, edge: 'start' | 'end'): LinkPoint {
  return {
    x: round(edge === 'end' ? rect.x + rect.width : rect.x),
    y: round(rect.y + rect.height / 2),
  };
}

type Command =
  | { readonly kind: 'M'; readonly x: number; readonly y: number }
  | { readonly kind: 'H'; readonly x: number }
  | { readonly kind: 'V'; readonly y: number }
  | {
      readonly kind: 'a';
      readonly r: number;
      readonly sweep: number;
      readonly dx: number;
      readonly dy: number;
    };

/** A plain decimal that is a multiple of 0.5 (no exponent, no `NaN`, no `Infinity`). */
const NUM = String.raw`-?(?:0|[1-9]\d*)(?:\.5)?`;
const COMMAND = new RegExp(
  String.raw`M(${NUM}) (${NUM})|H(${NUM})|V(${NUM})|a(${NUM}) \5 0 0 ([01]) (${NUM}) (${NUM})`,
  'y',
);
const ARROW = new RegExp(String.raw`^M(${NUM}) (${NUM})l(${NUM}) (${NUM})v(${NUM})z$`);

/** Parses `d` in the documented format, failing on anything else. */
function parse(d: string): Command[] {
  const commands: Command[] = [];
  COMMAND.lastIndex = 0;
  while (COMMAND.lastIndex < d.length) {
    const m = COMMAND.exec(d);
    if (!m) throw new Error(`unexpected path data at ${COMMAND.lastIndex}: ${d}`);
    const n = (i: number): number => Number(m[i]);
    if (m[1] !== undefined) commands.push({ kind: 'M', x: n(1), y: n(2) });
    else if (m[3] !== undefined) commands.push({ kind: 'H', x: n(3) });
    else if (m[4] !== undefined) commands.push({ kind: 'V', y: n(4) });
    else commands.push({ kind: 'a', r: n(5), sweep: n(6), dx: n(7), dy: n(8) });
  }
  if (commands[0]?.kind !== 'M' || commands.slice(1).some((c) => c.kind === 'M')) {
    throw new Error(`a path starts with one M: ${d}`);
  }
  return commands;
}

interface Segment {
  readonly ux: number;
  readonly uy: number;
  readonly length: number;
}

/** The runs between consecutive corner points. */
function segments(points: readonly LinkPoint[]): Segment[] {
  const result: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length > 0) result.push({ ux: Math.sign(b.x - a.x), uy: Math.sign(b.y - a.y), length });
  }
  return result;
}

interface Walked {
  /** Pen positions after each command, with points sampled along the arcs. */
  readonly samples: LinkPoint[];
  /** Straight pieces of the path. */
  readonly runs: [LinkPoint, LinkPoint][];
  /** Arc radii in order. */
  readonly radii: number[];
}

/**
 * Walks `d` against the corner points: every straight piece must run along its segment in the
 * segment's direction, every arc must join two consecutive segments with the right sweep, and
 * the pieces must add up to each segment's length exactly (so arcs never overlap).
 */
function walk(route: LinkRoute): Walked {
  const segs = segments(route.points);
  const used = segs.map(() => 0);
  const samples: LinkPoint[] = [];
  const runs: [LinkPoint, LinkPoint][] = [];
  const radii: number[] = [];
  let k = 0;
  let pen: LinkPoint = { x: Number.NaN, y: Number.NaN };
  for (const c of parse(route.d)) {
    if (c.kind === 'M') {
      pen = { x: c.x, y: c.y };
    } else if (c.kind === 'H' || c.kind === 'V') {
      const next = c.kind === 'H' ? { x: c.x, y: pen.y } : { x: pen.x, y: c.y };
      const ux = Math.sign(next.x - pen.x);
      const uy = Math.sign(next.y - pen.y);
      expect(ux !== 0 || uy !== 0, 'no empty runs').toBe(true);
      if (segs[k]?.ux !== ux || segs[k]?.uy !== uy) k++; // past a sharp corner
      expect(segs[k], `run ${c.kind} follows a segment`).toMatchObject({ ux, uy });
      used[k]! += Math.abs(next.x - pen.x) + Math.abs(next.y - pen.y);
      runs.push([pen, next]);
      pen = next;
    } else {
      const into = segs[k]!;
      const out = segs[k + 1]!;
      expect(out, 'an arc joins two segments').toBeDefined();
      expect([c.dx, c.dy]).toEqual([(into.ux + out.ux) * c.r, (into.uy + out.uy) * c.r]);
      const turn = into.ux * out.uy - into.uy * out.ux;
      expect(turn, 'arcs only at turns').not.toBe(0);
      expect(c.sweep).toBe(turn > 0 ? 1 : 0);
      const center = { x: pen.x + out.ux * c.r, y: pen.y + out.uy * c.r };
      for (let i = 1; i < 8; i++) {
        const angle = (i / 8) * (Math.PI / 2);
        samples.push({
          x: center.x - out.ux * c.r * Math.cos(angle) + into.ux * c.r * Math.sin(angle),
          y: center.y - out.uy * c.r * Math.cos(angle) + into.uy * c.r * Math.sin(angle),
        });
      }
      used[k]! += c.r;
      used[k + 1]! += c.r;
      radii.push(c.r);
      k++;
      pen = { x: pen.x + c.dx, y: pen.y + c.dy };
    }
    samples.push(pen);
  }
  expect(used).toEqual(segs.map((s) => s.length));
  expect(k).toBe(Math.max(0, segs.length - 1));
  return { samples, runs, radii };
}

/** Whether a point lies inside the box shrunk by the rounding tolerance (0.25 px). */
function inside(p: LinkPoint, rect: LinkRect): boolean {
  const t = 0.25;
  return (
    p.x > rect.x + t &&
    p.x < rect.x + rect.width - t &&
    p.y > rect.y + t &&
    p.y < rect.y + rect.height - t
  );
}

/** Whether an axis-aligned run passes through the box shrunk by the rounding tolerance. */
function crosses([a, b]: [LinkPoint, LinkPoint], rect: LinkRect): boolean {
  const t = 0.25;
  const [left, right] = [rect.x + t, rect.x + rect.width - t];
  const [top, bottom] = [rect.y + t, rect.y + rect.height - t];
  if (a.y === b.y) {
    return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  }
  return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
}

function mirrorX(rect: LinkRect): LinkRect {
  return { ...rect, x: -(rect.x + rect.width) };
}

function mirrorY(rect: LinkRect): LinkRect {
  return { ...rect, y: -(rect.y + rect.height) };
}

const MIRROR_TYPE: Readonly<Record<LinkType, LinkType>> = {
  FS: 'SF',
  SF: 'FS',
  SS: 'FF',
  FF: 'SS',
};

function checkRoute(input: LinkRouteInput): Walked {
  const route = routeLink(input);
  const { source: sourceEdge, target: targetEdge } = linkAnchors(input.type);
  const start = anchor(input.source, sourceEdge);
  const end = anchor(input.target, targetEdge);
  const walked = walk(route);

  // Ends: the path starts at the source anchor and ends at the target anchor.
  expect(route.points[0]).toEqual(start);
  expect(route.points.at(-1)).toEqual(end);
  expect(parse(route.d)[0]).toEqual({ kind: 'M', ...start });
  expect(walked.samples.at(-1)).toEqual(end);
  // Orthogonal: consecutive corner points share x or y.
  route.points.forEach((p, i) => {
    const next = route.points[i + 1];
    if (next) expect(p.x === next.x || p.y === next.y).toBe(true);
  });
  // Radii: within the option, multiples of 0.5 (checked by the parser).
  const curveRadius = input.options?.curveRadius ?? 5;
  for (const r of walked.radii) expect(r).toBeLessThanOrEqual(curveRadius);

  // Arrowhead: tip at the target anchor, pointing into the target edge.
  const size = round(input.options?.arrowSize ?? 5);
  const m = ARROW.exec(route.arrow);
  expect(m, route.arrow).not.toBeNull();
  const into = targetEdge === 'start' ? 1 : -1;
  expect(m!.slice(1).map(Number)).toEqual([end.x, end.y, -into * size + 0, -size + 0, 2 * size]);

  // Box: covers every point of the line and of the arrowhead; linkBBox agrees.
  const { bbox } = route;
  const arrowPoints = [
    end,
    { x: end.x - into * size, y: end.y - size },
    { x: end.x - into * size, y: end.y + size },
  ];
  for (const p of [...walked.samples, ...arrowPoints]) {
    expect(p.x).toBeGreaterThanOrEqual(bbox.x);
    expect(p.x).toBeLessThanOrEqual(bbox.x + bbox.width);
    expect(p.y).toBeGreaterThanOrEqual(bbox.y);
    expect(p.y).toBeLessThanOrEqual(bbox.y + bbox.height);
  }
  expect(linkBBox(input)).toEqual(bbox);
  for (const value of [bbox.x, bbox.y, bbox.width, bbox.height])
    expect(Number.isFinite(value)).toBe(true);
  return walked;
}

describe('routeLink (properties)', () => {
  it('FR-LINK-3: from anchor to anchor, orthogonal with quarter-circle corners, no NaN, any boxes', () => {
    fc.assert(
      fc.property(anyInput, (input) => {
        checkRoute(input);
      }),
      { numRuns: 2000 },
    );
  });

  it('FR-LINK-3: routes between bars in rows never cross the inside of either bar', () => {
    fc.assert(
      fc.property(rowInput, (input) => {
        const { samples, runs } = checkRoute(input);
        for (const rect of [input.source, input.target]) {
          for (const run of runs) expect(crosses(run, rect), `${input.type} run`).toBe(false);
          for (const p of samples) expect(inside(p, rect), `${input.type} arc`).toBe(false);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('FR-LINK-3: the arrowhead sits on a straight run when the last segment is long enough', () => {
    fc.assert(
      fc.property(rowInput, (input) => {
        const route = routeLink(input);
        const segs = segments(route.points);
        const last = segs.at(-1);
        const size = round(input.options?.arrowSize ?? 5);
        if (!last || segs.length < 2 || size === 0 || last.length < size) return;
        // The last command is a straight run of at least `size` into the tip.
        const final = parse(route.d).at(-1)!;
        const tip = route.points.at(-1)!;
        expect(final.kind === 'H' || final.kind === 'V').toBe(true);
        const startOfRun = walk(route).samples.at(-2)!;
        expect(
          Math.abs(tip.x - startOfRun.x) + Math.abs(tip.y - startOfRun.y),
        ).toBeGreaterThanOrEqual(size);
      }),
      { numRuns: 1000 },
    );
  });

  it('FR-LINK-3: mirroring time swaps FS ↔ SF and SS ↔ FF and mirrors the route', () => {
    fc.assert(
      fc.property(integerInput, (input) => {
        const route = routeLink(input);
        const mirrored = routeLink({
          type: MIRROR_TYPE[input.type],
          source: mirrorX(input.source),
          target: mirrorX(input.target),
          options: input.options,
        });
        expect(mirrored.points).toEqual(route.points.map((p) => ({ x: -p.x + 0, y: p.y })));
        expect(parse(mirrored.d)).toEqual(
          parse(route.d).map((c) => {
            switch (c.kind) {
              case 'M':
                return { ...c, x: -c.x + 0 };
              case 'H':
                return { ...c, x: -c.x + 0 };
              case 'V':
                return c;
              case 'a':
                return { ...c, sweep: 1 - c.sweep, dx: -c.dx + 0 };
            }
          }),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('FR-LINK-3: a link going up mirrors the same link going down (upstream #624)', () => {
    fc.assert(
      fc.property(integerInput, (input) => {
        const { source, target } = input;
        // Same-row detours always go under the bars, so only bars in different rows mirror.
        fc.pre(target.y >= source.y + source.height || target.y + target.height <= source.y);
        fc.pre(source.y + source.height / 2 !== target.y + target.height / 2);
        const route = routeLink(input);
        const mirrored = routeLink({ ...input, source: mirrorY(source), target: mirrorY(target) });
        expect(mirrored.points).toEqual(route.points.map((p) => ({ x: p.x, y: -p.y + 0 })));
        expect(parse(mirrored.d)).toEqual(
          parse(route.d).map((c) => {
            switch (c.kind) {
              case 'M':
                return { ...c, y: -c.y + 0 };
              case 'H':
                return c;
              case 'V':
                return { ...c, y: -c.y + 0 };
              case 'a':
                return { ...c, sweep: 1 - c.sweep, dy: -c.dy + 0 };
            }
          }),
        );
      }),
      { numRuns: 1000 },
    );
  });
});

/**
 * The link router (LinkRouter, FR-LINK-3, FR-SEL-1, plan step 3.5): orthogonal SVG paths with
 * rounded corners between two bars, leaving and entering the edges the link type connects
 * (`linkAnchors` of `schedule`), an arrowhead at the target and a bounding box for
 * virtualization. Pure geometry on plain rectangles, independent of how bars are laid out.
 *
 * Unlike the fork, which drew every type as finish-to-start (`docs/audit/02-fork.md` §5.5 I3),
 * each type attaches to its own edges; corners turn by geometry, not by a fixed sweep, so links
 * that go up look like links that go down (upstream #624, `docs/audit/01-upstream.md` §6).
 */

import type { LinkType } from '../model';
import { linkAnchors } from '../schedule';

/**
 * A bar's box in body pixels: `x` grows with time, `y` grows downwards. Any object with these
 * fields works (e.g. a bar rect of the layout).
 */
export interface LinkRect {
  /** Left edge (the bar's start). Finite. */
  readonly x: number;
  /** Top edge. Finite. */
  readonly y: number;
  /** Width; `0` for a point-like bar. Finite and `≥ 0`. */
  readonly width: number;
  /** Height. Finite and `≥ 0`. */
  readonly height: number;
}

/** A point in body pixels. */
export interface LinkPoint {
  /** Horizontal position. */
  readonly x: number;
  /** Vertical position. */
  readonly y: number;
}

/** Options of {@link routeLink}. All values are pixels, finite and `≥ 0`. */
export interface LinkRouteOptions {
  /**
   * Largest corner radius (`display.linkCurveRadius`), default `5`. Each corner shrinks to fit
   * its segments (see {@link routeLink}); `0` draws sharp corners.
   */
  readonly curveRadius?: number | undefined;
  /**
   * Horizontal run out of the source edge before the first turn, and into the target edge after
   * the last one; default `12`. A link whose target edge is less than `2 × gap` ahead of the
   * source edge takes a detour.
   */
  readonly gap?: number | undefined;
  /** Depth of the arrowhead; the head is `2 × arrowSize` tall. Default `5`. */
  readonly arrowSize?: number | undefined;
  /**
   * Vertical space between the bars of adjacent rows (row height minus bar height). With it,
   * detours run along the row boundary next to the target row, and same-row detours along the
   * boundary under the bars. Without it, detours run half-way between the two bars, and
   * same-row detours `gap / 2` under the lower bar.
   */
  readonly rowGap?: number | undefined;
}

/** Input of {@link routeLink} and {@link linkBBox}. */
export interface LinkRouteInput {
  /** Link type: which edges the link connects (`linkAnchors`, FR-LINK-1). */
  readonly type: LinkType;
  /** The predecessor's bar. */
  readonly source: LinkRect;
  /** The successor's bar. */
  readonly target: LinkRect;
  /** Geometry options; defaults when omitted. */
  readonly options?: LinkRouteOptions | undefined;
}

/**
 * A routed link. Coordinates are rounded to `0.5` px, so equal input gives equal strings
 * (snapshot-friendly) and straight runs land on half pixels. Plain objects, not frozen (this is
 * a hot path): treat them as immutable.
 */
export interface LinkRoute {
  /**
   * The SVG path of the line, from the source anchor to the arrow tip at the target anchor. The
   * format is stable: `M{x} {y}`, then absolute `H{x}` / `V{y}` runs and relative quarter
   * arcs `a{r} {r} 0 0 {sweep} {±r} {±r}` at the corners. Numbers are plain decimals.
   *
   * It is also the hit path (FR-SEL-1): renderers stroke the same `d` a second time, wide and
   * transparent (`--gantt-link-hit-width`), to catch pointer events.
   */
  readonly d: string;
  /**
   * The arrowhead, a closed triangle to fill: `M{tip}l{back} {-size}v{2 × size}z`. Its tip is
   * the target anchor, and it points into the target edge (right into a start, left into an
   * end).
   */
  readonly arrow: string;
  /**
   * The corners of the route before rounding them: the source anchor, each turn, the target
   * anchor. Consecutive points share `x` or `y`; at least two points (equal when the anchors
   * coincide).
   */
  readonly points: readonly LinkPoint[];
  /** The box of the line and the arrowhead; equal to {@link linkBBox} of the same input. */
  readonly bbox: LinkRect;
}

/** Default {@link LinkRouteOptions.curveRadius}. */
const DEFAULT_CURVE_RADIUS = 5;
/** Default {@link LinkRouteOptions.gap}. */
const DEFAULT_GAP = 12;
/** Default {@link LinkRouteOptions.arrowSize}. */
const DEFAULT_ARROW_SIZE = 5;

/** Horizontal direction of a run: `1` to the right (later), `-1` to the left. */
type Direction = 1 | -1;

/** The route before its corners are rounded. */
interface Skeleton {
  /** Rounded corners from the source anchor to the target anchor; may repeat points. */
  readonly waypoints: readonly LinkPoint[];
  /** The rounded target anchor (the arrow tip). */
  readonly end: LinkPoint;
  /** Direction of the run into the target. */
  readonly entry: Direction;
  /** Validated {@link LinkRouteOptions.curveRadius}. */
  readonly curveRadius: number;
  /** Validated {@link LinkRouteOptions.arrowSize}, rounded to `0.5` px. */
  readonly arrowSize: number;
}

/**
 * Routes a link between two bars (FR-LINK-3): an orthogonal path from the source anchor to the
 * target anchor with rounded corners, plus its arrowhead and box.
 *
 * **Anchors.** The link leaves the middle of the source edge and enters the middle of the target
 * edge given by its type: `FS` end → start, `SS` start → start, `FF` end → end, `SF` start →
 * end. It always leaves an end to the right and a start to the left, and enters a start moving
 * right and an end moving left, so the arrow points into the bar.
 *
 * **Shapes.** The rows of the two bars decide the shape; bars whose boxes overlap vertically are
 * in the same row.
 *
 * 1. *Step* (`FS`, `SF`): the target edge lies ahead, in the leaving direction, by at least
 *    `2 × gap` (in the same row: by any amount). The vertical run sits `gap` past the source
 *    edge (or half-way when a same-row gap is narrower); in the same row with aligned centers
 *    it is a straight line.
 *    ```
 *    FS, target below         FS, target above               SF, target below
 *    [source]--.                        .-->[target]                  .--[source]
 *              |                        |                             |
 *              '-->[target]   [source]--'                [target]<----'
 *    ```
 * 2. *Bracket* (`SS`, `FF` in different rows, whatever the horizontal positions): the vertical
 *    run sits `gap` outside the outermost of the two edges.
 *    ```
 *    SS                       FF
 *       .--[source]           [source]-----.
 *       |                                  |
 *       '-->[target]            [target]<--'
 *    ```
 * 3. *Detour* (`FS`, `SF` whose target edge is too close, touching, overlapping or behind):
 *    out by `gap`, across to `gap` before the target edge between the rows, then in. The
 *    horizontal run lies half-way between the bars, or with `rowGap` on the row boundary next
 *    to the target row (never past half-way), so it does not cross either bar.
 *    ```
 *    FS, touching / overlapping / backward
 *    [source]--.
 *              |
 *      .-------'      <- between the rows
 *      |
 *      '-->[target]
 *    ```
 * 4. *Same-row detour* (any other link in the same row): around under both bars, `rowGap / 2`
 *    (default `gap / 2`) below the lower one; a run that would turn inside the other bar turns
 *    half-way to it instead.
 *    ```
 *    FS backward, same row
 *      .-->[target]   [source]--.
 *      |                        |
 *      '------------------------'
 *    ```
 *
 * **Corners.** Each corner is a quarter circle of `curveRadius`, shrunk to fit: at most half of
 * each segment it shares with another corner, all of the first segment, the last segment minus
 * `arrowSize` (the arrowhead sits on a straight run), and no more than keeps the arc out of a
 * bar inside the turn (tight gaps). Radii are floored to `0.5` px, so arcs never overlap and
 * nothing is `NaN`. Bars that overlap each other may be crossed; any other route stays outside
 * both bars.
 *
 * Layout is left-to-right; mirroring for `'rtl'` is P1, like the time scale's.
 *
 * @param input - Link type, source and target bars, options.
 * @returns The path, arrowhead, corner points and box, rounded to `0.5` px.
 * @throws RangeError for a non-finite coordinate, a negative or non-finite size, or an option
 *   that is negative or not finite; an unknown type throws like `linkAnchors`.
 *
 * @example
 * ```ts
 * const route = routeLink({
 *   type: 'FS',
 *   source: { x: 100, y: 10, width: 80, height: 20 },
 *   target: { x: 240, y: 50, width: 60, height: 20 },
 *   options: { curveRadius: display.linkCurveRadius },
 * });
 * route.d; // 'M180 20H187a5 5 0 0 1 5 5V55a5 5 0 0 0 5 5H240'
 * route.arrow; // 'M240 60l-5 -5v10z'
 * ```
 */
export function routeLink(input: LinkRouteInput): LinkRoute {
  const { waypoints, end, entry, curveRadius, arrowSize } = resolveSkeleton(input);
  const points = simplify(waypoints, end);
  return {
    d: pathData(points, curveRadius, arrowSize, input.source, input.target),
    arrow: `M${end.x} ${end.y}l${-entry * arrowSize} ${-arrowSize}v${2 * arrowSize}z`,
    points,
    bbox: bounds(points, end, entry, arrowSize),
  };
}

/**
 * The box of a routed link: its line and arrowhead, as in {@link LinkRoute.bbox}, without
 * building the path. For virtualization: a link is drawn when its box, grown by half the hit
 * stroke width, intersects the visible window.
 *
 * @param input - As for {@link routeLink}.
 * @returns The box, rounded to `0.5` px.
 * @throws RangeError as {@link routeLink} does.
 */
export function linkBBox(input: LinkRouteInput): LinkRect {
  const { waypoints, end, entry, arrowSize } = resolveSkeleton(input);
  return bounds(waypoints, end, entry, arrowSize);
}

/** Validates the input and picks the shape (see {@link routeLink}). */
function resolveSkeleton(input: LinkRouteInput): Skeleton {
  const { source, target, options } = input;
  checkRect(source, 'source');
  checkRect(target, 'target');
  const curveRadius = checkOption(options?.curveRadius, DEFAULT_CURVE_RADIUS, 'curveRadius');
  const gap = checkOption(options?.gap, DEFAULT_GAP, 'gap');
  const arrowSize = round(checkOption(options?.arrowSize, DEFAULT_ARROW_SIZE, 'arrowSize'));
  const rowGap =
    options?.rowGap === undefined ? undefined : checkOption(options.rowGap, 0, 'rowGap');

  const anchors = linkAnchors(input.type);
  const exit: Direction = anchors.source === 'end' ? 1 : -1;
  const entry: Direction = anchors.target === 'start' ? 1 : -1;
  const sx = anchors.source === 'end' ? source.x + source.width : source.x;
  const sy = source.y + source.height / 2;
  const tx = anchors.target === 'end' ? target.x + target.width : target.x;
  const ty = target.y + target.height / 2;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  const below = target.y >= sourceBottom && ty > sy;
  const above = targetBottom <= source.y && ty < sy;
  const sameRow = !below && !above;

  const waypoints = [point(sx, sy)];
  const reach = exit * (tx - sx);
  if (exit === entry && reach >= (sameRow ? 0 : 2 * gap)) {
    // Step: out, across to the target row, in.
    const x = sx + exit * Math.min(gap, reach / 2);
    waypoints.push(point(x, sy), point(x, ty));
  } else if (exit !== entry && !sameRow) {
    // Bracket: out past both edges, across, back in.
    const x = exit > 0 ? Math.max(sx, tx) + gap : Math.min(sx, tx) - gap;
    waypoints.push(point(x, sy), point(x, ty));
  } else {
    // Detour: out, to the run between the rows (or under the row), back, across, in.
    let y: number;
    if (sameRow) y = Math.max(sourceBottom, targetBottom) + (rowGap ?? gap) / 2;
    else if (below) {
      const middle = (sourceBottom + target.y) / 2;
      y = rowGap === undefined ? middle : Math.max(middle, target.y - rowGap / 2);
    } else {
      const middle = (targetBottom + source.y) / 2;
      y = rowGap === undefined ? middle : Math.min(middle, targetBottom + rowGap / 2);
    }
    const out = sameRow ? clearance(sx, exit, target, gap) : gap;
    const into = sameRow ? clearance(tx, entry === 1 ? -1 : 1, source, gap) : gap;
    const x1 = sx + exit * out;
    const x2 = tx - entry * into;
    waypoints.push(point(x1, sy), point(x1, y), point(x2, y), point(x2, ty));
  }
  const end = point(tx, ty);
  waypoints.push(end);
  return { waypoints, end, entry, curveRadius, arrowSize };
}

/**
 * The run out of `x` in direction `dir` before turning, for same-row detours: `gap`, or half
 * the way to the other bar when that bar starts closer ahead, so the turn stays between them.
 */
function clearance(x: number, dir: Direction, other: LinkRect, gap: number): number {
  const ahead = dir > 0 ? other.x - x : x - (other.x + other.width);
  return ahead >= 0 && ahead < gap ? ahead / 2 : gap;
}

/** Drops repeated points and merges straight runs, so every point but the ends is a turn. */
function simplify(waypoints: readonly LinkPoint[], end: LinkPoint): LinkPoint[] {
  const points: LinkPoint[] = [];
  let last: LinkPoint | undefined;
  let beforeLast: LinkPoint | undefined;
  for (const p of waypoints) {
    if (p.x === last?.x && p.y === last.y) continue;
    if (beforeLast !== undefined && last !== undefined && continues(beforeLast, last, p)) {
      points[points.length - 1] = p;
    } else {
      points.push(p);
      beforeLast = last;
    }
    last = p;
  }
  if (points.length === 1) points.push(end);
  return points;
}

/** Whether `a → b → c` goes straight on (same axis, same direction). */
function continues(a: LinkPoint, b: LinkPoint, c: LinkPoint): boolean {
  if (a.x === b.x && b.x === c.x) return (b.y - a.y) * (c.y - b.y) > 0;
  return a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) > 0;
}

/**
 * The largest corner radius at `at` whose arc stays out of `rect`. In the corner's frame, `p`
 * runs back along the incoming segment and `q` along the outgoing one; the arc of radius `r` is
 * the quarter circle centered at `(r, r)` from `(r, 0)` to `(0, r)`. It misses a box inside the
 * turn whose nearest corner is `(p, q)` exactly when `r ≤ p + q + √(2pq)`; a box behind either
 * segment (all of it at `p ≤ 0` or `q ≤ 0`) never meets the arc. Corners are rounded to 0.5 px
 * and boxes are not, so a corner counts as inside a box only when it is more than 0.5 px deep.
 */
function clearRadius(
  rect: LinkRect,
  at: LinkPoint,
  backX: number,
  backY: number,
  outX: number,
  outY: number,
): number {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const p1 = backX === 0 ? backY * (rect.y - at.y) : backX * (rect.x - at.x);
  const p2 = backX === 0 ? backY * (bottom - at.y) : backX * (right - at.x);
  const q1 = outX === 0 ? outY * (rect.y - at.y) : outX * (rect.x - at.x);
  const q2 = outX === 0 ? outY * (bottom - at.y) : outX * (right - at.x);
  if (Math.max(p1, p2) <= 0 || Math.max(q1, q2) <= 0) return Infinity;
  const p = Math.min(p1, p2);
  const q = Math.min(q1, q2);
  // A corner deep inside the box (bars that overlap): the route crosses it anyway.
  if (p < -0.5 && q < -0.5) return Infinity;
  const pIn = Math.max(p, 0);
  const qIn = Math.max(q, 0);
  return pIn + qIn + Math.sqrt(2 * pIn * qIn);
}

/** The `d` string of the line through `points` with rounded corners (see {@link LinkRoute.d}). */
function pathData(
  points: readonly LinkPoint[],
  curveRadius: number,
  arrowSize: number,
  source: LinkRect,
  target: LinkRect,
): string {
  const last = points.length - 1;
  let d = '';
  let penX = 0;
  let penY = 0;
  const lineTo = (x: number, y: number): void => {
    if (x !== penX) d += `H${x}`;
    else if (y !== penY) d += `V${y}`;
    penX = x;
    penY = y;
  };
  let before: LinkPoint | undefined;
  let corner: LinkPoint | undefined;
  let index = 0;
  for (const next of points) {
    if (corner === undefined) {
      d = `M${next.x} ${next.y}`;
      penX = next.x;
      penY = next.y;
    } else if (before !== undefined) {
      const inX = Math.sign(corner.x - before.x);
      const inY = Math.sign(corner.y - before.y);
      const outX = Math.sign(next.x - corner.x);
      const outY = Math.sign(next.y - corner.y);
      // > 0: a clockwise turn on screen (y grows downwards), the arc's sweep flag 1.
      const turn = inX * outY - inY * outX;
      let r = 0;
      if (turn !== 0) {
        const inLength = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y);
        const outLength = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
        const inLimit = index === 2 ? inLength : inLength / 2;
        const outLimit = index === last ? Math.max(0, outLength - arrowSize) : outLength / 2;
        const clear = Math.min(
          clearRadius(source, corner, -inX, -inY, outX, outY),
          clearRadius(target, corner, -inX, -inY, outX, outY),
        );
        r = Math.floor(Math.min(curveRadius, inLimit, outLimit, clear) * 2) / 2;
      }
      lineTo(corner.x - inX * r, corner.y - inY * r);
      if (r > 0) {
        d += `a${r} ${r} 0 0 ${turn > 0 ? 1 : 0} ${(inX + outX) * r} ${(inY + outY) * r}`;
        penX = corner.x + outX * r;
        penY = corner.y + outY * r;
      }
    }
    before = corner;
    corner = next;
    index++;
  }
  if (corner !== undefined) lineTo(corner.x, corner.y);
  return d;
}

/** The box of `points` and of the arrowhead at `end`. */
function bounds(
  points: readonly LinkPoint[],
  end: LinkPoint,
  entry: Direction,
  arrowSize: number,
): LinkRect {
  const base = end.x - entry * arrowSize;
  let left = Math.min(end.x, base);
  let right = Math.max(end.x, base);
  let top = end.y - arrowSize;
  let bottom = end.y + arrowSize;
  for (const p of points) {
    if (p.x < left) left = p.x;
    if (p.x > right) right = p.x;
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A point rounded to `0.5` px. */
function point(x: number, y: number): LinkPoint {
  return { x: round(x), y: round(y) };
}

/** Rounds to the nearest `0.5` px; `-0` becomes `0`. */
function round(value: number): number {
  return Math.round(value * 2) / 2 + 0;
}

/** Throws a `RangeError` unless the box has finite coordinates and finite sizes `≥ 0`. */
function checkRect(rect: LinkRect, name: string): void {
  const { x, y, width, height } = rect;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !(width >= 0 && width < Infinity) ||
    !(height >= 0 && height < Infinity)
  ) {
    throw new RangeError(
      `${name} must have a finite x and y and a finite width and height ≥ 0, got {x: ${x}, y: ${y}, width: ${width}, height: ${height}}.`,
    );
  }
}

/** An option's value, `fallback` when omitted; throws a `RangeError` unless finite and `≥ 0`. */
function checkOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!(value >= 0 && value < Infinity)) {
    throw new RangeError(`${name} must be a finite number ≥ 0, got ${value}.`);
  }
  return value;
}

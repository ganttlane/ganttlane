import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createTimeScale, VIEW_MODE_PRESETS } from '../scale';
import {
  addDuration,
  asDateTimeMs,
  createFloatingAdapter,
  type DateTimeMs,
  DAY,
  type Duration,
  HOUR,
  parseDateInput,
  parseDuration,
} from '../time';
import { type ColumnGrid, columnGrid } from './columns';
import { type ExtensionPolicy, planExtension, type ViewportChange } from './extension';
import { resolveRange } from './range';
import { rebaseTimeline } from './rebase';
import type { TimelineState } from './state';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

function duration(input: string): Duration {
  const parsed = parseDuration(input);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

const adapter = createFloatingAdapter();
/** Every preset with its column grid. */
const MODES = VIEW_MODE_PRESETS.map((mode) => ({ mode, columns: columnGrid(mode, adapter) }));
const ORIGIN = at('2026-01-01');
const DEFAULT_MAX_WIDTH = 4_000_000;
/** Far below the ±1 px of FR-TL-3: float rounding plus the whole-ms rounding of `xToDate`. */
const ANCHOR_TOLERANCE_PX = 1e-3;

interface World {
  readonly state: TimelineState;
  readonly columns: ColumnGrid;
}

/** A policy without columns: the world's columns are added when it is applied. */
type Policy = Omit<ExtensionPolicy, 'columns' | 'adapter'>;

const contentWidth = (state: TimelineState): number =>
  state.scale.durationToPx(state.range.end - state.range.start);
const maxScroll = (state: TimelineState): number =>
  Math.max(contentWidth(state) - state.viewportWidth, 0);

const worldArb: fc.Arbitrary<World> = fc
  .record({
    mode: fc.integer({ min: 0, max: MODES.length - 1 }),
    startHour: fc.integer({ min: -2000 * 24, max: 2000 * 24 }),
    lengthHours: fc.integer({ min: 1, max: 400 * 24 }),
    viewportWidth: fc.integer({ min: 50, max: 3000 }),
    scroll: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map(({ mode, startHour, lengthHours, viewportWidth, scroll }) => {
    const { mode: viewMode, columns } = MODES[mode]!;
    const start = asDateTimeMs(ORIGIN + startHour * HOUR);
    const explicit = { start, end: asDateTimeMs(start + lengthHours * HOUR) };
    const range = resolveRange({ spans: [], now: ORIGIN, explicit, columns });
    const scale = createTimeScale({ origin: range.start, pxPerDay: viewMode.pxPerDay });
    const state = { range, scale, scrollLeft: 0, viewportWidth };
    return { columns, state: { ...state, scrollLeft: scroll * maxScroll(state) } };
  });

const boundArb = (sign: 1 | -1): fc.Arbitrary<DateTimeMs | undefined> =>
  fc.option(
    fc
      .integer({ min: 1, max: 3000 * 24 })
      .map((hours) => asDateTimeMs(ORIGIN + sign * hours * HOUR)),
    { nil: undefined },
  );

const policyArb: fc.Arbitrary<Policy> = fc.record({
  threshold: fc.option(fc.integer({ min: 0, max: 2500 }), { nil: undefined }),
  extendBy: fc.option(
    fc.constantFrom(...['6h', '1d', '3d', '1w', '1mo', '1q', '1y'].map(duration)),
    { nil: undefined },
  ),
  bounds: fc.option(fc.record({ min: boundArb(-1), max: boundArb(1) }), { nil: undefined }),
  maxSpan: fc.option(fc.constantFrom(...['30d', '90d', '1y', '5y'].map(duration)), {
    nil: undefined,
  }),
  maxWidth: fc.option(fc.constantFrom(20_000, 200_000), { nil: undefined }),
});

type Op =
  | { readonly kind: 'scroll'; readonly at: number }
  | { readonly kind: 'edge'; readonly side: 'start' | 'end'; readonly px: number }
  | { readonly kind: 'resize'; readonly width: number }
  | { readonly kind: 'zoom'; readonly mode: number; readonly anchor: number; readonly fit: boolean }
  | { readonly kind: 'extend'; readonly policy: Policy };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('scroll'),
      at: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('edge'),
      side: fc.constantFrom('start', 'end'),
      px: fc.integer({ min: 0, max: 3000 }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('resize'),
      width: fc.integer({ min: 50, max: 3000 }),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('zoom'),
      mode: fc.integer({ min: 0, max: MODES.length - 1 }),
      anchor: fc.double({ min: 0, max: 1, noNaN: true }),
      fit: fc.boolean(),
    }),
    weight: 1,
  },
  { arbitrary: fc.record({ kind: fc.constant('extend'), policy: policyArb }), weight: 6 },
);

function withScroll(world: World, scrollLeft: number): World {
  return { ...world, state: { ...world.state, scrollLeft } };
}

/** The extension size the policy stands for (the default depends on the viewport). */
function extendByOf(state: TimelineState, policy: Policy): Duration {
  return (
    policy.extendBy ?? {
      months: 0,
      ms: Math.max(state.scale.pxToDuration(2 * state.viewportWidth), 1),
    }
  );
}

/** `t` moved by one `extendBy`, which reaches a quarter of `maxWidth` at most. */
function stepOf(state: TimelineState, policy: Policy, t: DateTimeMs, sign: 1 | -1): number {
  const maxWidth = policy.maxWidth ?? DEFAULT_MAX_WIDTH;
  const reach = Math.max(Math.floor(maxWidth / 4 / state.scale.durationToPx(1)), 1);
  const moved = addDuration(t, extendByOf(state, policy), sign);
  return sign === 1 ? Math.min(moved, t + reach) : Math.max(moved, t - reach);
}

/** Whether the range is longer than `maxSpan` or wider than `maxWidth`. */
function overLimit(state: TimelineState, policy: Policy): boolean {
  const { start, end } = state.range;
  const maxWidth = policy.maxWidth ?? DEFAULT_MAX_WIDTH;
  const byWidth = end - start > Math.floor(maxWidth / state.scale.durationToPx(1));
  const bySpan = policy.maxSpan !== undefined && end > addDuration(start, policy.maxSpan);
  return byWidth || bySpan;
}

/** Every invariant of one `planExtension` step. */
function checkStep(
  state: TimelineState,
  policy: Policy,
  columns: ColumnGrid,
  change: ViewportChange | undefined,
): void {
  const { range, scale, scrollLeft, viewportWidth } = state;
  const width = contentWidth(state);
  const toStart = scrollLeft;
  const toEnd = width - scrollLeft - viewportWidth;
  const threshold = policy.threshold ?? viewportWidth;
  const min = policy.bounds?.min ?? -Infinity;
  const max = policy.bounds?.max ?? Infinity;

  if (change === undefined) {
    // Never misses an extension that fits (far below the hard cap of twice maxWidth).
    if (viewportWidth > 0 && policy.maxWidth === undefined && width < 1_000_000) {
      expect(toStart <= threshold && range.start > min, 'missed start').toBe(false);
      expect(toEnd <= threshold && range.end < max, 'missed end').toBe(false);
    }
    return;
  }

  const next = change.range;
  // Exactly one edge moves, in the direction of the reason.
  expect(next.start !== range.start, 'one edge').not.toBe(next.end !== range.end);
  expect(next.end).toBeGreaterThan(next.start);
  // The hard cap: an extension never makes the content wider than twice maxWidth.
  const cap = 2 * (policy.maxWidth ?? DEFAULT_MAX_WIDTH);
  const k = scale.durationToPx(1);
  if (change.reason.startsWith('extend')) {
    expect(contentWidth(change), 'cap').toBeLessThanOrEqual(cap + 1e-6);
  }
  const ceil = (t: number): number => {
    const floor = columns.floor(asDateTimeMs(t));
    return floor === t ? floor : columns.next(asDateTimeMs(t));
  };
  switch (change.reason) {
    case 'extend-start': {
      expect(next.start).toBeLessThan(range.start);
      expect(toStart).toBeLessThanOrEqual(threshold);
      expect(next.start).toBeGreaterThanOrEqual(min);
      const stepped = stepOf(state, policy, range.start, -1);
      if (next.start !== min) expect(columns.floor(next.start)).toBe(next.start);
      // A whole step unless it crosses the cap: then the room left (FR-TL-4).
      const whole = (range.end - columns.floor(asDateTimeMs(stepped))) * k <= cap;
      if (next.start !== min && whole) expect(next.start).toBeLessThanOrEqual(stepped);
      break;
    }
    case 'extend-end': {
      expect(next.end).toBeGreaterThan(range.end);
      expect(toEnd).toBeLessThanOrEqual(threshold);
      expect(next.end).toBeLessThanOrEqual(max);
      const stepped = stepOf(state, policy, range.end, 1);
      if (next.end !== max) expect(columns.floor(next.end)).toBe(next.end);
      const whole = (ceil(stepped) - range.start) * k <= cap;
      if (next.end !== max && whole) expect(next.end).toBeGreaterThanOrEqual(stepped);
      break;
    }
    case 'trim-start':
      expect(overLimit(state, policy)).toBe(true);
      expect(next.start).toBeGreaterThanOrEqual(stepOf(state, policy, range.start, 1));
      expect(columns.floor(next.start)).toBe(next.start);
      // The trimmed edge stays out of the threshold: it is not extended right back.
      expect(change.scrollLeft).toBeGreaterThan(threshold);
      break;
    case 'trim-end':
      expect(overLimit(state, policy)).toBe(true);
      expect(next.end).toBeLessThanOrEqual(stepOf(state, policy, range.end, -1));
      expect(columns.floor(next.end)).toBe(next.end);
      expect(contentWidth(change) - change.scrollLeft - viewportWidth).toBeGreaterThan(threshold);
      break;
    case 'scroll-to':
      throw new Error('planExtension never scrolls');
  }

  // The scale moves with the start; zoom and viewport are kept.
  expect(change.scale.origin).toBe(next.start);
  expect(change.scale.pxPerDay).toBe(scale.pxPerDay);
  expect(change.viewportWidth).toBe(viewportWidth);
  expect(Object.isFrozen(change)).toBe(true);

  // Content width changes exactly by the time added or removed, and every x by `shift`.
  const added = scale.durationToPx(range.start - next.start + (next.end - range.end));
  expect(Math.abs(contentWidth(change) - width - added)).toBeLessThan(1e-6 * Math.max(width, 1));
  expect(Math.abs(change.shift - scale.durationToPx(range.start - next.start))).toBeLessThan(1e-6);
  expect(change.scrollLeft).toBeGreaterThanOrEqual(0);
  expect(change.scrollLeft).toBeLessThanOrEqual(maxScroll(change) + 1e-6);

  // FR-TL-3: the date under the viewport's left edge stays put (content at least as wide as the
  // viewport; narrower content has nothing to scroll).
  if (width >= viewportWidth) {
    const left = scale.xToDate(scrollLeft);
    const drift = Math.abs(change.scale.dateToX(left) - change.scrollLeft);
    expect(drift, `${change.reason} drifted`).toBeLessThan(ANCHOR_TOLERANCE_PX);
  }
}

function run(world: World, op: Op): World {
  const { state } = world;
  switch (op.kind) {
    case 'scroll':
      return withScroll(world, op.at * maxScroll(state));
    case 'edge': {
      const limit = maxScroll(state);
      return withScroll(
        world,
        op.side === 'start' ? Math.min(op.px, limit) : Math.max(limit - op.px, 0),
      );
    }
    case 'resize': {
      const resized = { ...state, viewportWidth: op.width };
      return {
        ...world,
        state: { ...resized, scrollLeft: Math.min(state.scrollLeft, maxScroll(resized)) },
      };
    }
    case 'zoom': {
      const { mode, columns } = MODES[op.mode]!;
      const anchorX = op.anchor * state.viewportWidth;
      const next = rebaseTimeline(state, {
        pxPerDay: mode.pxPerDay,
        columns,
        anchorX,
        fit: op.fit,
      });
      expect(next.scale.origin).toBe(next.range.start);
      expect(columns.floor(next.range.start)).toBe(next.range.start);
      if (op.fit) {
        // FR-SCALE-6: the range grew to hold the anchored viewport, so the anchor stays put.
        const anchor =
          state.range.start + ((state.scrollLeft + anchorX) * DAY) / state.scale.pxPerDay;
        const after = next.range.start + ((next.scrollLeft + anchorX) * DAY) / next.scale.pxPerDay;
        expect(Math.abs(after - anchor) * (next.scale.pxPerDay / DAY)).toBeLessThan(
          ANCHOR_TOLERANCE_PX,
        );
      }
      return { columns, state: next };
    }
    case 'extend': {
      const policy = { ...op.policy, columns: world.columns };
      const change = planExtension(state, policy);
      checkStep(state, op.policy, world.columns, change);
      return change === undefined ? world : { ...world, state: change };
    }
  }
}

describe('viewport properties', () => {
  it('FR-TL-3, FR-TL-4: any mix of scrolls, resizes, zooms and extensions keeps the anchor', () => {
    fc.assert(
      fc.property(worldArb, fc.array(opArb, { minLength: 1, maxLength: 40 }), (initial, ops) => {
        let world = initial;
        for (const op of ops) world = run(world, op);
      }),
      { numRuns: 300 },
    );
  });

  it('FR-TL-2, FR-TL-4: without scrolling, planExtension settles within four changes', () => {
    fc.assert(
      fc.property(worldArb, policyArb, (world, policy) => {
        const full = { ...policy, columns: world.columns };
        let state = world.state;
        // At most one extension and one trim per edge, then idle.
        for (let step = 0; step <= 4; step++) {
          const change = planExtension(state, full);
          checkStep(state, policy, world.columns, change);
          if (change === undefined) {
            expect(planExtension(state, full)).toBeUndefined();
            return;
          }
          state = change;
        }
        throw new Error('planExtension made more than four changes without scrolling');
      }),
      { numRuns: 300 },
    );
  });

  it('FR-TL-5: scrolling towards an edge without bounds always finds more timeline', () => {
    fc.assert(
      fc.property(
        worldArb,
        fc.constantFrom<'start' | 'end'>('start', 'end'),
        fc.integer({ min: 1, max: 60 }),
        (initial, side, frames) => {
          // Wider than the viewport: at an exact fit both edges are 0 px away and the end goes
          // first (the tie rule), which costs one more frame.
          fc.pre(contentWidth(initial.state) > initial.state.viewportWidth);
          let world = initial;
          const startDate = world.state.scale.xToDate(world.state.scrollLeft);
          // Like a drag autoscroll: 20 px per frame towards the edge, one planExtension per frame.
          for (let frame = 0; frame < frames; frame++) {
            const { state } = world;
            const target = state.scrollLeft + (side === 'start' ? -20 : 20);
            world = withScroll(world, Math.min(Math.max(target, 0), maxScroll(state)));
            const change = planExtension(world.state, { columns: world.columns });
            if (change) world = { ...world, state: change };
          }
          // Only a first frame that starts right at the edge is blocked; then the timeline
          // always grows before the viewport reaches its edge.
          const { state } = world;
          const travelled = Math.abs(state.scale.dateToX(startDate) - state.scrollLeft);
          expect(travelled).toBeGreaterThan((frames - 1) * 20 - 1e-3);
        },
      ),
      { numRuns: 200 },
    );
  });
});

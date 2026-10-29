import { describe, expect, it } from 'vitest';

import { createTimeScale, type TimeRange, VIEW_MODE_PRESETS, type ViewMode } from '../scale';
import {
  asDateTimeMs,
  createFloatingAdapter,
  type DateTimeMs,
  DAY,
  type Duration,
  parseDateInput,
  parseDuration,
} from '../time';
import { columnGrid } from './columns';
import {
  ensureContains,
  type ExtensionPolicy,
  planExtension,
  type ViewportChange,
} from './extension';
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

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

const adapter = createFloatingAdapter();
const day = preset('day');
const dayColumns = columnGrid(day, adapter);

/** A timeline on `[start, end)` at `pxPerDay`, scale origin on the start. */
function timeline(
  start: string,
  end: string,
  scrollLeft: number,
  viewportWidth: number,
  pxPerDay = day.pxPerDay,
): TimelineState {
  const range: TimeRange = { start: at(start), end: at(end) };
  return {
    range,
    scale: createTimeScale({ origin: range.start, pxPerDay }),
    scrollLeft,
    viewportWidth,
  };
}

/** The date under the viewport's left edge. */
const leftDate = (state: TimelineState): DateTimeMs => state.scale.xToDate(state.scrollLeft);
const width = (state: TimelineState): number =>
  state.scale.durationToPx(state.range.end - state.range.start);

/** Applies `planExtension` until it returns nothing; the changes in order. */
function settle(state: TimelineState, policy: ExtensionPolicy, limit = 50): ViewportChange[] {
  const changes: ViewportChange[] = [];
  let current = state;
  for (let i = 0; i < limit; i++) {
    const change = planExtension(current, policy);
    if (!change) return changes;
    changes.push(change);
    current = change;
  }
  throw new Error('planExtension did not settle');
}

// March 2026 in the day mode: 31 days × 40 px = 1240 px of content.
const MARCH = ['2026-03-01', '2026-04-01'] as const;

describe('viewport/planExtension', () => {
  it('FR-TL-2, FR-TL-3: near the start, extends it by two viewport widths and compensates exactly', () => {
    const state = timeline(...MARCH, 100, 400);
    const change = planExtension(state, { columns: dayColumns })!;
    // 2 × 400 px = 800 px = 20 days before March 1.
    expect(change).toEqual({
      range: { start: at('2026-02-09'), end: at('2026-04-01') },
      scale: expect.objectContaining({ origin: at('2026-02-09'), pxPerDay: 40 }) as unknown,
      scrollLeft: 900,
      viewportWidth: 400,
      shift: 800,
      reason: 'extend-start',
    });
    expect(leftDate(change)).toBe(leftDate(state));
    expect(leftDate(change)).toBe(at('2026-03-03T12:00'));
    expect(width(change) - width(state)).toBe(800);
    expect(Object.isFrozen(change)).toBe(true);
    expect(Object.isFrozen(change.range)).toBe(true);
  });

  it('FR-TL-2: near the end, extends it without moving anything', () => {
    const state = timeline(...MARCH, 800, 400);
    const change = planExtension(state, { columns: dayColumns })!;
    expect(change.range).toEqual({ start: at('2026-03-01'), end: at('2026-04-21') });
    expect(change.scale).toBe(state.scale);
    expect(change).toMatchObject({ scrollLeft: 800, shift: 0, reason: 'extend-end' });
  });

  it('FR-TL-2: no extension away from the edges, and one change per call (idempotent)', () => {
    const state = timeline('2026-03-01', '2026-05-01', 1000, 400);
    expect(planExtension(state, { columns: dayColumns })).toBeUndefined();
    expect(planExtension(state, { columns: dayColumns })).toBeUndefined();

    // Content narrower than the viewport: both edges are near; one edge per call, then settled.
    const narrow = timeline('2026-03-01', '2026-03-06', 0, 400);
    const changes = settle(narrow, { columns: dayColumns });
    expect(changes.map((change) => change.reason)).toEqual(['extend-end', 'extend-start']);
    for (const change of changes)
      expect(planExtension(change, { columns: dayColumns })).not.toBe(change);
    expect(planExtension(changes.at(-1)!, { columns: dayColumns })).toBeUndefined();
  });

  it('FR-TL-2: the nearer edge first, the end on a tie', () => {
    const policy = { columns: dayColumns, threshold: 500 };
    // 1240 px of content, 400 px viewport: at 420 both edges are 420 px away.
    expect(planExtension(timeline(...MARCH, 420, 400), policy)?.reason).toBe('extend-end');
    expect(planExtension(timeline(...MARCH, 419, 400), policy)?.reason).toBe('extend-start');
    expect(planExtension(timeline(...MARCH, 421, 400), policy)?.reason).toBe('extend-end');
  });

  it('FR-TL-4: the threshold is a distance in px, inclusive', () => {
    expect(planExtension(timeline(...MARCH, 300, 400), { threshold: 300 })?.reason).toBe(
      'extend-start',
    );
    expect(planExtension(timeline(...MARCH, 301, 400), { threshold: 300 })).toBeUndefined();
    // Zero: only at the very edge.
    expect(planExtension(timeline(...MARCH, 0, 400), { threshold: 0 })?.reason).toBe(
      'extend-start',
    );
    expect(planExtension(timeline(...MARCH, 1, 400), { threshold: 0 })).toBeUndefined();
  });

  it('FR-TL-4: extendBy is calendar-aware and rounded up to whole columns', () => {
    const week = preset('week');
    const weeks = columnGrid(week, adapter);
    // Monday March 2 … Monday April 6: 35 days × 20 px = 700 px.
    const state = timeline('2026-03-02', '2026-04-06', 0, 300, week.pxPerDay);
    // Default: 600 px = 30 days back is Saturday Jan 31, floored to Monday Jan 26 (5 weeks).
    expect(planExtension(state, { columns: weeks })).toMatchObject({
      range: { start: at('2026-01-26') },
      shift: 700,
    });
    // One day back (at the edge, threshold 0) is Sunday March 1: still a whole week.
    const oneDay = { columns: weeks, extendBy: duration('1d'), threshold: 0 };
    expect(planExtension(state, oneDay)).toMatchObject({
      range: { start: at('2026-02-23') },
      shift: 140,
    });
    // At the end: one day after Monday April 6 rounds up to the next Monday.
    const end = { ...state, scrollLeft: 400 };
    expect(planExtension(end, oneDay)?.range.end).toBe(at('2026-04-13'));

    // A month back from March 1 in the month mode is February 1: 28 days × 4 px.
    const month = preset('month');
    const spring = timeline('2026-03-01', '2026-06-01', 0, 200, month.pxPerDay);
    const change = planExtension(spring, {
      columns: columnGrid(month, adapter),
      extendBy: duration('1mo'),
      threshold: 0,
    });
    expect(change).toMatchObject({ range: { start: at('2026-02-01') }, shift: 112 });
  });

  it('FR-TL-4: without columns the edge moves by extendBy exactly', () => {
    const policy = { extendBy: duration('36h'), threshold: 50 };
    const change = planExtension(timeline(...MARCH, 0, 400), policy)!;
    expect(change.range.start).toBe(at('2026-02-27T12:00'));
    expect(change.shift).toBe(60);
    expect(change.scrollLeft).toBe(60);
  });

  it('FR-TL-2, FR-TL-5: one extension always takes the edge out of the threshold', () => {
    // A small extendBy against a 400 px threshold, right at the edge (a jump there, or a drag).
    const policy = { columns: dayColumns, extendBy: duration('1d') };
    const change = planExtension(timeline(...MARCH, 0, 400), policy)!;
    // 400 px = 10 days are needed; just over that, floored to days, is 11 days.
    expect(change).toMatchObject({ range: { start: at('2026-02-18') }, shift: 440 });
    expect(planExtension(change, policy)?.reason).not.toBe('extend-start');
    // Without columns: by the least whole millisecond past the threshold.
    const exact = planExtension(timeline(...MARCH, 0, 400), { extendBy: duration('1d') })!;
    expect(exact.shift).toBeGreaterThan(400);
    expect(exact.shift).toBeLessThan(400.001);
    // Content narrower than the viewport (200 px short of it) grows at the end past the
    // threshold in one step: 600 px are needed, 21 days in all.
    const narrow = planExtension(timeline('2026-03-01', '2026-03-06', 0, 400), policy)!;
    expect(narrow.range.end).toBe(at('2026-03-22'));
    expect(narrow.reason).toBe('extend-end');
  });

  it('FR-TL-4: never extends past the bounds; an edge at its bound stays', () => {
    const bounds = { min: at('2026-02-20T06:00'), max: at('2026-04-10') };
    const policy = { columns: dayColumns, bounds };
    const start = planExtension(timeline(...MARCH, 100, 400), policy)!;
    // Clamped exactly to the bound, even mid-column.
    expect(start.range.start).toBe(bounds.min);
    expect(start.shift).toBe(8.75 * 40);
    expect(leftDate(start)).toBe(at('2026-03-03T12:00'));
    // At the bound: nothing more at the start, even right at the edge.
    expect(planExtension({ ...start, scrollLeft: 0 }, policy)).toBeUndefined();

    const end = planExtension(timeline(...MARCH, 800, 400), policy)!;
    expect(end.range.end).toBe(bounds.max);
    expect(planExtension({ ...end, scrollLeft: width(end) - 400 }, policy)).toBeUndefined();

    // A range already past a bound is not shrunk to it, and not extended further.
    const outside = timeline('2026-02-01', '2026-04-01', 0, 400);
    expect(planExtension(outside, policy)).toBeUndefined();
  });

  it('FR-TL-4: maxSpan trims the edge farther from the viewport, down to the limit', () => {
    // 151 days = 6040 px; the viewport (10 days) 40 days after the start.
    const state = timeline('2026-01-01', '2026-06-01', 1600, 400);
    const policy = { columns: dayColumns, maxSpan: duration('85d') };
    const change = planExtension(state, policy)!;
    expect(change).toMatchObject({
      range: { start: at('2026-01-01'), end: at('2026-03-27') },
      scrollLeft: 1600,
      shift: 0,
      reason: 'trim-end',
    });
    expect(planExtension(change, policy)).toBeUndefined();

    // The start farther away: trimmed with a negative compensation.
    const late = timeline('2025-11-01', '2026-04-01', 4040, 400);
    const trimmed = planExtension(late, policy)!;
    expect(trimmed).toMatchObject({
      range: { start: at('2026-01-06'), end: at('2026-04-01') },
      scrollLeft: 1400,
      shift: -2640,
      reason: 'trim-start',
    });
    expect(leftDate(trimmed)).toBe(leftDate(late));
  });

  it('FR-TL-4: trims keep threshold + extendBy beyond the viewport and come in chunks', () => {
    const state = timeline('2026-01-01', '2026-06-01', 1600, 400);
    const policy = { columns: dayColumns, maxSpan: duration('30d') };
    // threshold 400 px = 10 days, extendBy 800 px = 20 days: the end keeps 30 days after the
    // viewport; the start, 40 days before it, has only 10 days to spare, less than a chunk.
    const changes = settle(state, policy);
    expect(changes.map((change) => [change.reason, change.range])).toEqual([
      ['trim-end', { start: at('2026-01-01'), end: at('2026-03-22') }],
    ]);
    const settled = changes[0]!;
    expect(width(settled) - settled.scrollLeft - 400).toBe(1200);

    // Scrolling a little either way changes nothing: no per-column trims.
    for (const scrollLeft of [1500, 1700, 1000]) {
      expect(planExtension({ ...settled, scrollLeft }, policy), String(scrollLeft)).toBeUndefined();
    }
    // Scrolling 1200 px towards the start: within the threshold, the start is extended ...
    const extended = planExtension({ ...settled, scrollLeft: 400 }, policy)!;
    expect(extended).toMatchObject({
      range: { start: at('2025-12-12'), end: at('2026-03-22') },
      scrollLeft: 1200,
      reason: 'extend-start',
    });
    // ... and the end, now farther, is trimmed by a whole chunk, back to its margin.
    expect(planExtension(extended, policy)).toMatchObject({
      range: { start: at('2025-12-12'), end: at('2026-02-20') },
      reason: 'trim-end',
    });
  });

  it('FR-TL-4: maxWidth trims like maxSpan in pixels, and caps extensions at twice it', () => {
    // 90 days = 3600 px against 2000 px (50 days): the end is trimmed to it.
    const state = timeline('2026-01-01', '2026-04-01', 100, 400);
    const policy = { columns: dayColumns, maxWidth: 2000 };
    // One extendBy reaches 500 px (a quarter of maxWidth), 13 whole days: extending the start
    // would make 103 days = 4120 px > 4000 px, so the end is trimmed first to make room.
    const trimmed = planExtension(state, policy)!;
    expect(trimmed).toMatchObject({ range: { end: at('2026-02-20') }, reason: 'trim-end' });
    expect(planExtension(trimmed, policy)).toMatchObject({
      range: { start: at('2025-12-19'), end: at('2026-02-20') },
      reason: 'extend-start',
    });
  });

  it('FR-TL-4: an extension over the cap of twice maxWidth is clamped, so no edge is ever blocked', () => {
    const hour = preset('hour');
    const columns = columnGrid(hour, adapter);
    // Ten years at 960 px per day are 3.5 million px; 13 more years would be 8.06 million px,
    // over the cap of 8 million px.
    let state = timeline('2020-01-01', '2030-01-01', 0, 1000, hour.pxPerDay);
    const policy = { columns, extendBy: duration('13y') };
    for (let round = 0; round < 8; round++) {
      // The renderer scrolled to the very start; the timeline settles there.
      const edge = { ...state, scrollLeft: 0 };
      const changes = settle(edge, policy);
      expect(changes[0]?.reason, `round ${round}`).toBe('extend-start');
      for (const change of changes) expect(width(change)).toBeLessThanOrEqual(8_000_000);
      state = changes.at(-1)!;
      expect(state.range.start).toBeLessThan(edge.range.start);
      expect(leftDate(state)).toBe(edge.range.start);
    }
    // The same at the end.
    state = timeline('2020-01-01', '2030-01-01', 0, 1000, hour.pxPerDay);
    for (let round = 0; round < 8; round++) {
      const edge = { ...state, scrollLeft: width(state) - 1000 };
      const changes = settle(edge, policy);
      expect(changes[0]?.reason, `round ${round}`).toBe('extend-end');
      for (const change of changes) expect(width(change)).toBeLessThanOrEqual(8_000_000);
      state = changes.at(-1)!;
      expect(state.range.end).toBeGreaterThan(edge.range.end);
      expect(leftDate(state)).toBe(leftDate(edge));
    }
  });

  it('FR-TL-4: an extension is clamped to the room left under the cap when nothing can be trimmed', () => {
    // 47 days = 1880 px, over maxWidth 1000 (25 days) but with no room to trim: the 1500 px
    // viewport and one extendBy (250 px, a quarter of maxWidth) on each side cover the range.
    // Extending the start by 7 days would make 2160 px, over the cap of 2000 px: it gets the
    // 3 days left instead of being skipped.
    const state = timeline('2026-01-01', '2026-02-17', 0, 1500);
    const policy = { columns: dayColumns, maxWidth: 1000, threshold: 0 };
    const change = planExtension(state, policy)!;
    expect(change).toMatchObject({
      range: { start: at('2025-12-29'), end: at('2026-02-17') },
      reason: 'extend-start',
    });
    expect(width(change)).toBe(2000);
    expect(leftDate(change)).toBe(leftDate(state));
    // At the cap nothing more fits, and nothing can be trimmed.
    expect(planExtension({ ...change, scrollLeft: 0 }, policy)).toBeUndefined();
  });

  it('FR-TL-4: one extendBy reaches a quarter of maxWidth at most', () => {
    const hour = preset('hour');
    const state = timeline('2020-01-01', '2030-01-01', 0, 1000, hour.pxPerDay);
    const change = planExtension(state, { extendBy: duration('13y') })!;
    // 1 million px at 960 px per day: 1041 days 16 h.
    expect(change.range.start).toBe(at('2020-01-01') - 1_000_000 * (DAY / 960));
    expect(change.shift).toBe(1_000_000);
  });

  it('FR-TL-3: compensation is exact at every preset zoom level', () => {
    for (const mode of VIEW_MODE_PRESETS) {
      const columns = columnGrid(mode, adapter);
      const start = columns.floor(at('2026-03-04T05:00'));
      // At least 3000 px of content, so the viewport is near the start only.
      const end = columns.next(asDateTimeMs(start + Math.ceil((3000 * DAY) / mode.pxPerDay)));
      const scale = createTimeScale({ origin: start, pxPerDay: mode.pxPerDay });
      const state: TimelineState = {
        range: { start, end },
        scale,
        scrollLeft: 0.25,
        viewportWidth: 1000,
      };
      const change = planExtension(state, { columns })!;
      expect(change.reason, mode.id).toBe('extend-start');
      // The exact date under the edge (not rounded to ms) is in place to far below a pixel.
      const before = start + (0.25 * DAY) / mode.pxPerDay;
      const after = change.range.start + (change.scrollLeft * DAY) / mode.pxPerDay;
      expect(Math.abs(after - before) * (mode.pxPerDay / DAY), mode.id).toBeLessThan(1e-6);
      expect(columns.floor(change.range.start), mode.id).toBe(change.range.start);
    }
  });

  it('FR-TL-2: a zero-width (hidden) viewport needs nothing', () => {
    expect(planExtension(timeline(...MARCH, 0, 0))).toBeUndefined();
  });

  it('throws for a state or policy that breaks the contract', () => {
    const state = timeline(...MARCH, 100, 400);
    const shifted = {
      ...state,
      scale: createTimeScale({ origin: at('2026-02-01'), pxPerDay: 40 }),
    };
    expect(() => planExtension(shifted)).toThrow(/scale origin/);
    const empty = { ...state, range: { start: at('2026-03-01'), end: at('2026-03-01') } };
    expect(() => planExtension(empty)).toThrow(RangeError);
    expect(() => planExtension({ ...state, scrollLeft: NaN })).toThrow(/scrollLeft/);
    expect(() => planExtension({ ...state, viewportWidth: -1 })).toThrow(/viewportWidth/);
    expect(() => planExtension(state, { threshold: -1 })).toThrow(/threshold/);
    expect(() => planExtension(state, { extendBy: { months: 0, ms: 0 } })).toThrow(/extendBy/);
    expect(() => planExtension(state, { extendBy: { months: -1, ms: 0 } })).toThrow(/extendBy/);
    expect(() => planExtension(state, { maxSpan: { months: 0, ms: 0 } })).toThrow(/maxSpan/);
    expect(() => planExtension(state, { maxWidth: 0 })).toThrow(/maxWidth/);
    const backwards = { min: at('2026-05-01'), max: at('2026-01-01') };
    expect(() => planExtension(state, { bounds: backwards })).toThrow(/bounds/);
    expect(() => planExtension(state, { bounds: { min: NaN as DateTimeMs } })).toThrow(/bounds/);
  });
});

describe('viewport/ensureContains', () => {
  const state = timeline(...MARCH, 400, 400);

  it('FR-TL-6: grows the end for a later date, with room to align it anywhere', () => {
    const change = ensureContains(state, at('2026-04-15'), { columns: dayColumns })!;
    // Default padding: threshold + viewport + 1 = 801 px, just over 20 days after the date.
    expect(change).toMatchObject({
      range: { start: at('2026-03-01'), end: at('2026-05-06') },
      scrollLeft: 400,
      shift: 0,
      reason: 'scroll-to',
    });
    // At any alignment of the date, no edge is within the threshold: no extension in flight.
    for (const offset of [0, 200, 400]) {
      const x = change.scale.dateToX(at('2026-04-15')) - offset;
      expect(planExtension({ ...change, scrollLeft: x }, { columns: dayColumns })).toBeUndefined();
    }
  });

  it('FR-TL-6, FR-TL-3: grows the start for an earlier date and compensates', () => {
    const change = ensureContains(state, at('2026-02-01'), { columns: dayColumns })!;
    expect(change.range).toEqual({ start: at('2026-01-11'), end: at('2026-04-01') });
    expect(change.shift).toBe(49 * 40);
    expect(leftDate(change)).toBe(leftDate(state));
  });

  it('FR-TL-6: nothing when the target and its padding are inside', () => {
    const wide = timeline('2026-02-01', '2026-05-01', 400, 400);
    expect(ensureContains(wide, at('2026-03-20'))).toBeUndefined();
    // A date near the edge is not enough: its padding is outside.
    expect(ensureContains(wide, at('2026-04-25'))?.range.end).toBe(at('2026-05-15T00:36'));
    // Padding 0: only the target itself.
    expect(ensureContains(wide, at('2026-04-25'), { padding: 0 })).toBeUndefined();
  });

  it('FR-TL-6: an interval target (a bar) is covered whole', () => {
    const range = { start: at('2026-04-05'), end: at('2026-04-10') };
    const change = ensureContains(state, range, { padding: 40, columns: dayColumns })!;
    expect(change.range.end).toBe(at('2026-04-11'));
  });

  it('FR-TL-4, FR-TL-6: respects the bounds', () => {
    const bounds = { min: at('2026-02-25'), max: at('2026-04-10') };
    expect(ensureContains(state, at('2026-04-15'), { bounds })?.range.end).toBe(bounds.max);
    expect(ensureContains(state, at('2027-01-01'), { bounds })?.range.end).toBe(bounds.max);
    expect(ensureContains(state, at('2025-01-01'), { bounds })?.range.start).toBe(bounds.min);
  });

  it('FR-TL-4, FR-TL-6: over maxSpan, the side away from the target goes, never the target', () => {
    const change = ensureContains(state, at('2026-06-01'), {
      columns: dayColumns,
      maxSpan: duration('60d'),
    })!;
    expect(change.range).toEqual({ start: at('2026-04-23'), end: at('2026-06-22') });
    // The old view is gone: clamped to the content.
    expect(change.scrollLeft).toBe(0);

    const before = ensureContains(state, at('2025-12-01'), {
      columns: dayColumns,
      maxSpan: duration('60d'),
    })!;
    expect(before.range).toEqual({ start: at('2025-11-10'), end: at('2026-01-09') });

    // A target with its padding longer than maxSpan is kept whole.
    const long = ensureContains(state, at('2026-06-01'), {
      columns: dayColumns,
      maxSpan: duration('10d'),
    })!;
    expect(long.range).toEqual({ start: at('2026-05-11'), end: at('2026-06-22') });
  });

  it('FR-TL-6: a target wider than the range on both sides is kept whole over maxSpan', () => {
    const wide = { start: at('2026-02-01'), end: at('2026-05-01') };
    const change = ensureContains(state, wide, { padding: 0, maxSpan: duration('30d') })!;
    expect(change.range).toEqual(wide);
    expect(leftDate(change)).toBe(leftDate(state));
  });

  it('FR-TL-4, FR-TL-6: never grows wider than twice maxWidth; a wider target is reached at its start', () => {
    const hour = preset('hour');
    const columns = columnGrid(hour, adapter);
    const march = timeline(...MARCH, 400, 1000, hour.pxPerDay);
    // 33 years at 960 px per day: 11.6 million px, over the cap of 8 million px.
    const later = { start: at('2027-01-01'), end: at('2060-01-01') };
    const grown = ensureContains(march, later, { columns })!;
    expect(width(grown)).toBeLessThanOrEqual(8_000_000);
    expect(grown.range.start).toBeLessThan(later.start);
    expect(grown.range.end).toBeGreaterThan(later.start);
    // Around the current view (the target covers it on both sides).
    const around = { start: at('2000-01-01'), end: at('2040-01-01') };
    const both = ensureContains(march, around, { columns, padding: 0 })!;
    expect(width(both)).toBeLessThanOrEqual(8_000_000);
    expect(both.range.start).toBe(around.start);
    expect(columns.floor(both.range.end)).toBe(both.range.end);
  });

  it('throws for a non-finite target or padding', () => {
    expect(() => ensureContains(state, NaN as DateTimeMs)).toThrow(/target/);
    const reversed = { start: at('2026-04-10'), end: at('2026-04-05') };
    expect(() => ensureContains(state, reversed)).toThrow(/target/);
    expect(() => ensureContains(state, at('2026-04-15'), { padding: -1 })).toThrow(/padding/);
  });
});

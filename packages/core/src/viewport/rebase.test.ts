import { describe, expect, it } from 'vitest';

import { createTimeScale, VIEW_MODE_PRESETS, type ViewMode } from '../scale';
import { createFloatingAdapter, type DateTimeMs, DAY, parseDateInput } from '../time';
import { columnGrid } from './columns';
import { keepAnchor, rebaseTimeline } from './rebase';
import type { TimelineState } from './state';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

function preset(id: string): ViewMode {
  const mode = VIEW_MODE_PRESETS.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`no preset ${id}`);
  return mode;
}

const adapter = createFloatingAdapter();
const month = preset('month');

function timeline(
  start: string,
  end: string,
  scrollLeft: number,
  viewportWidth: number,
  pxPerDay = 40,
): TimelineState {
  const range = { start: at(start), end: at(end) };
  return {
    range,
    scale: createTimeScale({ origin: range.start, pxPerDay }),
    scrollLeft,
    viewportWidth,
  };
}

/** The exact date (unrounded ms) at viewport x `anchorX`. */
const dateAt = (state: TimelineState, anchorX: number): number =>
  state.range.start + ((state.scrollLeft + anchorX) * DAY) / state.scale.pxPerDay;

describe('viewport/keepAnchor', () => {
  it('FR-SCALE-6: keeps the date at the anchor across every pair of presets', () => {
    for (const from of VIEW_MODE_PRESETS) {
      for (const to of VIEW_MODE_PRESETS) {
        const oldScale = createTimeScale({
          origin: at('2026-03-01T06:00'),
          pxPerDay: from.pxPerDay,
        });
        const newScale = createTimeScale({ origin: at('2025-12-01'), pxPerDay: to.pxPerDay });
        for (const [scrollLeft, anchorX] of [
          [1234.5, 300],
          [0, 0],
          [987_654.25, 1999.75],
        ] as const) {
          const next = keepAnchor(oldScale, newScale, scrollLeft, anchorX);
          const before = oldScale.origin + ((scrollLeft + anchorX) * DAY) / from.pxPerDay;
          const after = newScale.origin + ((next + anchorX) * DAY) / to.pxPerDay;
          // In pixels of the new scale: far below a pixel at 960 ↔ 1 px per day.
          expect(
            Math.abs(after - before) * (to.pxPerDay / DAY),
            `${from.id} → ${to.id}`,
          ).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('FR-SCALE-6: plain numbers for a zoom and for a moved origin; not clamped', () => {
    const day = createTimeScale({ origin: at('2026-03-01'), pxPerDay: 40 });
    const monthScale = createTimeScale({ origin: at('2026-03-01'), pxPerDay: 4 });
    // March 11 at the left edge: 10 days × 4 px.
    expect(keepAnchor(day, monthScale, 400, 0)).toBe(40);
    // March 16 at x = 200 would need a negative offset in the month scale.
    expect(keepAnchor(day, monthScale, 400, 200)).toBe(-140);
    // Same zoom, origin 28 days earlier: everything 28 × 40 px further right.
    const february = createTimeScale({ origin: at('2026-02-01'), pxPerDay: 40 });
    expect(keepAnchor(day, february, 100, 0)).toBe(1220);
  });

  it('throws for a non-finite offset or anchor', () => {
    const scale = createTimeScale({ origin: at('2026-03-01'), pxPerDay: 40 });
    expect(() => keepAnchor(scale, scale, NaN, 0)).toThrow(/scrollLeft/);
    expect(() => keepAnchor(scale, scale, 0, Infinity)).toThrow(/anchorX/);
  });
});

describe('viewport/rebaseTimeline', () => {
  // March … May in the day mode (92 days = 3680 px), April 5 at the centre of an 800 px viewport.
  const state = timeline('2026-03-01', '2026-06-01', 1000, 800);

  it('FR-SCALE-6: a view mode switch re-snaps the range and keeps the anchor when it fits', () => {
    const next = rebaseTimeline(state, {
      pxPerDay: month.pxPerDay,
      columns: columnGrid(month, adapter),
      anchorX: 400,
      fit: true,
    });
    // ± 100 days of month-mode viewport around April 5, in whole months.
    expect(next.range).toEqual({ start: at('2025-12-01'), end: at('2026-08-01') });
    expect(next.scale).toMatchObject({ origin: at('2025-12-01'), pxPerDay: 4 });
    expect(next.scrollLeft).toBe(100);
    expect(dateAt(next, 400)).toBe(at('2026-04-05'));
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('FR-SCALE-6: without fit, a range too short for the new zoom clamps the scroll', () => {
    const next = rebaseTimeline(state, {
      pxPerDay: month.pxPerDay,
      columns: columnGrid(month, adapter),
      anchorX: 400,
    });
    expect(next.range).toEqual(state.range);
    expect(next.scrollLeft).toBe(0);
  });

  it('FR-SCALE-6, FR-TL-4: fit stays within the bounds, exactly', () => {
    const next = rebaseTimeline(state, {
      pxPerDay: month.pxPerDay,
      columns: columnGrid(month, adapter),
      anchorX: 400,
      fit: true,
      bounds: { min: at('2026-01-15'), max: at('2026-07-20') },
    });
    expect(next.range).toEqual({ start: at('2026-01-15'), end: at('2026-07-20') });
    // April 5 needs 100 days on its left; the bound leaves 80, so the scroll is clamped.
    expect(next.scrollLeft).toBe(0);
    // A range already past a bound keeps its edge.
    const wide = rebaseTimeline(state, { fit: true, bounds: { min: at('2026-04-01') } });
    expect(wide.range.start).toBe(at('2026-03-01'));
    const early = rebaseTimeline(state, { fit: true, bounds: { max: at('2026-05-01') } });
    expect(early.range.end).toBe(at('2026-06-01'));
  });

  it('FR-SCALE-7: zooming in at the cursor from the year mode to the hour mode', () => {
    const years = timeline('2020-01-01', '2030-01-01', 2000, 1200, 1);
    const hour = preset('hour');
    const next = rebaseTimeline(years, {
      pxPerDay: hour.pxPerDay,
      columns: columnGrid(hour, adapter),
      anchorX: 777.5,
      fit: true,
    });
    const drift = Math.abs(dateAt(next, 777.5) - dateAt(years, 777.5)) * (hour.pxPerDay / DAY);
    expect(drift).toBeLessThan(1e-6);
    expect(next.range).toEqual(years.range);
  });

  it('FR-TL-1: a range re-resolved for new data keeps the left edge date', () => {
    const next = rebaseTimeline(state, {
      range: { start: at('2026-02-01'), end: at('2026-05-01') },
    });
    expect(next.scale.origin).toBe(at('2026-02-01'));
    // March 26 at the left edge, 53 days after February 1.
    expect(next.scrollLeft).toBe(53 * 40);
    expect(dateAt(next, 0)).toBe(dateAt(state, 0));
  });

  it('keeps everything by default, and the scale direction', () => {
    const rtl = {
      ...state,
      scale: createTimeScale({ origin: state.range.start, pxPerDay: 40, direction: 'rtl' }),
    };
    const next = rebaseTimeline(rtl);
    expect(next).toMatchObject({ range: state.range, scrollLeft: 1000, viewportWidth: 800 });
    expect(next.scale.direction).toBe('rtl');
  });

  it('throws for an invalid state, range, zoom or anchor', () => {
    expect(() => rebaseTimeline({ ...state, scrollLeft: NaN })).toThrow(RangeError);
    const empty = { start: at('2026-03-01'), end: at('2026-03-01') };
    expect(() => rebaseTimeline(state, { range: empty })).toThrow(/range/);
    expect(() => rebaseTimeline(state, { pxPerDay: 0 })).toThrow(/pxPerDay/);
    expect(() => rebaseTimeline(state, { anchorX: NaN })).toThrow(/anchorX/);
  });
});

import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { buildHierarchy, visibleRows } from '../hierarchy';
import { createLayout, layoutRows } from '../layout';
import { normalizeModel, type Task } from '../model';
import { createTimeScale, VIEW_MODE_PRESETS } from '../scale';
import { createFloatingAdapter, type DateTimeMs, parseDateInput } from '../time';
import { columnGrid } from './columns';
import {
  planScrollTo,
  resolveInitialScroll,
  scrollLeftFor,
  scrollTopFor,
  scrollToTask,
} from './scroll';
import type { TimelineState } from './state';

function at(iso: string): DateTimeMs {
  const parsed = parseDateInput(iso);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value.value;
}

const columns = columnGrid(
  VIEW_MODE_PRESETS.find((mode) => mode.id === 'day')!,
  createFloatingAdapter(),
);

function timeline(start: string, end: string, scrollLeft = 0, viewportWidth = 400): TimelineState {
  const range = { start: at(start), end: at(end) };
  return {
    range,
    scale: createTimeScale({ origin: range.start, pxPerDay: 40 }),
    scrollLeft,
    viewportWidth,
  };
}

// March 2026: 1240 px of content, a 400 px viewport, at most 840 px of scroll.
const march = timeline('2026-03-01', '2026-04-01', 100);

describe('viewport/scrollLeftFor', () => {
  it('FR-SCROLL-1: a date at every alignment', () => {
    const date = at('2026-03-11'); // x = 400
    expect(scrollLeftFor(date, 'start', march)).toBe(400);
    expect(scrollLeftFor(date, 'center', march)).toBe(200);
    expect(scrollLeftFor(date, 'end', march)).toBe(0);
    expect(scrollLeftFor(date, 0.25, march)).toBe(300);
    // Fractions outside 0 … 1 are clamped.
    expect(scrollLeftFor(date, 2, march)).toBe(0);
    expect(scrollLeftFor(date, -1, march)).toBe(400);
  });

  it('FR-SCROLL-1: clamped at both ends of the content', () => {
    expect(scrollLeftFor(at('2026-03-30'), 'start', march)).toBe(840);
    expect(scrollLeftFor(at('2026-03-02'), 'end', march)).toBe(0);
    expect(scrollLeftFor(at('2026-02-01'), 'center', march)).toBe(0);
    expect(scrollLeftFor(at('2026-05-01'), 'center', march)).toBe(840);
    // Content narrower than the viewport never scrolls.
    expect(scrollLeftFor(at('2026-03-04'), 'start', timeline('2026-03-01', '2026-03-06'))).toBe(0);
  });

  it('FR-SCROLL-2: an interval aligns by its own fraction', () => {
    const bar = { start: at('2026-03-11'), end: at('2026-03-16') }; // x 400, 200 px wide
    expect(scrollLeftFor(bar, 'start', march)).toBe(400);
    expect(scrollLeftFor(bar, 'end', march)).toBe(200); // its end at the right edge
    expect(scrollLeftFor(bar, 'center', march)).toBe(300);
    const long = { start: at('2026-03-11'), end: at('2026-03-31') }; // 800 px, wider than the viewport
    expect(scrollLeftFor(long, 'start', march)).toBe(400);
    expect(scrollLeftFor(long, 'end', march)).toBe(800);
    expect(scrollLeftFor(long, 'center', march)).toBe(600);
  });

  it('throws for a non-finite alignment or a scale not on the range', () => {
    expect(() => scrollLeftFor(at('2026-03-11'), NaN, march)).toThrow(/align/);
    const moved = { ...march, scale: createTimeScale({ origin: at('2026-02-01'), pxPerDay: 40 }) };
    expect(() => scrollLeftFor(at('2026-03-11'), 'start', moved)).toThrow(/scale origin/);
  });
});

describe('viewport/scrollTopFor', () => {
  it('FR-SCROLL-2: a row at every alignment, clamped to the rows', () => {
    expect(scrollTopFor(480, 48, 'start', 300, 4800)).toBe(480);
    expect(scrollTopFor(480, 48, 'end', 300, 4800)).toBe(228);
    expect(scrollTopFor(480, 48, 'center', 300, 4800)).toBe(354);
    expect(scrollTopFor(4700, 48, 'start', 300, 4800)).toBe(4500);
    expect(scrollTopFor(0, 48, 'end', 300, 4800)).toBe(0);
    expect(scrollTopFor(96, 48, 'start', 300, 144)).toBe(0);
  });

  it('throws for non-finite or negative sizes', () => {
    expect(() => scrollTopFor(NaN, 48, 'start', 300, 4800)).toThrow(/rowY/);
    expect(() => scrollTopFor(0, -1, 'start', 300, 4800)).toThrow(/rowHeight/);
    expect(() => scrollTopFor(0, 48, 'start', -300, 4800)).toThrow(/viewportHeight/);
    expect(() => scrollTopFor(0, 48, 'start', 300, Infinity)).toThrow(/bodyHeight/);
  });
});

describe('viewport/planScrollTo', () => {
  it('FR-SCROLL-2: a fixed range clamps a date outside it', () => {
    expect(planScrollTo(at('2026-04-15'), march)).toEqual({
      scrollLeft: 840,
      change: undefined,
      jump: false,
    });
    expect(planScrollTo(at('2026-04-15'), march, { infinite: false }).change).toBeUndefined();
  });

  it('FR-TL-6: the infinite timeline grows first, then scrolls in the grown state', () => {
    const later = planScrollTo(at('2026-04-15'), march, { infinite: { columns } });
    expect(later.change).toMatchObject({ range: { end: at('2026-05-06') }, shift: 0 });
    expect(later.scrollLeft).toBe(45 * 40);
    const earlier = planScrollTo(at('2026-02-01'), march, {
      align: 'center',
      infinite: { columns },
    });
    expect(earlier.change).toMatchObject({ range: { start: at('2026-01-11') }, shift: 49 * 40 });
    // February 1 is 21 days after January 11, centred in the 400 px viewport.
    expect(earlier.scrollLeft).toBe(21 * 40 - 200);
    expect(Object.isFrozen(earlier)).toBe(true);
    // Inside the range with room around it: no change.
    const wide = timeline('2026-01-01', '2026-06-01');
    expect(planScrollTo(at('2026-03-11'), wide, { infinite: {} }).change).toBeUndefined();
    // The old view is still there in the grown range: a smooth scroll can start from it.
    expect([later.jump, earlier.jump]).toEqual([false, false]);
  });

  it('FR-TL-6, FR-TL-4: a plan whose range change cut the current view away is a jump', () => {
    const policy = { columns, maxSpan: { months: 0, ms: 60 * 86_400_000 } };
    const far = planScrollTo(at('2026-06-01'), march, { infinite: policy });
    // Over maxSpan the side away from the target goes, with the current view.
    expect(far.change?.range.start).toBeGreaterThan(at('2026-03-13'));
    expect(far.jump).toBe(true);
    const back = planScrollTo(at('2025-12-01'), march, { infinite: policy });
    expect(back.jump).toBe(true);
    // Near enough to keep the view: March 1 … April 25 is within 60 days.
    const near = planScrollTo(at('2026-04-05'), march, { infinite: policy });
    expect(near.change?.range).toEqual({ start: at('2026-03-01'), end: at('2026-04-26') });
    expect(near.jump).toBe(false);
    const wide = timeline('2026-01-01', '2026-06-01', 2000);
    expect(planScrollTo(at('2026-03-20'), wide, { infinite: policy })).toMatchObject({
      change: undefined,
      jump: false,
    });
  });
});

describe('viewport/scrollToTask', () => {
  const { calendar } = createWorkCalendar();
  const tasks: Task[] = [
    { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
    { id: 'b', name: 'B', start: '2026-04-20', end: '2026-04-24' },
    { id: 'stub', name: 'Stub', type: 'placeholder' },
  ];
  const model = normalizeModel({ tasks }, { calendar });
  const rows = layoutRows(visibleRows(buildHierarchy(model), 'all'));
  const layout = createLayout({ rows, tasks: model.taskById, scale: march.scale });

  it('FR-SCROLL-2: both axes, row and bar', () => {
    // Body of 3 × 48 px rows in a 96 px tall body viewport.
    expect(scrollToTask('a', layout, march, { viewportHeight: 96 })).toEqual({
      scrollLeft: 40,
      scrollTop: 0,
      change: undefined,
      jump: false,
    });
    const b = scrollToTask('b', layout, march, {
      viewportHeight: 96,
      align: 'end',
      alignY: 'center',
    });
    // The bar is past the fixed range: clamped to its end.
    expect(b).toEqual({ scrollLeft: 840, scrollTop: 24, change: undefined, jump: false });
  });

  it('FR-SCROLL-2: a row without a bar keeps the horizontal offset', () => {
    expect(scrollToTask('stub', layout, march, { viewportHeight: 96 })).toEqual({
      scrollLeft: 100,
      scrollTop: 48,
      change: undefined,
      jump: false,
    });
    expect(scrollToTask('ghost', layout, march, { viewportHeight: 96 })).toBeUndefined();
  });

  it('FR-TL-6: the infinite timeline grows to reach a bar outside the range', () => {
    const plan = scrollToTask('b', layout, march, {
      viewportHeight: 96,
      align: 'end',
      infinite: { columns },
    })!;
    // April 20 … 25 is x 2000 … 2200: its end at the right edge of the 400 px viewport.
    expect(plan.scrollLeft).toBe(1800);
    expect(plan.change?.range.end).toBe(at('2026-05-16'));
    expect(plan.scrollTop).toBe(0);
  });

  it('throws for a layout built on another scale', () => {
    const moved = createLayout({
      rows,
      tasks: model.taskById,
      scale: createTimeScale({ origin: at('2026-02-01'), pxPerDay: 40 }),
    });
    expect(() => scrollToTask('a', moved, march, { viewportHeight: 96 })).toThrow(/layout/);
  });
});

describe('viewport/resolveInitialScroll', () => {
  const now = at('2026-03-11T12:00');
  const spans = [
    { start: at('2026-03-21'), endExclusive: at('2026-03-25') },
    undefined,
    { start: at('2026-03-06'), endExclusive: at('2026-03-08') },
  ];

  it('FR-SCROLL-1: every initial option, with the same meaning in both modes', () => {
    const input = { state: march, now, spans };
    expect(resolveInitialScroll('none', input)).toBeUndefined();
    expect(resolveInitialScroll('start', input)).toEqual({
      scrollLeft: 0,
      change: undefined,
      jump: false,
    });
    expect(resolveInitialScroll('end', input)).toMatchObject({
      scrollLeft: 840,
      change: undefined,
    });
    expect(resolveInitialScroll('today', input)?.scrollLeft).toBe(420);
    expect(resolveInitialScroll('today', { ...input, align: 'center' })?.scrollLeft).toBe(220);
    expect(resolveInitialScroll('first-task', input)?.scrollLeft).toBe(200);
    expect(resolveInitialScroll('first-task', { state: march, now })?.scrollLeft).toBe(420);
    expect(resolveInitialScroll(at('2026-03-16'), input)?.scrollLeft).toBe(600);
  });

  it('FR-SCROLL-1, FR-TL-6: start and end of the infinite timeline are the range edges, with room around them', () => {
    const infinite = { state: march, now, spans, infinite: { columns } };
    // The range start lands at the left edge, the infinite timeline grown before it, so the
    // first extension does not fire right away.
    const start = resolveInitialScroll('start', infinite)!;
    expect(start.change?.range.start).toBeLessThan(march.range.start);
    expect(start.change!.scale.xToDate(start.scrollLeft)).toBe(march.range.start);
    // The range end lands at the right edge.
    const end = resolveInitialScroll('end', infinite)!;
    expect(end.change?.range.end).toBeGreaterThan(march.range.end);
    expect(end.change!.scale.xToDate(end.scrollLeft + 400)).toBe(march.range.end);
    // `range`: the edges of another range (the data's, when the timeline was grown).
    const grown = timeline('2026-01-01', '2026-06-01');
    const data = { start: at('2026-03-09'), end: at('2026-03-23') };
    const other = resolveInitialScroll('start', { ...infinite, state: grown, range: data })!;
    expect(other.change).toBeUndefined();
    expect(grown.scale.xToDate(other.scrollLeft)).toBe(data.start);
    const fixed = resolveInitialScroll('end', { state: grown, now, range: data })!;
    expect(grown.scale.xToDate(fixed.scrollLeft + 400)).toBe(data.end);
  });

  it('FR-TL-6: today outside the range grows the infinite timeline first', () => {
    const plan = resolveInitialScroll('today', {
      state: march,
      now: at('2026-06-01'),
      infinite: { columns },
    })!;
    expect(plan.change?.range.end).toBe(at('2026-06-22'));
    expect(plan.scrollLeft).toBe(92 * 40);
  });
});

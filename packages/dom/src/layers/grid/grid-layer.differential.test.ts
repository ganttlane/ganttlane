import type { CalendarDay, GanttSnapshot } from '@ganttlane/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { createLayerHarness, createTestCore } from '../../testing';
import { createGridLayer } from './index';

type DisplayOptions = NonNullable<Parameters<typeof createLayerHarness>[1]>;

// The grid layer redraws a part only when its inputs changed or the viewport came near the edge
// of what is drawn, so a long-lived grid holds more than the viewport shows (hysteresis) and
// reaches its state through many partial updates. What is in view must still be what a grid that
// is mounted fresh on the same snapshot draws, whatever the history and whatever the highlights
// hold (malformed entries, equal ids, predicates that throw).

const boom = (): boolean => {
  throw new Error('boom');
};
const picky = (day: CalendarDay): boolean => {
  if (day.day === 11) throw new Error('picky');
  return day.weekday === 1;
};

/** Highlight lists, each one object for good: the layer keys its parsed days by identity. */
const HIGHLIGHTS: readonly (readonly unknown[])[] = [
  [],
  [{ id: 'a', dates: ['2026-03-06', '2026-03-12', new Date(2026, 2, 20)] }],
  [
    {
      id: 'r',
      range: { start: '2026-03-02', end: '2026-03-20' },
      color: 'tomato',
      className: 'a  b',
    },
  ],
  [{ id: 'mondays', match: (day: CalendarDay) => day.weekday === 1 }],
  [
    { id: 'same', dates: ['2026-03-06', '2026-03-07'], color: 'red' },
    { id: 'same', range: { start: '2026-03-06', end: '2026-03-09' }, className: 'second' },
    { id: 'same', match: (day: CalendarDay) => day.day === 6 },
  ],
  [
    null,
    7,
    { id: 'n', dates: 5 },
    { id: 'o', dates: { length: 1 } },
    { id: 'rn', range: null },
    { id: 'ro', range: { start: '2026-03-06' } },
    { id: 'mf', match: 'weekend' },
    { id: 'ok', dates: ['2026-03-09'], color: 3, className: 3 },
  ],
  [
    { id: 'broken', match: boom },
    { id: 'ok', dates: ['2026-03-10'] },
  ],
  [
    { id: 'picky', match: picky },
    { id: 'broken', match: boom },
  ],
];

type Op =
  | { readonly kind: 'scroll'; readonly left: number; readonly top: number }
  | { readonly kind: 'view'; readonly mode: 'day' | 'week' | 'month' | 'hour' }
  | { readonly kind: 'highlights'; readonly index: number }
  | { readonly kind: 'show'; readonly highlights: boolean }
  | { readonly kind: 'nonWorking'; readonly mode: 'fill' | 'stripes' | false }
  | { readonly kind: 'lines'; readonly mode: 'both' | 'vertical' | 'horizontal' | 'none' }
  | { readonly kind: 'today'; readonly on: boolean }
  | { readonly kind: 'stripes'; readonly mode: 'row' | 'group' | false };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('scroll' as const),
    left: fc.integer({ min: 0, max: 6000 }),
    top: fc.integer({ min: 0, max: 400 }),
  }),
  fc.record({
    kind: fc.constant('view' as const),
    mode: fc.constantFrom('day', 'week', 'month', 'hour' as const),
  }),
  fc.record({
    kind: fc.constant('highlights' as const),
    index: fc.integer({ min: 0, max: HIGHLIGHTS.length - 1 }),
  }),
  fc.record({ kind: fc.constant('show' as const), highlights: fc.boolean() }),
  fc.record({
    kind: fc.constant('nonWorking' as const),
    mode: fc.constantFrom<'fill' | 'stripes' | false>('fill', 'stripes', false),
  }),
  fc.record({
    kind: fc.constant('lines' as const),
    mode: fc.constantFrom('both', 'vertical', 'horizontal', 'none' as const),
  }),
  fc.record({ kind: fc.constant('today' as const), on: fc.boolean() }),
  fc.record({
    kind: fc.constant('stripes' as const),
    mode: fc.constantFrom<'row' | 'group' | false>('row', 'group', false),
  }),
);

/** The attributes of an element as sorted `name=value` text. */
function attributesOf(element: Element): string {
  return [...element.attributes]
    .map(({ name, value }) => `${name}=${value}`)
    .sort()
    .join(' ');
}

/**
 * What a grid shows inside the viewport, as sorted text: every node that touches the visible
 * columns (a node's `x` and `width`, or the `x1` of a line), plus the rows and horizontal lines,
 * which span the content, and the stripes pattern.
 */
function visible(root: Element, snapshot: GanttSnapshot): string[] {
  const left = snapshot.timeline.scrollLeft;
  const right = left + snapshot.timeline.viewportWidth;
  const found: string[] = [];
  for (const element of root.querySelectorAll('rect, line, pattern')) {
    const x = Number(element.getAttribute('x') ?? element.getAttribute('x1') ?? 0);
    const width = Number(element.getAttribute('width') ?? 0);
    if (x + width < left || x > right) continue;
    found.push(`${element.localName} ${attributesOf(element)}`);
  }
  return found.sort();
}

/** Draws a snapshot; an error of a predicate is expected, and not what these tests look at. */
function draw(
  layer: { update(snapshot: GanttSnapshot, previous: GanttSnapshot | undefined): void },
  snapshot: GanttSnapshot,
  previous: GanttSnapshot | undefined,
): void {
  try {
    layer.update(snapshot, previous);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
}

function drawFresh(snapshot: GanttSnapshot, display: DisplayOptions): string[] {
  const harness = createLayerHarness('grid', display);
  const layer = createGridLayer();
  try {
    layer.mount(harness.context);
    draw(layer, snapshot, undefined);
    return visible(harness.root, snapshot);
  } finally {
    layer.destroy();
    harness.root.closest('.gantt')?.remove();
  }
}

/** Fails with the first few nodes that only one side draws (a full diff can be enormous). */
function expectSame(drawn: readonly string[], wanted: readonly string[], step: Op): void {
  const have = new Set(drawn);
  const want = new Set(wanted);
  const extra = drawn.filter((line) => !want.has(line)).slice(0, 4);
  const missing = wanted.filter((line) => !have.has(line)).slice(0, 4);
  expect({ step, extra, missing, counts: [drawn.length, wanted.length] }).toEqual({
    step,
    extra: [],
    missing: [],
    counts: [wanted.length, wanted.length],
  });
}

/** Applies a history to a long-lived grid and compares it with a fresh one after each step. */
function replay(ops: readonly Op[]): void {
  const core = createTestCore();
  core.setViewport({ width: 800, height: 400 });
  let display: DisplayOptions = {};
  const persistent = createLayerHarness('grid', display);
  const layer = createGridLayer();
  try {
    layer.mount(persistent.context);
    let previous = core.getSnapshot();
    draw(layer, previous, undefined);

    for (const step of ops) {
      switch (step.kind) {
        case 'scroll':
          core.scroll({ left: step.left, top: step.top });
          break;
        case 'view':
          core.setViewMode(step.mode);
          break;
        case 'highlights':
          display = { ...display, highlightDays: HIGHLIGHTS[step.index] as never };
          break;
        case 'show':
          display = { ...display, highlights: step.highlights };
          break;
        case 'nonWorking':
          display = { ...display, nonWorkingDays: step.mode };
          break;
        case 'lines':
          display = { ...display, gridLines: step.mode };
          break;
        case 'today':
          display = { ...display, today: step.on };
          break;
        case 'stripes':
          display = { ...display, rowStripes: step.mode };
          break;
      }
      persistent.setDisplay(display);
      const snapshot = core.getSnapshot();
      draw(layer, snapshot, previous);
      previous = snapshot;
      expectSame(visible(persistent.root, snapshot), drawFresh(snapshot, display), step);
    }
  } finally {
    layer.destroy();
    core.destroy();
    document.body.replaceChildren();
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('grid layer: a long-lived layer shows in the viewport what a fresh one draws', () => {
  it('FR-UI-1 … FR-UI-4: after any history of scrolls, view modes and display options', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 14 }), (ops) => {
        replay(ops);
      }),
      { numRuns: 60 },
    );
  });

  it('FR-UI-3: highlights that fail, repeat an id or are malformed, scrolled and switched', () => {
    replay([
      { kind: 'highlights', index: 6 },
      { kind: 'scroll', left: 2500, top: 0 },
      { kind: 'highlights', index: 4 },
      { kind: 'scroll', left: 300, top: 0 },
      { kind: 'highlights', index: 5 },
      { kind: 'view', mode: 'week' },
      { kind: 'highlights', index: 7 },
      { kind: 'show', highlights: false },
      { kind: 'show', highlights: true },
    ]);
  });

  it('the oracle can tell: a day that is drawn in view and missing in a fresh grid is found', () => {
    const core = createTestCore();
    core.setViewport({ width: 800, height: 400 });
    const snapshot = core.getSnapshot();
    const display: DisplayOptions = { highlightDays: HIGHLIGHTS[2] as never };
    const harness = createLayerHarness('grid', display);
    const layer = createGridLayer();
    layer.mount(harness.context);
    layer.update(snapshot, undefined);

    expect(visible(harness.root, snapshot)).not.toEqual(drawFresh(snapshot, {}));
    layer.destroy();
    core.destroy();
  });
});

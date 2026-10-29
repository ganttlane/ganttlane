import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Task } from '../model';
import { VIEW_MODE_PRESETS } from '../scale';
import { DAY } from '../time';
import { VIEWPORT_DEFAULTS } from '../viewport';
import { createGanttCore, type GanttCore } from './index';

const TASKS: readonly Task[] = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-04-06', end: '2026-04-17' },
];
/** Far below the ±1 px of FR-TL-3: float rounding only. */
const ANCHOR_TOLERANCE_PX = 1e-3;
const CAP = 2 * VIEWPORT_DEFAULTS.maxWidth;

type Op =
  | { readonly kind: 'edge'; readonly side: 'start' | 'end' }
  | { readonly kind: 'scroll'; readonly at: number }
  | { readonly kind: 'view-mode'; readonly mode: number }
  | { readonly kind: 'zoom'; readonly pxPerDay: number; readonly anchor: number }
  | { readonly kind: 'resize'; readonly width: number }
  | { readonly kind: 'data'; readonly days: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({ kind: fc.constant('edge'), side: fc.constantFrom('start', 'end') }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('scroll'),
      at: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('view-mode'),
      mode: fc.integer({ min: 0, max: VIEW_MODE_PRESETS.length - 1 }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('zoom'),
      pxPerDay: fc.double({ min: 0.5, max: 2000, noNaN: true }),
      anchor: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('resize'),
      width: fc.integer({ min: 200, max: 3000 }),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('data'),
      days: fc.integer({ min: -4000, max: 4000 }),
    }),
    weight: 1,
  },
);

/** The exact date (not rounded to ms) at a viewport x. */
function dateAt(gantt: GanttCore, viewportX: number): number {
  const { range, scale, scrollLeft } = gantt.getSnapshot().timeline;
  return range.start + ((scrollLeft + viewportX) * DAY) / scale.pxPerDay;
}

/** The anchor moved by less than the tolerance, in px of the current zoom. */
function expectKept(gantt: GanttCore, viewportX: number, before: number, what: string): void {
  const { pxPerDay } = gantt.getSnapshot().timeline.scale;
  const drift = Math.abs(dateAt(gantt, viewportX) - before) * (pxPerDay / DAY);
  expect(drift, what).toBeLessThan(ANCHOR_TOLERANCE_PX);
}

/** The renderer: applies the scroll request of the snapshot, then reports the position. */
function applyRequest(gantt: GanttCore, seen: { id: number }): void {
  const request = gantt.getSnapshot().scrollRequest;
  if (request === undefined || request.id === seen.id) return;
  seen.id = request.id;
  const { contentWidth, timeline } = gantt.getSnapshot();
  if (request.left !== undefined) {
    expect(request.left).toBeGreaterThanOrEqual(0);
    expect(request.left).toBeLessThanOrEqual(Math.max(contentWidth - timeline.viewportWidth, 0));
    gantt.scroll({ left: request.left, top: 0 });
  }
}

function run(gantt: GanttCore, op: Op, seen: { id: number }, width: { value: number }): void {
  const vw = width.value;
  const { contentWidth } = gantt.getSnapshot();
  switch (op.kind) {
    case 'edge':
    case 'scroll': {
      const max = Math.max(contentWidth - vw, 0);
      const left = op.kind === 'scroll' ? op.at * max : op.side === 'start' ? 0 : max;
      const before = gantt.getSnapshot().timeline.scale.xToDate(left);
      const change = gantt.scroll({ left, top: 0 });
      // FR-TL-3: the date under the reported left edge stays put (content wider than the view).
      if (change !== undefined && contentWidth >= vw) {
        const drift = Math.abs(change.scale.dateToX(before) - change.scrollLeft);
        expect(drift, change.reason).toBeLessThan(1);
      }
      break;
    }
    case 'view-mode': {
      const anchor = dateAt(gantt, vw / 2);
      const id = VIEW_MODE_PRESETS[op.mode]!.id;
      const switched = gantt.getSnapshot().viewMode.id !== id;
      gantt.setViewMode(id);
      if (switched) expectKept(gantt, vw / 2, anchor, `view mode ${id}`);
      break;
    }
    case 'zoom': {
      const x = op.anchor * vw;
      const anchor = dateAt(gantt, x);
      gantt.zoomTo(op.pxPerDay, { anchor: x });
      expectKept(gantt, x, anchor, `zoom ${op.pxPerDay}`);
      break;
    }
    case 'resize':
      width.value = op.width;
      gantt.setViewport({ width: op.width, height: 400 });
      break;
    case 'data': {
      const left = dateAt(gantt, 0);
      const shift = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) + op.days * DAY;
      gantt.setTasks([
        ...TASKS,
        { id: 'c', name: 'C', start: shift('2026-03-02'), end: shift('2026-03-09') },
      ]);
      // The infinite timeline keeps its range for new data: the left edge date with it.
      expectKept(gantt, 0, left, 'data');
      break;
    }
  }
  applyRequest(gantt, seen);
}

describe('facade timeline properties', () => {
  it('FR-TL-3, FR-TL-4, FR-SCALE-6: any mix of scrolls, view modes, zooms, resizes and data keeps the anchors and the size cap', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 1, maxLength: 25 }),
        fc.constantFrom(undefined, '6mo', '5y'),
        (ops, maxSpan) => {
          const gantt = createGanttCore({
            tasks: TASKS,
            now: () => '2026-03-04',
            timeline: { infinite: maxSpan === undefined ? true : { maxSpan } },
            scroll: { initial: '2026-03-09' },
          });
          const width = { value: 800 };
          const seen = { id: 0 };
          gantt.setViewport({ width: width.value, height: 400 });
          applyRequest(gantt, seen);
          for (const op of ops) {
            run(gantt, op, seen, width);
            const { contentWidth, timeline } = gantt.getSnapshot();
            expect(contentWidth, op.kind).toBeLessThanOrEqual(CAP);
            expect(timeline.scrollLeft).toBeGreaterThanOrEqual(0);
            expect(timeline.scrollLeft).toBeLessThanOrEqual(
              Math.max(contentWidth - timeline.viewportWidth, 0) + 1e-6,
            );
          }
          gantt.destroy();
        },
      ),
      { numRuns: 150 },
    );
  });
});

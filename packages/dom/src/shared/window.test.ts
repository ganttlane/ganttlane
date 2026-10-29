import { createGanttCore, type GanttSnapshot } from '@ganttlane/core';
import { describe, expect, it } from 'vitest';

import { covers, same, spanOf, visibleTime } from './window';

/** A real snapshot of a 800 px wide chart, scrolled to the middle of a long range. */
function snapshot(scrollLeft = 640): GanttSnapshot {
  const core = createGanttCore({
    tasks: [
      { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
      { id: 'b', name: 'B', start: '2026-06-01', end: '2026-06-05' },
    ],
    now: () => '2026-03-04',
  });
  core.setViewport({ width: 800, height: 400 });
  core.scroll({ left: scrollLeft, top: 0 });
  const shown = core.getSnapshot();
  core.destroy();
  return shown;
}

describe('visibleTime', () => {
  it('NFR-PERF-3: is the virtualization window as dates, clipped to the content', () => {
    const shown = snapshot(640);
    const time = visibleTime(shown)!;
    const { scale } = shown.header;

    expect(scale.dateToX(time.start)).toBeCloseTo(Math.max(shown.window.left, 0), 6);
    expect(scale.dateToX(time.end)).toBeCloseTo(
      Math.min(shown.window.right, shown.contentWidth),
      6,
    );
  });

  it('never reaches past the left edge or the width of the content', () => {
    const start = snapshot(0);
    expect(start.window.left).toBeLessThanOrEqual(0);
    expect(start.header.scale.dateToX(visibleTime(start)!.start)).toBe(0);

    const end = snapshot(snapshot(0).contentWidth - 800);
    const time = visibleTime(end)!;
    expect(end.window.right).toBeGreaterThan(end.contentWidth);
    expect(end.header.scale.dateToX(time.end)).toBeLessThanOrEqual(end.contentWidth);
  });

  it('is undefined when the window lies outside the content', () => {
    const shown = snapshot();
    const outside = { ...shown, window: { ...shown.window, left: -300, right: -10 } };
    expect(visibleTime(outside)).toBeUndefined();
    const empty = { ...shown, window: { ...shown.window, left: 500, right: 500 } };
    expect(visibleTime(empty)).toBeUndefined();
  });
});

describe('spanOf and covers', () => {
  it('NFR-PERF-2: a scroll inside the drawn window is covered, no redraw is needed', () => {
    const drawn = snapshot(640);
    const span = spanOf(drawn);
    expect(span).toEqual({ left: drawn.window.left, right: drawn.window.right });

    expect(covers(span, drawn)).toBe(true);
    expect(covers(span, snapshot(650))).toBe(true);
  });

  it('NFR-PERF-3: a viewport near the edge of what was drawn is not covered', () => {
    const span = spanOf(snapshot(640));
    // The window overscans 400 px: half of that is the slack that has to remain.
    expect(covers(span, snapshot(640 + 250))).toBe(false);
    expect(covers(span, snapshot(640 - 250))).toBe(false);
  });

  it('nothing drawn yet is not covered', () => {
    expect(covers(undefined, snapshot())).toBe(false);
  });
});

describe('same', () => {
  it('compares field by field with ===', () => {
    const shared = { x: 1 };
    expect(same({ a: 1, b: shared }, { a: 1, b: shared })).toBe(true);
    expect(same({ a: 1, b: shared }, { a: 1, b: { x: 1 } })).toBe(false);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
  });
});

import type { GanttSnapshot, TimeRange } from '@ganttlane/core';

/**
 * The content pixels a drawn section covers, overscan included (not clipped to the content): what
 * a layer remembers of its last redraw, to tell with {@link covers} whether the next scroll still
 * fits in it.
 */
export interface DrawnSpan {
  /** Left edge of the drawn window in content px. */
  readonly left: number;
  /** Right edge of the drawn window in content px. */
  readonly right: number;
}

/**
 * The time a layer draws for a snapshot: the virtualization window (`snapshot.window`) clipped to
 * the content, because what lies outside the scrollable width is never drawn (it would extend
 * the scroller). `undefined` when nothing of the window is inside the content.
 *
 * @param snapshot - The snapshot to draw.
 * @returns The date range to generate cells, lines and days for.
 */
export function visibleTime(snapshot: GanttSnapshot): TimeRange | undefined {
  const left = Math.max(snapshot.window.left, 0);
  const right = Math.min(snapshot.window.right, snapshot.contentWidth);
  if (!(right > left)) return undefined;
  const { scale } = snapshot.header;
  return { start: scale.xToDate(left), end: scale.xToDate(right) };
}

/**
 * The span a redraw covers, as {@link covers} expects it.
 *
 * @param snapshot - The snapshot that is drawn.
 * @returns Its window.
 */
export function spanOf(snapshot: GanttSnapshot): DrawnSpan {
  return { left: snapshot.window.left, right: snapshot.window.right };
}

/**
 * Whether a drawn span still serves the viewport: the viewport is inside it by at least half of
 * an overscan on both sides, so that a fast scroll has slack before the next redraw lands. A
 * scroll that stays inside needs no redraw at all.
 *
 * @param span - What was drawn last; `undefined` when nothing was.
 * @param snapshot - The snapshot to draw now.
 * @returns `true` when the drawn nodes are enough.
 */
export function covers(span: DrawnSpan | undefined, snapshot: GanttSnapshot): boolean {
  if (span === undefined) return false;
  const { scrollLeft, viewportWidth } = snapshot.timeline;
  const margin = Math.max(scrollLeft - snapshot.window.left, 0) / 2;
  return span.left + margin <= scrollLeft && scrollLeft + viewportWidth + margin <= span.right;
}

/**
 * Whether every field of two input records is identical (`===`): the "inputs unchanged" test of
 * a layer that redraws a part only when what it was computed from changed.
 *
 * @param a - The inputs drawn last.
 * @param b - The inputs wanted now.
 * @returns `true` when nothing changed.
 */
export function same<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => a[key] === b[key]);
}

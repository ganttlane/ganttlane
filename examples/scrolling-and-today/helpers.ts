import type { DateRange } from '@ganttlane/dom';

const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Says what the chart shows: the dates at the left and right edges of the viewport, and where it
 * is scrolled to.
 *
 * @param range - What `getVisibleRange()` returns: `Date`s with the wall-clock time of the chart.
 * @param x - The horizontal offset `onScroll` reports, in px.
 * @param y - The vertical offset `onScroll` reports, in px.
 * @returns A sentence.
 */
export function describe(range: DateRange, x: number, y: number): string {
  return `Visible: ${day.format(range.start)} to ${day.format(range.end)} (scrolled ${String(Math.round(x))} px across, ${String(Math.round(y))} px down)`;
}

import type { DateRange } from '@ganttlane/dom';

const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_MS = 86_400_000;

/**
 * Says what the timeline is now: its first and last day, its length, and why it last changed, with
 * how often each kind of change has happened since the setting was chosen.
 *
 * @param range - What `onRangeChange` reports: `Date`s with the wall-clock time of the chart, the
 * end exclusive.
 * @param reason - Why the range changed (`'extend-start'`, `'extend-end'`, `'trim-end'`, …).
 * @param counts - How many times each reason has come up.
 * @returns A sentence.
 */
export function describe(
  range: DateRange,
  reason: string,
  counts: ReadonlyMap<string, number>,
): string {
  const days = Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS);
  const history = [...counts].map(([why, times]) => `${why} ×${String(times)}`).join(', ');
  return `Range: ${day.format(range.start)} to ${day.format(range.end)}, ${String(days)} days (last change: ${reason}${history === '' ? '' : `; so far ${history}`})`;
}

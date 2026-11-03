import type { GanttRow } from '@ganttlane/dom';

/** The view modes the toolbar offers. */
export const VIEW_MODES = ['day', 'week', 'month'] as const;

/** The themes the toolbar offers. */
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** What scrolls the rows: the chart itself, or one box around the list and the chart. */
export const HEIGHTS = ['fixed', 'auto'] as const;
export type HeightMode = (typeof HEIGHTS)[number];

/** The height of the chart when it scrolls itself; with `'auto'` the box around it does. */
export const CHART_HEIGHT = 400;

const dates = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * The dates of a row for the Dates column. The dates of a record are `Date`s with the task's own
 * wall clock, so they are read as local. A row without a bar has none.
 *
 * @param row - The row.
 * @returns `2 – 6 Mar`, or nothing.
 */
export function datesOf({ record }: GanttRow): string {
  const { start, end, type } = record;
  if (start === undefined || end === undefined) return '';
  return type === 'milestone' ? dates.format(start) : dates.formatRange(start, end);
}

/**
 * The columns, the same for both renderers. Text only, so it needs no `render`, which would be a
 * node in vanilla and a `ReactNode` in React.
 */
export const columns = [
  { id: 'name', header: 'Task' },
  { id: 'dates', header: 'Dates', width: 110, align: 'end', value: datesOf },
] as const;

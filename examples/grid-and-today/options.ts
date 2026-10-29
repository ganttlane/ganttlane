import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // A fixed "today", at noon, so that the today line is on the plan whenever you read this. An
  // application leaves `now` out: the chart then uses the clock.
  now: () => '2026-03-18T12:00',
  display: {
    // Which grid lines the body draws: 'both' (the default), 'vertical', 'horizontal' or 'none'.
    gridLines: 'both',
    // The today line, its marker in the header and the highlighted header cell. Default `true`.
    today: true,
    // Days off: 'fill' (the default), 'stripes' (a pattern), or false (not drawn).
    nonWorkingDays: 'fill',
    // The range of the hovered bar, highlighted in the header. Default `true`.
    headerRangeHighlight: true,
  },
  viewMode: 'week',
  // Shorter rows than the default (48 and 30 px), so that the whole plan is on the screen.
  layout: { rowHeight: 34, barHeight: 22 },
  // Open on the plan (today is on it, thanks to `now`).
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

const DAY = 86_400_000;

/**
 * A major line wherever a predicate says so: `majorLine` may be `{ unit }` (a line at the start of
 * every week, month, …), `false`, or a function of the start of a column, in floating milliseconds.
 * This one draws a line at midnight on every second Monday, a sprint: 1970-01-05 was a Monday, and
 * 2026-03-02 is a whole number of fortnights after it.
 */
const everySprint = (date: number): boolean =>
  date % DAY === 0 && (Math.floor(date / DAY) - 4) % 14 === 0;

/**
 * View modes replaced field by field: each mode keeps what it has (columns, headers, snap) and
 * takes the `majorLine` given here. A mode that is not named keeps its own (the month view's
 * lines are at quarters). `viewModes` is taken whole by `setOptions`.
 */
export const sprintLines = {
  day: { majorLine: everySprint },
  week: { majorLine: everySprint },
} satisfies NonNullable<GanttOptions['viewModes']>;

export const noLines = {
  day: { majorLine: false },
  week: { majorLine: false },
  month: { majorLine: false },
} satisfies NonNullable<GanttOptions['viewModes']>;

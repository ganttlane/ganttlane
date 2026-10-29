/**
 * The charts of the journeys. Weekends are not special (`calendar.weekends: []`), so one day to
 * the right is one calendar day and a drag of `n` days moves a task by exactly `n` days.
 */

/** Three five-day tasks in a row (Monday to Friday), a week apart. */
export const TASKS = [
  { id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'Beta', start: '2026-03-09', end: '2026-03-13' },
  { id: 'c', name: 'Gamma', start: '2026-03-16', end: '2026-03-20' },
] as const;

/** The chart of most journeys: 1000 px wide, opening on the first task, in the day view. */
export const PLAN = {
  tasks: TASKS,
  viewMode: 'day',
  calendar: { weekends: [] },
  today: '2026-03-04',
  scroll: { initial: 'first-task' },
  width: 1000,
} as const;

/** The same with a link from the first task to the second. */
export const LINKED = {
  ...PLAN,
  links: [{ source: 'a', target: 'b', type: 'FS' }],
} as const;

/** The id of the link `a → b` as the chart names it: `<source>:<type>:<target>`. */
export const LINK_A_B = 'a:FS:b';

/** A task half a year away from the others, which is not drawn until the chart scrolls to it. */
export const FAR_TASK = { id: 'z', name: 'Omega', start: '2026-09-07', end: '2026-09-11' } as const;

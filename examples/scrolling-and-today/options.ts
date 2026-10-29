import type { GanttOptions } from '@ganttlane/dom';

// What the controls of the example offer, and their types.
/** What `scroll.initial` takes here: four keywords, and a date (1 June). */
export const INITIALS = ['today', 'first-task', 'start', 'end', '2026-06-01'] as const;
/** What `scroll.align` takes: a side of the viewport (a fraction from 0 to 1 is valid too). */
export const ALIGNS = ['start', 'center', 'end'] as const;
/** What `scroll.behavior` takes (and 'auto', the browser's own). */
export const BEHAVIORS = ['smooth', 'instant'] as const;
export type Initial = (typeof INITIALS)[number];
export type Align = (typeof ALIGNS)[number];
export type Behavior = (typeof BEHAVIORS)[number];

export const options = {
  viewMode: 'week',
  // The source of "today": the system clock by default. It is pinned here so that the example
  // looks the same on every day (and so that "today" is inside this plan). Leave it out in an app.
  now: () => '2026-04-15',
  scroll: {
    // Where the chart opens, read when it is created: 'today' (the default), 'first-task', 'start'
    // or 'end' of the timeline, 'none', or a date such as '2026-06-01'.
    initial: 'today',
    // Where the target of a scroll lands in the viewport: 'start', 'center' (here), 'end', or a
    // fraction from 0 to 1. It also places the row of `scrollToTask` vertically.
    align: 'center',
    // How `scrollToToday`, `scrollToDate` and `scrollToTask` move: 'smooth' (the default),
    // 'instant' or 'auto' (the browser's own).
    behavior: 'smooth',
  },
  // The today line in the grid and its marker in the header (the default).
  display: { today: true },
} satisfies Partial<GanttOptions>;

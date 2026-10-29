import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Every day is a working day, so a milestone on a Saturday is not a conflict.
  calendar: { weekends: [] },
  // Compact rows, so that all twelve show.
  layout: { rowHeight: 34, barHeight: 22 },
  // One column a week: the whole plan fits.
  viewMode: 'week',
  scroll: {
    // Open on the plan; the default, 'today', is far from these dates.
    initial: 'first-task',
    // Where the first task lands in the chart, as a fraction of its width (default 0, the left
    // edge): a little in, so that the first diamond is not cut in half by the edge.
    align: 0.04,
  },
} satisfies Partial<GanttOptions>;

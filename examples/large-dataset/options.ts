import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'week',
  // Open on the plan, at its first task.
  scroll: { initial: 'first-task' },
  // Compact rows: more of the plan on the screen. The chart draws only the rows (and the bars,
  // links and days) that are in view, plus a few beyond, whatever the size of the plan.
  layout: { rowHeight: 28, barHeight: 18 },
} satisfies Partial<GanttOptions>;

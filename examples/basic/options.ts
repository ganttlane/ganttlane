import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline: 'hour', 'quarter-day', 'half-day', 'day', 'week' (here), 'month'
  // or 'year'. It can change later without recreating the chart.
  viewMode: 'week',
  // Open on the plan. The default is 'today', which for a plan in the past or the future is the
  // nearest end of its range.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

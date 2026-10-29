import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline. In `<Gantt>` it is a controlled prop, so `react.tsx` passes the one
  // your state holds (this value is where the state starts).
  viewMode: 'week',
  // Rows and bars a little smaller than the default, so that the plan and its inspector fit.
  layout: { rowHeight: 36, barHeight: 22 },
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

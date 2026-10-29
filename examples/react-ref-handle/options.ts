import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline. (<Gantt> takes it as `viewMode`, controlled, or as
  // `defaultViewMode`, which the chart then owns: see `react.tsx`.)
  viewMode: 'day',
  // Record every change, so that `undo()` and `redo()` have something to step through.
  history: true,
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

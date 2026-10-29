import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline. (`useGantt` takes it as `viewMode`, controlled, or as
  // `defaultViewMode`, which the chart then owns: see `react.tsx`.)
  viewMode: 'week',
  // Record every change, so that `canUndo` and `canRedo` have something to say.
  history: true,
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

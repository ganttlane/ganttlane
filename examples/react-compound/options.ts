import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The scale of the timeline. (`GanttRoot` takes it as `viewMode`, controlled, or as
  // `defaultViewMode`, which the chart then owns: see `react.tsx`.)
  viewMode: 'week',
  // Record every change, so that the toolbar's Undo and Redo have something to undo.
  history: true,
  // A click on a bar selects it: the panel follows the selected task.
  selection: { onClick: true, clearOnEmptyClick: true },
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

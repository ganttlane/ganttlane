import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all eight rows are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Undo and redo. They are off by default. `true` turns them on and keeps the last 100 actions;
  // an object sets `limit`, the most actions kept (the oldest go first). Here: the last five, so
  // that the limit is easy to reach. The example changes it with `setOptions({ history })`.
  history: { limit: 5 },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all seven tasks are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

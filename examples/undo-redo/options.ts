import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Undo and redo. They are off by default. `true` turns them on and keeps the last 100 actions;
  // an object sets `limit`, the most actions kept (the oldest go first). Here: the last five, so
  // that the limit is easy to reach. The example changes it with `setOptions({ history })`.
  history: { limit: 5 },
  // The keys: Ctrl or Cmd + Z undoes and Ctrl or Cmd + Shift + Z (or Ctrl + Y) redoes, while the
  // focus is on a bar (`barFocus` lets the bars take it) or on the chart. Off by default too.
  keyboard: { barFocus: true, undo: true },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all seven tasks are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

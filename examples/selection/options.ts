import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // A click selects the bar; Ctrl or Cmd adds it or takes it out, and the keys reach the bars.
  selection: { onClick: true, multiple: true },
  keyboard: { barFocus: true },
  // Smaller rows, so that all eight rows are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

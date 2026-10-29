import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // `historyChange` is only emitted when the history is on (it is off by default).
  history: true,
  // The timeline reaches beyond the plan on both sides: scroll the chart sideways for `scroll`.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all rows are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

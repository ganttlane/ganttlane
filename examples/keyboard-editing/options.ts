import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'day',
  scroll: { initial: 'first-task' },
  calendar: { weekends: [0, 6] },
  // The bars take the focus, the arrows edit the one that has it, and a click selects.
  keyboard: { barFocus: true, edit: true, announce: true },
  selection: { onClick: true },
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

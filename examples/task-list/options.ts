import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // One column a week: the plan is a few screens wide, so the chart scrolls sideways.
  viewMode: 'week',
  // Every day is a working day, so a bar dropped on a weekend is no conflict to explain.
  calendar: { weekends: [] },
  // A click on a bar selects it, and a click on empty space clears the selection: the list shows it.
  selection: { onClick: true, clearOnEmptyClick: true },
  layout: { rowHeight: 36, barHeight: 22, headerRowHeight: 28 },
  // Zebra stripes for each group with its children; the list draws the same.
  display: { rowStripes: 'group' },
  timeline: { padding: '0d' },
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

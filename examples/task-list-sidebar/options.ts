import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // One column a week: the plan is a few screens wide, so the chart scrolls sideways.
  viewMode: 'week',
  // Every day is a working day, so a bar dropped on a weekend is no conflict to explain.
  calendar: { weekends: [] },
  layout: {
    // The chart is as tall as its rows and does not scroll vertically itself: the box that holds
    // the list and the chart does, so the two move as one. The renderer finds that box (the
    // nearest ancestor that scrolls) and keeps the header stuck to the top of it.
    height: 'auto',
    // The list draws its rows from these (`getRowMetrics`, `snapshot.layoutOptions`), so they can
    // change later with `setOptions({ layout })` and the two still line up.
    rowHeight: 36,
    barHeight: 22,
    headerRowHeight: 28,
  },
  // Zebra stripes for each group with its children; the list draws the same bands.
  display: { rowStripes: 'group' },
  timeline: { padding: '0d' },
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

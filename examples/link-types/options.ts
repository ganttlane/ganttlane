import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Every day is a working day, so no weekend fill and no weekend conflicts: here the only thing
  // that moves a bar is a link.
  calendar: { weekends: [] },
  scheduling: {
    // The type of a link that does not name one: 'FS' (the default), 'SS', 'FF' or 'SF'. It is
    // read when the data is loaded and again whenever it changes, so the select above the chart
    // can change it without recreating the chart.
    defaultLinkType: 'FS',
  },
  display: {
    // The largest radius, in px, of the rounded corners of a link's route. The default is 5;
    // 0 draws square corners.
    linkCurveRadius: 10,
  },
  // Compact rows, so that all ten show.
  layout: { rowHeight: 36, barHeight: 22 },
  // Open on the plan; the default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

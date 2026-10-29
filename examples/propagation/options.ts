import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Every day is a working day, so the only conflicts are about links.
  calendar: { weekends: [] },
  scheduling: {
    // What an edit does to the tasks linked to it:
    //   'preserve-lag'  the tasks after it move too, so that every link keeps its lag (default);
    //   'none'          only the task you edit moves: the links are drawn, and checked.
    // The select above the chart changes it with `setOptions`, without recreating the chart.
    propagation: 'preserve-lag',
  },
  // One column a week: the whole plan fits.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

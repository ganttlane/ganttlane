import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The tooltip of a task. Its `render` function is in `vanilla.ts` (`tooltip.render`) and in
  // `react.tsx` (the `renderTooltip` prop); what it says comes from `helpers.ts`.
  tooltip: {
    delay: 100, // ms before a hovered bar shows it
    placement: 'bottom', // it flips by itself when there is no room
  },
  scheduling: {
    // What an edit does to the tasks after it:
    //   'preserve-lag'  they move too, so that every link keeps its lag (default);
    //   'none'          only the task you edit moves, and the gaps change.
    // The select above the chart changes it with `setOptions`.
    propagation: 'preserve-lag',
  },
  // One column a week, a day is 20 px and a drag snaps to days: the whole plan fits.
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

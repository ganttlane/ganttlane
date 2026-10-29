import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // The tooltip of a task. Its `render` function is what the example is about: it is in
  // `vanilla.ts` (`tooltip.render`) and in `react.tsx` (the `renderTooltip` prop).
  tooltip: {
    trigger: 'hover', // or 'click': then it stays open, so that its buttons can be reached
    delay: 100, // ms before a hovered bar shows it
    placement: 'bottom', // it flips by itself when there is no room
  },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

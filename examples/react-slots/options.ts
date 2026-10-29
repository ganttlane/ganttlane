import type { GanttOptions } from '@ganttlane/dom';

import type { Meta } from './data';

export const options = {
  // The scale of the timeline. (<Gantt> takes it as `viewMode`, controlled, or as
  // `defaultViewMode`, which the chart then owns: see `react.tsx`.)
  viewMode: 'week',
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },
  // A click opens the tooltip and keeps it open, so that the buttons in it can be pressed. The
  // default, 'hover', is for reading: a hover tooltip takes no pointer events.
  tooltip: { trigger: 'click' },
  // The chart does not measure what React draws, so it cannot tell if a React label fits in its
  // bar: 'auto' would always put it inside. 'inside' says so; 'outside' is the other choice.
  display: { barLabel: 'inside' },
} satisfies Partial<GanttOptions<Meta>>;

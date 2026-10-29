import type { GanttOptions } from '@ganttlane/dom';

import type { Meta } from './data';

export const options = {
  // Zebra stripes: 'row' (every other row), 'group' (every other parent with its children), or
  // false (none, the default). A task's `rowClassName` paints over a stripe.
  display: { rowStripes: 'group' },
  // Shorter rows than the default (48 px), so that the whole plan is on the screen.
  layout: { rowHeight: 34, barHeight: 20 },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions<Meta>>;

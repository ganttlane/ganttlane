import type { GanttOptions } from '@ganttlane/dom';

import type { Meta } from './data';

export const options = {
  display: {
    // Where a bar's label goes: 'inside', 'outside', 'none', or 'auto' (the default), which puts
    // it inside when it fits and outside when it does not. The select in the example changes it.
    barLabel: 'auto',
    // What the label says is `display.renderBarLabel` (vanilla.ts) or the `renderBarLabel` prop
    // (react.tsx). Left out, a label is the name of the task.
  },
  // A little shorter than the defaults (48 and 30 px), room enough for an avatar of 16 px.
  layout: { rowHeight: 34, barHeight: 22 },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions<Meta>>;

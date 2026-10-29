import type { GanttOptions } from '@ganttlane/dom';

// The hooks themselves (`onBeforeTaskChange` and `onBeforeLinkCreate`) are in `hooks.ts`: they
// need the example's state, which the select and the checkbox change.
export const options = {
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all eight tasks are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // What the user may do with the mouse. `true` (the default) allows everything, `false` makes
  // the chart read-only, and an object turns single kinds of edit on and off; a flag left out
  // is on. The example switches it with `setOptions({ editing })`.
  editing: { move: true, resize: true, progress: true, links: true },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that all eight tasks are in view at once.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

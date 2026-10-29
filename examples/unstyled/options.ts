import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // A fixed "today", so that the today line is on the plan whenever you read this. An application
  // leaves `now` out.
  now: () => '2026-03-18',
  // The renderer writes the sizes of rows and bars into the SVG, so a stylesheet does not set them.
  layout: { rowHeight: 36, barHeight: 22 },
  display: {
    // Zebra stripes per phase with its children: `data-stripe` on the row.
    rowStripes: 'group',
    // Days off as a pattern: the renderer defines it, the stylesheet colours its lines. (The
    // default, 'fill', is a plain rectangle that the stylesheet fills.)
    nonWorkingDays: 'stripes',
  },
} satisfies Partial<GanttOptions>;

import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  viewMode: 'week',
  // Sizes in px. Each one can be changed later with `setOptions({ layout: { … } })`.
  layout: {
    // The height of a task's row: the room for its bar and the space around it (default 48).
    rowHeight: 48,
    // The height of a bar, centred in its row (default 30, or the row's height when that is less).
    // A bar cannot be taller than its row: a taller `barHeight` is clamped, with a warning.
    barHeight: 30,
    // The corner radius of a bar (default 3). Each bar limits it to half its own height and width.
    barRadius: 3,
    // The height of every header row (one number), or one number per row, top first (the default
    // is [45, 30]; a row with no number of its own is 30).
    headerRowHeight: 40,
    // The height of the chart itself, which only the renderer knows: a number of px, and the chart
    // scrolls inside that; 'auto', and the chart is as tall as its rows and the page scrolls it;
    // left out, and the chart fills its container.
    height: 300,
  },
  // No timeline before the first task, so the chart opens at the left end of its timeline (the
  // default padding of the week view is '4w').
  timeline: { padding: '0d' },
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  scheduling: {
    // Whether the progress handle skips the days off: a boundary dragged onto a weekend or a
    // holiday jumps to the edge of it, in the direction of the drag (default `true`). The box
    // above the chart changes it. It matters for the tasks that count calendar days: in a task
    // that counts working days the boundary never rests on a day off anyway.
    skipNonWorkingDays: { progress: true },
  },
  // A narrower day column than the default 40 px, so that the whole plan fits.
  viewModes: { day: { pxPerDay: 30 } },
  scroll: {
    // Open on the plan; the default, 'today', is far from these dates.
    initial: 'first-task',
    // Where the first task lands, as a fraction of the width of the chart (default 0, the left
    // edge). A drag near an edge of the chart scrolls it, so the bars get a margin to be dragged
    // by their left edges.
    align: 0.08,
  },
} satisfies Partial<GanttOptions>;

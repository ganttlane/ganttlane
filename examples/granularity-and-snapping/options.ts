import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  scheduling: {
    // The data step: every date, duration and lag of a task is a multiple of it. A duration that
    // divides 24 hours: '1min', '15min', '1h', '1d' (the default), … The first select changes it.
    granularity: '15min',
    // What to do with a value that is not a multiple of it. It is always reported as a
    // `misaligned` issue, and then: 'expand' (the default) aligns a start down and an end up, so
    // the task only grows; 'nearest' aligns to the closest step; 'reject' keeps the task out of
    // the chart (a row without a bar). The second select changes it.
    alignInput: 'expand',
    // `snap`, the step a drag snaps to, is left out: the step of the view mode is used ('15min'
    // in 'hour', '1h' in 'quarter-day' and 'half-day', '1d' in 'day', 'week' and 'month'). The
    // third select sets it: a duration, 'unit' (the column) or `false` (no snapping).
  },
  // 6-hour columns, which snap to an hour; the buttons switch to 'hour' and 'day'.
  viewMode: 'quarter-day',
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

import type { GanttOptions } from '@ganttlane/dom';

import type { Meta } from './data';
import { describe } from './helpers';

export const options = {
  // The scale of the timeline. The select also offers the half-day and quarter-day scales, where
  // the times of day of the timed tasks can be read.
  viewMode: 'day',
  // Open on the plan. The default, 'today', is far from these dates.
  scroll: { initial: 'first-task' },

  // Every date, duration and lag is a multiple of the granularity. The default, '1d', would report
  // the timed tasks (`'2026-03-23T09:00'`) as `misaligned` and round them to midnight: one hour
  // lets them be what they are. Tasks given as whole days stay on whole days.
  scheduling: { granularity: '1h' },
  // What a date-only `end` means. `true` (the default): the last day of the task. `false`: the day
  // after it, so that '2026-03-20' ends the task when 19 March is over. The checkbox flips it.
  dates: { endInclusive: true },

  // Smaller rows, so that all fourteen fit. Labels go beside the bars.
  layout: { rowHeight: 28, barHeight: 18 },
  display: { barLabel: 'outside' },

  tooltip: {
    // `record.task` is the task as given, with its own typed `data` (`Meta`); the rest of the
    // record is what the chart made of it.
    render: ({ task: record }) => ({
      title: record.name,
      subtitle: describe(record),
      details: record.task.data?.note,
    }),
  },
} satisfies Partial<GanttOptions<Meta>>;

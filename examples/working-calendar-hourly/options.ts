import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Which days are working days: Monday to Friday, and one named holiday.
  calendar: {
    weekends: [0, 6], // the default: Sunday and Saturday
    holidays: [{ date: '2026-03-10', name: 'Office closed' }], // the name shows when hovering the day
  },
  scheduling: {
    // The data step: every date, duration and lag is a whole number of hours.
    // (`10:30` is reported as a `misaligned` issue, and aligned.)
    granularity: '1h',
    // A duration counts working time only, for every task (a task can say 'calendar').
    durationMode: 'working',
    // Drags land on working days. `move` is on by default, `resize` is not.
    skipNonWorkingDays: { move: true, resize: true },
  },
  // How days off are drawn: 'fill' (default), 'stripes' or false.
  display: { nonWorkingDays: 'stripes' },
  // 6-hour columns; try 'hour' to see the individual hours.
  viewMode: 'quarter-day',
  scroll: { initial: 'first-task' },

  // Ask before a bar ends up on a day off. Returning false cancels the change; a promise works too.
  onBeforeTaskChange: ({ conflicts }) => {
    const dayOff = conflicts.some(
      (conflict) => conflict.type === 'non-working-start' || conflict.type === 'non-working-end',
    );
    return dayOff ? window.confirm('This lands on a day off. Keep it?') : true;
  },
  // Problems with the data or the options are reported, never thrown.
  onIssues: ({ source, issues }) => {
    for (const issue of issues) console.warn(source, issue.code, issue.path, issue.suggested);
  },
} satisfies Partial<GanttOptions>;

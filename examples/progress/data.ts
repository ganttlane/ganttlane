import type { Link, Task } from '@ganttlane/core';

// 2026-03-09 is a Monday: Build crosses a weekend (14 and 15 March). Progress is a percentage of
// the length of the task, `0` to `100`; a task without `progress` has none done.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 100 },

  // The same bar twice, with the same 50 % done, to compare what a resize does to the progress.
  // `progressAnchor` says what a resize keeps: the part that is done (`'start'`, the default) or
  // the part that is left (`'end'`).
  {
    id: 'build-start',
    name: 'Build · anchor start',
    start: '2026-03-09',
    end: '2026-03-20',
    progress: 50,
  },
  {
    id: 'build-end',
    name: 'Build · anchor end',
    start: '2026-03-09',
    end: '2026-03-20',
    progress: 50,
    progressAnchor: 'end',
  },

  // The done part is painted in the task's own colour (`--gantt-bar-progress-color`).
  {
    id: 'review',
    name: 'Review',
    start: '2026-03-16',
    end: '2026-03-20',
    progress: 60,
    progressColor: '#e8590c',
  },

  // Counted in working days: the weekend is not part of the length, so its progress is not either.
  {
    id: 'qa',
    name: 'QA',
    start: '2026-03-18',
    duration: 7,
    durationMode: 'working',
    progress: 40,
  },

  { id: 'launch', name: 'Launch', start: '2026-03-23', end: '2026-03-27' },
];

export const links: Link[] = [];

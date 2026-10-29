import type { Link, Task } from '@ganttlane/core';

// A chain of four tasks and a fifth beside it. 2026-03-02 is a Monday; a task with an `end` ends on
// that day (inclusive), and the milestone has just a `start`.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  // Starts a day after Design ends (the lag of the first link).
  { id: 'build', name: 'Build', start: '2026-03-08', end: '2026-03-14' },
  // Starts two days after Build starts. Its link has no lag, so it keeps the gap it has now.
  { id: 'docs', name: 'Docs', start: '2026-03-10', end: '2026-03-16' },
  // Starts the day Build ends.
  { id: 'review', name: 'Review', start: '2026-03-15', end: '2026-03-17' },
  // Two days after Review ends.
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-03-20' },
];

export const links: Link[] = [
  { source: 'design', target: 'build', lag: 1 }, // finish-to-start, the default type
  { source: 'build', target: 'docs', type: 'SS' }, // no lag: the gap it has when the data is loaded
  { source: 'build', target: 'review', lag: 0 },
  { source: 'review', target: 'release', lag: 2 },
];

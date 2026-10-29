import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. A task with an `end` ends on that day (inclusive); a task with a
// `duration` lasts that many days.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 10 },
  { id: 'qa', name: 'QA', start: '2026-03-23', duration: 5 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-30' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' }, // finish-to-start, the default type
  { source: 'build', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

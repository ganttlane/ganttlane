import type { Link, Task } from '@ganttlane/core';

// The starting point of the application's own state: the chart never changes these arrays.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  { id: 'qa', name: 'QA', start: '2026-03-23', duration: 5 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-30' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

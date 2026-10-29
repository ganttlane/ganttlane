import type { Link, Task } from '@ganttlane/core';

// The plan as the server last saved it. Dependent tasks keep following their predecessors, so one
// drag of Design moves Build and QA as well.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  { id: 'qa', name: 'QA', start: '2026-03-23', duration: 5 },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
];

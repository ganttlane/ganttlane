import type { Link, Task } from '@ganttlane/core';

export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 25 },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-27' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
];

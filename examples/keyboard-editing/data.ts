import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday.
export const tasks: Task[] = [
  { id: 'brief', name: 'Brief', start: '2026-03-02', end: '2026-03-04', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-05', end: '2026-03-11', progress: 80 },
  { id: 'build', name: 'Build', start: '2026-03-12', end: '2026-03-20', progress: 30 },
  // Locked: the arrow keys leave it to the chart, which scrolls.
  { id: 'review', name: 'Review', start: '2026-03-12', end: '2026-03-18', locked: true },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-25' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-26' },
];

export const links: Link[] = [
  { source: 'brief', target: 'design' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Nine tasks over seven weeks: more than the chart shows at once, on both
// axes, so that the scroll buttons have somewhere to go.
export const tasks: Task[] = [
  { id: 'research', name: 'Research', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-16', end: '2026-03-27', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-23', duration: 5 },
  { id: 'review', name: 'Review', start: '2026-03-30', end: '2026-04-03' },
  { id: 'qa', name: 'QA', start: '2026-04-06', end: '2026-04-10' },
  { id: 'marketing', name: 'Marketing', start: '2026-04-06', end: '2026-04-17' },
  { id: 'support', name: 'Support', start: '2026-04-13', end: '2026-04-17' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-20' },
];

export const links: Link[] = [
  { source: 'research', target: 'design' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'review' },
  { source: 'docs', target: 'review' },
  { source: 'review', target: 'qa' },
  { source: 'qa', target: 'support' },
  { source: 'support', target: 'launch' },
  { source: 'marketing', target: 'launch' },
];

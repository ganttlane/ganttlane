import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Drag a few bars, draw a link, then undo them one by one.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'api', name: 'API', start: '2026-03-09', end: '2026-03-13', progress: 50 },
  { id: 'ui', name: 'UI', start: '2026-03-09', end: '2026-03-17', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-19' },
  { id: 'qa', name: 'QA', start: '2026-03-18', end: '2026-03-20' },
  { id: 'review', name: 'Review', start: '2026-03-23', end: '2026-03-24' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-25' },
];

export const links: Link[] = [
  { source: 'design', target: 'api' },
  { source: 'design', target: 'ui' },
  { source: 'api', target: 'qa' },
  { source: 'ui', target: 'qa' },
  { source: 'qa', target: 'review' },
  { source: 'review', target: 'launch' },
];

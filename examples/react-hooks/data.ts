import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday.
export const tasks: Task[] = [
  { id: 'brief', name: 'Brief', start: '2026-03-02', end: '2026-03-04', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-05', end: '2026-03-13', progress: 70 },
  { id: 'backend', name: 'Backend', start: '2026-03-16', end: '2026-03-27', progress: 40 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-16', end: '2026-04-03', progress: 20 },
  { id: 'docs', name: 'Docs', start: '2026-03-30', end: '2026-04-03' },
  { id: 'qa', name: 'QA', start: '2026-04-06', end: '2026-04-10' },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-04-13' },
];

export const links: Link[] = [
  { source: 'brief', target: 'design' },
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'qa' },
  { source: 'frontend', target: 'qa' },
  { source: 'docs', target: 'qa' },
  { source: 'qa', target: 'release' },
];

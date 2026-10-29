import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. The tasks last 1, 3, 12, 5 and 2 working days, so that the tooltip's
// "working days" line meets the plural forms of a language: Ukrainian says "1 робочий день",
// "3 робочі дні" and "5 робочих днів" (and "12 робочих днів").
export const tasks: Task[] = [
  { id: 'brief', name: 'Brief', start: '2026-03-02', end: '2026-03-02', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-03', end: '2026-03-05', progress: 100 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-24', progress: 35 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-20', progress: 60 },
  { id: 'review', name: 'Review', start: '2026-03-25', end: '2026-03-26', progress: 0 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-27' },
];

export const links: Link[] = [
  { source: 'brief', target: 'design' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'docs', type: 'SS' },
  { source: 'build', target: 'review' },
  { source: 'review', target: 'launch' },
];

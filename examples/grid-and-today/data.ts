import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Four weeks of work around a fixed "today" (2026-03-18, see
// `options.ts`), so the today line crosses the middle of the plan and the weekends show.
export const tasks: Task[] = [
  { id: 'research', name: 'Research', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 90 },
  { id: 'backend', name: 'Backend', start: '2026-03-12', end: '2026-03-24', progress: 55 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-16', end: '2026-03-25', progress: 25 },
  { id: 'docs', name: 'Docs', start: '2026-03-18', end: '2026-03-24', progress: 10 },
  { id: 'review', name: 'Review', start: '2026-03-26', end: '2026-03-27', progress: 0 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-30' },
];

export const links: Link[] = [
  { source: 'research', target: 'design' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'review' },
  { source: 'frontend', target: 'review' },
  { source: 'review', target: 'launch' },
];

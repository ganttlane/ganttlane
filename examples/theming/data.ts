import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. A short plan with a spread of progress, a milestone and weekends, so
// that bars, progress, links, rows, days off, the today line and a highlighted day all show the
// tokens of a theme.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-03-09', end: '2026-03-20', progress: 65 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-11', end: '2026-03-24', progress: 40 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-20', progress: 20 },
  { id: 'review', name: 'Review', start: '2026-03-25', end: '2026-03-26', progress: 0 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-27' },
];

export const links: Link[] = [
  { source: 'design', target: 'backend' },
  { source: 'backend', target: 'frontend', type: 'SS' }, // start to start
  { source: 'frontend', target: 'review' },
  { source: 'docs', target: 'review' },
  { source: 'review', target: 'launch' },
];

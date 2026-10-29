import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Docs and Review have no links yet: draw some.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'api', name: 'API', start: '2026-03-09', end: '2026-03-13', progress: 60 },
  { id: 'ui', name: 'UI', start: '2026-03-09', end: '2026-03-17', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-19' },
  { id: 'integrate', name: 'Integrate', start: '2026-03-18', end: '2026-03-24' },
  { id: 'qa', name: 'QA', start: '2026-03-25', end: '2026-03-27' },
  { id: 'review', name: 'Review', start: '2026-03-30', end: '2026-03-31' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-01' },
];

export const links: Link[] = [
  { source: 'design', target: 'api' },
  { source: 'design', target: 'ui' },
  { source: 'api', target: 'integrate' },
  { source: 'ui', target: 'integrate' },
  { source: 'integrate', target: 'qa' },
  // `editable: false`: the menu of this link does not offer to remove it (the click still selects).
  { source: 'qa', target: 'launch', editable: false },
];

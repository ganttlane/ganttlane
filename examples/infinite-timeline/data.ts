import type { Link, Task } from '@ganttlane/core';

// Ten tasks in one quarter. The plan is short on purpose: the chart is about what happens when you
// scroll past its end.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-13', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-03-16', end: '2026-04-10', progress: 70 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-23', end: '2026-04-17', progress: 50 },
  { id: 'docs', name: 'Docs', start: '2026-04-06', end: '2026-04-24', progress: 20 },
  { id: 'review', name: 'Review', start: '2026-04-20', end: '2026-04-24' },
  { id: 'qa', name: 'QA', start: '2026-04-27', end: '2026-05-08' },
  { id: 'beta', name: 'Beta', start: '2026-05-11', end: '2026-05-22' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-05-25' },
  { id: 'marketing', name: 'Marketing', start: '2026-04-13', end: '2026-05-29' },
  { id: 'monitor', name: 'Monitor', start: '2026-05-26', end: '2026-06-12' },
];

export const links: Link[] = [
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'review' },
  { source: 'frontend', target: 'review' },
  { source: 'review', target: 'qa' },
  { source: 'qa', target: 'beta' },
  { source: 'beta', target: 'launch' },
  { source: 'launch', target: 'monitor' },
];

import type { Link, Task } from '@ganttlane/core';

// Ten tasks in March 2026: enough rows to be taller than the chart, bars of different lengths,
// progress (the filled part of a bar follows its corners), and a milestone.
export const tasks: Task[] = [
  { id: 'discovery', name: 'Discovery', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 100 },
  { id: 'prototype', name: 'Prototype', start: '2026-03-12', end: '2026-03-20', progress: 70 },
  { id: 'backend', name: 'Backend', start: '2026-03-16', end: '2026-03-31', progress: 40 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-23', end: '2026-04-07', progress: 25 },
  { id: 'docs', name: 'Docs', start: '2026-03-23', end: '2026-04-03', progress: 10 },
  { id: 'marketing', name: 'Marketing', start: '2026-03-30', end: '2026-04-10' },
  { id: 'qa', name: 'QA', start: '2026-04-08', end: '2026-04-14' },
  { id: 'review', name: 'Review', start: '2026-04-15', end: '2026-04-16' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-20' },
];

export const links: Link[] = [
  { source: 'discovery', target: 'design' },
  { source: 'design', target: 'prototype' },
  { source: 'prototype', target: 'backend' },
  { source: 'prototype', target: 'frontend' },
  { source: 'backend', target: 'qa' },
  { source: 'frontend', target: 'qa' },
  { source: 'qa', target: 'review' },
  { source: 'review', target: 'launch' },
];

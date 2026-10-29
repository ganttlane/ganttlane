import type { Link, Task } from '@ganttlane/core';

// March 2026 (the 2nd is a Monday), a plan of eight tasks. The days marked in `options.ts` (an
// offsite, two demo days, a code freeze, the Fridays and a holiday on Friday the 20th) fall in the
// middle of it. No task starts or ends on the holiday: that would be a scheduling conflict, which
// the chart draws on the bar.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'prototype', name: 'Prototype', start: '2026-03-09', end: '2026-03-13', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-03-09', end: '2026-03-19', progress: 60 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-16', end: '2026-03-27', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-27', progress: 20 },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-27' },
  { id: 'review', name: 'Review', start: '2026-03-30', end: '2026-03-30' },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-03-31' },
];

export const links: Link[] = [
  { source: 'design', target: 'prototype' },
  { source: 'design', target: 'backend' },
  { source: 'prototype', target: 'frontend' },
  { source: 'backend', target: 'qa' },
  { source: 'qa', target: 'review' },
  { source: 'frontend', target: 'review' },
  { source: 'docs', target: 'review' },
  { source: 'review', target: 'release' },
];

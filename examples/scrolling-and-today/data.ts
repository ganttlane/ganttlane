import type { Link, Task } from '@ganttlane/core';

// Fourteen tasks from February to July 2026: wide enough to scroll in both directions, and tall
// enough that scrolling to a task moves the rows too. "Today" is pinned to 15 April (see
// `options.ts`), which is in the middle of the plan.
export const tasks: Task[] = [
  { id: 'discovery', name: 'Discovery', start: '2026-02-02', end: '2026-02-13', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-02-16', end: '2026-03-06', progress: 100 },
  { id: 'prototype', name: 'Prototype', start: '2026-03-09', end: '2026-03-20', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-03-23', end: '2026-04-24', progress: 60 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-23', end: '2026-05-08', progress: 40 },
  { id: 'docs', name: 'Docs', start: '2026-04-13', end: '2026-05-15', progress: 15 },
  { id: 'review', name: 'Review', start: '2026-05-11', end: '2026-05-22' },
  { id: 'qa', name: 'QA', start: '2026-05-25', end: '2026-06-05' },
  { id: 'beta', name: 'Beta', start: '2026-06-08', end: '2026-06-19' },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-06-22' },
  { id: 'launch', name: 'Launch', start: '2026-06-23', end: '2026-06-26' },
  { id: 'retro', name: 'Retrospective', start: '2026-06-29', end: '2026-07-03' },

  { id: 'marketing', name: 'Marketing', start: '2026-04-27', end: '2026-06-19' },
  { id: 'hiring', name: 'Hiring', start: '2026-02-16', end: '2026-07-03', progress: 35 },
];

export const links: Link[] = [
  { source: 'discovery', target: 'design' },
  { source: 'design', target: 'prototype' },
  { source: 'prototype', target: 'backend' },
  { source: 'prototype', target: 'frontend' },
  { source: 'backend', target: 'review' },
  { source: 'frontend', target: 'review' },
  { source: 'docs', target: 'review' },
  { source: 'review', target: 'qa' },
  { source: 'qa', target: 'beta' },
  { source: 'beta', target: 'release' },
  { source: 'release', target: 'launch' },
  { source: 'launch', target: 'retro' },
];

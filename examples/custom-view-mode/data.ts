import type { Link, Task } from '@ganttlane/core';

// The team works in two-week sprints that start on a Monday: sprint 5 is 9 to 20 March, sprint 6
// 23 March to 3 April, and so on. Most tasks fill whole sprints; the three long ones (a platform
// programme, a marketing push and hiring) are what the quarter view is for.
export const tasks: Task[] = [
  { id: 'discovery', name: 'Discovery', start: '2026-03-09', end: '2026-03-20', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-23', end: '2026-04-03', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-04-06', end: '2026-04-17', progress: 70 },
  { id: 'frontend', name: 'Frontend', start: '2026-04-06', end: '2026-05-01', progress: 40 },
  { id: 'docs', name: 'Docs', start: '2026-04-20', end: '2026-05-01', progress: 10 },
  { id: 'review', name: 'Review', start: '2026-05-04', end: '2026-05-15' },
  { id: 'qa', name: 'QA', start: '2026-05-18', end: '2026-05-29' },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-06-01' },

  { id: 'platform', name: 'Platform programme', start: '2026-03-09', end: '2026-07-10' },
  { id: 'marketing', name: 'Marketing push', start: '2026-04-20', end: '2026-06-26' },
  { id: 'hiring', name: 'Hiring', start: '2026-03-09', end: '2026-08-28', progress: 30 },
];

export const links: Link[] = [
  { source: 'discovery', target: 'design' },
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'review' },
  { source: 'frontend', target: 'review' },
  { source: 'docs', target: 'review' },
  { source: 'review', target: 'qa' },
  { source: 'qa', target: 'release' },
];

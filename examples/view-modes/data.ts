import type { Link, Task } from '@ganttlane/core';

// 2026-03-30 is a Monday. A bare date is a whole day (an `end` is the last day, inclusive); a date
// with a time is a timed task. So the plan has two scales in it: days of work, and launch day
// (Tuesday 14 April) hour by hour. The launch-day tasks are slivers in the week view and real bars
// in the hour view: switch the view mode to see both.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-30', end: '2026-04-01', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-04-02', end: '2026-04-08', progress: 100 },
  { id: 'frontend', name: 'Frontend', start: '2026-04-02', end: '2026-04-09', progress: 80 },
  { id: 'docs', name: 'Docs', start: '2026-04-06', end: '2026-04-17', progress: 40 },
  { id: 'qa', name: 'QA', start: '2026-04-10', end: '2026-04-13', progress: 30 },

  { id: 'checks', name: 'Final checks', start: '2026-04-14T08:00', end: '2026-04-14T09:00' },
  { id: 'deploy', name: 'Deploy', start: '2026-04-14T09:00', end: '2026-04-14T10:30' },
  { id: 'smoke', name: 'Smoke tests', start: '2026-04-14T10:30', end: '2026-04-14T12:00' },
  { id: 'announce', name: 'Announce', start: '2026-04-14T13:00', end: '2026-04-14T14:00' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-14T14:00' },

  { id: 'monitor', name: 'Monitor', start: '2026-04-15', end: '2026-04-24' },
  { id: 'retro', name: 'Retrospective', start: '2026-04-27', end: '2026-04-28' },
];

export const links: Link[] = [
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'qa' },
  { source: 'frontend', target: 'qa' },
  { source: 'qa', target: 'checks' },
  { source: 'checks', target: 'deploy' },
  { source: 'deploy', target: 'smoke' },
  { source: 'smoke', target: 'announce' },
  { source: 'announce', target: 'launch' },
  { source: 'launch', target: 'monitor' },
  { source: 'monitor', target: 'retro' },
];

import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Build is a parent: its record lists its children.
export const tasks: Task[] = [
  { id: 'discovery', name: 'Discovery', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 80 },
  { id: 'build', name: 'Build', start: '2026-03-16', end: '2026-03-27', progress: 30 },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-16',
    end: '2026-03-24',
    progress: 45,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-18',
    end: '2026-03-27',
    progress: 20,
  },
  { id: 'docs', name: 'Docs', start: '2026-03-23', end: '2026-03-26' },
  { id: 'qa', name: 'QA', start: '2026-03-30', end: '2026-03-31' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-01' },
];

export const links: Link[] = [
  { source: 'discovery', target: 'design' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
  { source: 'docs', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

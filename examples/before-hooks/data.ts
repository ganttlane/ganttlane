import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Design is finished (100%); Release is a frozen group: Release itself and
// its two children cannot be dragged, and the link hook of the example refuses links into them.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'api', name: 'API', start: '2026-03-09', end: '2026-03-13', progress: 60 },
  { id: 'ui', name: 'UI', start: '2026-03-09', end: '2026-03-17', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-19' },
  { id: 'qa', name: 'QA', start: '2026-03-18', end: '2026-03-20' },
  { id: 'release', name: 'Release', start: '2026-03-23', end: '2026-03-27', locked: true },
  {
    id: 'package',
    name: 'Package',
    parentId: 'release',
    start: '2026-03-23',
    end: '2026-03-24',
    locked: true,
  },
  {
    id: 'publish',
    name: 'Publish',
    parentId: 'release',
    start: '2026-03-25',
    end: '2026-03-27',
    locked: true,
  },
];

export const links: Link[] = [
  { source: 'design', target: 'api' },
  { source: 'design', target: 'ui' },
  { source: 'api', target: 'qa' },
  { source: 'ui', target: 'qa' },
];

/** The tasks of the frozen group: Release and its children. */
export const frozen: ReadonlySet<Task['id']> = new Set(
  tasks
    .filter((task) => task.id === 'release' || task.parentId === 'release')
    .map((task) => task.id),
);

import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. The tasks are written in four different shapes on purpose: when a drag
// is written back into them with `patchTasks`, each one keeps the shape it has (an ISO string
// stays an ISO string, a `duration` stays a `duration`, a `Date` stays a `Date`, epoch ms stay a
// number), and the inspector under the chart shows that.
//
// `new Date(2026, 2, 16)` is local midnight of 16 March. A number is read the same way, through
// the local clock, so it is made from a `Date` here: an epoch literal would land on another day
// in some time zone.
export const tasks: Task[] = [
  // Phase: Design, with two children. ISO strings, and a `duration` instead of an `end`.
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-13' },
  {
    id: 'wireframes',
    name: 'Wireframes',
    parentId: 'design',
    start: '2026-03-02',
    end: '2026-03-06',
  },
  { id: 'visuals', name: 'Visuals', parentId: 'design', start: '2026-03-09', duration: 5 },
  // Phase: Build. Epoch milliseconds, and `Date` objects.
  { id: 'build', name: 'Build', start: '2026-03-16', end: '2026-03-27' },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: new Date(2026, 2, 16).getTime(),
    end: new Date(2026, 2, 27).getTime(),
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: new Date(2026, 2, 18),
    end: new Date(2026, 2, 27),
  },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-03-30' },
];

export const links: Link[] = [
  { source: 'wireframes', target: 'visuals' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'release' },
];

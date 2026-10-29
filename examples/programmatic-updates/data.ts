import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Discovery is finished and locked: `updateTask` leaves it alone, too.
export const tasks: Task[] = [
  {
    id: 'discovery',
    name: 'Discovery',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
  },
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-13', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-16', end: '2026-03-20', progress: 20 },
  // No links yet: the buttons add and remove one.
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-18' },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-25' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-26' },
];

export const links: Link[] = [
  { source: 'discovery', target: 'design' },
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

/** The task that `setTasks` adds and removes in the example. */
export const review: Task = {
  id: 'review',
  name: 'Review',
  start: '2026-03-26',
  end: '2026-03-27',
};

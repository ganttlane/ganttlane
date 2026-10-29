import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Design is locked, so dragging it is refused (`onEditRefused`); Build is
// a parent with two children, so it can be collapsed (`onExpandedChange`).
export const tasks: Task[] = [
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
  },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 30 },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-09',
    end: '2026-03-17',
    progress: 45,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-11',
    end: '2026-03-20',
    progress: 20,
  },
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-19' },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-25' },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-26' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

/**
 * A task whose end is before its start: the data has a problem, which `onIssues` reports
 * (`end-before-start`). The example adds it with `setTasks` and takes it away again.
 */
export const broken: Task = {
  id: 'broken',
  name: 'Broken',
  start: '2026-03-12',
  end: '2026-03-05',
};

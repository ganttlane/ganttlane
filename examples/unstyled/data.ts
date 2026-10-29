import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Every kind of thing a stylesheet has to draw is here: phases with
// children (stripes by group), finished work that is locked (`data-locked`), a milestone, links of
// two types, and one bar that starts on a Saturday, a day off, so that it is in conflict
// (`data-conflict`).
export const tasks: Task[] = [
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
  },
  {
    id: 'wireframes',
    name: 'Wireframes',
    parentId: 'design',
    start: '2026-03-02',
    end: '2026-03-03',
    progress: 100,
    locked: true,
  },
  {
    id: 'visuals',
    name: 'Visuals',
    parentId: 'design',
    start: '2026-03-04',
    end: '2026-03-06',
    progress: 100,
    locked: true,
  },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20', progress: 45 },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-09',
    end: '2026-03-17',
    progress: 70,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-11',
    end: '2026-03-20',
    progress: 30,
  },
  // Starts on a Saturday: a day off, so the bar is in conflict.
  { id: 'docs', name: 'Docs', start: '2026-03-21', end: '2026-03-24', progress: 10 },
  { id: 'qa', name: 'QA', start: '2026-03-25', end: '2026-03-27', progress: 0 },
  { id: 'release', name: 'Release', type: 'milestone', start: '2026-03-30' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'backend', target: 'frontend', type: 'SS' }, // start to start
  { source: 'build', target: 'qa' },
  { source: 'docs', target: 'qa' },
  { source: 'qa', target: 'release' },
];

import type { Link, Task } from '@ganttlane/core';

/** What `task.data` holds. It is the type of `record.task.data` in every event and render function. */
export interface Meta {
  owner: string;
  status: 'done' | 'active' | 'late';
}

export const tasks: Task<Meta>[] = [
  // ---- Design: finished, so locked (no drag, and no propagation moves it) ----
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-13',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },
  {
    id: 'draft',
    name: 'Draft',
    parentId: 'design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },
  {
    id: 'sign-off',
    name: 'Sign-off',
    parentId: 'design',
    start: '2026-03-09',
    end: '2026-03-13',
    progress: 100,
    locked: true,
    className: 'is-done',
    data: { owner: 'Ann', status: 'done' },
  },

  // ---- Build: counted in working days; its children follow it ----
  {
    id: 'build',
    name: 'Build',
    start: '2026-03-16',
    end: '2026-04-10',
    durationMode: 'working',
    progress: 35,
    className: 'is-active',
    data: { owner: 'Bo', status: 'active' },
  },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-16',
    end: '2026-03-27',
    parentAnchor: 'SS', // its start is pinned to the start of Build
    followParent: true, // and it moves when Build moves (`hierarchy.moveChildren: 'following'`)
    progress: 50,
    className: 'is-active',
    data: { owner: 'Bo', status: 'active' },
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-23',
    end: '2026-04-10',
    parentAnchor: ['SS', 'FF'], // both edges pinned: it stretches with Build
    followParent: true,
    progress: 20,
    className: 'is-late',
    data: { owner: 'Cy', status: 'late' },
  },

  // ---- QA and the release ----
  {
    id: 'qa',
    name: 'QA',
    start: '2026-04-10', // a day before Build ends
    duration: 5, // days
    data: { owner: 'Ann', status: 'active' },
  },
  {
    id: 'release',
    name: 'Release',
    type: 'milestone', // a diamond at its start
    start: '2026-04-17',
    data: { owner: 'Ann', status: 'active' },
  },
];

export const links: Link[] = [
  { source: 'design', target: 'build' }, // finish-to-start; no lag: it keeps the gap it has now
  { source: 'build', target: 'qa', lag: -1 }, // a lead: QA starts a day before Build ends
  { source: 'qa', target: 'release', lag: '2d' }, // a lag: two days after QA ends
];

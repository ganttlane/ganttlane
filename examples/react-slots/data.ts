import type { Link, Task } from '@ganttlane/core';

/** Who owns a task. The chart does not know people: this is the application's own id. */
export type PersonId = 'ann' | 'bo' | 'cy';

/** What `task.data` holds. It is the type of `record.task.data` in every slot. */
export interface Meta {
  owner: PersonId;
}

// 2026-03-02 is a Monday.
export const tasks: Task<Meta>[] = [
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    data: { owner: 'ann' },
  },
  {
    id: 'backend',
    name: 'Backend',
    start: '2026-03-09',
    end: '2026-03-18',
    progress: 55,
    data: { owner: 'bo' },
  },
  {
    id: 'frontend',
    name: 'Frontend',
    start: '2026-03-09',
    end: '2026-03-20',
    progress: 35,
    data: { owner: 'cy' },
  },
  { id: 'docs', name: 'Docs', start: '2026-03-12', end: '2026-03-18', data: { owner: 'ann' } },
  { id: 'qa', name: 'QA', start: '2026-03-23', end: '2026-03-26', data: { owner: 'cy' } },
  { id: 'release', name: 'Release', start: '2026-03-27', end: '2026-03-31', data: { owner: 'bo' } },
];

export const links: Link[] = [
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'backend', target: 'qa' },
  { source: 'frontend', target: 'qa' },
  { source: 'docs', target: 'qa' },
  { source: 'qa', target: 'release' },
];

import type { Link, Task } from '@ganttlane/core';

/** What `task.data` holds: who owns the task. A label can read it from `task.data`. */
export interface Meta {
  owner: 'Ann' | 'Bo' | 'Cy' | 'Di';
}

// 2026-03-02 is a Monday. In the week view a day is 20 px wide, so a bar of five days is 100 px:
// "Research" fits in its bar, "Accessibility audit" does not, and `display.barLabel: 'auto'`
// puts each label where it fits.
export const tasks: Task<Meta>[] = [
  {
    id: 'research',
    name: 'Research',
    start: '2026-03-02',
    end: '2026-03-11',
    progress: 100,
    data: { owner: 'Ann' },
  },
  {
    id: 'a11y',
    name: 'Accessibility audit',
    start: '2026-03-09',
    end: '2026-03-13',
    progress: 60,
    data: { owner: 'Di' },
  },
  {
    id: 'design',
    name: 'Design system',
    start: '2026-03-12',
    end: '2026-03-20',
    progress: 45,
    data: { owner: 'Bo' },
  },
  {
    id: 'icons',
    name: 'Icons',
    start: '2026-03-12',
    end: '2026-03-13',
    progress: 20,
    data: { owner: 'Bo' },
  },
  {
    id: 'migrations',
    name: 'Database migrations',
    start: '2026-03-16',
    end: '2026-03-20',
    progress: 80,
    data: { owner: 'Cy' },
  },
  {
    id: 'frontend',
    name: 'Frontend',
    start: '2026-03-16',
    end: '2026-03-23',
    progress: 30,
    data: { owner: 'Ann' },
  },
  {
    id: 'docs',
    name: 'Docs',
    start: '2026-03-18',
    end: '2026-03-20',
    progress: 0,
    data: { owner: 'Di' },
  },
  {
    id: 'security',
    name: 'Security review',
    start: '2026-03-24',
    end: '2026-03-25',
    progress: 0,
    data: { owner: 'Cy' },
  },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-26', data: { owner: 'Ann' } },
];

export const links: Link[] = [
  { source: 'research', target: 'design' },
  { source: 'design', target: 'frontend', type: 'SS' }, // start to start
  { source: 'frontend', target: 'security' },
  { source: 'docs', target: 'security', type: 'FF' }, // finish to finish
  { source: 'security', target: 'launch' },
];

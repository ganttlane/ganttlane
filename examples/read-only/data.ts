import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. Two kinds of task are out of the user's reach, on top of what the
// `editing` option says for the whole chart:
//  - `locked: true` cannot be moved, resized or given progress, but links may start and end at it;
//  - `linkable: false` cannot be linked at all, but it can be dragged like any other bar.
export const tasks: Task[] = [
  // Finished work is locked: the user cannot drag it, and propagation never moves it either.
  {
    id: 'research',
    name: 'Research',
    start: '2026-03-02',
    end: '2026-03-06',
    progress: 100,
    locked: true,
  },
  {
    id: 'design',
    name: 'Design',
    start: '2026-03-09',
    end: '2026-03-13',
    progress: 100,
    locked: true,
  },
  { id: 'backend', name: 'Backend', start: '2026-03-16', end: '2026-03-27', progress: 40 },
  { id: 'frontend', name: 'Frontend', start: '2026-03-16', end: '2026-03-25', progress: 25 },
  // Agreed with another team: no dependency may be drawn to or from it.
  {
    id: 'legal',
    name: 'Legal review',
    start: '2026-03-18',
    end: '2026-03-20',
    progress: 0,
    linkable: false,
  },
  { id: 'docs', name: 'Docs', start: '2026-03-26', end: '2026-03-27', progress: 0 },
  { id: 'qa', name: 'QA', start: '2026-03-30', end: '2026-03-31', progress: 0 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-04-01' },
];

export const links: Link[] = [
  { source: 'research', target: 'design' },
  { source: 'design', target: 'backend' },
  { source: 'design', target: 'frontend' },
  { source: 'frontend', target: 'docs' },
  { source: 'backend', target: 'qa' },
  { source: 'docs', target: 'qa' },
  { source: 'qa', target: 'launch' },
];

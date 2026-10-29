import type { Link, Task } from '@ganttlane/core';

// Three phases, each with children: `parentId` makes the tree, and the rows are the tasks in
// pre-order (a phase, then its children). 2026-03-02 is a Monday; a task with an `end` ends on
// that day (inclusive).
//
// A child is tied to its phase in two steps:
//   `followParent: true`  the child moves with its phase (when `hierarchy.moveChildren` lets it);
//   `parentAnchor`        which edges of the child are pinned to which edges of the phase:
//                         'SS' start to start, 'FF' end to end, 'FS' start to the phase's end,
//                         'SF' end to the phase's start, or two of them (one per edge).
// A child with no `parentAnchor` takes `hierarchy.childAnchor`.
export const tasks: Task[] = [
  // ---- Plan: collapsed when the chart opens ----
  { id: 'plan', name: 'Plan', start: '2026-03-02', end: '2026-03-06' },
  {
    id: 'research',
    name: 'Research',
    parentId: 'plan',
    start: '2026-03-02',
    end: '2026-03-04',
    parentAnchor: 'SS', // its start is pinned to the start of Plan
    followParent: true,
  },
  {
    id: 'spec',
    name: 'Spec',
    parentId: 'plan',
    start: '2026-03-04',
    end: '2026-03-06',
    parentAnchor: 'FF', // its end is pinned to the end of Plan
    followParent: true,
  },

  // ---- Build: expanded, and the one to drag ----
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  {
    id: 'backend',
    name: 'Backend',
    parentId: 'build',
    start: '2026-03-09',
    end: '2026-03-16',
    parentAnchor: 'SS', // start pinned: it moves with Build, and a resize of Build's end leaves it
    followParent: true,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    parentId: 'build',
    start: '2026-03-09',
    end: '2026-03-20',
    parentAnchor: ['SS', 'FF'], // both edges pinned: it stretches with Build
    followParent: true,
  },
  {
    id: 'qa',
    name: 'QA',
    parentId: 'build',
    start: '2026-03-16',
    end: '2026-03-20',
    followParent: true, // no `parentAnchor`: the pin is `hierarchy.childAnchor`
  },
  {
    id: 'docs',
    name: 'Docs',
    parentId: 'build',
    start: '2026-03-11',
    end: '2026-03-18',
    // Not followParent: only `moveChildren: 'all'` moves it, with the start of Build
  },

  // ---- Launch: collapsed when the chart opens ----
  { id: 'launch', name: 'Launch', start: '2026-03-23', end: '2026-03-27' },
  {
    id: 'marketing',
    name: 'Marketing',
    parentId: 'launch',
    start: '2026-03-25',
    end: '2026-03-27',
    parentAnchor: 'FF',
    followParent: true,
  },
  {
    id: 'support',
    name: 'Support',
    parentId: 'launch',
    start: '2026-03-26',
    end: '2026-03-27',
    followParent: true,
  },
];

export const links: Link[] = [];

import type { Link, Task } from '@ganttlane/core';

// A plan with five milestones and three placeholder rows. 2026-03-02 is a Monday.
//   `type: 'milestone'`    a point in time, not a bar: it has a `start` and no length (an `end` or
//                          a `duration` is ignored). It is drawn as a diamond.
//   `type: 'placeholder'`  a row with no bar: its dates, if it has any, are ignored. It holds a
//                          place in the list: a heading for the rows under it, or work that is not
//                          scheduled yet. A task with no dates at all is a placeholder too, but
//                          the chart reports it as an issue; the type says you meant it.
export const tasks: Task[] = [
  { id: 'kickoff', name: 'Kick-off', type: 'milestone', start: '2026-03-02' },
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'signoff', name: 'Design sign-off', type: 'milestone', start: '2026-03-09' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-17' },
  { id: 'beta', name: 'Beta', type: 'milestone', start: '2026-03-18' },

  // A heading: a placeholder with children, which are the rows below it.
  { id: 'launch', name: 'Launch', type: 'placeholder' },
  {
    id: 'marketing',
    name: 'Marketing',
    parentId: 'launch',
    start: '2026-03-20',
    end: '2026-03-25',
  },
  { id: 'docs', name: 'Docs', parentId: 'launch', start: '2026-03-20', end: '2026-03-26' },
  { id: 'release', name: 'Release', type: 'milestone', parentId: 'launch', start: '2026-03-27' },

  // Work that is not scheduled yet: rows with no bar. The button turns Hiring into a task.
  { id: 'backlog', name: 'Backlog', type: 'placeholder' },
  { id: 'hiring', name: 'Hiring', type: 'placeholder', parentId: 'backlog' },
  { id: 'support', name: 'Support rota', type: 'placeholder', parentId: 'backlog' },
];

// A milestone is linked like any task: it is the source of a link (what follows it) or its target
// (what it waits for). Its two edges are the same moment, so every link type reaches the same point.
export const links: Link[] = [
  { source: 'kickoff', target: 'design', lag: 0 },
  { source: 'design', target: 'signoff', lag: 2 },
  { source: 'signoff', target: 'build', lag: 0 },
  { source: 'build', target: 'beta', lag: 0 },
  { source: 'beta', target: 'marketing', lag: 2 },
  { source: 'beta', target: 'docs', lag: 2 },
  { source: 'marketing', target: 'release', lag: 1 },
  { source: 'docs', target: 'release', lag: 0 },
];

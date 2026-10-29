import type { Link, Task } from '@ganttlane/core';

// 2026-03-02 is a Monday. The plan has no weekends (see `options.ts`), so a task can be moved
// by a day without landing on a day off.
export const tasks: Task[] = [
  { id: 'brief', name: 'Brief', start: '2026-03-02', end: '2026-03-04', progress: 100 },
  { id: 'design', name: 'Design', start: '2026-03-05', end: '2026-03-10', progress: 70 },
  { id: 'build', name: 'Build', start: '2026-03-11', end: '2026-03-20', progress: 30 },
  { id: 'docs', name: 'Docs', start: '2026-03-14', end: '2026-03-18', progress: 10 },
  { id: 'review', name: 'Review', start: '2026-03-21', end: '2026-03-22', progress: 0 },
  { id: 'qa', name: 'QA', start: '2026-03-25', end: '2026-03-26', progress: 0 },
  { id: 'launch', name: 'Launch', type: 'milestone', start: '2026-03-29' },
];

// Links of three types, with different gaps. A link without a `lag` keeps the gap its tasks have:
// Docs starts three days after Build starts, QA two days after Review ends.
export const links: Link[] = [
  { source: 'brief', target: 'design' }, // finish to start, no gap
  { source: 'design', target: 'build' },
  { source: 'build', target: 'docs', type: 'SS' }, // start to start, a gap of three days
  { source: 'docs', target: 'review', type: 'FF' }, // finish to finish, a gap of four days
  { source: 'build', target: 'review' },
  { source: 'review', target: 'qa' }, // finish to start, a gap of two days
  // The launch date is a promise: this link cannot be removed from the UI.
  { source: 'qa', target: 'launch', editable: false },
];

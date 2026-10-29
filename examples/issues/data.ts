import type { Link, Task } from '@ganttlane/core';

// Bad input on purpose. The chart never throws on it: it reports each problem as an `Issue`
// (`gantt.getIssues()`, `onIssues`), keeps the rest of the data, and draws what it can.
// 2026-03-02 is a Monday; a task with an `end` ends on that day (inclusive).
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },

  // `end-before-start` (error): the end is a day before the start. The task has no bar.
  { id: 'review', name: 'Review', start: '2026-03-16', end: '2026-03-12' },

  // `invalid-date` (error): the start is no date. The task has no bar.
  { id: 'qa', name: 'QA', start: 'next tuesday', duration: 3 },

  // `misaligned` (warning): the data step is a day, and 10:30 is not a multiple of it. The task
  // is kept, and its start is aligned (`scheduling.alignInput`); `suggested` says to what.
  { id: 'release', name: 'Release', start: '2026-03-16T10:30', duration: 2 },

  // Two tasks that wait for each other, see the links.
  { id: 'docs', name: 'Docs', start: '2026-03-09', end: '2026-03-11' },
  { id: 'marketing', name: 'Marketing', start: '2026-03-11', end: '2026-03-13' },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  // `unknown-link-task` (error): there is no task `ghost`. The link is dropped.
  { source: 'build', target: 'ghost' },
  // `cycle` (error): Docs waits for Marketing, which waits for Docs. The links are kept and
  // drawn, dashed and red, and scheduling ignores them.
  { source: 'docs', target: 'marketing' },
  { source: 'marketing', target: 'docs' },
];

// The same plan without the mistakes: what the button puts in.
export const fixedTasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'review', name: 'Review', start: '2026-03-16', end: '2026-03-18' },
  { id: 'qa', name: 'QA', start: '2026-03-17', duration: 3 },
  { id: 'release', name: 'Release', start: '2026-03-16', duration: 2 },
  { id: 'docs', name: 'Docs', start: '2026-03-09', end: '2026-03-11' },
  { id: 'marketing', name: 'Marketing', start: '2026-03-12', end: '2026-03-14' },
];

export const fixedLinks: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'review' },
  { source: 'docs', target: 'marketing' },
];

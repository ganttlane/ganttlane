import type { Link, Task } from '@ganttlane/core';

// Wall-clock times, in the form `'YYYY-MM-DDTHH:mm'`. 2026-03-09 is a Monday. Every value is a
// multiple of 15 minutes (the granularity in `options.ts`), except the start and the end of
// Handoff, which are deliberately not: `scheduling.alignInput` decides what happens to them.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-09T09:00', end: '2026-03-09T15:30' },
  { id: 'build', name: 'Build', start: '2026-03-09T13:00', end: '2026-03-10T17:15' },
  { id: 'review', name: 'Review', start: '2026-03-10T10:30', end: '2026-03-10T15:00' },
  { id: 'qa', name: 'QA', start: '2026-03-10T14:00', end: '2026-03-11T11:45' },
  { id: 'docs', name: 'Docs', start: '2026-03-11T09:00', end: '2026-03-11T13:00' },
  // 13:10 and 16:35 are not multiples of 15 minutes: each is a `misaligned` issue, and is aligned
  // to 13:00 and 16:45 (`'expand'`), to 13:15 and 16:30 (`'nearest'`), or not accepted (`'reject'`).
  { id: 'handoff', name: 'Handoff', start: '2026-03-11T13:10', end: '2026-03-11T16:35' },
];

export const links: Link[] = [];

import type { Link, Task } from '@ganttlane/core';

// One source, Design (Monday 2026-03-09 to Thursday 2026-03-12), and nine tasks linked to it: two for
// each link type, one with a lag (a gap after the anchor, positive) and one with a lead (a
// negative lag: the anchors overlap), and one whose link names neither a type nor a lag.
//
// A link joins an edge of the source to an edge of the target, `lag` apart:
//   FS  the end of the source   to the start of the target
//   SS  the start of the source to the start of the target
//   FF  the end of the source   to the end of the target
//   SF  the start of the source to the end of the target
// A task with an `end` ends on that day (inclusive); a task with a `duration` lasts that many days.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-09', end: '2026-03-12' },

  // FS: starts 2 days after Design ends, and 2 days before it ends.
  { id: 'build', name: 'Build · FS +2d', start: '2026-03-15', duration: 3 },
  { id: 'docs', name: 'Docs · FS -2d', start: '2026-03-11', duration: 3 },

  // SS: starts 2 days after Design starts, and 2 days before it starts.
  { id: 'frontend', name: 'Frontend · SS +2d', start: '2026-03-11', duration: 3 },
  { id: 'qa', name: 'QA · SS -2d', start: '2026-03-07', duration: 3 },

  // FF: ends 2 days after Design ends, and 2 days before it ends.
  { id: 'marketing', name: 'Marketing · FF +2d', start: '2026-03-11', end: '2026-03-14' },
  { id: 'release', name: 'Release · FF -2d', start: '2026-03-07', end: '2026-03-10' },

  // SF: ends 2 days after Design starts, and 2 days before it starts.
  { id: 'hiring', name: 'Hiring · SF +2d', start: '2026-03-07', end: '2026-03-10' },
  { id: 'support', name: 'Support · SF -2d', start: '2026-03-04', end: '2026-03-06' },

  // No type and no lag: the type is `scheduling.defaultLinkType`, the lag the gap it has now.
  { id: 'review', name: 'Review · no type', start: '2026-03-15', duration: 3 },
];

export const links: Link[] = [
  { source: 'design', target: 'build', type: 'FS', lag: 2 },
  { source: 'design', target: 'docs', type: 'FS', lag: -2 },
  { source: 'design', target: 'frontend', type: 'SS', lag: 2 },
  { source: 'design', target: 'qa', type: 'SS', lag: -2 },
  { source: 'design', target: 'marketing', type: 'FF', lag: 2 },
  { source: 'design', target: 'release', type: 'FF', lag: -2 },
  { source: 'design', target: 'hiring', type: 'SF', lag: 2 },
  { source: 'design', target: 'support', type: 'SF', lag: -2 },
  { source: 'design', target: 'review' },
];

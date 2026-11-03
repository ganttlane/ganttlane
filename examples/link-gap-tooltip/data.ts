import type { Link, Task } from '@ganttlane/core';

// 2 March 2026 is a Monday. An `end` is the last day of the task, so a bar ends at the midnight
// after it: Design ends on Saturday 7 March at 00:00.
export const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 100 },
  { id: 'backend', name: 'Backend', start: '2026-03-02', end: '2026-03-10', progress: 70 },
  // Two predecessors: 3 days after the end of Design, and 1 day before the end of Backend.
  { id: 'build', name: 'Build', start: '2026-03-10', end: '2026-03-12', progress: 20 },
  // Starts the moment Build ends: no gap.
  { id: 'review', name: 'Review', start: '2026-03-13', end: '2026-03-18' },
  // Start to start, with a lag of its own: 3 days after the start of Review.
  { id: 'docs', name: 'Docs', start: '2026-03-16', end: '2026-03-19' },
  // Counted in working days, so the weekend before it does not count: 2 after Review, 1 after Docs.
  {
    id: 'launch',
    name: 'Launch',
    start: '2026-03-23',
    end: '2026-03-24',
    durationMode: 'working',
  },
];

export const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'backend', target: 'build' },
  { source: 'build', target: 'review' },
  { source: 'review', target: 'docs', type: 'SS', lag: 3 },
  { source: 'review', target: 'launch' },
  { source: 'docs', target: 'launch' },
];

import type { Link, Task } from '@ganttlane/core';

// Dates with a time are wall-clock time: `'2026-03-05T10:00'` is 10:00 for every viewer, in every
// time zone. 2026-03-04 is a Wednesday.
export const tasks: Task[] = [
  // 8 hours: Wednesday 09:00 to 17:00.
  { id: 'freeze', name: 'Code freeze', start: '2026-03-04T09:00', duration: '8h' },
  // Thursday 10:00 + 2 working days = Monday 10:00 (the weekend is skipped, the time of day kept).
  { id: 'qa', name: 'QA pass', start: '2026-03-05T10:00', duration: '2d' },
  // 4 hours: Monday 10:00 to 14:00.
  { id: 'release', name: 'Release', start: '2026-03-09T10:00', duration: '4h' },
  // Monday 15:00 + 2 working days, with Tuesday a holiday = Thursday 15:00.
  { id: 'monitor', name: 'Monitor', start: '2026-03-09T15:00', duration: '2d' },
];

export const links: Link[] = [
  // No lag: QA keeps the gap the data has, 17 hours from Wednesday 17:00 to Thursday 10:00.
  // Drag the freeze an hour later and QA follows by an hour.
  { source: 'freeze', target: 'qa' },
  { source: 'qa', target: 'release' },
  // A lag is a rule instead: Monitor starts an hour after the release ends, wherever it goes.
  { source: 'release', target: 'monitor', lag: '1h' },
];

import type { Link, Task } from '@ganttlane/core';

// The calendar (see `options.ts`): Saturday and Sunday are off, so are Fridays in June (a custom
// rule), Wednesday 10 June is a holiday, and Saturday 13 June is worked. 2026-06-08 is a Monday.
//
// A task with a `duration` and no `end` lasts that many days, counted as `durationMode` says:
//   'working'   working days only: days off inside the task do not count, so it is longer;
//   'calendar'  every day counts, a day off or not.
// A task with no `durationMode` of its own takes `scheduling.durationMode`, which is 'working'.
export const tasks: Task[] = [
  // 3 working days: Mon 8, Tue 9 and Thu 11; the holiday on Wed 10 is skipped. Ends Thu 11.
  { id: 'design', name: 'Design', start: '2026-06-08', duration: 3, progress: 50 },
  // 5 working days: Mon 8, Tue 9, Thu 11, Sat 13 (a worked Saturday) and Mon 15. The holiday, the
  // Friday and the Sunday are skipped. Ends Mon 15, 8 calendar days after it starts.
  { id: 'build', name: 'Build', start: '2026-06-08', duration: 5, progress: 40 },
  // 3 working days: Tue 16, Wed 17, Thu 18.
  { id: 'review', name: 'Review', start: '2026-06-16', duration: 3 },
  // 5 working days from Thu 18: Thu 18, Mon 22, Tue 23, Wed 24 and Thu 25. It spans a weekend.
  { id: 'handover', name: 'Handover', start: '2026-06-18', duration: 5 },
  // The same 5 days, counted in calendar days: Thu 18 to Mon 22. This task says so itself, so it
  // ignores `scheduling.durationMode`.
  {
    id: 'on-call',
    name: 'On-call',
    start: '2026-06-18',
    duration: 5,
    durationMode: 'calendar',
    progress: 20,
  },
  // One working day, and it is the worked Saturday: a task may sit on it, and is not in conflict.
  { id: 'hotfix', name: 'Hotfix', start: '2026-06-13', duration: 1 },
];

export const links: Link[] = [];

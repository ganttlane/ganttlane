import type { GanttOptions } from '@ganttlane/dom';

export const options = {
  // Which days are working days. From the strongest rule to the weakest, a day is decided by:
  // `workingDays`, then `holidays`, then `isWorkingDay`, then `weekends`.
  calendar: {
    // Days of the week that are off, 0 is Sunday: Saturday and Sunday (the default).
    weekends: [0, 6],
    // Named days off: the name shows when you hover the day.
    holidays: [{ date: '2026-06-10', name: 'Company holiday' }],
    // Exceptions: days that are worked whatever the other rules say, here a Saturday.
    workingDays: ['2026-06-13'],
    // Your own rule: `true` makes the day a working day, `false` a day off, and `undefined` leaves
    // it to the next rule (`weekends`). It must be pure: the answer is cached. Here, Fridays are
    // off from June to August.
    isWorkingDay: ({ weekday, month }) =>
      month >= 6 && month <= 8 && weekday === 5 ? false : undefined,
  },
  scheduling: {
    // How a `duration` is counted, for the tasks that do not say: 'working' or 'calendar'.
    durationMode: 'working',
    // Whether an edited edge moves off a day off, onto the next working day (a start) or the
    // last one (an end). These are the defaults; the boxes above the chart change them.
    skipNonWorkingDays: { move: true, resize: false, progress: true },
  },
  // A narrower day column than the default 40 px, so that the whole plan fits.
  viewModes: { day: { pxPerDay: 32 } },
  scroll: { initial: 'first-task' },
} satisfies Partial<GanttOptions>;

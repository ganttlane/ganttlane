# Working days at one-hour granularity

A Monday-to-Friday calendar with a named holiday, tasks timed to the hour, and a before-hook that
asks before a bar lands on a day off. Three settings make it work:

- `calendar` says which days are working days;
- `scheduling.granularity: '1h'` makes the **data** step one hour: every date, duration and lag in
  the chart is a whole number of hours (`10:30` is reported as `misaligned` and aligned);
- `durationMode: 'working'` counts a duration in working time only, so a task of two working days
  that starts on Thursday at 10:00 ends on Monday at 10:00 (the weekend is skipped, the time of
  day is kept).

```sh
pnpm add @ganttlane/dom
```

`main.ts`:

```ts
import '@ganttlane/dom/styles.css';
import { createGantt } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart'); // give it a height in CSS
if (!container) throw new Error('#chart not found');

const gantt = createGantt(container, {
  tasks: [
    // 8 hours: Wednesday 09:00 to 17:00.
    { id: 'freeze', name: 'Code freeze', start: '2026-03-04T09:00', duration: '8h' },
    // Thursday 10:00 + 2 working days = Monday 10:00.
    { id: 'qa', name: 'QA pass', start: '2026-03-05T10:00', duration: '2d' },
    // 4 hours: Monday 10:00 to 14:00.
    { id: 'release', name: 'Release', start: '2026-03-09T10:00', duration: '4h' },
    // Monday 15:00 + 2 working days, with Tuesday a holiday = Thursday 15:00.
    { id: 'monitor', name: 'Monitor', start: '2026-03-09T15:00', duration: '2d' },
  ],
  links: [
    // No lag: QA keeps the gap the data has, 17 hours from Wednesday 17:00 to Thursday 10:00.
    // Drag the freeze an hour later and QA follows by an hour.
    { source: 'freeze', target: 'qa' },
    { source: 'qa', target: 'release' },
    // A lag is a rule instead: Monitor starts an hour after the release ends, wherever it goes.
    { source: 'release', target: 'monitor', lag: '1h' },
  ],

  calendar: {
    weekends: [0, 6], // the default: Sunday and Saturday
    holidays: [{ date: '2026-03-10', name: 'Office closed' }], // the name shows when hovering the day
  },
  scheduling: {
    granularity: '1h',
    durationMode: 'working', // for every task; a task can say 'calendar'
    // Drags land on working days. `move` is on by default, `resize` is not.
    skipNonWorkingDays: { move: true, resize: true },
  },
  display: { nonWorkingDays: 'stripes' }, // 'fill' (default), 'stripes' or false

  viewMode: 'quarter-day', // 6-hour columns; try 'hour' to see the individual hours
  scroll: { initial: 'first-task' },

  // Ask before a bar ends up on a day off. Returning false cancels the change; a promise works too.
  onBeforeTaskChange: ({ conflicts }) => {
    const dayOff = conflicts.some(
      (conflict) => conflict.type === 'non-working-start' || conflict.type === 'non-working-end',
    );
    return dayOff ? window.confirm('This lands on a day off. Keep it?') : true;
  },
  onIssues: ({ source, issues }) => {
    for (const issue of issues) console.warn(source, issue.code, issue.path, issue.suggested);
  },
});

// The records are computed from the calendar: `Date`s with the wall-clock time the data says.
const qa = gantt.getTask('qa');
console.log(qa?.start, qa?.endExclusive, qa?.duration?.workingDays);
```

Notes:

- The dates are **floating wall-clock time**: `'2026-03-05T10:00'` is 10:00 for every viewer, in
  every time zone. Strings with `Z` or an offset are rejected.
- A task given as a bare date (`'2026-03-06'`) has day precision and stays on whole days even at an
  hourly granularity (`scheduling.keepDayPrecision`, on by default); give it a time to make it a timed
  task.
- A drag snaps to the step of the view mode (`scheduling.snap` overrides it): `1h` in the quarter-day
  mode used here. A step finer than the granularity (the hour mode's 15 minutes) is raised to the
  granularity by itself.
- A working day is the whole 24 hours; working hours (shifts) are not modelled yet. So a gap in
  working time counts the night between Wednesday 17:00 and Thursday 10:00 (17 hours) and skips the
  weekend.
- A link without a `lag` keeps the gap it has now. A `lag` (a number of days, or a duration such as
  `'1h'`) is a rule, not a minimum: after a drag the successor sits exactly that far from its
  predecessor, so give dates that already do. If Monitor started at 18:00 here, the first drag of
  Release would pull it back to one hour after Release ends.
- Hold `Alt` while dragging to snap to the data step (one hour here) instead of the view mode's.

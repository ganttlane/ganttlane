---
title: Working days at one-hour granularity
description: A Monday-to-Friday calendar with a named holiday, tasks timed to the hour, a lag, and a before-hook that asks before a bar lands on a day off.
category: Scheduling
order: 230
---

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
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): four tasks timed to the hour, and the links with their lags.
- [`options.ts`](options.ts): the calendar, the scheduling rules, `display`, and two handlers.
- [`helpers.ts`](helpers.ts): `describe`, which reads a task's computed record.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart and the view mode buttons.

## Options

| Option                          | Value                          | What it does                                                                 |
| ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `calendar.weekends`             | `[0, 6]`                       | Sunday and Saturday are days off (the default)                               |
| `calendar.holidays`             | `[{ date, name }]`             | A named day off; the name shows when hovering the day                        |
| `scheduling.granularity`        | `'1h'`                         | The data step: one hour                                                      |
| `scheduling.durationMode`       | `'working'`                    | Durations count working time only                                            |
| `scheduling.skipNonWorkingDays` | `{ move: true, resize: true }` | Drags land on working days                                                   |
| `display.nonWorkingDays`        | `'stripes'`                    | Days off are striped (`'fill'` is the default)                               |
| `viewMode`                      | `'quarter-day'`                | 6-hour columns; the buttons switch to `'day'` and `'hour'`                   |
| `onBeforeTaskChange`            | a function                     | Asks before a bar ends up on a day off; `false` cancels, a promise works too |
| `onIssues`                      | a function                     | Reports problems with the data or the options                                |

## What to try

Drag Code freeze an hour later and QA follows by an hour. Drag QA onto the weekend: the before-hook
asks. The line under the chart says where QA is, from its computed record. Hold `Alt` while dragging
to snap to the data step (one hour here) instead of the view mode's.

## Notes

- The dates are **floating wall-clock time**: `'2026-03-05T10:00'` is 10:00 for every viewer, in
  every time zone. Strings with `Z` or an offset are rejected.
- A task given as a bare date (`'2026-03-06'`) has day precision and stays on whole days even at an
  hourly granularity (`scheduling.keepDayPrecision`, on by default); give it a time to make it a
  timed task.
- A drag snaps to the step of the view mode (`scheduling.snap` overrides it): `1h` in the
  quarter-day mode used here. A step finer than the granularity (the hour mode's 15 minutes) is
  raised to the granularity by itself.
- A working day is the whole 24 hours; working hours (shifts) are not modelled yet. So a gap in
  working time counts the night between Wednesday 17:00 and Thursday 10:00 (17 hours) and skips the
  weekend.
- A link without a `lag` keeps the gap it has now. A `lag` (a number of days, or a duration such as
  `'1h'`) is a rule, not a minimum: after a drag the successor sits exactly that far from its
  predecessor, so give dates that already do. If Monitor started at 18:00 here, the first drag of
  Release would pull it back to one hour after Release ends.
- The records are computed from the calendar: `gantt.getTask('qa')` has `Date`s with the wall-clock
  time the data says, and `duration.workingDays`.

---
title: Working calendar
description: Weekends, a named holiday, a worked Saturday and a custom rule, durations counted in working or in calendar days, and drags that skip the days off.
category: Scheduling
order: 230
height: 580
---

# Working calendar

The calendar says which days are working days; the rest of the chart reads it. Days off are shaded,
a duration can count working days only, and a drag can land on a working day instead of a day off.
Here the week is Monday to Thursday in June (Saturday, Sunday and, by a rule of its own, Friday are
off), Wednesday 10 June is a holiday and Saturday 13 June is worked anyway.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks, with the dates worked out in comments.
- [`options.ts`](options.ts): `calendar` and `scheduling`.
- [`helpers.ts`](helpers.ts): `describe`, which reads a task's computed record.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, a select and three boxes.

For a calendar at one-hour granularity, with hours of the day, see
[Working days at one-hour granularity](../working-calendar-hourly/README.md).

## Options

| Option                          | Value                        | What it does                                                             |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `calendar.weekends`             | `[0, 6]`                     | Days of the week that are off, `0` is Sunday (the default)               |
| `calendar.holidays`             | `[{ date, name }]`           | A named day off; the name shows when you hover the day                   |
| `calendar.workingDays`          | `['2026-06-13']`             | A day that is worked whatever the other rules say (here a Saturday)      |
| `calendar.isWorkingDay`         | a function                   | Your own rule: `true`, `false`, or `undefined` for "ask the next rule"   |
| `scheduling.durationMode`       | `'working'`                  | How a `duration` is counted, for the tasks that say nothing (the select) |
| `scheduling.skipNonWorkingDays` | `{ move, resize, progress }` | Whether an edited edge moves off a day off (the three boxes)             |
| `task.durationMode`             | `'calendar'` on _On-call_    | A task counts its own `duration` its own way                             |
| `viewModes`                     | `{ day: { pxPerDay: 32 } }`  | A narrower day column than the default 40 px, so that the plan fits      |
| `onTasksChange`                 | a function (in the example)  | One `ChangeSet` per edit; the example reads the edited task's record     |

## What to try

- **Look at the lengths.** _Build_, _Handover_ and _On-call_ all last five days, but _Build_ and
  _Handover_ count working days (the holiday, the Fridays and the weekends do not count, the worked
  Saturday does) and _On-call_ counts calendar days.
- **Switch _Durations count_ to `calendar`.** _Design_, _Build_ and _Handover_ become shorter, and
  _Design_ and _Build_ now end on a day off: they are drawn with a red outline, and
  `record.conflicts` has a `non-working-end` for each. _On-call_ does not change.
- **Drag _Review_ three days to the right**, so that it would start on a Friday. With _Skip days
  off: move_ ticked, the start moves on to Monday, and the bar keeps its three working days. Untick
  the box and drag again: the bar stays on the Friday, and the status line reports a
  `non-working-start` conflict.
- **Drag the right edge of _Build_ one day to the left**, onto Sunday. With _resize_ ticked the end
  goes back to Saturday, the last working day; with it unticked the bar ends on Sunday, with a
  `non-working-end` conflict.
- **Drag the progress handle of _On-call_** (the little handle at the foot of the done part) into
  the weekend. With _progress_ ticked the boundary jumps to the edge of the days off; without it,
  it rests on one. _On-call_ counts calendar days: in a task that counts working days the
  boundary never rests on a day off, whatever the box says.
- **Hover a shaded day** for the name of the holiday.

## Notes

- **Which rule decides a day.** `workingDays` first, then `holidays`, then `isWorkingDay`, then
  `weekends`. A rule that returns `undefined` passes the day on. It must be pure (the answer is
  cached for the life of the calendar), and it is given a `CalendarDay`: `weekday`, `month`, `day`, ….
- **`durationMode`.** A working duration skips days off and keeps counting until it has its days;
  `duration.workingDays` and `duration.calendarDays` of the record say both. A calendar duration
  counts every day, so a task can start or end on a day off: that is a `non-working-start` or
  `non-working-end` conflict, a warning, not an error.
- **`skipNonWorkingDays`.** `move` is on by default, `resize` is not, and `progress` is on. It works
  on a drag: `updateTask` and propagation through links put the dates exactly where you say.
- **A conflict is a warning.** It is drawn (`data-conflict`), listed in `record.conflicts` and
  `changeSet.conflicts`, and passed to `onBeforeTaskChange`, as in
  [Propagation and conflicts](../propagation/README.md).
- **React.** `scheduling` is passed to `<Gantt>` after the spread of `options`, from state: in React
  the props are the truth, so an option changed with `setOptions` on the ref would be overwritten by
  the next render.

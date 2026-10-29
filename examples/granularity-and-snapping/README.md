---
title: Granularity and snapping
description: The data step (granularity), the step a drag snaps to in each view mode, what happens to a value that is not a multiple of the step (alignInput), and Alt to snap to the data step.
category: Scheduling
order: 250
height: 610
showsIssues: true
---

# Granularity and snapping

Two steps decide where a bar can be. The **granularity** is the step of the _data_: every date,
duration and lag in the chart is a multiple of it (a day by default; here 15 minutes). The
**snap** is the step of a _drag_: a bar jumps from one multiple of it to the next, and it is the
step of the view mode (`'1h'` in the quarter-day view, `'15min'` in the hour view, `'1d'` in the day
view) unless `scheduling.snap` says another. The data has one value that is not a multiple of the
granularity on purpose, so that the `misaligned` issue and `scheduling.alignInput` are in front of you.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks timed to the quarter hour, and one (_Handoff_) that is not.
- [`options.ts`](options.ts): `scheduling.granularity`, `scheduling.alignInput` and the view mode.
- [`helpers.ts`](helpers.ts): the choices of the selects, and the sentences of the two status lines.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, three buttons and three selects.
  The React one uses `useGantt` and `useGanttState` to show the snap step the chart resolved.

## Options

| Option                   | Value                                        | What it does                                                                                                 |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `scheduling.granularity` | `'15min'`                                    | The data step: a duration that divides 24 hours; default `'1d'` (the first select)                           |
| `scheduling.alignInput`  | `'expand'`                                   | What to do with a value that is not a multiple: `'expand'`, `'nearest'`, `'reject'` (the second select)      |
| `scheduling.snap`        | left out                                     | The step of a drag; left out, the view mode's step. The third select sets a duration or `false`              |
| `viewMode`               | `'quarter-day'`                              | 6-hour columns, which snap to an hour; the buttons switch to `'hour'` and `'day'` (React: `defaultViewMode`) |
| `scroll.initial`         | `'first-task'`                               | Opens on the plan; the default, `'today'`, is far from these dates                                           |
| `onTasksChange`          | a function (in the example)                  | One `ChangeSet` per drag; the example reads the edited task's record                                         |
| `onIssues`               | a function (React); `on('issues')` (vanilla) | Called when the list of issues changes, also at creation                                                     |

## What to try

- **Drag a bar in the quarter-day view.** It moves an hour at a time (the first status line says
  `Snap step: 1h`). Switch to `hour` and it moves by 15 minutes; switch to `day` and it jumps by
  whole days: the step belongs to the view mode.
- **Hold `Alt` while you drag.** The bar snaps to the data step instead of the view mode's: with
  `Snap step: 1d` in the day view and 15 minutes of granularity, a bar that only moved by days now
  moves by quarter hours. The step is raised to the granularity if it was finer.
- **Set _Snap_ to `30min`, `1d` or `off`.** It takes the place of the step of the view mode in every
  view. `off` stops snapping to the grid, but the data stays a multiple of the granularity: the
  dragged date is aligned to it when you let go.
- **Look at _Handoff_** (13:10 to 16:35) and the first line under the chart. At 15 minutes it is
  aligned to 13:00 to 16:45 and the two `misaligned` issues say so (a warning: the value was
  corrected). Change _Align input_ to `nearest`: 13:15 to 16:30. To `reject`: the task has no bar
  at all (an error), and a suggested value is in the issue.
- **Change _Granularity_ to `30min` or `1h`.** More of the data stops being a multiple of the step,
  the list of issues grows, and the bars are aligned again.

## Notes

- **Always a multiple.** Every date, duration and lag in a record, a `ChangeSet` and an event is a
  multiple of `scheduling.granularity`. A value that is not is reported as a `misaligned` issue with
  `value`, `suggested` and a `path` (`tasks[5].start`), and corrected as `alignInput` says. It is
  the same for tasks you pass later (`setTasks`) and for `updateTask`.
- **`'expand'` only ever grows a task**: the start goes down and the end goes up, so a task never
  loses time. `'nearest'` can shrink it. `'reject'` leaves the task out and reports an error.
- **Snap.** `scheduling.snap` overrides the view mode's. It takes a duration (`'30min'`, `'1d'`,
  `'1w'`, `'1mo'`), `'unit'` for the column of the view mode, `false` for none, or an object that
  sets the step for `move`, `resize` and `progress` separately and a `mode` (`'grid'` or
  `'relative'`). A step finer than the granularity is raised to it.
- **`Alt`.** The step is the data step for as long as the key is down: drop on the quarter hour
  even where the view mode snaps to the day.
- **Day precision.** A task with date-only dates stays on whole days at any granularity
  (`scheduling.keepDayPrecision`, on by default); these tasks are timed.
- **View modes.** `setViewMode(id)` keeps the date at the centre of the chart where it is; the
  buttons pass `{ keepScroll: false }`, which scrolls to the first task again, as when the chart
  opened.
- **React.** `viewMode` is a controlled prop and `defaultViewMode` its uncontrolled twin: the example
  uses the second, so that the buttons can call `setViewMode` on the instance. `scheduling` is
  passed to `useGantt` from state, after the spread of `options`: in React the props are the truth,
  so an option changed with `setOptions` on the instance would be overwritten by the next render.
  `useGanttState` reads the resolved snap step from the chart's snapshot; destructure `setContainer`
  and `slots` from the instance and render them.

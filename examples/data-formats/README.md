---
title: Data formats
description: Every way to write the dates, durations, precision and links of a task, side by side, and how the chart reads each of them.
category: Data
order: 320
height: 620
---

# Data formats

A task's dates, its length, its precision and its links can be written in more than one way. The
chart reads all of them into one thing, a `TaskRecord` with real `Date`s, and this example writes
the same kind of plan in each shape, side by side. Each bar is named after how it was written.
Hover a bar for how the chart read it, or click it: the line under the chart shows the task as it is
in `data.ts` (`record.task`, the object you gave, which the chart never changes) and the days or
moments it covers. The checkbox flips `dates.endInclusive`, and the select zooms in far enough to
read the times of day.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): fourteen tasks in four groups, the `links` array, and `Meta`, the type of
  `task.data`.
- [`options.ts`](options.ts): the granularity, `dates`, the size of the rows, and a tooltip that
  reads the typed `data`.
- [`helpers.ts`](helpers.ts): `inputOf` writes a task as source text, `describe` says how the chart
  read it from its computed record.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, the checkbox and the select.

## Options

| Option                                 | Value          | What it does                                                                                  |
| -------------------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `scheduling.granularity`               | `'1h'`         | The step of the data: every date, duration and lag is a multiple of it, so timed tasks fit    |
| `dates.endInclusive`                   | `true`         | Whether a date-only `end` is the last day (the default) or the day after it; the checkbox     |
| `viewMode`                             | `'day'`        | The scale; the select adds `'half-day'` and `'quarter-day'` (React: state, a controlled prop) |
| `scroll.initial`                       | `'first-task'` | Opens on the plan                                                                             |
| `layout.rowHeight`, `layout.barHeight` | `28`, `18`     | Smaller rows, so that all fourteen fit                                                        |
| `display.barLabel`                     | `'outside'`    | The name goes beside the bar, whatever its length                                             |
| `tooltip.render`                       | a function     | Shows how the chart read the task, and the `note` of its typed `data`                         |
| `onTaskClick`                          | a function     | Writes the task's input and its record in the line under the chart                            |

## How each shape is read

| You write                                                                    | The chart reads                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `start` and `end` as a `Date`, `'2026-03-16'` or a number, at local midnight | A date-only value: precision `'day'`. The task covers whole days, and an `end` is the **last** day (`dates.endInclusive: true`) |
| `'2026-03-23T09:00'`, or a `Date` or a number with a time of day             | A time: precision `'time'`. The task starts and ends at exact moments, and an `end` is the moment it is over                    |
| `duration: 3`                                                                | A number of days, counted from `start`. It is used when there is no `end`: `end` wins if both are given                         |
| `duration: '3d'`, `'1w'`, `'6h'`                                             | A length with a unit. A week is seven calendar days. Hours make a timed task, whatever `start` looks like                       |
| `precision: 'time'` on date-only values                                      | The same strings read as exact moments: `'2026-03-25'` is the midnight that starts that day, so the task ends there             |
| `precision: 'day'`                                                           | Whole days. It is what date-only values are anyway; a time of day under it would be `misaligned`                                |
| `dates.endInclusive: false`                                                  | A date-only `end` is the day after the task, which ends when the day before it is over. Timed tasks and durations do not change |
| an entry of `links`                                                          | A link: `source`, `target`, a `type` (`'FS'` by default) and a `lag` (a number of days, or a duration such as `'1d'`)           |
| `dependencies` on the successor                                              | The same link, written on the task that follows: ids, or `{ id, type, lag }`. It is merged into the links                       |
| `data`                                                                       | Yours. The chart never reads it; `Task<Meta>` types it everywhere it comes back                                                 |

## What to try

- **Compare the first three bars.** `Date`, an ISO date and an epoch number are the same five days
  (16 to 20 March). Click each to see the source text next to what the chart read.
- **Flip `dates.endInclusive`.** Every bar with a date-only `end` (the first three, _precision
  'day'_ and the four link rows) loses its last day: with `false` the end is where the task stops,
  not its last day. The timed tasks, the durations and _precision 'time'_ do not move.
- **Look at the times.** _ISO date-time_ and _duration '6h'_ are timed tasks: they begin and end
  inside a day. Choose _quarter-day_ in the select to read them.
- **Compare the two precisions.** Both tasks are written `'2026-03-23'` to `'2026-03-25'`. One is read
  as three whole days, the other as two days that end at midnight.
- **Compare the two links.** The arrows between the _links[]_ rows and between the _dependencies_
  rows are the same link, a finish-to-start with a lag of a day. Click the targets to see where each
  was written.

## Notes

- **The dates are floating wall-clock time.** `'2026-03-23T09:00'` is 09:00 for every viewer, in every
  time zone, and strings with a `Z` or a UTC offset are rejected. A `Date` or a number is read
  through the local clock of the machine, so `new Date(2026, 2, 16)` (months count from 0) is
  16 March everywhere. Avoid `new Date('2026-03-16')`: JavaScript reads that string as UTC, which is
  the evening of the 15th west of Greenwich. The epoch numbers of this example are made from a `Date`
  for that reason.
- **The granularity decides what a time of day may be.** With the default `'1d'`, a timed task is
  reported as `misaligned` and widened to whole days. `'1h'` accepts the hours of this plan; a finer
  value accepts finer times. Tasks given as whole days stay on whole days
  (`scheduling.keepDayPrecision`, on by default).
- **Precision is derived from the input**, and `precision` overrides it. A date-only value is a day;
  a time of day makes the task timed, and so does a duration in hours.
- **`record` has the computed side.** `start`, `end` and `endExclusive` are `Date`s, `endExclusive`
  being the end of the half-open interval whichever way `end` was written, and `duration` counts days
  and working days. `record.task` is your task, untouched, with its typed `data`.
- **`links` is the canonical form, `dependencies` a shorthand.** Use whichever fits your data:
  the chart merges them, the `links` array first, then the dependencies in task order. If you keep
  the links in your own state (see [Controlled data](../controlled-data/README.md)), prefer the
  array: a dependency is not in the list the chart hands back, and deleting one is only reported to
  `onLinkDelete`.
- **`Task<Meta>` is the type of your payload.** It flows through `createGantt<Meta>` or the tasks of
  `<Gantt>` into the records, the tooltip's context and every handler, here
  `record.task.data?.note`.
- **React: the two options the controls change are state.** `viewMode` is a controlled prop in
  React (the chart shows the one your state holds), and `dates` comes from state too. The
  component passes both after the spread `options`, so they win. The vanilla chart changes them
  with `setViewMode` and `setOptions`.

---
title: Progress
description: Dragging the progress handle, what a resize does to the progress (progressAnchor), a colour of its own, and a boundary that skips the days off; with the progress events in the status line.
category: Scheduling
order: 270
height: 510
---

# Progress

Every bar has a done part: `progress` is a percentage of its length, and the handle at the foot of
the done part is how you change it by hand. Moving a bar keeps its percentage; resizing it asks
a question, because the bar is now longer or shorter: what stays, the part that is done or the part
that is left? `task.progressAnchor` answers it. This chart has the same bar twice, with the answer
`'start'` (the default) and `'end'`, a bar in a colour of its own, and a box that decides whether the
handle skips weekends.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks with their `progress`, `progressAnchor` and `progressColor`.
- [`options.ts`](options.ts): `scheduling.skipNonWorkingDays.progress` and the day column.
- [`helpers.ts`](helpers.ts): the sentences of the status line.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, a box and a reset button.

## Options

| Option                                   | Value                       | What it does                                                                       |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `task.progress`                          | `0` to `100`                | How much of the bar is done                                                        |
| `task.progressAnchor`                    | `'end'` on one _Build_      | What a resize keeps: the done part (`'start'`, default) or the remainder           |
| `task.progressColor`                     | `'#e8590c'` on _Review_     | The colour of the done part (`--gantt-bar-progress-color`)                         |
| `scheduling.skipNonWorkingDays.progress` | `true`                      | The handle skips the days off (default `true`; the box)                            |
| `viewModes`                              | `{ day: { pxPerDay: 30 } }` | A narrower day column than the default 40 px, so that the plan fits                |
| `scroll.initial`                         | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates                 |
| `scroll.align`                           | `0.08`                      | A margin to the left of the first task (a fraction of the width), see the notes    |
| `onTasksChange`                          | a function (in the example) | One `ChangeSet` per change; its `reason` is what the change was                    |
| `onTaskProgressChange`                   | a function (in the example) | Called with the `TaskRecord` and the new progress of a task whose progress changed |

## What to try

- **Drag the progress handle** of _Design_, _Review_ or any bar: it appears at the foot of the done
  part when you hover the bar. The status line says what the progress is now and the date the done
  part reaches.
- **Drag the right edge of both _Build_ bars** two days to the right. They had 50 % of 12 days done.
  _Build · anchor start_ keeps the six days that are done, so the percentage drops (six of 14, 43 %).
  _Build · anchor end_ keeps the six that are left, so the percentage rises (eight of 14, 57 %). Drag
  the edge two days to the left and the two swap sides (60 % and 40 %).
- **Drag the left edge** of both and it is the other way around. The done part of the anchor
  `'start'` bar moves with its start edge, and that of the anchor `'end'` bar stays where it is.
- **Move a bar.** The percentage is kept, and the status line says the progress is as it was
  (`onTaskProgressChange` is not called).
- **Drag the handle of _Build · anchor start_ back to a weekday, and then forward onto the Sunday.**
  With the box ticked the boundary jumps over the days off, to the Monday after them (58 %); with
  it unticked it rests on the Sunday (50 %). Going the other way it would jump to the Saturday.
- **Do the same with _QA_.** It counts working days, so its boundary never rests on a day off, with
  the box ticked or not: it stops at the start of the weekend.

## Notes

- **A resize rebases the progress.** With `'start'` the done amount (in days, or in working days for
  a task that counts them) stays, and the percentage changes: `progress × old / new`. With `'end'`
  the remainder stays: `100 − (100 − progress) × old / new`. Shrinking a bar below what is done
  gives 100 %. The percentage is kept exact, not rounded, so repeated resizes do not drift; only the
  date of the boundary is aligned to the data step.
- **Events.** A change is one `ChangeSet` (`onTasksChange`, with a `reason`: `'progress'` for the
  handle, `'resize-start'`, `'resize-end'`, `'move'`, …). After it, `onTaskProgressChange` is called
  for each task whose progress changed, with its record: `record.progress` and `record.progressDate`,
  the date the done part reaches. There is no event called `progressChange`.
- **Skipping days off** (`scheduling.skipNonWorkingDays.progress`) belongs to the handle. It is a
  field of the same object as `move` and `resize`, which the example leaves as they are (the
  object is replaced whole by `setOptions`, so the fields it leaves out are back to their
  defaults).
- **The colour.** `progressColor` sets the custom property `--gantt-bar-progress-color` on the bar;
  `color` does the same for the bar itself. Both can be set in your stylesheet too.
- **A margin on the left.** A drag that comes near an edge of the chart scrolls it (`scroll.autoScroll`),
  so a bar that starts at the very edge cannot be taken by its left edge without the chart moving
  under it. `scroll.align: 0.08` leaves the first bars a margin.
- **Editing.** `editing: { progress: false }` turns the handle off for the chart, and a task's own
  `editable` does it for one task.
- **React.** `scheduling` is passed to `<Gantt>` after the spread of `options`, from state: in React
  the props are the truth, so an option changed with `setOptions` on the ref would be overwritten by
  the next render.

---
title: Milestones and placeholders
description: Milestones that are points in time, drawn as diamonds and linked like tasks, and placeholder rows that have no bar, as headings and as work that is not scheduled yet.
category: Scheduling
order: 260
height: 650
---

# Milestones and placeholders

Not every row of a plan is a bar. A **milestone** (`type: 'milestone'`) is a point in time with no
length, drawn as a diamond. A **placeholder** (`type: 'placeholder'`) is a row with no bar at all: a
heading for the rows under it, or work that nobody has scheduled yet. The plan here chains five
milestones and four tasks with links, and keeps three placeholder rows.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the tasks, with `type` and `parentId`, and the links, in comments.
- [`options.ts`](options.ts): the calendar and the view mode.
- [`helpers.ts`](helpers.ts): what the button does to the tasks, and the sentences of the status line.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart and two buttons.

## Options

| Option                                 | Value                       | What it does                                                                                                          |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `task.type`                            | `'milestone'`               | A point in time at `start`; a zero length; drawn as a diamond                                                         |
| `task.type`                            | `'placeholder'`             | A row with no bar; its dates are ignored                                                                              |
| `task.parentId`                        | `'launch'`, `'backlog'`     | A placeholder can be the group of the rows under it                                                                   |
| `link`                                 | `{ source, target, lag }`   | A milestone is the source or the target of a link, like a task                                                        |
| `calendar.weekends`                    | `[]`                        | Every day is a working day, so a milestone on a Saturday is no conflict                                               |
| `layout.rowHeight`, `layout.barHeight` | `34`, `22`                  | Compact rows, so that all twelve show                                                                                 |
| `viewMode`                             | `'week'`                    | One column a week: the whole plan fits                                                                                |
| `scroll.initial`                       | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates                                                    |
| `scroll.align`                         | `0.04`                      | Where the first task lands, as a fraction of the width: a little in from the edge, so that the first diamond is whole |
| `onTaskClick`                          | a function (in the example) | Called with the `TaskRecord` of a bar that was clicked                                                                |
| `onTasksChange`                        | a function (in the example) | One `ChangeSet` per drag, with every task it moved                                                                    |

## What to try

- **Drag _Kick-off_** a day or two to the right. Every link after it moves its target: _Design_, then
  _Design sign-off_, _Build_, _Beta_, _Marketing_, _Docs_ and _Release_. The status line lists them.
- **Take a diamond by its side.** There is nothing to resize: a milestone has no edges to drag, so
  it moves, and that is all it does.
- **Click _Beta_**, and then _Build_. The status line reads the record: `type`, the date, and the
  length (none for a milestone).
- **Drag _Marketing_ to the right.** _Release_, the milestone that waits for it (and for _Docs_),
  follows it by its lag: a milestone is moved by links like any bar.
- **Press _Schedule Hiring_.** _Hiring_ was a placeholder, a row under _Backlog_ with no bar;
  now it is a task with a start and a duration, and it has a bar. Press it again and the bar goes,
  and the row stays. The other placeholders, _Launch_ and _Support rota_, have no bar either, and
  nothing to drag.

## Notes

- **A milestone has a `start` and no length.** Its `end` and `duration` are ignored. Its start and
  its end are the same moment, so a link of any type reaches the same point; `lag` counts from it.
  A milestone cannot be resized, but it can be moved, linked and given a `progress`.
- **A placeholder has no bar.** A row without dates is a placeholder too, but then the chart
  reports a `no-dates` issue: the type says you meant it. A link that touches a placeholder is kept
  but inactive: it is not drawn, not propagated, and reported as an `inactive-link` issue. Give the
  row dates and a task `type` (as the button does) and the link works.
- **A placeholder as a heading.** `parentId` makes _Launch_ the parent of three rows, a milestone
  among them; the heading has no bar, so a child is never "outside" it. Children of a
  placeholder can be shut with `collapse('launch')` as any other group (see
  [Groups and children](../hierarchy/README.md)).
- **Your tasks, your list.** The button builds a new array with the one task replaced and gives it
  to `setTasks`; the chart diffs it by `id`. Nothing you pass in is changed.
- **React.** `defaultTasks` and `defaultLinks` are where the chart starts, and then it owns the data
  (uncontrolled); `chart.current.setTasks(next)` gives it a new list.

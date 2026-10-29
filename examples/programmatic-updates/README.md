---
title: Programmatic updates
description: Change tasks and links from code with updateTask, addLink, removeLink and setTasks, and read what each call resolves to, including rejected, unchanged and cancelled.
category: Editing
order: 430
height: 760
---

# Programmatic updates

Everything a user can do with the mouse, code can do with a method: `updateTask` moves, resizes or
re-progresses a task, `addLink` and `removeLink` change the dependencies, and `setTasks` replaces
the tasks. The first three return a **promise of a result** that says what happened, so a caller
knows more than the events can tell it. Each button calls one method, and the block under the chart
shows the call and its result.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks, four links, and the `review` task that `setTasks` adds.
- [`options.ts`](options.ts): `onBeforeTaskChange` (the freeze), the view mode and the layout.
- [`actions.ts`](actions.ts): **the calls**, one for each button, and the text of their results.
- [`styles.css`](styles.css): your own styles for the rows of buttons and the result.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, the buttons and the events.

## Options

| Option                           | Value                       | What it does                                                                       |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `onBeforeTaskChange`             | a function                  | The freeze: cancels a change that makes a task end after 3 April, a drag or a call |
| `onTasksChange`                  | a function (in the example) | One `ChangeSet` for each committed call (`reason: 'api'`)                          |
| `onLinkCreate`                   | a function (in the example) | `addLink` created a link                                                           |
| `onLinkDelete`                   | a function (in the example) | `removeLink` deleted a link                                                        |
| `onIssues`                       | a function (in the example) | A rejected value is reported here too (`source: 'change-set'`)                     |
| `viewMode`                       | `'week'`                    | The scale of the timeline (React: `defaultViewMode`)                               |
| `scroll.initial`                 | `'first-task'`              | Opens on the plan                                                                  |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                  | Smaller rows, so that every task is in view                                        |

## Methods

| Method                                     | Resolves to                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `updateTask(id, { start, end, progress })` | `committed` (with the `changeSet`), `unchanged`, `cancelled`, `busy` or `rejected` (`unknown-task`, `invalid-value`) |
| `addLink(link)`                            | `created`, `cancelled`, `busy` or `rejected` (`invalid`, `unknown-task`, `duplicate`, `cycle`)                       |
| `removeLink(id)`                           | `deleted`, `cancelled`, `busy` or `rejected` (`unknown-link`)                                                        |
| `setTasks(tasks)`                          | nothing: it replaces the tasks and the chart finds the difference by id                                              |

## What to try

- **Move Build.** `start` alone moves the task and keeps its length, and QA and Launch follow
  along their links: one `onTasksChange`, with every task it moved. Press it again: the answer is
  `unchanged`, since Build is already there.
- **Resize** changes the end edge (`end` alone), **Reschedule** sets both ends, **Build to 75%**
  the progress.
- **Locked task.** Discovery is `locked`, so `updateTask` answers `unchanged` and the issue
  `locked-task`.
- **End before start** and **Unknown task** are `rejected`: the first with the issue and its path,
  the second because a task that is not there has no bar to change.
- **Past the freeze.** The before-hook cancels the change, and the call resolves `cancelled` with
  the reason `hook`. A drag that ends after 3 April is cancelled by the same hook.
- **Links.** `addLink` Docs → QA is `created`; press it again and it is `rejected` as a `duplicate`.
  QA → Design would close a cycle. `removeLink` is `deleted`, and the second time `rejected` as
  `unknown-link`.
- **setTasks.** Add Review and remove it again: the chart gets a new row and loses it.

## Notes

- **The same rules as the mouse.** A call propagates through links and children like the same
  drag and goes through `onBeforeTaskChange`, which sees `reason: 'api'`. It does not snap to the
  view mode's step and does not roll a bar onto a working day: the dates are exact. The editing
  flags and `linkable` do not apply to code (see [Read-only](../read-only/README.md)), but a
  locked task does stay put.
- **A value that does not fit.** A date off the `scheduling.granularity` is aligned (and reported
  as `misaligned`, or the call is `rejected` with `alignInput: 'reject'`). A date-only `end` is read
  the way the data is: the last day.
- **`busy`.** While a before-hook waits for an answer, `updateTask`, `addLink` and `removeLink` resolve
  `busy` and change nothing: see [Before-hooks](../before-hooks/README.md).
- **`setTasks` starts from the chart's own tasks** (`gantt.core.getSnapshot().state.tasks`),
  which hold what the user dragged. Passing your first array again would put those tasks back. In
  the uncontrolled mode used here, replacing the tasks also clears the
  [undo history](../undo-redo/README.md).
- **React.** The buttons call the methods of the handle (`ref.current?.updateTask(…)`). `tasks`
  and `links` are controlled props in React; the example passes `defaultTasks` and `defaultLinks`,
  so the chart owns its data and these calls change it. If your own state owns the tasks, change
  that state instead and let the new array reach the chart: see
  [Controlled data](../controlled-data/README.md).

---
title: Read-only and partial editing
description: Turn editing off for the whole chart or one kind of edit at a time, lock a task, forbid links to another, and read what the chart refuses from onEditRefused.
category: Editing
order: 400
height: 480
---

# Read-only and partial editing

What the **user** may do with the mouse is the `editing` option: `false` makes the chart read-only,
and an object with `move`, `resize`, `progress` and `links` turns single kinds of edit off. Two
fields of a task narrow it further: `locked` (no drag at all, but links may touch it) and
`linkable: false` (no link at all, but the bar may be dragged). Whatever the chart refuses is
reported by `onEditRefused`, which the line under the chart shows.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks; Research and Design are `locked`, Legal review is `linkable: false`.
- [`options.ts`](options.ts): the `editing` flags the chart starts with, the view mode, the first scroll and the layout.
- [`helpers.ts`](helpers.ts): the lines of the status, made from the payloads of the events.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the checkboxes, which call `setOptions({ editing })` or pass the `editing` prop.

## Options

| Option                           | Value                                                                 | What it does                                                                          |
| -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `editing`                        | `false`, or `{ move, resize, progress, links }` (all `true` at start) | Read-only, or one flag per kind of edit; a flag left out is on, `true` is the default |
| `task.locked`                    | `true` on Research and Design                                         | The task cannot be moved, resized or given progress; links may still touch it         |
| `task.linkable`                  | `false` on Legal review                                               | No link may start at or end at the task                                               |
| `onEditRefused`                  | a function (in the example)                                           | A drag the chart would not start or commit: `{ gesture, id, target, reason, at }`     |
| `onTasksChange`                  | a function (in the example)                                           | A change that was made, for contrast with the refusals                                |
| `onLinkCreate`                   | a function (in the example)                                           | A link that was drawn                                                                 |
| `viewMode`                       | `'week'`                                                              | The scale of the timeline (React: `defaultViewMode`)                                  |
| `scroll.initial`                 | `'first-task'`                                                        | Opens on the plan                                                                     |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                                                            | Smaller rows, so that every task is in view                                           |

## What to try

- Untick **editing** and drag any bar: the chart is read-only, nothing moves, and each attempt
  says `Refused (permission, at the start)`. Hover a bar: no handles are drawn.
- Tick it again and untick **resize**. Drag the edge of Backend: it _moves_ the bar, because a
  resize zone that is not allowed is just the body of the bar. Untick **move** as well and the same
  drag is refused.
- Research and Design are locked: dragging them is refused with every flag on. Draw a link from
  the round handle of Design all the same.
- Legal review has no link handles. Draw a link from Backend onto it: nothing is created, and on
  release the chart reports `link-create` refused (`permission`).
- Untick **links**: no handles at all. Untick **progress**: the little handle at the foot of
  a bar goes away.

## Notes

- **A refusal changes nothing.** The payload has the `gesture` (`'move'`, `'resize-start'`,
  `'resize-end'`, `'progress'` or `'link-create'`), the task `id` (the source, for a link) and the
  `target` of a link. `at` says when: `'start'` as the drag was about to begin, `'commit'` when it
  was let go. The `reason` is `'permission'` here; `'busy'` while a
  [before-hook](../before-hooks/README.md) waits, and `'self'`, `'cycle'` and `'duplicate'` for
  links ([Link editing](../link-editing/README.md)).
- **Only the user is limited.** `updateTask`, `addLink`, `setTasks` and the other methods ignore
  `editing` and `linkable`; only a locked task is left alone by `updateTask` too (it answers
  `'unchanged'`). See [Programmatic updates](../programmatic-updates/README.md).
- **A task can override the chart.** `task.editable` takes `true`, `false` or the same four flags,
  and wins over `editing`, in both directions: a task with `editable: true` can be edited in a
  read-only chart. `locked` and `linkable: false` still forbid what they forbid.
- **Locked work stays put in propagation, too.** When a predecessor moves, a locked successor does
  not follow, and what comes after it is not pushed either. The link is still drawn.
- **React.** `editing` is an ordinary prop, so the checkboxes are state. `viewMode` is the
  controlled one, and `defaultViewMode` is where the chart starts.

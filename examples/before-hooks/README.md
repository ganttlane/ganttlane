---
title: Before-hooks
description: Veto, rewrite or delay a change with onBeforeTaskChange, refuse a link with onBeforeLinkCreate, and see the chart stay busy while a hook has not answered.
category: Editing
order: 440
height: 580
---

# Before-hooks

Two hooks run **before** something is committed, and can stop it. `onBeforeTaskChange` sees each
change set (a drag, or a call of `updateTask`) and `onBeforeLinkCreate` each new link (a drag, or
`addLink`). A hook answers `true` to go on, `false` to cancel, and, for a change, a changed
`ChangeSet` to put in place of the one it was given. It may also answer **later**, with a promise:
the chart is `busy` until the answer comes, and refuses new gestures meanwhile.

The select picks what the task hook does, and the box whether the link hook refuses links into the
frozen Release group. The line under the chart tells what the hook did and what the chart reported.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks (Design is finished, Release and its children are frozen) and four links.
- [`options.ts`](options.ts): the view mode, the first scroll and the layout.
- [`hooks.ts`](hooks.ts): **the hooks**: veto, rewrite, ask first, and the link rule.
- [`styles.css`](styles.css): your own styles for the busy flag and the strip with the question.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the controls, the status and the busy flag (`core.subscribe`, `useGanttState`).

## Options

| Option                           | Value                       | What it does                                                                                     |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `onBeforeTaskChange`             | a function (`hooks.ts`)     | `({ changeSet, reason, conflicts })`: answers `true`, `false`, a `ChangeSet` or a promise of one |
| `onBeforeLinkCreate`             | a function (`hooks.ts`)     | `({ link, id, wouldCreateCycle })`: answers `true`, `false` or a promise of one                  |
| `onTasksChange`                  | a function (in the example) | The change that went through                                                                     |
| `onLinkCreate`                   | a function (in the example) | The link that was created                                                                        |
| `onEditRefused`                  | a function (in the example) | A gesture that the chart would not start: `busy` while a hook waits                              |
| `viewMode`                       | `'week'`                    | The scale of the timeline (React: `defaultViewMode`)                                             |
| `scroll.initial`                 | `'first-task'`              | Opens on the plan                                                                                |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                  | Smaller rows, so that every task is in view                                                      |

## What to try

- **Veto.** Pick _Veto changes to finished work_ and drag Design (100%): the bar snaps back and
  nothing is reported but the hook's own line. Drag API, which is not finished: it goes through,
  and QA follows.
- **Rewrite.** Pick _Rewrite_ and drag the progress handle of API (the little square at the foot of
  its bar) to the right end: the chart commits 80%, the hook's value, not yours.
- **Ask first.** Pick it and drag any bar. On release the bar waits where you dropped it, the flag
  says `busy: yes`, and the question has its two buttons. Try to drag another bar: `Refused (busy)`.
  Approve and the change is committed, Reject and it is cancelled.
- **Links.** With the box ticked, draw a link from QA onto Release (or Package, or Publish): the hook
  cancels it, and the chart reports no event, since nothing was refused by the chart itself. A link
  from Docs to QA is created. Untick the box, and Release can be linked. In _Ask first_ both hooks ask.

## Notes

- **What a hook may answer.** `true` or nothing goes on; `false` cancels (a drag snaps back, and
  `updateTask` and `addLink` resolve `cancelled` with the reason `'hook'`); a `ChangeSet`
  replaces the one being committed, and is checked again, so a value is aligned to the granularity
  and a task that no longer changes is dropped. A hook that throws or rejects cancels and reports
  the error to `onError`.
- **`busy` while a promise is pending.** `gantt.core.getSnapshot().busy` (React:
  `useGanttState(gantt, (snapshot) => snapshot.busy)`). No gesture starts and `updateTask` resolves
  `busy` until the answer comes; the bar that was dropped is shown where it was dropped. The same
  flag is set while controlled data holds a change that its owner has not applied yet.
- **Where hooks run, and where they do not.** `onBeforeTaskChange` runs for a drag and for
  `updateTask`, `onBeforeLinkCreate` for a link that is drawn and for `addLink`. Removing a link is
  not hooked, and neither are undo, redo and `edit.rollback()`: a hook cannot stand in the way of
  putting things back.
- **The context.** `reason` is `'move'`, `'resize-start'`, `'resize-end'`, `'progress'` or `'api'`;
  `conflicts` are the warnings the change would cause (a day off, a child outside its parent):
  [the working calendar example](../working-calendar-hourly/README.md) asks about them.
  `wouldCreateCycle` only explains: a link that closes a cycle is rejected whatever the hook says.
- **Hooks are not permissions.** `editing`, `locked` and `linkable` stop a gesture from beginning
  ([Read-only](../read-only/README.md)); a hook is asked at the end, with the whole change in hand.
- **React.** The hooks are props like any handler, and always current: `createHooks(env)` runs on
  every render, so a hook reads the state of the latest one. `viewMode` is a controlled prop, so
  `defaultViewMode` is where the chart starts.

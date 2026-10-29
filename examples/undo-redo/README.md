---
title: Undo and redo
description: Turn the history on, wire Undo and Redo buttons and Ctrl or Cmd + Z shortcuts to undo() and redo(), and watch canUndo, canRedo, the limit and onHistoryChange.
category: Editing
order: 450
height: 480
---

# Undo and redo

The history is **off by default**. With `history` on, every action is an entry: a drag, an
`updateTask`, a link that was drawn, a link that was removed. `undo()` applies the inverse of the
last entry and `redo()` puts it back; `canUndo` and `canRedo` say whether there is anything to do,
and `onHistoryChange` tells you when either flips, which is what the buttons follow.

The library has **no keyboard shortcuts yet**: it never listens for Ctrl or Cmd + Z. The example
adds its own `keydown` listener on the page (Ctrl or Cmd + Z undoes, with Shift it redoes) and calls
the same two methods as the buttons.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): seven tasks and six links.
- [`options.ts`](options.ts): `history` with its limit, the view mode, the first scroll and the layout.
- [`helpers.ts`](helpers.ts): which key press means undo or redo, `undoAll`, and the lines of the status.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the buttons, the select for the limit, the shortcuts and the events.

## Options

| Option                           | Value                       | What it does                                                                        |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `history`                        | `{ limit: 5 }`              | Undo and redo on, and the last five actions kept; `true` is on with the default 100 |
| `onHistoryChange`                | a function (in the example) | `({ canUndo, canRedo })`, only when one of them changes: the buttons follow it      |
| `onTasksChange`                  | a function (in the example) | A change set, also for an undo or a redo (`reason: 'undo'` or `'redo'`)             |
| `onLinkCreate`, `onLinkDelete`   | functions (in the example)  | A link drawn or removed, also by an undo or a redo                                  |
| `viewMode`                       | `'week'`                    | The scale of the timeline (React: `defaultViewMode`)                                |
| `scroll.initial`                 | `'first-task'`              | Opens on the plan                                                                   |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                  | Smaller rows, so that every task is in view                                         |

## Methods

| Method                    | What it does                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- |
| `undo()` and `redo()`     | Undo the last entry, redo the last undone one; they return `{ status }` at once |
| `canUndo` and `canRedo`   | Whether there is an entry to undo or to redo                                    |
| `setOptions({ history })` | Changes the limit (or turns the history off) without recreating the chart       |

## What to try

- Drag API and UI, change a progress with the little handle, draw a link from Docs to Review. Each
  is an entry, and the buttons turn on as soon as there is something to undo.
- Press **Undo**: the bar goes back, `onTasksChange` reports it with `reason: 'undo'`, and the
  call returns `undone`. **Redo** puts it back. Make a new change after an undo: `canRedo` goes
  false, because the redo entries no longer apply.
- Click the chart, then press **Ctrl+Z** (**Cmd+Z** on a Mac), and **Shift+Ctrl+Z** to redo.
  The shortcuts work while the focus is in the example.
- Undo the link you drew: it is removed, and `onLinkDelete` reports it.
- Choose **Keep the last 3 actions**, make five changes and press **Undo all**: it undoes three.
  Lowering the limit drops the oldest entries at once.

## Notes

- **What is an entry.** Committed changes (drags and `updateTask`, with everything they moved),
  link creations and link removals. Selection, scrolling and the view mode are not.
- **No hooks, but a check.** An undo or a redo does not ask `onBeforeTaskChange`, so a hook cannot
  stand in the way of putting things back ([Before-hooks](../before-hooks/README.md)). It is checked
  against the data all the same: with controlled data, an entry that no longer fits the data gives
  `stale` and clears the history. With the chart's own data, replacing the tasks with `setTasks`
  clears the history at once (`canUndo` goes false).
- **The results.** `undone`, `redone`, `empty` (nothing to do), `busy` (a hook is waiting, or
  controlled data holds a change its owner has not applied) and `stale`.
- **The limit.** `history: true` keeps the last 100 actions, `{ limit: n }` the last `n` (undo and
  redo entries together, the oldest dropped first), `{ enabled: false }` or leaving it out turns the
  history off.
- **Edit sessions.** A session that is rolled back (`edit.rollback()`) puts the history back as it
  was when the session began.
- **React.** `history` is an ordinary prop. The buttons follow `onHistoryChange` through state;
  `useGanttState` could read the flags from the snapshot instead.

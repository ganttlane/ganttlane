---
title: Keyboard editing
description: Move and resize tasks with the arrow keys, hear the result in a live region, and see what a keyboard change reports to onTasksChange.
category: Editing
order: 425
height: 560
---

# Keyboard editing

A chart can be edited without a pointer. With `keyboard.barFocus` the bars take the keyboard focus
(one tab stop for all of them), and with `keyboard.edit` the arrow keys edit the bar that has it:
Left and Right move the task one snap step earlier and later, Shift with them moves its end, and
Alt and Shift its start. Each press is a whole change, with the permissions, the propagation to
successors and children and the before-hooks of the same drag, and `onTasksChange` hears it with the
reason `move`, `resize-start` or `resize-end`.

The chart also adds a hidden live region (`role="status"`) that says the result, for a screen
reader: the task, its new dates, its working days and how many other tasks the change moved. Each bar
is named with the same facts. The list under the chart is what `onTasksChange` reported.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks and four links; Review is locked.
- [`options.ts`](options.ts): the keyboard, the snap step, the weekend and the layout.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the handler that lists the changes.

## Options

| Option              | Value                    | What it does                                                       |
| ------------------- | ------------------------ | ------------------------------------------------------------------ |
| `keyboard.barFocus` | `true`                   | The bars take the keyboard focus and are named with their dates    |
| `keyboard.edit`     | `true`                   | Left and Right edit the bar that has the focus                     |
| `keyboard.announce` | `true`                   | Selection changes are said too (editing always says its result)    |
| `selection.onClick` | `true`                   | Enter, Space and a click select the bar, and it says it is pressed |
| `calendar.weekends` | `[0, 6]`                 | Saturday and Sunday are skipped by a move, as they are by a drag   |
| `scheduling.snap`   | `'1d'` (the view mode's) | One press is one day                                               |
| `onTasksChange`     | a function               | Every press arrives here, with `changeSet.reason`                  |

## What to try

- Press Tab until a bar has a ring. Press Right: the bar moves a day, and so do the tasks that follow
  it. Press Left on a Monday: the bar goes to the Friday before, skipping the weekend.
- Hold Shift and press Right: only the end moves. Hold Alt and Shift and press Left: only the start
  moves. A task never gets shorter than one step.
- Focus Review and press Right: it is locked, so the key is left to the chart and the chart scrolls.
- Up, Down, Home and End walk the bars, and Enter selects.
- Turn on a screen reader and move a bar: it says `Design, Mar 3, 2026 – Mar 7, 2026, 80% done ·
4 working days; 1 other task changed`.

## Notes

- **One press, one change.** There is no edit mode: a press is committed (or refused) at once, so a
  save-on-change application receives one `onTasksChange` per press. A pointer drag is still one.
- **`nudge`.** The same step is a method: `gantt.nudge(id, 'move' | 'resize-start' | 'resize-end', -1 | 1)`,
  for a button of your own.
- **A task that cannot be edited that way** (locked, `editable: false`, or `editing` off for that
  kind) does not take the key, and the chart scrolls as it would without `keyboard.edit`.

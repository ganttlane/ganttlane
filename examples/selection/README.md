---
title: Selection
description: Select tasks from code, with a click or from the keyboard, select a link by clicking its arrow, read both from onSelectionChange, and show the record getTask returns in a side panel.
category: Editing
order: 420
height: 680
---

# Selection

A chart keeps a **selection**: the selected tasks (`selectedKeys`) and the selected link. Selected
bars and links are outlined. The tasks are selected by your code (`select(ids)`), and here also by a
click, with `selection.onClick`, and the link with a click on its arrow (or by code, with
`selectLink(id)`). Every change of either arrives at `onSelectionChange(selectedKeys, selectedLink)`.

With `selection.multiple`, Ctrl or Cmd + click adds a task or takes it out. With `keyboard.barFocus`
the bars can be reached with Tab, and walked and selected from the keyboard. The panel under the
chart shows the selected tasks and link as `getTask(id)` and `getLink(id)` return them.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks, one of them a parent with two children, and five links.
- [`options.ts`](options.ts): the selection, the keyboard, the view mode, the first scroll and the layout.
- [`helpers.ts`](helpers.ts): the lines of the panel and the status.
- [`styles.css`](styles.css): your own styles for the panel.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the handlers, the buttons and the panel.

## Options

| Option                           | Value                       | What it does                                                                  |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `selection.onClick`              | `true`                      | A click on a bar selects that task                                            |
| `selection.multiple`             | `true`                      | With Ctrl or Cmd, a click adds the task or takes it out                       |
| `keyboard.barFocus`              | `true`                      | The bars take the keyboard focus, with one tab stop for all of them           |
| `onSelectionChange`              | a function (in the example) | `(selectedKeys, selectedLink)`: the whole selection, after every change       |
| `onTasksChange`                  | a function (vanilla)        | A bar was dragged: the panel shows the new record                             |
| `defaultSelectedKeys`            | `['backend']` (React)       | The tasks selected at the start; the vanilla code calls `select(['backend'])` |
| `viewMode`                       | `'week'`                    | The scale of the timeline (React: `defaultViewMode`)                          |
| `scroll.initial`                 | `'first-task'`              | Opens on the plan                                                             |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                  | Smaller rows, so that every row is in view                                    |

## Methods

| Method             | What it does                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `select(ids)`      | Replaces the selected tasks; an id the chart does not know is left out           |
| `selectLink(id)`   | Selects a link by its id (`source:type:target` unless the link has its own `id`) |
| `clearSelection()` | Clears the selected tasks and the selected link                                  |
| `getTask(id)`      | The `TaskRecord` of a task: dates, progress, parent, children, conflicts, …      |
| `getLink(id)`      | The `LinkRecord` of a link: ends, type, gap, whether it can be removed           |

## What to try

- Click Design: it is outlined, and the panel shows its record. The status line is what
  `onSelectionChange` was given. Click Docs with Ctrl or Cmd held: both are selected. Do it again:
  Docs is out.
- Press Tab until a bar has a ring. Up, Down, Home and End walk the bars, Enter selects, and Ctrl or
  Cmd + Enter adds. Left and Right scroll the chart.
- Click Build: its record lists its children. Drag Build, and the panel follows: its dates change,
  and its `conflicts` count when it ends on a weekend.
- Click the arrow from Design to Build: the link is selected, with its type and its gap, and
  the tasks stay selected. Click a bar again: the link is not selected any more.
- Use the buttons: Select all, Select Backend and Frontend, Select Design → Build, Clear selection.

## Notes

- **What a click changes.** A click on a link selects it and keeps the selected tasks. A click on a
  bar or on empty space clears the selected link, and the tasks follow `selection`. Without
  `selection.onClick` a click selects no task, and `onTaskClick` is where you decide what it means.
  A drag selects nothing, with Ctrl or Cmd too.
- **The selection follows the data.** A task that leaves the data (`setTasks`) leaves the selection,
  and `select([...])` with an id that does not exist leaves it out. It is not part of the
  [history](../undo-redo/README.md).
- **React.** The selected tasks are a controlled prop of their own, `selectedKeys`
  (`defaultSelectedKeys` is the uncontrolled one), with the same `onSelectionChange`; the selected
  link is always the chart's. `useGanttState(gantt, (snapshot) => snapshot.selection)` reads both. A
  record is frozen and the same object until its task changes, so a list of records that are
  compared one by one re-renders only when one of them did.

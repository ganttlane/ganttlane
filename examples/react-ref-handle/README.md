---
title: The ref handle
description: Every method of a chart from buttons, through the ref of the Gantt component - view mode, scrolling, selection, updates, undo and redo, and an edit session.
category: React
order: 610
height: 520
---

# The ref handle

React only. A `ref` on `<Gantt>` is the chart's **handle**: `scrollToTask`, `setViewMode`, `select`,
`updateTask`, `undo`, `edit.begin` and the other methods of the vanilla chart (without `destroy`,
which React does), for code that does not run while rendering, such as a click handler. The buttons
above the chart call them, and the first line under the buttons says what each call returned.

```sh
pnpm add @ganttlane/react react react-dom
```

## Files

- [`data.ts`](data.ts): nine tasks over seven weeks and the links between them.
- [`options.ts`](options.ts): the view mode, `history` and the first scroll.
- [`react.tsx`](react.tsx): the `ref`, a table of buttons (each is one call on the handle), a
  listener added with `on`.

## Options

| Option                         | Value                       | What it does                                                                  |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| `ref`                          | `useRef<GanttHandle>(null)` | The handle: the methods of the chart                                          |
| `defaultViewMode`              | `'day'`                     | The scale of the timeline; the chart owns it, so `setViewMode` sticks         |
| `history`                      | `true`                      | Records every change, so that `undo()` and `redo()` have an entry to step     |
| `scroll.initial`               | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates            |
| `defaultTasks`, `defaultLinks` | the tasks and links         | Where the chart starts with its data; it owns it, and `updateTask` changes it |

## What to try

- **View.** _Week_ and _Month_ change the scale and keep the date at the centre in place. _Go to
  Launch_ scrolls on both axes (the bar is below and to the right of the first screen).
- **Select.** _Select Design_ selects the task in code, and its bar is drawn selected. A click on an
  arrow selects a link instead (a click on a bar does not select a task). The second line under the
  buttons is a listener added with `on('selectionChange', …)`: it hears both, as `(tasks, link)`.
- **Change.** _Design +10%_ is `updateTask` with a `progress`. _Build +1 week_ is `updateTask`
  with a `start`: Build keeps its length and the tasks that follow it move along the links, so the
  status line counts more than one changed task. Both are recorded: _Undo_ and _Redo_ step through
  them, and say `empty` when there is nothing to step to.
- **Edit session.** _Edit_ opens a session (`edit.begin()`). Drag some bars, then _Cancel_ puts
  every bar back, or _Save_ keeps them and counts the net changes.

## Notes

- **The handle is for commands, not for rendering.** It is the same object for the life of the
  component and calling a method does not render anything. To show a part of the chart's state in
  your UI (whether `undo()` can step, which tasks are selected, the visible dates) read it with
  `useGanttState`: see [Hooks](../react-hooks/README.md).
- **`ref.current` is `null`** before the chart is committed and after the component unmounts (and
  while a hidden `<Activity>` has the chart), so write `chart.current?.…`. It is set before the
  layout effects of the parent run, so an effect may use it at once, as the `on` call here does.
- **Listeners.** `on(name, handler)` takes the events of the `on<Event>` props
  (`selectionChange` for `onSelectionChange`) and returns the function that removes the listener,
  which is what an effect returns. Use the props for what belongs to a render, and `on` for a log or
  an analytics call.
- **Controlled props win.** `viewMode`, `tasks`, `links`, `expandedKeys` and `selectedKeys` have a
  prop that makes the group yours. Then a method of the handle (`setViewMode`, `select`,
  `collapse`, …) calls your handler and the chart goes back to what your state says, unless the
  handler changes your state. Here the chart owns them (`defaultViewMode`, `defaultTasks`), so the
  methods stick. The other way is shown in
  [Controlled state](../react-controlled-state/README.md).
- **Results are values.** `updateTask` resolves to `committed` (with the `changeSet`), `unchanged`,
  `rejected`, `busy` or `cancelled`; `undo()` and `redo()` to `undone` / `redone`, `empty`, `stale`,
  `busy` or `cancelled`; `edit.begin()`, `commit()` and `rollback()` to a status too (`begun`,
  `already-open`, `committed`, `rolled-back`, `no-session`, …). Nothing throws for a refused change.
- **`TData` flows through the handle**: `useRef<GanttHandle<Meta>>(null)` for tasks with a typed
  `data`, as in [A release plan](../release-plan/README.md).

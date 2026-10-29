---
title: Controlled state
description: Tasks, links, view mode, selection and open phases all live in your own reducer and the chart follows, with patchTasks and an inspector that shows the state change.
category: React
order: 630
height: 760
---

# Controlled state

React only. Five groups of the chart can be yours: `tasks`, `links`, `viewMode`, `selectedKeys` and
`expandedKeys`. This example keeps all five in one `useReducer` and gives them to `<Gantt>` as
props. The chart never changes them. What it does by itself (a drag, a click, an arrow you draw)
reaches your reducer through a handler, and the chart shows whatever your state says afterwards.
Any other part of your application can change the state too, and the chart follows. The inspector
under the chart is that state, with the field the last action changed marked.

```sh
pnpm add @ganttlane/react react react-dom
```

## Files

- [`data.ts`](data.ts): the plan, with its dates written in four shapes, and its links.
- [`options.ts`](options.ts): the view mode the state starts with, the size of the rows and the
  first scroll.
- [`state.ts`](state.ts): the state, the actions and the reducer, with `patchTasks`.
- [`react.tsx`](react.tsx): `useReducer`, `<Gantt>` with the controlled props and their handlers,
  and the toolbars.
- [`inspector.tsx`](inspector.tsx) and [`styles.css`](styles.css): the inspector.

## Options

| Option                                                      | Value                 | What it does                                                            |
| ----------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `tasks`                                                     | `state.tasks`         | The data is yours; the chart reports changes and shows them as drafts   |
| `links`                                                     | `state.links`         | The links, the same way                                                 |
| `viewMode`                                                  | `state.viewMode`      | The scale of the timeline                                               |
| `selectedKeys`                                              | `state.selectedKeys`  | The selected tasks                                                      |
| `expandedKeys`                                              | `state.expandedKeys`  | The open phases: `'all'` or a list of ids                               |
| `onTasksChange`                                             | a function            | A `ChangeSet` for every change; the reducer writes it with `patchTasks` |
| `onLinksChange`                                             | a function            | Your links with the arrow that was drawn or removed                     |
| `onViewModeChange`, `onSelectionChange`, `onExpandedChange` | functions             | What the chart changed by itself, for your state to take in             |
| `onTaskClick`                                               | a function            | A click on a bar selects the task in the state                          |
| `ref`                                                       | `useRef<GanttHandle>` | The model a change set needs, and `collapseAll()` for the experiment    |
| `layout.rowHeight`, `layout.barHeight`                      | `36`, `22`            | Smaller rows, so that the plan and the inspector fit                    |
| `scroll.initial`                                            | `'first-task'`        | Opens on the plan                                                       |

## What to try

- **Drag a bar** and watch the inspector. Drag Design: the change set holds Design, its two
  children and everything that follows along the links, and `patchTasks` writes all seven into
  your tasks. They keep the shape they had: an ISO string stays an ISO string, Visuals keeps its
  `duration` and only its start changes, the epoch numbers of Backend stay numbers, and the
  `Date`s of Frontend stay `Date`s.
- **Click a bar.** `onTaskClick` puts the task in `selectedKeys`, and the chart draws it
  selected. Click a task in the inspector's list instead: the state changes from outside the chart
  and the chart follows.
- **Press the buttons.** The view mode, _Collapse all_ and _Expand all_ change the state, and the
  chart is brought to it.
- **Draw an arrow.** Hover a bar and drag its round handle onto another bar: the chart gives the
  list with the new arrow to `onLinksChange`, and draws it once your state has it.
- **Refuse a change.** Tick the box and press _Chart: collapseAll()_. The chart tries to close
  the phases and tells `onExpandedChange`, which the reducer now ignores: the phases open again at
  once, because `expandedKeys` is still `'all'`. Untick the box, and the reducer takes the change
  in: `expandedKeys` becomes `[]`.

## Notes

- **A group is controlled by its prop**, given the first time the chart renders, and it stays
  that way (switching is reported in development and ignored). `defaultTasks`, `defaultLinks`,
  `defaultViewMode`, `defaultSelectedKeys` and `defaultExpandedKeys` are the uncontrolled twins.
  `<Gantt>` has no `dataMode` prop: `tasks` is what makes the data controlled.
- **A handler is the chart's report, not a change.** The view mode, the selection and the open
  phases go back to their prop at once when your state does not follow, as the experiment shows.
  A task change stays a **draft**, drawn over your tasks, until you hand new tasks back (the same
  array again is nothing; a new one is your answer, and a new one with the old content refuses
  the change). An arrow is added only when you hand back the links.
- **`patchTasks(tasks, changes, model)`** writes a `ChangeSet` into your own tasks, in the shape
  each one has, and returns a new array (the same one if nothing changed). It never mutates what
  you pass. The `model` is the one the change set was computed on, which is the chart's own:
  `chart.core.getSnapshot().state.derived.model`. The reducer stays a pure function because the
  model travels in the action.
- **Give the chart the same array until something changes.** The reducer returns the state it was
  given when an action changes nothing, so a click on the selected task does not hand the chart a
  new `selectedKeys`. Anything you derive from the tasks for the chart should be memoized; the
  inspector derives for itself, and what it shows is not given to the chart.
- **`onSelectionChange` also reports the selected arrow**, as its second argument. A click on an
  arrow does not change `selectedKeys`, so the reducer sees the same keys and does nothing.
- **The epoch numbers depend on the time zone.** They are made from `new Date(2026, 2, 16)`, the
  local midnight, so they differ from one machine to another, and read as the same days on each.
- **`useState` works as well.** The five groups are plain props; a reducer is only convenient
  because they change together (_Reset_ puts all five back). For the simpler case with one group
  see [Controlled data](../controlled-data/README.md), and for an edit session that saves or
  cancels, [Edit session](../edit-session/README.md).

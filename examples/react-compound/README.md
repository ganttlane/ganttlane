---
title: GanttRoot, GanttChart and useGanttBar
description: A chart, a task list, a toolbar and a panel that follows the selected bar, as separate components that share one chart through GanttRoot, with no prop to hand it down.
category: React
order: 625
height: 480
---

# GanttRoot, GanttChart and useGanttBar

React only. `<GanttRoot>` makes a chart (it takes the options `<Gantt>` takes) and shares it with
everything below it; `<GanttChart>` is the element the chart is drawn into, wherever you put it.
The pieces of the page are components of their own, and none is handed the chart as a prop:

- `Toolbar` reads the chart with `useGanttContext()` and its state with `useGanttState(selector)`.
- `TaskList` takes the chart of the root when it is given none.
- `TaskPanel` calls `useGanttBar(id)` for the selected task, and goes with its bar.

```sh
pnpm add @ganttlane/react react react-dom
```

## Files

- [`data.ts`](data.ts): seven tasks and the links between them.
- [`options.ts`](options.ts): the view mode, `history`, selection by click and the first scroll.
- [`react.tsx`](react.tsx): `Example` (the root), `Toolbar` and `TaskPanel`.
- [`styles.css`](styles.css): the layout of the pieces, and the panel.

## Options

| Option                         | Value                                        | What it does                                                               |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| `defaultViewMode`              | `'week'`                                     | The scale of the timeline; the chart owns it, so the toolbar can change it |
| `history`                      | `true`                                       | Records every change, so that Undo and Redo have something to say          |
| `selection`                    | `{ onClick: true, clearOnEmptyClick: true }` | A click on a bar selects the task, which is what the panel follows         |
| `scroll.initial`               | `'first-task'`                               | Opens on the plan; the default, `'today'`, is far from these dates         |
| `defaultTasks`, `defaultLinks` | the tasks and links                          | Where the chart starts with its data; it owns it from then on              |

## What to try

- **Select a bar.** The panel appears under it, with the task's dates and progress.
- **Drag the bar.** The panel goes with it, and its dates change as the bar's do: they are the
  `draft` of `useGanttBar`, the values the chart shows before the change is committed. The border
  turns dashed while `isDragging` is true.
- **Scroll the chart.** The panel stays under the bar, and goes away when the bar is out of view.
  `box` is in px from the corner of the chart's element, the scroll taken off.
- **Change the view mode, or drag a bar and undo.** The toolbar is a component with no props.

## Notes

- **`GanttRoot` draws no element.** It renders its children and the portals of the slots, so what
  a slot draws sees the same context (`renderBarLabel` may call `useGanttBar` too).
- **A context cannot know `task.data`.** `GanttRoot` infers it from its props; below it, name it:
  `useGanttContext<MyData>()`, `useGanttBar<MyData>(id)`.
- **`useGanttBar` follows frame by frame.** `box` changes while the chart scrolls and the bar is
  dragged, so the component that calls it renders then. Keep it in a component of its own, as here,
  and read the selection alone with `useGanttState`.
- **One `GanttChart` per root.** A second one is reported in development.
- **Without a root.** `useGanttBar(id, gantt)` and `useGanttState(gantt, selector)` take a chart
  from `useGantt` instead, and `<Gantt>` is still the chart in one element.

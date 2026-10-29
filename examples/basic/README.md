---
title: Basic chart
description: Four tasks, three links, two event handlers and a few methods, with the vanilla renderer and with React.
category: Basics
order: 10
---

# Basic chart

A chart with four tasks, three links and two event handlers, made with
[`@ganttlane/dom`](../../packages/dom/README.md) and, in React, with
[`@ganttlane/react`](../../packages/react/README.md). The buttons above the chart call methods
(`setViewMode`, `scrollToTask`) without recreating it.

```sh
pnpm add @ganttlane/dom              # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the tasks and the links.
- [`options.ts`](options.ts): the options the example is about.
- [`vanilla.ts`](vanilla.ts): `createGantt`, the handlers, the buttons and the clean-up.
- [`react.tsx`](react.tsx): `<Gantt>` with the same data and options.

## Options

| Option           | Value                       | What it does                                                                                       |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `viewMode`       | `'week'`                    | The scale of the timeline: columns are weeks                                                       |
| `scroll.initial` | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates                                 |
| `onTaskClick`    | a function (in the example) | Called with the `TaskRecord` of a bar that was clicked, never after a drag                         |
| `onTasksChange`  | a function (in the example) | One `ChangeSet` per drag, with every task it moved (the dragged task and the tasks that follow it) |

## What to try

Drag a bar to move it: its successors follow along the links. Drag its edges to resize it, and the
little handle at the foot of a bar to change its progress. Drag from the round handle beside a bar
onto another bar to link them, click an arrow to open its menu (remove the dependency), and hover a
bar for its tooltip. `Escape` cancels a drag, and holding `Alt` while dragging snaps to the data
step instead of the view mode's.

## Notes

- **The container needs a height.** The chart fills it and scrolls inside it. Give it one with CSS
  (`<div id="chart" style="height: 380px">`), with `style` or `className` on `<Gantt>`, or give the
  chart its own with `layout.height`.
- **Import the stylesheet once**: `@ganttlane/dom/styles.css`, or `@ganttlane/react/styles.css` in
  a React app (it is a copy, so an app that installed only `@ganttlane/react` can import it).
- **Clean up.** `destroy()` removes every node, listener and timer the chart added, and is safe to
  call twice. `<Gantt>` does it when it unmounts.
- **React: controlled and uncontrolled props.** `defaultTasks` and `defaultLinks` are where the
  chart starts, and then it owns the data. `viewMode` is the other kind: the chart shows the one
  you pass, so the buttons here change it through state. Object props such as
  `scroll={{ initial: 'first-task' }}` may be written inline: they are compared by content.
- **React: the methods.** Give the component a `ref` (`useRef<GanttHandle>(null)`, then
  `ref.current?.scrollToTask('qa')`). To keep the data in your own state instead, see
  [Controlled data](../controlled-data/README.md).

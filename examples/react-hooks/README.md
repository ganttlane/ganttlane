---
title: useGantt and useGanttState
description: A chart made with useGantt and a toolbar outside it, driven by useGanttState - the view mode, undo and redo, the dates in view and the edit session.
category: React
order: 620
height: 560
---

# useGantt and useGanttState

React only. `useGantt(options)` is `<Gantt>` without the `div`: it returns the chart's **instance**,
and you render the element the chart fills and the place of its slots yourself.
`useGanttState(instance, selector)` reads a slice of the chart's state while a component renders,
and renders it again only when that slice changes. Together they let a toolbar live **outside** the
chart: the one above the chart here is a component of its own, which gets the instance, shows the
chart's state and calls its methods. The component that owns the chart (`Example`) is not
subscribed to anything, so it does not render again when the chart's state changes.

```sh
pnpm add @ganttlane/react react react-dom
```

## Files

- [`data.ts`](data.ts): seven tasks and the links between them.
- [`options.ts`](options.ts): the view mode, `history` and the first scroll.
- [`react.tsx`](react.tsx): `Example` (the chart, with `useGantt`), `Toolbar` and `Readout` (the
  state, with `useGanttState`).

## Options

| Option                         | Value               | What it does                                                                |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| `defaultViewMode`              | `'week'`            | The scale of the timeline; the chart owns it, so the toolbar can change it  |
| `history`                      | `true`              | Records every change, so that `canUndo` and `canRedo` have something to say |
| `scroll.initial`               | `'first-task'`      | Opens on the plan; the default, `'today'`, is far from these dates          |
| `defaultTasks`, `defaultLinks` | the tasks and links | Where the chart starts with its data; it owns it from then on               |
| `renderTooltip`                | a function          | A tooltip as React; it is what makes the `slots` element needed             |

## What to try

- **View mode.** The select shows the mode the chart is in, and changes it. The dates in view
  under the chart change with it.
- **The dates in view.** Scroll the chart sideways: the line under it follows. It reads
  `getVisibleRange()`, which makes a new object on every call, so the selector is given an
  `isEqual` to say when two ranges are the same. Nothing else renders while you scroll.
- **Undo and redo.** Drag a bar: _Undo_ turns on. Press it, and _Redo_ turns on. Neither is a
  prop of anything: `useGanttState` reads `canUndo` and `canRedo` again whenever the chart changes.
- **Dirty.** _Edit_ opens an edit session, and the first drag in it makes the session dirty: the
  label says _Unsaved changes_ and _Save_ turns on. _Discard_ puts every bar back (the chart owns
  the data, so it does that by itself).
- **Selected.** The line under the chart also lists the selected tasks, from
  `snapshot.selection.tasks`. Nothing in this chart selects a task by itself (a click on a bar
  does not), but `select(['qa'])` on the instance would show up there.

## Notes

- **`setContainer` and `slots`.** `setContainer` is the ref of the element the chart fills, which
  needs a height. `slots` is a stable element that draws the portals of `renderTooltip`,
  `renderLinkMenu` and `renderBarLabel`: render it next to the container, below the providers
  their content should see. Destructure the two from the instance, as here: the
  `react-hooks/refs` lint rule otherwise reads `gantt.setContainer` as a ref read during render.
- **The instance is one object.** It is the same for the life of the component, also under
  StrictMode, so it can be passed down as a prop and nothing renders because of it.
- **A selector gets the snapshot.** `(snapshot) => snapshot.viewMode.id`,
  `snapshot.selection.tasks`, `snapshot.state.session`, and so on. The default `isEqual` is
  `Object.is`: pick primitives, or parts of the snapshot, which keep their identity until they
  change. A selector that builds a new object or array each time needs an `isEqual`, or the
  component renders on every change of the chart.
- **A selector may read the instance.** `canUndo`, `canRedo` and `edit.isDirty` are not in the
  snapshot, but they change together with it, so `() => gantt.canUndo` is a valid selector.
- **One component, one render.** A component renders again when any of the slices it reads
  changes, so `Toolbar` (five slices) renders on an undo, a drag that is dropped, or a new view
  mode, and not on a scroll; `Readout` renders on a scroll. Split what changes often from what
  does not, as here.
- **A controlled mode is the other choice.** `viewMode` is a controlled option: `useGantt({ viewMode })`
  would make your state the truth, and `gantt.setViewMode()` would be put back unless you update
  that state in `onViewModeChange`. This example lets the chart own the mode (`defaultViewMode`);
  [Controlled state](../react-controlled-state/README.md) keeps it yours.
- **Anything with a snapshot works.** `useGanttState` takes a chart from `useGantt`, its `core`,
  a core from `createGanttCore`, or the `ref` handle of `<Gantt>`
  ([The ref handle](../react-ref-handle/README.md)).

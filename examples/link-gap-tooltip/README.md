---
title: Link gaps in a tooltip
description: A tooltip with one row for each predecessor of a task, saying how far the task sits from it, measured between the bars and true during a drag.
category: Customization
order: 545
---

# Link gaps in a tooltip

The tooltip of a task lists its predecessors, one row per link, with how far the task sits from each:
`Design: 3 days after`, `Backend: 1 day before`, `Build: no gap`. A task counted in working days
says so (`Review: 2 working days after`), and the weekend in between does not count.

The numbers are the distance between the bars as they are drawn, also while a bar is being dragged.

```sh
pnpm add @ganttlane/dom @ganttlane/core                     # vanilla
pnpm add @ganttlane/react @ganttlane/core react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks and six links, with a task that has two predecessors and each kind
  of row: after, before, no gap, start to start, working days.
- [`options.ts`](options.ts): `tooltip.delay` and `placement`, `scheduling.propagation`, the first
  scroll.
- [`helpers.ts`](helpers.ts): `gapRows`, which measures the links and puts each distance in words.
  The vanilla and the React file both draw what it returns.
- [`styles.css`](styles.css): the tooltip's own markup, its own styles.
- [`vanilla.ts`](vanilla.ts): a `tooltip.render` that returns a DOM node, and a select for the
  propagation.
- [`react.tsx`](react.tsx): a `GapCard` component returned from `renderTooltip`, and the same select.

## Options

| Option                   | Value                | What it does                                                                        |
| ------------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `tooltip.delay`          | `100`                | Milliseconds a hovered bar waits before it shows the tooltip                        |
| `tooltip.placement`      | `'bottom'`           | The preferred side of the bar; it flips by itself when there is no room             |
| `tooltip.render`         | a function (vanilla) | Returns the content: a DOM node here                                                |
| `renderTooltip`          | a function (React)   | Returns a `ReactNode`; replaces `tooltip.render` when both are given                |
| `scheduling.propagation` | `'preserve-lag'`     | `'none'` moves only the task you edit, so that dragging a predecessor changes a gap |
| `task.durationMode`      | `'working'` (Launch) | Per task: its lengths and the gaps of the links into it count working time          |
| `link.type`, `link.lag`  | `'SS'`, `3` (Docs)   | Per link: which edges the gap is between, and the gap the link asks for             |

## What to try

- **Hover _Build_.** It has two predecessors: it starts 3 days after the end of _Design_, and 1
  day before the end of _Backend_.
- **Drag _Build_ to the right.** The dates and both rows change with every day it crosses: the
  _Backend_ row goes from `1 day before` through `no gap` to `1 day after`.
- **Drag an edge of _Build_.** The left edge changes the rows, because these links end at its
  start. The right edge changes the dates and leaves the rows.
- **Drag _Docs_ one day to the left.** A drag does not land on a weekend here, so it goes to the
  Friday. That is less than the 3 days its link asks for, so the link turns red, and the row says
  `no gap`: how far the two tasks really are, while the lag of the link still says 3.
- **Hover _Launch_.** On the screen it starts 4 days after the end of _Review_, and the row says 2
  working days: the weekend does not count. Drag it to the Friday before, and the _Docs_ row says
  `no working days between`.
- **Drag _Design_, with Propagation at `preserve-lag` and then at `none`.** Its tooltip has no rows,
  as it has no predecessors. Hover _Build_ after each drop. With `preserve-lag`, _Build_ moved
  along, so its row for _Design_ stays and the one for _Backend_ changes. With `none`, it is the other
  way around.

## What the numbers mean

A row is `measureLag` from the edge of the predecessor to the edge of the task that the type of the
link names (`linkAnchors`, `anchorTime`), counted in the task's `durationMode` with the chart's
calendar and granularity. That is how the chart itself decides whether a link is broken.

The dates of both bars come from `selectTaskPatch(snapshot.state, id)`: the drag in progress over the
committed data. So the numbers during a drag are what the drop would leave, and they stay right for a
predecessor that moves along in the same drag (a child of the dragged task, say).

The type at the end of a row says which edges those are. `FS` is the end of the predecessor to the
start of the task, `SS` start to start, `FF` end to end, `SF` start to end.

## Notes

- `context.predecessors[n].lag` looks like the answer, and is not. The record comes from the committed
  link graph, so it stays where it was during a drag, while `preview` in the same context moves. And
  an explicit `Link.lag` is what the link asks for, not what the bars do: after a drop that breaks the
  link, or with `propagation: 'none'`, the two differ. Read it for the gap a link keeps; measure for
  the gap there is.
- The context of `render` has no calendar, granularity or draft, so the function reads them from the
  chart: `gantt.core.getSnapshot()` in vanilla, the `core` of the `<Gantt>` ref in React. The vanilla
  `render` closes over `gantt`, the React one over the ref; both run only after the chart exists.
- `render` is asked again when the task's own drag moves or the data changes, not when another task
  is dragged. With the default `showWhileDragging` that never shows: a drag brings up the tooltip of
  the dragged task. A click tooltip kept open with `trigger: 'click'` and `showWhileDragging: false`
  keeps the rows it has while another task is dragged, and has the new ones at the drop.
- Measure `successors` in the context the same way, from this task to the other.
- The React card takes its rows from the `renderTooltip` callback, which the chart calls with each
  change. It is a plain component, and is drawn from what it is given.

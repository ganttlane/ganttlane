---
title: Task list beside the chart
description: A sticky list of task names and dates on the left of the chart, with rows that line up with the bars, toggles for the groups, selection, hover and the keyboard.
category: Customization
order: 590
height: 570
---

# Task list beside the chart

A classic gantt tool has a grid on the left: the task names, indented by their depth, with a column
of dates, and the bars to the right of it on the same rows. The chart has no such column of its
own, and does not need one: it tells you where its rows are, and a list you draw yourself lines up
with them. This one has

- **a label for every visible row**, at the row's height and place, indented by depth, with the
  dates as a second column, under a header as tall as the chart's;
- **toggles** on the groups (`expand` and `collapse`), and keys: Up and Down move, Left and Right
  shut and open a group, Enter selects and scrolls to the bar (`role="tree"`, with `aria-expanded`
  and `aria-level`);
- **a click on a name** that selects the task and scrolls the chart to its bar (`select`,
  `scrollToTask`), and a click on a bar that selects its row in the list (`onTaskClick`);
- **hover both ways**: a name lights its row in the chart, and a bar (or its row) lights its name;
- **dates that follow a drag** (`onTasksChange`), and rows that still line up after a change of the
  row height, the view mode, the theme, or what is collapsed.

The list is plain markup that reads the chart's snapshot. Nothing here is part of the library.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): thirty tasks in four groups, nested two levels deep, with a few links.
- [`options.ts`](options.ts): `layout` (the sizes, and `height: 'auto'`), the stripes and the view.
- [`helpers.ts`](helpers.ts): the list's rows from a snapshot, the dates text, what each key does
  (`treeAction`), and `keepRowAt`, which lets `scrollToTask` scroll sideways only.
- [`styles.css`](styles.css): the list's own styles, in the sizes the chart reports.
- [`vanilla.ts`](vanilla.ts): the markup, the list drawn from `gantt.core.getSnapshot()` and kept
  by `gantt.core.subscribe`, the events and the toolbar.
- [`react.tsx`](react.tsx): the same with `useGantt` and `useGanttState`.

## Options

| Option                                             | Value                       | What it does                                                                                                                 |
| -------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `layout.height`                                    | `'auto'`                    | The chart is as tall as its rows and does not scroll vertically: the box around the list and the chart does, header stuck    |
| `layout.rowHeight`, `barHeight`, `headerRowHeight` | `36`, `22`, `28`            | The sizes the list reads back (`snapshot.layout.rows`); the **Row height** select changes them with `setOptions({ layout })` |
| `display.rowStripes`                               | `'group'`                   | Zebra stripes for each group; the list draws the same bands from `Row.groupStripe`                                           |
| `viewMode`                                         | `'week'`                    | The scale (React: `defaultViewMode`); the **View** select calls `setViewMode`                                                |
| `theme`                                            | `'auto'`                    | The **Theme** select; the list follows the `data-theme` of the chart's root (see Notes)                                      |
| `calendar.weekends`                                | `[]`                        | Every day is a working day, so a bar dropped on a weekend is no conflict to explain                                          |
| `scroll.initial`                                   | `'first-task'`              | Opens on the plan                                                                                                            |
| `onTaskClick`                                      | a function (in the example) | A click on a bar selects its task: `select([id])`                                                                            |
| `onTasksChange`                                    | a function (in the example) | One `ChangeSet` per drag; the status line says what moved, and the list shows the new dates                                  |
| `onExpandedChange`                                 | a function (in the example) | The open groups after `expand`, `collapse`, `expandAll` and `collapseAll`, from the list, a button or code                   |

## What the list reads

| From the chart                                  | Used for                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `snapshot.state.derived.rows`                   | The visible rows in order: `depth`, `hasChildren`, `isExpanded`, `groupStripe`              |
| `gantt.getTask(id)`                             | The name, the dates, the parent and the siblings of a row (`aria-setsize`, `aria-posinset`) |
| `snapshot.layout.rows`                          | `rowHeight` and `headerHeight`, which become `--task-list-row-height` and `-header-height`  |
| `gantt.getRowMetrics(id)`                       | Where a row lies, for the band that lights the hovered row across the chart                 |
| `snapshot.selection.tasks`                      | The selected rows (`aria-selected`), wherever the selection was made                        |
| `snapshot.feedback.hover`                       | The task whose bar, or whose row, the pointer is on in the chart                            |
| `snapshot.viewportHeight`, `snapshot.scrollTop` | `keepRowAt`: how far down the visible rows a clicked row is                                 |
| `gantt.core.subscribe(listener)`                | Called after every change of the snapshot: how the list hears of new rows, names and dates  |

## What to try

- **Scroll.** Wheel over the names or over the chart: one box scrolls, and the rows stay together.
  The headers stay at the top, and so does the list when the chart scrolls sideways.
- **Click a name** far down the list (_Release_): the chart scrolls sideways to its bar and
  selects it; the box does not move. Click a bar: its name is selected.
- **Open and shut.** Click the chevron of _Build_, or press Left with the focus on it: its nine tasks
  leave the list and the chart together. _Collapse all_ and _Expand all_ are buttons of the page,
  and the list follows them the same way.
- **Drag a bar**, say _Research_, to the right: its dates change, and so do the dates of what it
  pushed (the links).
- **Change the Row height**, the **View** or the **Theme**: the rows still line up.
- **Use the keyboard.** Tab to the list, then Up, Down, Home, End, Left and Right. Enter selects the
  row and scrolls the chart to its bar. A row you move to scrolls into view below the header.

## Notes

- **One box scrolls both, and why.** With `layout.height: 'auto'` the chart is as tall as its rows
  and the nearest ancestor that scrolls (here `.task-list-scroller`) scrolls it, while the header of
  the chart sticks to the top of that box. The list is a second column in the same box with a sticky
  header of its own, so wheel, touch, scrollbar and keyboard move both with no code and nothing to
  keep in step. The other design is a chart of a fixed height with its own scroller, and a list
  that is synced to it: the chart tells the list where it is (`on('scroll')`, `y`), which works,
  but there is no call to scroll the chart from the list, so the list would have to write the
  `scrollTop` of the chart's `.gantt__scroller` by itself, and each side would move the other from
  a `scroll` event, which arrives after the browser has already moved the first.
- **The trade-offs of one box.** The sideways scrollbar belongs to the chart's scroller, which is as
  tall as its rows, so it is under the last row (invisible with overlay scrollbars; sideways wheel
  and touch work anywhere over the chart, and a click on a name scrolls to the bar). The chart
  draws the rows in view and five more on each side after a scroll, as a chart of a fixed height
  does, so a fling much faster than that can show an empty chart row for a frame. And the box is
  yours: it needs a height, and nothing between it and the chart may clip (`overflow: hidden`).
- **Why `keepRowAt`.** `scrollToTask` scrolls on both axes, and `alignY` takes a place in the
  viewport (`'start'`, `'center'`, `'end'` or a fraction), not "leave it". A click on a visible name
  would move the row away from the pointer, so `keepRowAt` passes the fraction at which the row
  already is. A row that is not in view is centred.
- **When the list renders.** `subscribe` runs for every change of the snapshot: a scroll frame, a
  hover and a drag preview are each one. The parts of the snapshot keep their identity until they
  change, so the list compares `state.derived` (new when a group opens or shuts, and when a name or
  a date changes) and `layout.rows` (new when a size does), and rebuilds only then. What is left for
  every snapshot is a few attributes. It draws every row: for thousands, draw only the rows from
  `snapshot.window.firstRow` to `lastRow` (what the chart itself draws) between two spacers.
- **Colours.** The chart declares its colours on `.gantt`, which a list beside it cannot inherit,
  so `styles.css` has a small palette of its own (`light-dark()`, the values of the default theme)
  and takes its `color-scheme` from the `data-theme` of the chart's root (`:has()`): the theme select,
  the site's toggle and `prefers-color-scheme` (`'auto'`) all reach the list that way.
- **Hover.** The chart lights no row of its own, only a bar, so when the pointer is on a name the
  example lays a band (`.task-list__band`) over the chart's row, at `headerHeight +
getRowMetrics(id).y`. The other way round, `snapshot.feedback.hover` names the task of the
  pointer's row even where there is no bar (`onTaskHoverChange` names bars only), so the whole row
  of the chart lights its name.
- **React.** `useGantt` and `useGanttState`, not `<Gantt ref>`. The list is drawn from the chart's
  snapshot, so it needs the chart while it renders: `useGantt` returns it at once (the core exists
  during the render, so the list also renders on a server), while a `ref` is `null` until the chart
  is committed, which leaves the first render of the list empty. And `setContainer` puts the chart
  in the box beside the list, in the column you want, without the `div` that `<Gantt>` adds.
  `useGanttState` renders the list again only when the slice it reads changes: not while the chart
  scrolls. `viewMode` is a controlled prop, so the select calls `setViewMode` on the instance and the
  chart starts from `defaultViewMode`; the row height and the theme are state, passed to `layout`
  and `theme`, because in React the props are the truth.

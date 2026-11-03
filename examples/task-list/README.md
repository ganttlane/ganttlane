---
title: Task list
description: The built-in list of tasks beside the chart, with columns, toggles, a splitter, selection, hover, the keyboard and scrolling kept in sync.
category: Customization
order: 585
height: 570
---

# Task list

The list of tasks that a classic gantt tool has on its left: a row for every row of the chart, at
the same height and place, indented by depth, with a toggle on the groups, the columns you choose
and a splitter on its edge. It is `createTaskList` for `@ganttlane/dom` and `<TaskList>` for
`@ganttlane/react`. The [guide](https://ganttlane.github.io/ganttlane/guides/task-list/) has all of it; the
[task list beside the chart](../task-list-sidebar/) example draws one by hand from the same public
API, for when you want your own markup.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): thirty tasks in four groups, nested two levels deep, with a few links.
- [`options.ts`](options.ts): the sizes, the stripes, the view, and `selection` so that a click on a
  bar selects it.
- [`helpers.ts`](helpers.ts): the columns, and the text of the Dates column.
- [`styles.css`](styles.css): the two side by side, and the box of `layout.height: 'auto'`.
- [`vanilla.ts`](vanilla.ts): `createGantt`, `createTaskList` and the toolbar.
- [`react.tsx`](react.tsx): the same with `useGantt` and `<TaskList>`.

## Options

| Option                                | Value                                         | What it does                                                                          |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `columns`                             | `[{ id: 'name', … }, { id: 'dates', … }]`     | The columns of the list; the first is the tree column, with the indent and the toggle |
| `selection.onClick`                   | `true`                                        | A click on a bar selects its task, and the list shows it                              |
| `selection.clearOnEmptyClick`         | `true`                                        | A click on an empty part of the chart clears the selection                            |
| `layout.height`                       | `400`, or `'auto'` with the **Height** select | Who scrolls the rows: the chart, or the box around the list and the chart             |
| `layout.rowHeight`, `headerRowHeight` | `36`, `28`                                    | The sizes the list reads back, so that its rows line up                               |
| `display.rowStripes`                  | `'group'`                                     | Zebra stripes for each group, the same in the list                                    |
| `theme`                               | `'auto'`                                      | The **Theme** select; the list follows the chart                                      |

## What to try

- **Scroll.** Wheel over the names or over the chart: the other follows.
- **Click a name** far down the list (_Release_): the chart scrolls sideways to its bar and selects
  it, and nothing moves if the bar is already in view. Click a bar: its name is selected. Click
  empty space in the chart: the selection is cleared.
- **Open and shut.** Click the chevron of _Build_, or press Left with the focus on it.
- **Drag a bar**: its dates change when you drop it, and so do the dates of what it pushed.
- **Point at a row**, in the list or in the chart: both light up.
- **Drag the splitter** on the edge of the list, or focus it and press Left and Right.
- **Use the keyboard.** Tab to the list, then Up, Down, Page Up, Page Down, Home, End, Left and
  Right. Enter selects the row and scrolls the chart to its bar.
- **Change the Height.** With `fixed` the chart scrolls and the list follows it, which during a fast
  fling can be a frame behind. With `auto` one box scrolls both, and they cannot differ.

## Notes

- **The row hover** is on here because a list is attached. A chart without one lights no row, unless
  you set `display.rowHover` or `--gantt-row-hover-color` yourself.
- **A list draws what the chart draws**, the rows in view and a few more, so it stays fast with
  thousands of tasks.
- **Dates follow a commit,** not the drag in progress: the record of a task changes when the change
  is committed.

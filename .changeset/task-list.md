---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

A built-in task list beside the chart: `createTaskList` from the new subpath
`@ganttlane/dom/task-list`, and `<TaskList>` from `@ganttlane/react`. It has columns, expand toggles,
a splitter and the keyboard (`role="treegrid"`), draws only the rows the chart draws, and keeps the
expanded rows, the selection, the hover, the focus, the vertical position, the theme and the sizes in
sync with the chart. With `layout.height: 'auto'` one box scrolls both and they cannot differ; with a
fixed or filling height each has its own scroller, and the list can be a frame behind during a fast
fling. Existing charts look as they did: `--gantt-row-hover-color` is `transparent` unless a task
list is attached, `display.rowHover` is on or you set the token yourself.

The public API it is built on, all usable on its own:

- `scrollTo({ left, top, behavior })`, and `align` / `alignY` of `scrollToTask` also take `'nearest'`
  and `false`.
- `getRows()` with `onRowsChange`, `getRowWindow()`, `getLayoutMetrics()`, and on `Gantt`
  `getAppearance()` with `on('appearanceChange')`.
- `toggle(id)`, and `onExpandedChange` gets the expanded parents as a list in a new second argument.
- `setHoveredRow(id)` with `onRowHoverChange` and `snapshot.hoveredRow`; `.gantt__row` gets
  `data-hovered` and `data-focused`.
- `focusTask(id)` with `onFocusChange` and `snapshot.focusedTask`.
- `selection: { onClick, clearOnEmptyClick }`, both off by default.
- `display.rowHover`, the tokens `--gantt-row-hover-color`, `--gantt-row-highlight-color` and
  `--gantt-row-selected-color`, and the class `gantt-scope`, which gives anything beside a chart the
  `--gantt-*` tokens.

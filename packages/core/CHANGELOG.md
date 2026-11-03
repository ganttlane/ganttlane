# @ganttlane/core

## 0.3.0

### Minor Changes

- d187916: Selecting several tasks by click, and keyboard focus on the bars. Both are off by default, so existing
  charts behave as they did.

  - `selection.multiple`: with `selection.onClick`, Ctrl or Cmd + click adds a task or takes it out. A
    plain click still selects one task, a drag never changes the selection, and with the modifier a click
    on an empty part clears nothing. A task list follows it too, on a click and on Enter or Space with
    the modifier, and says `aria-multiselectable`.
  - `keyboard.barFocus`: a roving tabindex on the bars, with one tab stop for all of them. Up, Down, Home,
    End, Page Up and Page Down walk the bars, and Enter and Space are a click (`taskClick` and the
    selection follow). Left and Right stay the scroller's. The ring is an outline beside the stroke of a
    selected, invalid or conflicting bar, and shows from the keyboard only. A bar then has
    `role="button"`, its task's name as `aria-label`, and `aria-pressed` where a click selects it. The
    focused bar stays in the document when it scrolls away and keeps the focus when rows are sorted, and
    one that goes away with its row hands the focus to the tab stop.
  - `gantt.focusBar(id)` moves the browser's focus to a bar and scrolls to it.
  - `focusTask`, `snapshot.focusedTask` and `onFocusChange` now mean the task's row or bar. A task list
    and focusable bars share one focused task, and the surface that holds the browser's focus keeps it.
    `focusTask(undefined)` does not take the focus from a bar, which is the focused task again at the
    next draw.
  - `getAppearance()` has `multiSelect`, and `core.send` takes a `ClickInput`, a click that no pointer
    made.
  - `@ganttlane/dom/facade`'s `MERGED_OPTION_GROUPS` now lists `selection`, which `setOptions` already
    merged, and `keyboard`. In React, a field taken off the `selection` prop now returns to its default
    instead of keeping its value.

### Patch Changes

- 4783ebc: A focused row of the task list keeps the focus when rows are sorted. In Chromium a sort moves the row's
  node, which takes the browser's focus from it: the vanilla list lost the focus to the page, and in both
  lists `onFocusChange` heard a `null`. Now the same row keeps the focus, `focusedTask` does not change, and
  no `null` is heard.

## 0.2.0

### Minor Changes

- c518480: A built-in task list beside the chart: `createTaskList` from the new subpath
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

## 0.1.0

### Minor Changes

- 479dbd5: First public release.

  - `@ganttlane/core`: headless gantt core with floating wall-clock time, a work calendar (weekends,
    holidays, exceptions), a linear time scale with seven view-mode presets, data granularity and
    alignment, link types with lag, propagation and conflicts, hierarchy, edit sessions with
    Save / Cancel, undo / redo, issues instead of exceptions, and `patchTasks` for controlled data.
  - `@ganttlane/dom`: `createGantt` with the vanilla DOM renderer: bars, links, header and grid,
    pointer editing (move, resize, progress, links), tooltips and the link menu, scrolling with an
    optional infinite timeline, a default theme of `--gantt-*` custom properties and an unstyled
    contract.
  - `@ganttlane/react`: `<Gantt>`, `useGantt` and `useGanttState` over the vanilla renderer, with
    controlled and uncontrolled props, slots for the tooltip, the link menu and bar labels, a
    `ref` handle, StrictMode, SSR and React 18.3 / 19 support.

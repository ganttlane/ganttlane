# @ganttlane/react

## 0.4.0

### Minor Changes

- a89096f: Keyboard editing, a live region and bars that tell what they are. The new options are off by default,
  so existing charts behave as they did, apart from three things: the name of a bar that takes the focus
  is longer, a context menu on a press cancels the gesture, and `RendererCore` (what `mountRenderer`
  takes), `Gantt` and the full `GanttStrings` object have new members (`nudge`, `taskChanged`,
  `notChanged`, `selection`), which a custom core or a complete set of strings of your own has to add.

  - `keyboard.edit` (with `keyboard.barFocus`): Left and Right move the focused task one snap step
    earlier and later, Shift with them moves its end, and Alt and Shift its start. Each press is a
    whole change with the permissions, the before-hooks and the propagation of the same drag, reported
    as one `onTasksChange` with the reason `move`, `resize-start` or `resize-end`. A task that cannot be
    edited that way leaves the key to the chart, which scrolls.
  - `nudge(id, gesture, direction)` on the core, the chart and the React handle: the same step from
    code, for buttons of your own.
  - `keyboard.announce`, and `keyboard.edit` with `barFocus`: a hidden live region (`div.gantt__live`,
    `role="status"`) says the result of a keyboard change (the task, its new dates, working days, how
    many other tasks it moved); `announce` also says when the selection changes other than by a press
    on a bar. New strings: `taskChanged`, `notChanged` and `selection`.
  - A bar that takes the focus is named with its dates, progress and working days, as its tooltip
    describes the task (`Design, Mar 3, 2026 – Mar 7, 2026, 80% done · 4 working days`), in the chart's
    `locale` and `strings`.
  - `focusTask(undefined)` takes the focus from a bar to the chart, and a window that loses the focus
    keeps the bar as the focused task.
  - A context menu cancels the gesture it came from. Safari on macOS opens one on Ctrl + click and
    sends no release, so the bar was dragged with the button up once the menu closed.
  - The task list: `cellNavigation` walks it cell by cell, as a treegrid does.
  - Tests: axe over the chart and the list in Chromium, Firefox and WebKit on both renderers, and the
    contrast of the default themes pinned by their tokens.

- d775ddd: Moving from frappe-gantt, and checking your data. Nothing changes in the production build of
  `createGanttCore`, and the main entry of the production build is as large as it was.

  - `@ganttlane/core/migrate` exports `fromFrappeGanttOptions(options)`: it turns the options of
    frappe-gantt into options of ganttlane and reports what it could not turn. Every key is either in
    the result or in `unmapped`, with a reason (`'manual'`, `'unsupported'`, `'removed'` or `'unknown'`);
    `notes` mark what was converted but behaves differently (`padding`, `column_width`). Tasks and event
    handlers are not converted.
  - `@ganttlane/core/schema` exports `TaskSchema` and `LinkSchema`, the valibot schemas the core checks
    its input with, to validate data from an API and to extend a task with your own payload:
    `v.object({ ...TaskSchema.entries, data: MyDataSchema })`.
  - The development build (export condition `development`, which Vite and webpack pick in dev mode)
    reports a top-level option key the core does not know as an `unknown-option` warning in
    `getIssues().options` and `onIssues`, and for a name from frappe-gantt it says where the option lives
    now (`bar_height` is `layout.barHeight`). The key is ignored as before. The production build does not
    look for unknown keys and does not carry the hints. A test of yours that runs with the `development`
    condition and expects `getIssues().options` to be empty will see the warning for a key the core does
    not know. The development build is about 0.9 kB larger.

### Patch Changes

- Updated dependencies [a89096f]
- Updated dependencies [d775ddd]
  - @ganttlane/core@0.4.0
  - @ganttlane/dom@0.4.0

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
- Updated dependencies [d187916]
- Updated dependencies [4783ebc]
  - @ganttlane/core@0.3.0
  - @ganttlane/dom@0.3.0

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

### Patch Changes

- Updated dependencies [c518480]
  - @ganttlane/core@0.2.0
  - @ganttlane/dom@0.2.0

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

### Patch Changes

- Updated dependencies [479dbd5]
  - @ganttlane/core@0.1.0
  - @ganttlane/dom@0.1.0

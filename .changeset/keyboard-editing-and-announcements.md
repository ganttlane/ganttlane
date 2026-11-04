---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

Keyboard editing, a live region and bars that tell what they are. The new options are off by default,
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

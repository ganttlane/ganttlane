---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

Selecting several tasks by click, and keyboard focus on the bars. Both are off by default, so existing
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

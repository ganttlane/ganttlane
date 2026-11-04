---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

Hotkeys for undo and redo. Off by default, so existing charts behave as they did: nothing listens for
the keys unless you ask.

- `keyboard.undo` (with `history`): Ctrl or Cmd + Z undoes the last action, Ctrl or Cmd + Shift + Z and
  Ctrl + Y redo it. The keys are heard only with the focus on a bar or on the chart's scrollable region,
  so an input, a `contenteditable` or a control of a slot keeps its own undo. They do nothing during a
  drag or while a change waits to be applied, and a key that has nothing to do (no `history`, nothing to
  undo) stays with the browser. A Latin letter is read from the typed character; on a layout that types
  a letter of another script (Cyrillic, Greek) the physical Z and Y keys are used. The `keyboard` prop
  of `<Gantt>` and `useGantt` takes it too.
- With `keyboard.announce`, or `keyboard.edit` with `barFocus`, the live region says the result: two new
  `strings`, `undone` and `redone`, functions of the first changed task's description and the locale.
  A custom `strings` object that lists every key (a full translation) should add them; one that is
  merged over the defaults needs nothing.

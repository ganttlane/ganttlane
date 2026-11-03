---
'@ganttlane/core': patch
'@ganttlane/dom': patch
'@ganttlane/react': patch
---

A focused row of the task list keeps the focus when rows are sorted. In Chromium a sort moves the row's
node, which takes the browser's focus from it: the vanilla list lost the focus to the page, and in both
lists `onFocusChange` heard a `null`. Now the same row keeps the focus, `focusedTask` does not change, and
no `null` is heard.

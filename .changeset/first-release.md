---
'@ganttlane/core': minor
'@ganttlane/dom': minor
'@ganttlane/react': minor
---

First public release.

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

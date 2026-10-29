---
title: Events log
description: Every public event of a chart, logged live with its payload, a filter by kind, and the buttons and gestures that make each one fire.
category: Editing
order: 460
height: 720
---

# Events log

A chart reports what happens to it through **events**: each is an `on<Event>` option and a listener
added with `gantt.on(name, handler)` (React: a prop). This example gives the chart one handler for
every event, and writes a line for each into a log, newest first, with the time and what the event
carried. The boxes above the chart show and hide the kinds of event, and the buttons make the ones
that a mouse cannot.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): seven tasks (Design is locked, Build has two children) and three links.
- [`options.ts`](options.ts): `history`, the view mode, the first scroll and the layout.
- [`helpers.ts`](helpers.ts): **`loggingHandlers`**, one handler for each of the twenty events, and the log itself.
- [`styles.css`](styles.css): your own styles for the filter and the log.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the buttons, the filter and the list.

## Options

| Option                           | Value                                | What it does                                                                                  |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `on<Event>`                      | twenty functions (`loggingHandlers`) | One handler for each event; `gantt.on(name, handler)` takes the same functions                |
| `history`                        | `true`                               | Without it the history is off, and `historyChange` would never come                           |
| `viewMode`                       | `'week'`                             | The scale of the timeline (React: `defaultViewMode`)                                          |
| `scroll.initial`                 | `'first-task'`                       | Opens on the plan; the timeline reaches beyond it on both sides, so the chart can be scrolled |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                           | Smaller rows, so that every row is in view                                                    |

## Events

| Group (filter)    | Event                | What makes it fire                                                                                                            |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Clicks            | `taskClick`          | A click on a bar (a press and release that was not a drag); a double click reports it twice                                   |
| Clicks            | `taskDoubleClick`    | A double click on a bar, after its second `taskClick`                                                                         |
| Clicks            | `linkClick`          | A click on the arrow of a link; the link is selected, so a `selectionChange` comes just before it                             |
| Hover             | `taskHoverChange`    | The pointer comes to a bar, or leaves the bars; unchecked by default, since it is frequent                                    |
| Changes           | `tasksChange`        | One per committed change set: a drag, `updateTask`, an undo, a redo; it lists every task that moved                           |
| Changes           | `taskDatesChange`    | The same change, once per task whose dates changed, after `tasksChange`                                                       |
| Changes           | `taskProgressChange` | The same, once per task whose progress changed: drag the progress handle                                                      |
| Links             | `linkCreate`         | A link drawn with the handles, `addLink`, an undo of a removal or a redo of a creation                                        |
| Links             | `linkDelete`         | A link removed from its menu, `removeLink`, or an undo of a creation                                                          |
| View and range    | `viewModeChange`     | `setViewMode`: the select                                                                                                     |
| View and range    | `rangeChange`        | The range of the timeline changed, with a `reason`: `'initial'` at the start, `'view-mode'`, or a data, option or drag change |
| View and range    | `expandedChange`     | `expand`, `collapse`, `expandAll`, `collapseAll`: the two buttons                                                             |
| Scroll            | `scroll`             | The timeline scrolled: the wheel, the scrollbar, a drag near an edge, a view mode switch. A run is one line                   |
| Selection         | `selectionChange`    | `select`, `clearSelection`, `selectLink`, or a click on a link; only when the selection is different                          |
| Refused           | `editRefused`        | A gesture the chart refused: drag Design, which is locked ([Read-only](../read-only/README.md))                               |
| Issues and errors | `issues`             | A problem in the data, the options or a change set: **Break data**; when the list changes, also back to none                  |
| Issues and errors | `error`              | A listener or a hook threw: **Failing listener**, then select something. Without `onError` it would be rethrown               |
| Dirty and history | `dirtyChange`        | An edit session got its first change, or ended: **Begin edit**, drag a bar, then **Commit** or **Rollback**                   |
| Dirty and history | `editRollback`       | `edit.rollback()`: what to revert, for controlled data ([Edit session](../edit-session/README.md))                            |
| Dirty and history | `historyChange`      | `canUndo` or `canRedo` flipped: the first drag, **Undo**, **Redo** ([Undo and redo](../undo-redo/README.md))                  |

## What to try

- Click a bar, double-click it, drag it. A drag is `tasksChange` and `taskDatesChange` (read the log
  from the bottom up), and the first one also `historyChange`, since it made `canUndo` true. It is
  never a `taskClick`.
- Drag Design: `editRefused`, and nothing else. Drag the progress handle of Backend:
  `taskProgressChange`.
- Draw a link from Docs to Launch, then click its arrow: `linkClick` and `selectionChange`.
- Choose another view mode, then scroll the chart sideways: `viewModeChange` and `rangeChange` with
  the `scroll` they bring, and one `scroll` line with a count for the whole run of a scrollbar drag.
- **Begin edit**, drag a bar (`dirtyChange`), **Rollback** (`editRollback`, `dirtyChange`).
- **Break data** adds a task whose end is before its start: `issues` names the problem, and the
  history is gone (`historyChange`), because replacing the tasks clears it.
- Untick a group to hide its lines (they are still collected: tick it again to see them), and tick
  **Hover** for `taskHoverChange`.

## Notes

- **A payload per event.** `taskClick`, `taskDoubleClick` and `taskHoverChange` get the `TaskRecord`
  and the DOM event; `tasksChange` a `ChangeSet`; `linkCreate` the `Link` and its id; `linkDelete` and
  `linkClick` a `LinkRecord`; `selectionChange` `(selectedKeys, selectedLink)`; `viewModeChange` the
  `ViewMode`; `rangeChange` `{ start, end, reason }`; `scroll` `{ x, y, date }`. `helpers.ts`
  turns each into a line, which is also the shortest way to see the types.
- **The order of a drag.** `dirtyChange` and `historyChange` are emitted as the data changes, before
  the events of the action that caused them, which come after in this order: `issues`, `tasksChange`,
  `taskDatesChange` and `taskProgressChange`.
- **One handler, or many.** The `on<Event>` option is one handler per event and can be swapped with
  `setOptions` at no cost; `gantt.on(name, handler)` adds listeners and returns the function that
  removes them, as **Failing listener** shows.
- **React.** The handlers are props, spread from `loggingHandlers`; they are always current, so a new
  function on every render is no change at all. `viewMode` is a controlled prop, and the example
  uses `defaultViewMode` and the handle's `setViewMode`.

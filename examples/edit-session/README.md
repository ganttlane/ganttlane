---
title: Edit session, Save and Cancel
description: Your state owns the plan; an edit session wraps a spell of editing between Edit, Save and Cancel, with a save that can be refused.
category: Data
order: 310
---

# Edit session, Save and Cancel

Your state owns the tasks and the links. The chart never changes them: it reports every committed
change and shows it as a draft until you pass the new tasks back. An **edit session** wraps a spell
of editing between **Edit**, **Save** and **Cancel**:

- every drag is an `onTasksChange(changeSet)`, which you write into your tasks with `patchTasks`;
- **Save** closes the session (`edit.commit()`) and sends the plan to your server;
- **Cancel** rolls the session back (`edit.rollback()`): the chart does not touch your data, it tells
  you what to undo with `onEditRollback`, and you write that into your state the way you wrote the
  drags.

Until you press Edit the chart is in view mode (`editing: false`): bars cannot be dragged and links
cannot be drawn. A checkbox makes the "server" refuse the save, to see the last saved plan come back.

```sh
pnpm add @ganttlane/dom @ganttlane/core     # vanilla: patchTasks is the core's
pnpm add @ganttlane/react react react-dom   # React: it exports patchTasks too
```

## Files

- [`data.ts`](data.ts): the plan as the server last saved it.
- [`options.ts`](options.ts): controlled data, view mode (`editing: false`), the first scroll.
- [`helpers.ts`](helpers.ts): `savePlan`, which stands for your API, `linkId`, and `restoreLinks`.
- [`vanilla.ts`](vanilla.ts): `gantt.edit`, `setOptions({ editing })` and the dirty flag as an event.
- [`react.tsx`](react.tsx): `useGantt` and `useGanttState`, with the container rendered by hand.

## Options

| Option                        | Value                | What it does                                                                     |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `dataMode`                    | `'controlled'`       | The chart never changes your tasks (React: the `tasks` prop makes it controlled) |
| `editing`                     | `false`, then `true` | Editing from the UI: view mode until Edit; your own calls still work             |
| `onTasksChange`               | a function           | Every drag: write the `ChangeSet` into your tasks with `patchTasks`              |
| `onEditRollback`              | a function           | A cancelled session: the inverse to write into your tasks and your links         |
| `onDirtyChange`               | a function (vanilla) | `edit.isDirty` flipped: Save is only useful when there are changes               |
| `onLinkCreate`/`onLinkDelete` | functions (vanilla)  | A link drawn or removed; `onLinksChange` in React gives the whole list           |
| `viewMode`                    | `'week'`             | The scale of the timeline                                                        |
| `scroll.initial`              | `'first-task'`       | Opens on the plan                                                                |

## What to try

Press Edit and drag a bar: its successors follow. Save sends the plan; Cancel puts the plan back as
it was when you pressed Edit, including a link you drew or removed. Tick the checkbox and Save: the
last saved plan comes back. A task dragged away and back is not listed among the changes of the
session.

## Notes

- `useGantt(options)` is `<Gantt>` without the `div`: you render the container yourself
  (`ref={gantt.setContainer}`) and `gantt.slots` next to it, which is where React-rendered tooltips
  and labels go. Use `<Gantt ref={…}>` and `ref.current?.edit.begin()` if you prefer a component.
- `tasks` going in as a prop makes the chart **controlled** from its first render. The same array
  again is nothing; a **new** array, even with equal contents, is your answer to the change and ends
  the draft. So derive nothing from `tasks` in the render body without `useMemo`, or any re-render
  (the `saving` flag!) would discard the change that is being saved.
- `patchTasks(tasks, changes, model)` takes the `model` of the core that computed the change set,
  which is `core.getSnapshot().state.derived.model`.
- `edit.commit()` returns `{ status: 'committed', changes }`: the net difference between the start
  of the session and now; any other status (`'no-session'`, `'busy'`) means nothing was committed.
  The data is already in your state, since every drag was applied as it happened; send the whole
  plan, or `changes` as a diff.
- `edit.rollback()` never asks `onBeforeTaskChange` (a cancel is not vetoed). In controlled mode its
  whole effect is the `onEditRollback(changes)` event: apply `changes` to your tasks with
  `patchTasks`, and drop `changes.links.removed` / restore `changes.links.added` in your links.
- Tasks that depend on others keep following: with the default `scheduling.propagation`
  (`'preserve-lag'`) a drag moves the successors, and they are all in the one `ChangeSet`.
- The simpler case, where every change is saved at once, is [Controlled data](../controlled-data/README.md).

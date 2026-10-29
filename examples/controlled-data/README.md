---
title: Controlled data
description: Your own state owns the tasks and the links; the chart reports every change and waits for your answer, a save that can be refused.
category: Data
order: 300
---

# Controlled data

By default the chart owns the tasks: a drag changes its own copy and tells you. With
`dataMode: 'controlled'` **you** own them, for an application whose tasks live in a store, a query
cache or a database. The chart never changes your tasks; instead:

- every committed change (a drag, `updateTask`, an undo with `history: true`) is reported once, as
  a `ChangeSet`, to `onTasksChange`, and is shown as a **draft** over your tasks;
- you write it into your own tasks with `patchTasks`, which keeps the shape of each task (ISO
  strings stay ISO strings, a `duration` stays a `duration`);
- you hand the result back, with `setTasks` (a new `tasks` prop in React), which ends the draft.
  Handing back the old tasks refuses the change: the bar goes back to where your data has it.

While a change waits for your answer the chart is busy: no new drag starts. That makes a save
request a natural place to answer from. Here the "server" answers after a moment, and a checkbox
makes it say no.

```sh
pnpm add @ganttlane/dom @ganttlane/core     # vanilla: patchTasks is the core's
pnpm add @ganttlane/react react react-dom   # React: it exports patchTasks too
```

## Files

- [`data.ts`](data.ts): the initial tasks and links, the start of your state.
- [`options.ts`](options.ts): `dataMode: 'controlled'`, the view mode and the first scroll.
- [`helpers.ts`](helpers.ts): `saveTasks`, which stands for your API, and `linkId`.
- [`vanilla.ts`](vanilla.ts): the state in two variables, `patchTasks` and `setTasks`.
- [`react.tsx`](react.tsx): the state in `useState`, and the `tasks` and `links` props.

## Options

| Option                        | Value               | What it does                                                                             |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `dataMode`                    | `'controlled'`      | The chart never changes your tasks; it reports changes and shows them as drafts          |
| `onTasksChange`               | a function          | Receives the `ChangeSet` of every committed change: write it into your tasks             |
| `onLinkCreate`/`onLinkDelete` | functions (vanilla) | The link that was drawn or removed; you keep the list and hand it back with `setLinks`   |
| `tasks`, `links`              | your state (React)  | The props that make `<Gantt>` controlled; `onLinksChange` gives the list with the change |
| `viewMode`                    | `'week'`            | The scale of the timeline                                                                |
| `scroll.initial`              | `'first-task'`      | Opens on the plan                                                                        |

## What to try

Drag a bar. The change set holds the dragged task and every task that follows it along the links,
and `patchTasks` writes all of them. Tick the checkbox to see a refusal: the bars jump back. Draw a
link from the round handle beside a bar: your list gets it.

## Notes

- `patchTasks(tasks, changeSet, model)` takes the array you give it and returns a new one, or the
  same array when nothing changes. It never mutates `tasks`. The `model` is the one the change set
  was computed on, `core.getSnapshot().state.derived.model`.
- `@ganttlane/dom` re-exports the _types_ of the core (`Task`, `Link`, `ChangeSet`, …) but not its
  runtime functions, so `patchTasks` is imported from `@ganttlane/core`: add it to your own
  `package.json`, on the same version. `@ganttlane/react` exports it itself.
- **React: a new array is your answer.** The same `tasks` array again is nothing; a **new** one,
  even with equal contents, ends the draft. So derive nothing from `tasks` in the render body
  without `useMemo`, or any re-render (the status text here!) would discard the change that is
  being saved. The refusal above is `setTasks([...tasks])`.
- The same answer is how a **rollback** works: see [Edit session](../edit-session/README.md), where
  the whole Edit, Save and Cancel flow is built.
- In React the choice is made by props (`tasks` or `defaultTasks`), without `dataMode`; see
  [`@ganttlane/react`](../../packages/react/README.md#controlled-and-uncontrolled).

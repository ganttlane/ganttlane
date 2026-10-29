---
title: Propagation and conflicts
description: What an edit does to the tasks linked to it, with propagation on or off, and the conflict a link reports when its successor starts too early.
category: Scheduling
order: 210
height: 520
---

# Propagation and conflicts

When you drag a task, its links decide what else moves. `scheduling.propagation` chooses between
two policies: `'preserve-lag'`, where the tasks after the edited one move so that every link keeps
its lag, and `'none'`, where only the task you drag moves and the links are just drawn. Either way
a link is checked: a successor that sits closer to its predecessor than the link allows is a
conflict, drawn in red and reported with the change.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): four tasks in a chain and a fifth beside it, and the links with their lags.
- [`options.ts`](options.ts): `scheduling.propagation`, the calendar and the view mode.
- [`helpers.ts`](helpers.ts): `describe`, which turns a `ChangeSet` into a sentence, and the
  helpers for the buttons.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, the select, the box and the buttons.

## Options

| Option                   | Value                       | What it does                                                                 |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------- |
| `scheduling.propagation` | `'preserve-lag'`            | What an edit does to linked tasks: `'preserve-lag'` or `'none'` (the select) |
| `calendar.weekends`      | `[]`                        | Every day is a working day, so the only conflicts are about links            |
| `viewMode`               | `'week'`                    | One column a week: the whole plan fits                                       |
| `scroll.initial`         | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates           |
| `onBeforeTaskChange`     | a function (in the example) | Asked before a change is applied, with its conflicts; `false` cancels it     |
| `onTasksChange`          | a function (in the example) | One `ChangeSet` per change, with every task it moved and its conflicts       |
| `link.lag`               | `1`, `0`, `2`, none         | The gap a link keeps; without one it keeps the gap it has when loaded        |

## What to try

- **Drag _Design_ to the right** with `preserve-lag`. _Build_, _Docs_, _Review_ and _Release_ all
  follow, each keeping its lag. The status line lists the tasks in the order the chart moved them.
- **Switch to `none`** and drag _Design_ again: only _Design_ moves. As soon as _Design_ ends less
  than a day (the lag of the link) before _Build_ starts, the link turns red, _Build_ gets a red
  outline, and the status line names the conflict, the gap the link needs and the gap it has.
- **Drag _Review_ to the left**, in front of the end of _Build_: it moves freely, and the link from
  _Build_ turns red in both modes, because a link is checked against its predecessor whichever
  policy is on. _Release_ follows _Review_ with `preserve-lag` and stays with `none`.
  _Design +3 days_ and _Review -3 days_ make the same edits from code, with `updateTask`.
- **Tick _Refuse a broken link_** and repeat: the before-hook sees the conflict in its argument,
  returns `false`, and the bar goes back.
- **After a conflict**, drag _Build_ (with `preserve-lag`): the links put _Review_ and _Release_ back
  at their lags and the conflict goes.

## Notes

- **Where propagation goes.** An edit travels from the edited task to its successors, never to its
  predecessors. A task that moves moves its own successors in turn, in one pass, so a cycle cannot
  loop. A `locked` task never moves and stops the propagation.
- **Lags.** A link with a `lag` keeps exactly that gap; a link with none keeps the gap it had when
  the data was loaded (_Docs_ stays two days behind the start of _Build_).
- **`link-violated`.** A conflict is reported for an active link whose gap is below what it
  requires: its `lag` when it has one, or no more overlap than at load when it does not. It
  has the `linkId` and the two gaps in milliseconds (`requiredMs`, `actualMs`). Drawn: the link and
  the bar of the successor are red (`data-conflict`). Reported: `changeSet.conflicts` (in
  `onTasksChange` and `onBeforeTaskChange`) and `record.conflicts` (`getTask('review').conflicts`).
  A gap wider than the lag is not a conflict.
- **A conflict is a warning.** The change is accepted, and nothing is corrected, unless your
  `onBeforeTaskChange` returns `false` (or a modified `ChangeSet`).
- **`'push-forward'`** is the policy that would push the successors of an edit forward until
  every link holds. It is not available yet: `scheduling.propagation: 'push-forward'` is reported as
  an `unsupported-option` issue and `'preserve-lag'` is used.
- **React.** `scheduling` is passed to `<Gantt>` after the spread of `options`, from state: in React
  the props are the truth, so an option changed with `setOptions` on the ref would be overwritten by
  the next render. `onBeforeTaskChange` is given inline and always reads the current state.

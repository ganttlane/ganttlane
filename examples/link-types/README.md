---
title: Link types and lags
description: Finish-to-start, start-to-start, finish-to-finish and start-to-finish links, each with a lag and a lead; drag the source and watch every type follow.
category: Scheduling
order: 200
height: 560
---

# Link types and lags

A link joins an edge of one task (the source) to an edge of another (the target) and keeps them
`lag` apart. There are four types, one for each pairing of edges. Here one task, _Design_, is the
source of nine links: two of each type, one with a lag (a gap, positive) and one with a lead (a
negative lag, an overlap), and one link that names neither a type nor a lag. Drag _Design_ and
every target moves with it, each by its own rule.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): _Design_, its nine targets and the links, with the dates worked out in
  comments.
- [`options.ts`](options.ts): the calendar, `scheduling.defaultLinkType`, `display.linkCurveRadius`.
- [`helpers.ts`](helpers.ts): `describe`, which turns the `ChangeSet` of a drag into a sentence.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, two selects and a reset button.

## Options

| Option                          | Value                       | What it does                                                                                       |
| ------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `calendar.weekends`             | `[]`                        | Every day is a working day: no weekend fill, so only the links move the bars                       |
| `scheduling.defaultLinkType`    | `'FS'`                      | The type of a link that names none (the select changes it: `setOptions`)                           |
| `display.linkCurveRadius`       | `10`                        | The largest radius, in px, of the corners of a link's route (default `5`)                          |
| `layout.rowHeight`, `barHeight` | `36`, `22`                  | Compact rows, so that all ten show                                                                 |
| `scroll.initial`                | `'first-task'`              | Opens on the plan; the default, `'today'`, is far from these dates                                 |
| `onTasksChange`                 | a function (in the example) | One `ChangeSet` per drag, with the dragged task and every task it moved                            |
| `link.type`, `link.lag`         | `'FS'`, `2`, `-2`, …        | Per link: which edges, and how far apart (a number is days; a string such as `'4h'` is a duration) |

## What to try

- **Drag _Design_ to the right.** All nine targets move by the same number of days: a link keeps its
  lag whichever way the source goes. The status line lists them in the order the chart moved them.
- **Drag the right edge of _Design_.** Only the targets that hang from its end move: the _FS_ ones
  (their start) and the _FF_ ones (their end). The _SS_ and _SF_ ones stay, because they hang from
  its start.
- **Drag the left edge of _Design_.** Now the _SS_ and _SF_ targets move, and the _FS_ and _FF_ ones
  stay. A link on an edge that did not move does not move its target.
- **Drag a target** (say _Build_) closer to _Design_ than its lag allows. A target is free to go
  anywhere: nothing pushes it back, but the link turns red and the status line reports the conflict.
  Drag _Design_ again and the link puts _Build_ back exactly where its lag says.
- **Change the default link type.** _Review_ has a link with no `type` and no `lag`: it takes the
  type from the select, and the lag from the gap its two edges have now, so the arrow is redrawn
  and nothing moves until you drag.
- **Change the corner radius** and watch the routes.

## Notes

- **The four types.** `FS` joins the end of the source to the start of the target, `SS` the start to
  the start, `FF` the end to the end, `SF` the start of the source to the end of the target.
- **The lag is a gap between those two edges**, counted in the target's `durationMode` (calendar
  days here). A negative lag is a lead: the target's edge lies before the source's. A number is days; a
  string is a duration (`'3d'`, `'4h'`).
- **A lag is a rule, not a minimum.** When the source moves, the target goes to exactly `lag` from
  it, in both directions. A link with no `lag` keeps the gap it has when the data is loaded.
- **A link to an edge that does not move moves nothing.** Resizing the start of the source leaves
  the targets of its `FS` and `FF` links alone.
- **Two links to the same target pin both of its edges.** An `SS` and an `FF` link make the target
  stretch when the source is resized. An `FS` and an `FF` link both hang from the source's end, so
  with no lags (each keeps the gap it has) the target moves with it and keeps its length. A child
  pinned to both edges of its phase (`['SS', 'FF']`, with `followParent`) stretches the same way, see
  [Groups and children](../hierarchy/README.md).
- **React.** `scheduling` and `display` are passed to `<Gantt>` after the spread of `options`, from
  state: in React the props are the truth, so an option changed with `setOptions` on the ref would be
  overwritten by the next render. `defaultTasks` and `defaultLinks` are where the chart starts, and
  `chart.current.setTasks(tasks)` puts the data back.

---
title: A large plan
description: Up to ten thousand generated tasks with their links, a count selector, and the time the chart takes to put its first bars on the screen.
category: Time scale
order: 160
height: 560
---

# A large plan

The chart draws only what you can see: the rows in view, and the bars, links, grid lines and days
that belong to them (plus a few beyond the edges, so that scrolling does not show gaps). A plan of
ten thousand tasks costs the DOM about what a plan of a hundred does. This example generates a plan
of the size you choose, with a link from each task to the one before it in its chain, and says how
long the chart took from being asked for to having its first bars on the screen. The two buttons
jump to the ends of the plan.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): `generate(count)`, a deterministic generator of tasks and links, and the
  plan at its default size (1,000 tasks) as `tasks` and `links`.
- [`options.ts`](options.ts): the view mode, the first scroll and compact rows.
- [`helpers.ts`](helpers.ts): `onFirstPaint`, which times the first bars, and `describe`.
- [`vanilla.ts`](vanilla.ts): a new chart for each size, and `scrollToTask`.
- [`react.tsx`](react.tsx): the same, with a `key` that makes a new chart for each size.

## The plan

`generate(count)` has no randomness: the same `count` gives the same tasks every time. The tasks
come in chains of five (Design, Build, Review, QA, Release), named after a team and the number of
the chain (`Backend 1 · Design`). Each task starts after the one before it and is linked to it
(`t1 → t2 → …`, four links for every five tasks), and each chain starts three working days after
the one before it (over thirty chains, and then from the start again), so the plan is a row of
staircases. Every task starts and ends on a working day, so no bar is in conflict with the
weekends. Ids are `t1` … `t<count>`.

## Options

| Option             | Value          | What it does                                                                     |
| ------------------ | -------------- | -------------------------------------------------------------------------------- |
| `viewMode`         | `'week'`       | The scale of the timeline (React: `defaultViewMode`, as nothing here changes it) |
| `scroll.initial`   | `'first-task'` | Opens on the plan, at its first task                                             |
| `layout.rowHeight` | `28`           | Compact rows: more of the plan on the screen                                     |
| `layout.barHeight` | `18`           | The height of a bar inside its row                                               |

## What to try

Pick **10,000** and read the line under the chart: it is the time from the moment the chart was
asked for (generating the plan is not counted) to the first animation frame that has bars in it,
on your machine. Pick a few sizes to see how it grows with the plan: the chart creates its model
of every task once, but draws a screenful. Press **Last task**: the chart is at the end of a plan
of ten thousand rows at once (`scrollToTask`, which here is `instant`: a smooth scroll through
three hundred thousand pixels would take a while). Drag a bar and the tasks that follow it move
with it, as they do on a plan of four.

## Notes

- **What is drawn.** With the plan of 10,000 tasks, the chart holds about twenty rows, a dozen bars
  and as many links in the DOM at a time, whatever the size of the plan. That is the virtual
  window: the rows in view, and a few more on each side (`overscan`).
- **Where the time goes.** Creating a chart reads every task once: it validates the shapes, parses
  the dates, builds the tree and the graph of links, and works out the rows. That is the part that
  grows with the plan. Drawing does not.
- **Changing the data.** To change some tasks, give `setTasks` the new list: it is diffed by id, and
  only what changed is recomputed. A new chart, as this example makes for each size, is for a plan
  that is a different one altogether (in React, a `key` does it).
- **Generating data.** The generator is a plain function of the count, so that the data is the
  same in the tests, in the code tabs and on the page. It makes its dates by counting working days
  from a Monday; the chart does its own date arithmetic through its date adapter.
- **What the number is.** `onFirstPaint` watches the chart's element for the first `.gantt__bar`
  and then waits for one more animation frame. It measures this page, in this browser, with
  whatever else is running: use it to compare sizes, not as a benchmark. For the numbers of the
  library, run the repository's `pnpm bench`, or open the playground's `/bench/` page (a generated
  plan of 1k or 10k tasks, scrolled and dragged automatically, with timings).
- **When a plan is too large to load at all**, load it by date range: the infinite timeline's
  `onRangeChange` says which range the chart now shows
  ([Infinite timeline](../infinite-timeline/README.md)), and `setTasks` takes what you fetched.

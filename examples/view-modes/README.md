---
title: View modes
description: The seven zoom presets of the timeline, from hours to years, switched with a select and refined with zoomTo.
category: Time scale
order: 100
height: 570
---

# View modes

A **view mode** is a zoom level of the timeline: the unit of its columns, how wide a day is, the
header rows above the columns, the grid lines and the step a drag snaps to. There are seven
built-in ones, and one plan can be read at any of them. This plan has days of work and a launch
day planned hour by hour, so the launch-day tasks are slivers in the week view and real bars in
the hour view. The select calls `setViewMode`, the buttons call `zoomTo`, and the line under the
chart is written by `onViewModeChange`.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): twelve tasks, five of them timed to the hour, and their links.
- [`options.ts`](options.ts): the view mode, the granularity, the first scroll and compact rows.
- [`helpers.ts`](helpers.ts): the ids of the presets, `describe` (the status line) and `zoomed`.
- [`vanilla.ts`](vanilla.ts): `setViewMode`, `zoomTo` and `onViewModeChange` on a `Gantt`.
- [`react.tsx`](react.tsx): `viewMode` as a controlled prop, and `zoomTo` through the `ref`.

## The presets

| `id`          | One column | `pxPerDay` | Default snap | Header rows         | Padding  |
| ------------- | ---------- | ---------- | ------------ | ------------------- | -------- |
| `hour`        | 1 hour     | 960        | `15min`      | day, hour           | 7 days   |
| `quarter-day` | 6 hours    | 160        | `1h`         | day, 6-hour block   | 7 days   |
| `half-day`    | 12 hours   | 80         | `1h`         | day, 12-hour block  | 14 days  |
| `day`         | 1 day      | 40         | `1d`         | month, day          | 14 days  |
| `week`        | 1 week     | 20         | `1d`         | month, week (`2–8`) | 4 weeks  |
| `month`       | 1 month    | 4          | `1d`         | year, month         | 4 months |
| `year`        | 1 year     | 1          | `1mo`        | decade, year        | 2 years  |

`pxPerDay` is the zoom: how many pixels a day is wide. The **snap** is the step a bar moves, resizes
or changes progress by when it is dragged; `scheduling.snap` replaces it for every mode, and holding
`Alt` while dragging snaps to the data step instead. The **padding** is the timeline the chart adds
before the first task and after the last. The modes made of hours have minor grid lines as well
(every 15 minutes in `hour`, every hour in `quarter-day` and `half-day`), which are drawn only while
they are at least 6 px apart: in `half-day`, at 80 px a day, they are too close.

## Options

| Option                   | Value                       | What it does                                                                               |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| `viewMode`               | `'week'`                    | The preset in use; `setViewMode(id)` changes it later (React: a controlled prop)           |
| `scheduling.granularity` | `'15min'`                   | The data step. A snap step is never finer than it, so the hour presets need it             |
| `scroll.initial`         | `'2026-04-14T11:00'`        | Opens on launch day (a moment, not `'today'`, which is far from this plan)                 |
| `scroll.align`           | `'center'`                  | The moment lands in the middle of the chart (`setViewMode` then keeps the middle in place) |
| `layout.rowHeight`       | `32`                        | Compact rows, so that all twelve tasks fit                                                 |
| `layout.barHeight`       | `20`                        | The height of a bar inside its row                                                         |
| `onViewModeChange`       | a function (in the example) | Called with the `ViewMode` that is now in use: its `label`, `pxPerDay` and `snap`          |

## What to try

Pick **hour**: launch day fills the chart, with a column per hour and a faint line every 15 minutes.
Drag _Deploy_ and it moves a quarter of an hour at a time; the tasks linked after it move along.
Pick **week** and drag _QA_: it moves a day at a time, which is the snap of that mode. Pick **year**
and the whole plan is a few pixels wide, in the middle of two years of padding. **Zoom in** and
**Zoom out** change the pixels per day of the mode you are in (the line under the chart says so);
picking another mode starts from that mode's own preset again.

## Notes

- **The moment in the middle stays.** `setViewMode(id)` keeps the date at the centre of the chart
  where it is, so zooming in on launch day lands on launch day. With `{ keepScroll: false }` as its
  second argument it scrolls like at mount instead (`scroll.initial`).
- **`zoomTo(pxPerDay, { anchor })`** keeps the date under `anchor` (an x in the viewport, default the
  middle) in place. The zoom belongs to the view mode in use and is dropped when the mode changes.
- **An id the chart does not know** falls back to `'day'` and is reported as an option issue; a mode
  of your own is added through `viewModes` ([Custom view modes](../custom-view-mode/README.md)).
- **`onViewModeChange`** fires only when the mode itself changes, not after `zoomTo`; read the zoom
  with `gantt.core.getSnapshot().timeline.scale.pxPerDay`, as this example does.
- **React.** `viewMode` is a controlled prop, so the select changes your state and the chart follows
  it; `defaultViewMode` is its uncontrolled twin. `options` is spread as props, and the example
  passes `viewMode` after it, for it to win.

---
title: Scrolling and today
description: Where the chart opens, how code scrolls it to today, a date or a task, the today marker, and the visible range reported as you scroll.
category: Time scale
order: 120
height: 560
---

# Scrolling and today

Where a chart is looking is part of its options. `scroll.initial` says where it opens, `scroll.align`
and `scroll.behavior` say how a scroll that code asks for lands and moves, and three methods do the
asking: `scrollToToday()`, `scrollToDate(date)` and `scrollToTask(id)`. The today line and its
marker in the header are `display.today`, and the line under the chart is written from the
`scroll` event: every scroll, whether the user or a method made it, reports where the chart is and
which dates are in view (`getVisibleRange()`).

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): fourteen tasks from February to July, with links.
- [`options.ts`](options.ts): `scroll`, the pinned `now`, `display.today`, and what the selects offer.
- [`helpers.ts`](helpers.ts): `describe`, which writes the status line.
- [`vanilla.ts`](vanilla.ts): `scrollTo*`, `setOptions({ scroll })`, `on('scroll')`, and a new chart when
  `scroll.initial` changes.
- [`react.tsx`](react.tsx): the same with props, the `ref` handle and a `key`.

## Options

| Option            | Value                                   | What it does                                                                                 |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scroll.initial`  | `'today'`                               | Where the chart opens; the select tries each value (read when the chart is created)          |
| `scroll.align`    | `'center'`                              | Where the target of a scroll lands in the viewport: `'start'`, `'center'`, `'end'` or 0 to 1 |
| `scroll.behavior` | `'smooth'`                              | How `scrollTo*` moves: `'smooth'`, `'instant'` or `'auto'` (the browser's own)               |
| `display.today`   | `true`                                  | The today line and marker; the checkbox switches it                                          |
| `now`             | `() => '2026-04-15'`                    | The source of "today" (the system clock by default); pinned so that the demo never changes   |
| `viewMode`        | `'week'`                                | The scale of the timeline (React: `defaultViewMode`, as nothing here changes it)             |
| `onScroll`        | a function (vanilla: `on('scroll', …)`) | `{ x, y, date }` on every scroll: the offsets in px and the date at the left edge            |

## What to try

The chart opens on **today** (15 April, the red line), centred. Pick another **Opens at** and the
chart is made again: **first-task** puts the earliest start in the middle, **start** and **end** put
the left or the right end of the timeline at the edge of the chart (whatever the alignment), and the
last choice is a date, 1 June. Then press the buttons and watch the line under the chart: **Review** scrolls to its
bar and to its row, because `scrollToTask` moves both axes. Set **Align** to `end` and press
**Review** again: its bar ends at the right edge and its row is the last one in view. Set
**Behavior** to `instant` and the scroll jumps instead of gliding. Uncheck **Today marker** and the
line and the header marker go away.

## Notes

- **`scroll.initial` is read once**, when the chart is created, which is why the select makes a new
  chart (`destroy()` and `createGantt()` in the vanilla code, a new `key` in React). `align`,
  `behavior` and `display.today` are ordinary options: `setOptions({ scroll: { align } })` or a prop
  changes them on the chart that is there.
- **The values.** `'today'` is the default. `'first-task'` is the earliest start (today when there
  are no tasks). `'start'` and `'end'` are the ends of the timeline, padding included. `'none'`
  does not scroll. Anything else is a date: `'2026-06-01'`, a `Date` or epoch milliseconds, aligned
  by `scroll.align` like today and the first task.
- **A fixed timeline is clamped.** The chart cannot scroll past its ends, so `'today'` for a plan
  that is entirely in the past or the future lands on the nearest end of it. Put
  `timeline.includeToday: true` in the options to make the range of the chart contain today, or turn
  on [the infinite timeline](../infinite-timeline/README.md), which grows to reach any date.
- **A call can bring its own** `align` and `behavior`, as in
  `gantt.scrollToDate('2026-06-01', { align: 'end', behavior: 'instant' })`.
  `scrollToTask(id, { alignY })` places the row independently of the bar, and expands the collapsed
  parents of the row first (`expand: false` does not).
- **Calls made too early** (before the chart has a width) are remembered, the latest one wins, and
  they are performed at mount instead of `scroll.initial`.
- **The dates are wall-clock `Date`s.** `getVisibleRange()` and the `date` of `onScroll` are `Date`s
  that read the same in every time zone, so format them with the local formatter, as
  [`helpers.ts`](helpers.ts) does. `now` is floating wall-clock time too.
- **Why `on('scroll')` in the vanilla code.** The first scroll of a chart, the one that applies
  `scroll.initial`, happens inside `createGantt`, before the function has returned the chart. An
  `onScroll` option that reads the chart would run too early, so the example adds the listener
  with `gantt.on('scroll', …)` once it has the chart. React has no such trouble: the handle in the
  `ref` is set before the first event.

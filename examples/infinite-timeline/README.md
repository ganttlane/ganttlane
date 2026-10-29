---
title: Infinite timeline
description: A timeline that grows as you scroll past its ends, with its threshold, step, longest span and bounds, and every change of its range reported by onRangeChange.
category: Time scale
order: 130
height: 580
---

# Infinite timeline

A chart normally covers its tasks plus some padding, and scrolling stops there. With
`timeline.infinite` the timeline grows by itself: when you scroll within `threshold` pixels of
either edge, that edge moves out by `extendBy`, and the chart keeps the date under its left edge
where it is, so nothing jumps. `maxSpan` cuts off the side you left, `bounds` stop the growth at
dates you choose, and `scrollToDate` to a date outside the timeline grows it first. Every change
is reported with `onRangeChange`, with the new range and the reason: the hook for loading tasks as
the timeline reaches new dates.

The select puts a different value into `timeline.infinite`; the line under the chart is written
by `onRangeChange` and counts the changes since you chose.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): ten tasks in one quarter, and their links.
- [`options.ts`](options.ts): `timeline.infinite`, and the five settings the select offers.
- [`helpers.ts`](helpers.ts): `describe`, which writes the status line.
- [`vanilla.ts`](vanilla.ts): `onRangeChange`, `setOptions({ timeline })` and `scrollToDate`.
- [`react.tsx`](react.tsx): the same with the `timeline` and `onRangeChange` props and the `ref`.

## Options

| Option                          | Value                                      | What it does                                                                        |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `timeline.infinite`             | `true`, `false` or an object (the select)  | Turns the infinite timeline on (it is off by default); an object also sets the rest |
| `timeline.infinite.threshold`   | `200`                                      | Distance in px from an edge at which it is extended (default: the viewport's width) |
| `timeline.infinite.extendBy`    | `'1mo'`                                    | The least one extension adds (default: two viewport widths of time)                 |
| `timeline.infinite.maxSpan`     | `'6mo'`                                    | The longest timeline kept: the edge you scrolled away from is trimmed               |
| `timeline.infinite.bounds`      | `{ min: '2026-01-01', max: '2026-12-31' }` | Dates it never extends past; a date-only `max` includes its whole day               |
| `onRangeChange`                 | a function                                 | Called with `{ start, end, reason }` whenever the range changes                     |
| `viewMode`                      | `'week'`                                   | The scale of the timeline (React: `defaultViewMode`, as nothing here changes it)    |
| `scroll.initial`                | `'first-task'`                             | Opens on the plan, with the empty timeline before it in reach                       |
| `layout.rowHeight`, `barHeight` | `32`, `20`                                 | Compact rows, so that every task fits                                               |

The five settings of the select:

| Select                        | `timeline.infinite`                                    |
| ----------------------------- | ------------------------------------------------------ |
| `false: a fixed range`        | `false`                                                |
| `true: the defaults`          | `true`                                                 |
| `threshold 200, extendBy 1mo` | `{ threshold: 200, extendBy: '1mo' }`                  |
| `extendBy 1mo, maxSpan 6mo`   | `{ extendBy: '1mo', maxSpan: '6mo' }`                  |
| `bounds: 2026 only`           | `{ bounds: { min: '2026-01-01', max: '2026-12-31' } }` |

## What to try

With **true**, scroll to the right end of the chart (the wheel, a trackpad, the scrollbar): the
timeline reaches out by about two screens each time you come near its end, and the line under the
chart counts `extend-end`. Do the same to the left for `extend-start`. **Go to Dec 2027** jumps
to a date far outside the timeline, which grows to include it (`scroll-to`), and **Back to the
plan** comes home. Choose **false**: the timeline snaps back to the plan and its padding, and
scrolling stops at its ends. Choose **extendBy 1mo, maxSpan 6mo** and scroll a long way in one
direction: the timeline never gets much longer than six months, as the edge behind you is trimmed
(`trim-start`, `trim-end`). Choose **bounds: 2026 only** and neither scrolling nor the buttons get
you out of 2026.

## Notes

- **The reasons** `onRangeChange` gives: `'initial'` (the first range), `'extend-start'` and
  `'extend-end'` (the timeline grew), `'trim-start'` and `'trim-end'` (it was cut), `'scroll-to'`
  (a `scrollTo*` outside it), `'drag'` (a bar was dragged out of it), `'resize'` (the viewport
  changed), `'view-mode'` and `'zoom'` (the scale changed), `'data'` and `'options'` (new tasks or
  options re-resolved it). The event carries `Date`s: `start` and the exclusive `end`.
- **Changing the setting** with `setOptions({ timeline: { infinite } })` re-resolves the range
  (`'options'`) only when it changes: from a grown timeline to `false` it snaps back to the data.
  `timeline` is merged field by field, so `padding`, `range` and `includeToday` keep their values.
- **Why it does not jump.** Extending the start moves every date to the right on the page. The
  chart adds the same distance to `scrollLeft` in the same frame, so the date at the left edge
  stays where it was; extending the end moves nothing.
- **There is a ceiling anyway.** Browsers cannot draw an element of any width, so the content is
  never kept wider than about 4 million px: at the hour view (960 px a day) that is about eleven
  years, at the week view (20 px a day) about 550. `maxSpan` is the limit you choose, in time.
- **A fixed range of your own** is `timeline.range: { start, end }`; `timeline.includeToday`
  keeps today inside an automatic range. Neither is needed for the infinite timeline.
- **`scroll.initial: 'start'` and `'end'`** mean the ends of the data (and its padding), also with
  an infinite timeline, which then has more timeline beyond them to scroll into.
- **React.** `timeline` is an ordinary prop, so the select changes your state and the chart merges
  it with `setOptions` for you. `onRangeChange` can fire several times before React renders again,
  so the example keeps the counts in a ref.

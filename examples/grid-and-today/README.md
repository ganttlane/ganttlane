---
title: Grid and today
description: Grid lines, days off, the today line and the major lines of each view mode, with hover and selection styles set from tokens.
category: Customization
order: 570
height: 500
---

# Grid and today

The body of the chart is a grid, and a handful of options and tokens decide what is on it:

- **`display.gridLines`**: the vertical lines of the columns, the horizontal lines of the rows,
  both (the default), or none.
- **The today line** (`display.today`): the line in the grid, the dot in the header, and the
  highlighted header cell. It follows the clock, or the `now` option.
- **Days off** (`display.nonWorkingDays`): weekends and holidays, as a fill, stripes, or not drawn.
- **Major lines**: the heavier lines at the start of a week, a month or a quarter. Each view mode
  says where its own are (`majorLine`), and you can say otherwise.
- **Hover and selection**: the range of a hovered bar in the header, a selected bar, a selected link.
  They are tokens, so a stylesheet of yours changes them without a rule per state.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): seven tasks and five links around the fixed "today".
- [`options.ts`](options.ts): the `display` options, a fixed `now`, `layout`, the first scroll, and
  two `viewModes` overrides: major lines every second Monday, and none.
- [`styles.css`](styles.css): the "violet, bold" look, as tokens, with its dark values.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the toolbar and the status line. A
  click selects a bar, so there is a selection to style.

## Options

| Option                          | Value                                      | What it does                                                                                 |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `display.gridLines`             | `'both'`; the select: the other three      | `'both'`, `'vertical'`, `'horizontal'` or `'none'`                                           |
| `display.today`                 | `true`; the checkbox                       | The today line, its marker in the header and the highlighted header cell                     |
| `display.nonWorkingDays`        | `'fill'`; the select: `'stripes'`, `false` | How days off are shown                                                                       |
| `display.headerRangeHighlight`  | `true`; the checkbox                       | The range of the hovered bar, highlighted in the header                                      |
| `viewModes`                     | `{ day: { majorLine } }`, …                | Overrides merged over the presets: `majorLine` as a function of a column's start, or `false` |
| `viewMode`                      | `'week'`; the select: `'day'`, `'month'`   | The scale: each has its own major lines (React: a controlled prop)                           |
| `now`                           | `() => '2026-03-18T12:00'`                 | A fixed today, so the line is on the plan. Leave it out in an application                    |
| `layout.rowHeight`, `barHeight` | `34`, `22`                                 | Shorter rows than the default 48 and 30, so the whole plan is on the screen                  |
| `scroll.initial`                | `'first-task'`                             | Opens on the plan                                                                            |

The tokens of the "violet" look (`styles.css`): `--gantt-grid-line-color`, `--gantt-grid-major-line-color`
and `-width`, `--gantt-nonworking-color`, `--gantt-today-color` and `-width`,
`--gantt-header-current-color`, `--gantt-header-range-color`, `--gantt-bar-selected-color` and
`-width`, `--gantt-link-selected-color` and `-width`, and `--gantt-focus-ring-color`. The whole
table is in the [`@ganttlane/dom` README](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#tokens).

## Major lines of the view modes

| View mode     | Column   | Major line at the start of a | Minor lines (the snap step) |
| ------------- | -------- | ---------------------------- | --------------------------- |
| `hour`        | 1 hour   | day                          | 15 minutes                  |
| `quarter-day` | 6 hours  | day                          | 1 hour                      |
| `half-day`    | 12 hours | day                          | 1 hour                      |
| `day`         | 1 day    | week                         | none                        |
| `week`        | 1 week   | month                        | none                        |
| `month`       | 1 month  | quarter                      | none                        |
| `year`        | 1 year   | none                         | none                        |

## What to try

Switch **View** and watch the heavier lines move: weeks in the day view, months in the week view,
quarters in the month view. Choose **Major lines**: "sprint" draws one
every second Monday (a function of the start of a column), "none" removes them. Change **Grid
lines** and **Days off**, and untick **Today**: the line, the dot and the header cell all go. Then
choose the violet look: the today line is bold and dashed, the major lines are heavier. Hover a
bar to see its range in the header, and click it for the selection outline; click an arrow for the
selected-link colour. Untick **Header range** to turn the highlight off.

## Notes

- **Major lines** are `{ unit }` (a line at the start of every week, month, quarter, …), a function
  of the start of a column in floating milliseconds that returns `true` where a line goes, or
  `false` for none. A `viewModes` record is merged over the presets field by field, so the example
  names `majorLine` only: the columns, headers and snap of the mode stay. The function here draws a
  line at midnight on every second Monday, and the month view is left out, so it keeps its quarters.
- **Minor lines** are the snap steps inside a column (dotted, from `minorLine`); `gridLines` leaves
  them out while they are denser than a few pixels.
- **State is attributes**: a major line has `data-major`, the header cell that holds today
  `data-current`, a selected bar `data-selected`. `display.today: false` removes the line, the
  marker and `data-current`. Anything a token does not cover is a rule on those names: the dashes of
  the today line in `styles.css` are one, `stroke-dasharray` on `.gantt__today`.
- **Clicking a bar only reports it** (`taskClick`); the example selects the bar in the handler
  (`select([id])`). Clicking an arrow selects the link by itself.
- **Why `[data-look] .gantt`**: the stylesheet declares each token on `.gantt`, the element inside
  your container, so a token set on the container is never inherited. See [Theming](../theming/README.md).
- **Days off come from the calendar** (`calendar.weekends`, `calendar.holidays`); `nonWorkingDays`
  only decides how they look. The default weekend is Saturday and Sunday.

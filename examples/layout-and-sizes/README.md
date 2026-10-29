---
title: Layout and sizes
description: Row, bar, corner and header sizes with live sliders, and a chart of a fixed height next to one that is as tall as its rows.
category: Time scale
order: 150
height: 540
---

# Layout and sizes

The size of everything the chart draws comes from the `layout` option, in pixels:

- `rowHeight`: the height of a task's row, the room for its bar and the space around it;
- `barHeight`: the height of a bar, centred in its row;
- `barRadius`: the roundness of its corners;
- `headerRowHeight`: the height of each row of the header (month, week, day, …);
- `height`: the height of the chart itself, which only the renderer knows.

The sliders change the first four with `setOptions({ layout })`, nothing is recreated, and the line
under the chart says what the options amount to. The select switches the chart between a
**fixed height** (the chart is that tall and scrolls inside itself) and `'auto'` (the chart is as
tall as its rows, and the page scrolls it, with the header stuck to the top). The dashed box is
the page.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): ten tasks in March and April, with progress and a milestone, and their links.
- [`options.ts`](options.ts): `layout`, each field commented, and the first scroll.
- [`helpers.ts`](helpers.ts): the sliders, and `describe`, which writes the status line.
- [`vanilla.ts`](vanilla.ts): the sliders and the select, `setOptions`, and a box that stands for the page.
- [`react.tsx`](react.tsx): the same with a `layout` prop.

## Options

| Option                   | Value          | What it does                                                                                                |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `layout.rowHeight`       | `48`           | The height of a row (the default): the slider **Row**                                                       |
| `layout.barHeight`       | `30`           | The height of a bar (the default), at most the row's: **Bar**                                               |
| `layout.barRadius`       | `3`            | The corner radius of a bar (the default), at most half its height and width: **Radius**                     |
| `layout.headerRowHeight` | `40`           | One number for every header row, or a list, top first (default `[45, 30]`): **Header rows**                 |
| `layout.height`          | `300`          | Px: the chart is that tall and scrolls inside. `'auto'`: as tall as its rows. Left out: fills the container |
| `viewMode`               | `'week'`       | The scale of the timeline (React: `defaultViewMode`, as nothing here changes it)                            |
| `timeline.padding`       | `'0d'`         | No timeline before the first task (the week view has `'4w'`), so the chart opens at the plan                |
| `scroll.initial`         | `'first-task'` | Opens on the plan                                                                                           |

## What to try

Drag **Row** down to 30: the rows shrink, and so does the bar, which cannot be taller than its row
unless you set `barHeight` to say so. Then drag **Bar** up past the row's height: the bars fill
their rows and no more, and the line under the chart says so (the option is clamped, and a
`warning` issue is reported). Drag **Radius** up: the corners round off until they are half the
bar's height, a pill, and no further. **Header rows** sets all the header rows at once. Switch the
**Height** to `'auto'` and the chart grows to show every row; scroll the dashed box (the page) and
the header stays at the top of it. Switch back, and the chart is 300 px again and scrolls itself.

## Notes

- **The defaults** are a row of 48 px, a bar of 30 px (or the row's height, when the row is
  shorter), corners of 3 px, and two header rows of 45 and 30 px. A header row past the second has
  30 px.
- **A list for `headerRowHeight`** gives each row of the header its own height, top first. Extra
  numbers are ignored and a missing one is the default, so one list suits view modes that have
  different numbers of header rows. A number sets them all.
- **A bad number** (not finite, zero or negative where it has to be positive) is an
  `invalid-layout-option` issue and the default is used instead. `setOptions` returns the issues of
  the options now in use, and `getIssues().options` has them too.
- **`layout.height`** belongs to the renderer, not to the core, so it is merged like the rest of
  `layout` but never reaches the core. A number sets `--gantt-height` on the root; `'auto'` sets
  `data-height="auto"` and moves the header into a sticky strip, so that it sticks to the page or to
  whatever ancestor scrolls it. Left out, the chart takes `height: 100%` of its container, which
  then needs a height of its own.
- **Anything else that is a size** is a CSS custom property of the theme (`--gantt-font-size`,
  `--gantt-grid-line-width`, …) that your stylesheet can set, see [Release plan](../release-plan/README.md)
  for a stylesheet of your own.
- **React.** `layout` is an ordinary prop: the sliders change your state, a new object with a
  changed field is applied with `setOptions` for you, and `layout.height` goes through it too.
  `viewMode` is a controlled prop and `defaultViewMode` its uncontrolled twin, so the example passes
  the latter.

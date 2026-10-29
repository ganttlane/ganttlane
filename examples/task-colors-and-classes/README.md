---
title: Task colours and classes
description: Style bars and rows by status with task.className and task.rowClassName and your own stylesheet, or with task.color and task.progressColor from the data, and stripe the rows.
category: Customization
order: 520
height: 550
---

# Task colours and classes

There are two ways to say what a task looks like, and the chart supports both:

- **A class**, `task.className` for the bar and `task.rowClassName` for its row. The class is a hook
  for your stylesheet: the example's [`styles.css`](styles.css) turns five status classes into five
  bar colours, and two of them into a tint of the whole row. Themes, hover states and print styles
  all stay in CSS.
- **A colour in the data**, `task.color` and `task.progressColor`. The renderer writes them as the
  custom properties `--gantt-bar-color` and `--gantt-bar-progress-color` on that one bar. Nothing to
  write in CSS; the colour is a value you compute.

The plan below is styled the first way. The **Style from** select swaps the tasks for the same plan
with colours in the data. **Row stripes** is `display.rowStripes`.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the plan with `className` and `rowClassName` (`tasks`), and `coloured`, the same
  plan with `color` and `progressColor`. A `Task<Meta>` carries its status in `data`.
- [`options.ts`](options.ts): `display.rowStripes`, row and bar heights, the first scroll.
- [`styles.css`](styles.css): the status classes (one custom property each) and the row tints.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the two selects. The tasks are swapped with
  `setTasks`, the stripes with `setOptions({ display })` (React: the `display` prop).

## Options

| Option                                 | Value                                            | What it does                                                                        |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `task.className`                       | `'is-done'`, `'is-phase is-active'`, …           | Added to the class of the bar (`g.gantt__bar`); several classes separated by spaces |
| `task.rowClassName`                    | `'row-late'`, `'row-blocked'`                    | Added to the class of the task's row (`rect.gantt__row`)                            |
| `task.color`, `task.progressColor`     | `'#0f9d8a'`, `'#0a6b5d'` (QA; all in `coloured`) | `--gantt-bar-color` and `--gantt-bar-progress-color` on the bar                     |
| `display.rowStripes`                   | `'group'`; the select: `'row'`, `false`          | Zebra stripes: every other row, every other parent with its children, or none       |
| `layout.rowHeight`, `layout.barHeight` | `34`, `20`                                       | Shorter rows than the default 48 and 30, so the whole plan is on the screen         |
| `viewMode`                             | `'week'`                                         | The scale of the timeline (React: `defaultViewMode`)                                |
| `scroll.initial`                       | `'first-task'`                                   | Opens on the plan                                                                   |

## What to try

Choose "colours in the data": the bars keep their colours (they now come from `color`), but the red
and grey row tints are gone, because a row can only be styled by a class. QA is teal in both
modes: its own `color` and `progressColor` win over its class. Switch **Row stripes** between
`'group'`, `'row'` and `false`: with `'group'` the stripes follow the phases, with `'row'` they
follow the rows. A tinted row paints over its stripe. Hover a bar and click an arrow, as in any
chart: the hover outline, the selection and the conflict marks are the library's and combine with
your classes.

## Notes

- **A class sets a custom property, not the paint.** `.gantt__bar.is-late { --gantt-bar-color: … }`
  is enough: the track, the milestone diamond and the progress (the bar colour mixed towards black)
  all read it. Set `--gantt-bar-progress-color` in the class too if the progress should be another
  colour, and `--gantt-bar-label-color` for the label. Setting `fill` on `.gantt__bar-track`
  yourself also works, but the progress colour, which is derived from `--gantt-bar-color`, would
  not follow it.
- **Precedence.** `task.color` is written on the bar element itself, so it beats a class; a class
  beats the theme's `--gantt-bar-color` on `.gantt`, which the bar inherits. A rule of yours
  is not in `@layer gantt`, so it beats the library's own rules without `!important`.
- **A row class paints the whole row**, over the stripe and under the bars: use a colour with an
  alpha (`rgb(217 72 15 / 10%)`), so the grid lines and days off stay visible. There is no
  `color` counterpart for a row.
- **A phase is a task.** Give a parent a class of its own (`is-phase` here: a darker progress)
  next to its status. Its dates are its own; the library does not roll them up from the children.
- **Dark theme.** The status colours are mid-tones that work on both backgrounds. If they should
  differ, add `.gantt[data-theme='dark'] .is-done { … }` rules, or derive the colour from
  `color-mix()`; see [Theming](../theming/README.md) for how a theme is written.
- **Which to pick.** Classes when the look is a design decision (a palette, a theme, a print sheet)
  or when you also want a row style. Colours when they are data (a label colour a user picked, a
  project's colour) and not worth a rule each.

---
title: Theming
description: Switch between the light, dark and automatic themes, and re-style one chart with --gantt-* custom properties, in three presets for a brand palette, a compact density and high contrast.
category: Customization
order: 500
height: 440
---

# Theming

The look of the chart is a set of CSS custom properties, the `--gantt-*` **tokens**, and a theme is
nothing but a set of values for them. This example has the two things you will want to change:

- **the theme**, `theme: 'auto' | 'light' | 'dark'`. It is the `data-theme` attribute of the chart's
  root element and switches without a redraw. `'auto'` follows `prefers-color-scheme`;
- **a palette and a density** of your own, for one chart: three presets (Brand, Compact, High
  contrast) written as CSS in [`styles.css`](styles.css), chosen by a `data-preset` attribute on the
  chart's container.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): six tasks and five links, so that bars, progress, links, rows, days off, the
  today line and a highlighted day all have something to colour.
- [`options.ts`](options.ts): `theme`, a fixed `now`, `display.rowStripes`, a highlight, and the
  `layout` sizes of the presets (the density half that is not a token).
- [`styles.css`](styles.css): the presets, as rules on `[data-preset='…'] .gantt`.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the two selects, the attribute on the
  container and `setOptions({ theme })` (React: the `theme` prop).

## Options

| Option                                                          | Value                                                             | What it does                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `theme`                                                         | `'auto'`, then your choice                                        | `data-theme` of the chart's root: `'light'`, `'dark'`, or `'auto'` (the system) |
| `layout.rowHeight`, `barHeight`, `barRadius`, `headerRowHeight` | `40`, `24`, `3`, `[45, 30]`; Compact: `26`, `16`, `2`, `[26, 26]` | Geometry is an option, not a token; `setOptions` merges it field by field       |
| `display.rowStripes`                                            | `'row'`                                                           | Zebra rows: `--gantt-row-stripe-color`                                          |
| `highlights`                                                    | one day                                                           | A highlighted day: `--gantt-highlight-color` and `--gantt-highlight-opacity`    |
| `now`                                                           | `() => '2026-03-18'`                                              | A fixed today, so the today line is on the plan. Leave it out in an application |
| `viewMode`                                                      | `'week'`                                                          | The scale of the timeline (React: `defaultViewMode`)                            |
| `scroll.initial`                                                | `'first-task'`                                                    | Opens on the plan                                                               |

The tokens each preset sets (`styles.css`):

| Preset        | Tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand         | `--gantt-bar-color`, `--gantt-bar-selected-color`, `--gantt-link-color`, `--gantt-link-selected-color`, `--gantt-header-background-color`, `--gantt-header-text-color`, `--gantt-header-current-color`, `--gantt-header-range-color`, `--gantt-grid-major-line-color`, `--gantt-today-color`, `--gantt-highlight-color`, `--gantt-focus-ring-color`, `--gantt-popover-border-color`, `--gantt-popover-radius`                                               |
| Compact       | `--gantt-font-size`, `--gantt-link-width`, `--gantt-link-selected-width`, `--gantt-today-width`, `--gantt-bar-selected-width`, `--gantt-popover-radius`, `--gantt-popover-max-width`                                                                                                                                                                                                                                                                        |
| High contrast | the colours of the background, text, borders, header, grid lines, rows, days off, highlight, today line, bars, bar labels, links, focus ring and popovers (`--gantt-background-color`, `--gantt-foreground-color`, `--gantt-nonworking-color`, `--gantt-popover-*`, …), and the widths `--gantt-border-width`, `--gantt-grid-major-line-width`, `--gantt-today-width`, `--gantt-bar-selected-width`, `--gantt-link-width` and `--gantt-link-selected-width` |

The whole table, with the light and dark value of every token, is in the
[`@ganttlane/dom` README](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#tokens).

## What to try

Switch the theme: the chart changes at once, and so does the preset you chose, because each preset
says what it looks like in light and in dark. Pick Brand and hover a bar: the tooltip has the
preset's border and corners, and the highlighted day (Code freeze) is amber. Pick Compact and look
at the rows: type and lines are thinner (tokens) and the rows are shorter (the `layout` option,
applied by `setOptions`). Pick High contrast, then the dark theme. Click an arrow to select it, and
hover a bar to see the range it covers in the header: both are tokens.

## Notes

- **Set tokens on `.gantt`, not on the container.** The stylesheet declares every token on
  `div.gantt`, the element the chart adds inside your container, so a custom property set on the
  container (or on `<body>`) is never inherited by it. Give the container a class or an attribute
  and select the descendant, `[data-preset='brand'] .gantt { --gantt-bar-color: … }`, as the
  presets do. The library's CSS is in `@layer gantt` and yours is not, so yours wins without
  `!important` and in whatever order the two files are loaded.
- **A theme has two halves.** Because your unlayered rule beats the library's `dark` values, a
  preset that changes colours has to give the dark ones too (`.gantt[data-theme='dark']`, and
  `.gantt[data-theme='auto']` under `@media (prefers-color-scheme: dark)`). The presets keep their
  palette in a few variables of their own (`--brand-*`, `--hc-*`) and derive the tokens from them
  once, so a theme only gives those variables new values. A preset that changes only sizes
  (Compact) needs no dark block.
- **Density is part tokens, part options.** Type size and line widths are tokens
  (`--gantt-font-size`, `--gantt-link-width`, …). Row, bar and header heights are the `layout`
  option, because the renderer needs the numbers to place every bar. `setOptions({ layout })`
  merges field by field, and a field set to `undefined` goes back to its default.
- **This site and the theme switch.** The documentation site keeps every chart in its own theme: it
  writes `data-theme` on the chart's root when the chart appears and when you change the theme of
  the site (the select in the header). That is the attribute the `theme` option sets, so the last
  writer wins. The Theme select here calls `setOptions({ theme })`, so it works; when the site's
  theme changes the attribute is rewritten, and the example reads the attribute back
  (a `MutationObserver`) so that its select shows what the chart has. In your own page nothing else
  writes `data-theme`, and you can set the option and forget it. `'auto'` follows the system, not
  the site.
- **Per-element colours** are a separate thing: `task.color` and `task.progressColor` set
  `--gantt-bar-color` and `--gantt-bar-progress-color` on a single bar; see
  [Task colours and classes](../task-colors-and-classes/README.md).
- To replace the stylesheet instead of adjusting it, see [Unstyled](../unstyled/README.md).

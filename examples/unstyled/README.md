---
title: Unstyled
description: A chart styled from scratch, without the default stylesheet, using only the documented classes, data attributes and custom properties.
category: Customization
order: 510
height: 520
---

# Unstyled

The default stylesheet is a separate file that the JavaScript never imports. This example leaves it
out: the chart is drawn by [`styles.css`](styles.css) alone, a small "paper and ink" look (serif
type, dotted grid, dashed arrows, outlined bars, hard shadows on the popovers, and a dark variant),
written against the **unstyled contract** and nothing else.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): a plan with every state a stylesheet has to draw: phases with children, locked
  work, a milestone, links of two types, and a bar in conflict.
- [`options.ts`](options.ts): `display.rowStripes`, `display.nonWorkingDays`, `layout`, a fixed `now`.
- [`styles.css`](styles.css): the whole look, in three parts: the palette, the required skeleton,
  and the rules for each part of the chart.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the same chart without the
  `styles.css` import of the library; a class on the container scopes the sheet to it.

## Options

| Option                          | Value                               | What it does                                                                 |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `display.rowStripes`            | `'group'`                           | Marks every other group of rows with `data-stripe`; the sheet colours it     |
| `display.nonWorkingDays`        | `'stripes'`                         | Days off are a pattern the renderer defines; the sheet colours its lines     |
| `layout.rowHeight`, `barHeight` | `36`, `22`                          | Sizes are options: the renderer writes them into the SVG, the sheet does not |
| `now`                           | `() => '2026-03-18'`                | A fixed today, so the today line is on the plan. Leave it out in an app      |
| `viewMode`                      | `'week'` (the buttons change it)    | The scale of the timeline (React: a controlled prop)                         |
| `scroll.initial`                | `'first-task'`                      | Opens on the plan                                                            |
| `onTaskClick`                   | `gantt.on('taskClick', …)` / a prop | Selects the clicked bar, so `[data-selected]` has something to draw          |

## What to try

Hover a bar: its handles appear (they are in the DOM always, at `opacity: 0`), and so does the range
of the bar in the header. Drag a bar, its edges or the handle at its foot, or draw a link from the
round handle. Click a bar to select it, and an arrow to open its menu; hover a bar for its tooltip.
Docs starts on a Saturday, so its bar carries `data-conflict`; Design and its children are locked and
their outline is dashed (`data-locked`). Switch the site's theme: the sheet has a dark variant,
chosen by the `data-theme` attribute of the root.

## Notes

- **What the contract guarantees.** The structure of the chart (`div.gantt` › `div.gantt__scroller` ›
  `div.gantt__header` and `svg.gantt__body` …), the class names, the `data-*` attributes and their
  values, and the custom properties the renderer writes, change only in a major version. The
  tree and every attribute are listed in the
  [`@ganttlane/dom` README](../../packages/dom/README.md#unstyled-contract), and the package's tests
  check its own stylesheet against that list: every class and attribute has a rule or is marked as
  intentionally unstyled. What is **not** promised: the order of siblings inside a group, SVG geometry
  attributes (`x`, `width`, `d`, `points`, …) and element ids.
- **What a replacement sheet must do.** Size the structure from the custom properties the renderer
  writes on the root (`--gantt-content-width`, `--gantt-header-height`, `--gantt-body-height`,
  `--gantt-height`); make `.gantt__scroller` the one scroll container and keep
  `overflow-anchor: none` and `scroll-behavior: auto`; position header cells, the range and the
  today marker absolutely; clip the header with `overflow: clip`, never `hidden`, which would break
  sticky labels; give `.gantt__link-hit` a wide transparent stroke with `pointer-events: stroke`;
  place `.gantt__popover` with `transform: translate(var(--gantt-popover-x), var(--gantt-popover-y))`
  and give `[data-interactive]` popovers `pointer-events: auto`. Those rules are marked REQUIRED in
  `styles.css`.
- **Leave the geometry to the renderer.** Positions and sizes inside the SVG are attributes. A CSS
  value out-ranks an attribute, so a sheet that sets `r`, `width` or `d` breaks the chart; the sheet
  here sets paint (`fill`, `stroke`, `opacity`) only. The same goes for `fill="none"` on the link
  paths, which is why they are not painted black without a sheet.
- **State is attributes.** `[data-selected]`, `[data-hovered]`, `[data-dragging]`, `[data-locked]`,
  `[data-readonly]`, `[data-conflict]`, `[data-invalid]`, `[data-current]`, `[data-major]`,
  `[data-stripe]`, `[data-cycle]`: the renderer sets and removes them, and the sheet decides what
  they look like. When they combine, order the rules as the default sheet does: selected beats
  conflict and invalid, which beat hover.
- **Labels set both `fill` and `color`**, because a bar label is SVG text, or HTML in a
  `foreignObject` when `display.renderBarLabel` returns a node.
- **Per-element colours are yours to use or not.** `task.color` and `task.progressColor` arrive as
  `--gantt-bar-color` and `--gantt-bar-progress-color` on the bar. A replacement sheet can read them
  with a fallback (`fill: var(--gantt-bar-color, var(--bar-fill))`); this one does not, so every
  bar has the paper look. Reading them only makes sense when the default sheet is not loaded too,
  because that one defines `--gantt-bar-color` on every chart.
- **Scope the sheet, and it survives company.** Every rule starts with `.paper`, a class on the
  container, so the sheet cannot reach another chart on the page. The default sheet is in
  `@layer gantt` and this one is not, so if the default sheet is on the page as well (this site
  links it on every example page) these rules still win, without `!important`, because they set
  every property the default sheet sets for these parts. In your project, leave it out.
- To adjust the default look instead of replacing it, see [Theming](../theming/README.md).

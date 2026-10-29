---
title: Custom tooltip
description: The tooltip of a task as text sections, as a DOM node, and as a React component, none of it parsed as HTML by accident.
category: Customization
order: 540
---

# Custom tooltip

The tooltip of a task is the `tooltip` option. Its `render(context)` function returns what to show,
and the type of the answer decides how it is inserted, so that nothing is ever parsed as HTML by
accident:

| `render` returns                        | Shown as                                                               |
| --------------------------------------- | ---------------------------------------------------------------------- |
| a `string`                              | text                                                                   |
| `{ title, subtitle, details, actions }` | three lines of text and buttons that call `onSelect(context)`          |
| a DOM `Node`                            | the node, as it is                                                     |
| `{ node, dispose }`                     | a node that is told (`dispose()`) when the tooltip is done with it     |
| `{ html }`                              | markup, parsed as it is: the one way in, and sanitising it is your job |
| `null`, `''`, whitespace, `{}`          | nothing: no tooltip                                                    |

`render` runs when its inputs change (another task, new dates while dragging), not on every mouse
move. The context carries the task's `TaskRecord`, the `preview` of a drag in progress, the
predecessors and successors with their lags, the parent, the chart's `locale` and `api.hide()`.

With `@ganttlane/react` the tooltip is a React element, drawn through a portal into the node the
chart shows (`renderTooltip`). It sees your context providers and your state, and may use hooks.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): three tasks, two links.
- [`options.ts`](options.ts): `tooltip.trigger`, `delay` and `placement`, and the first scroll.
- [`vanilla.ts`](vanilla.ts): two `tooltip.render` functions (text sections, a DOM node) and the
  buttons that swap them with `setOptions`.
- [`react.tsx`](react.tsx): a `TaskCard` component returned from `renderTooltip`.

## Options

| Option              | Value                | What it does                                                            |
| ------------------- | -------------------- | ----------------------------------------------------------------------- |
| `tooltip.trigger`   | `'hover'`            | What opens it; `'click'` keeps it open, so its buttons can be reached   |
| `tooltip.delay`     | `100`                | Milliseconds a hovered bar waits before it shows the tooltip            |
| `tooltip.placement` | `'bottom'`           | The preferred side of the bar; it flips by itself when there is no room |
| `tooltip.render`    | a function (vanilla) | Returns the content: text sections or a DOM node                        |
| `renderTooltip`     | a function (React)   | Returns a `ReactNode`; replaces `tooltip.render` when both are given    |

## What to try

Hover a bar (click it in the React example, which has a button in its tooltip), then drag it: the
tooltip shows where it would land. The vanilla buttons swap the tooltip between text sections and a
DOM node. A tooltip with `actions` stays open until a press outside it or `Escape`, so its buttons
can be used.

## Notes

- `tooltip` is taken whole by `setOptions`: a given group replaces the one before, so a field it
  leaves out is back to its default. That is why the buttons spread `options.tooltip`.
- A DOM node is built with `textContent`, never `innerHTML`: the name of a task is data.
- `renderLinkMenu` (the menu a click on an arrow opens) and `renderBarLabel` (the text on a bar)
  work the same way in React. A tooltip, menu or label that renders to nothing (`null`, `false`,
  an empty element) is not shown.

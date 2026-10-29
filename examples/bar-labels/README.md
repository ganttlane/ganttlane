---
title: Bar labels
description: Where a bar's label goes (inside, outside, automatic or none) and what it says, as text, a DOM node, a disposable node or a React element, for example an avatar and a name.
category: Customization
order: 530
height: 520
---

# Bar labels

Every bar has a label, by default the name of the task. Two options decide what you see:

- **`display.barLabel`** says where it goes: inside the bar, outside it, `'auto'` (inside when it fits,
  outside when it does not), or `'none'`.
- **`display.renderBarLabel`** says what it is. It is called with the task (`id`, `name`, `task`,
  `progress`) and returns a string, a DOM node, a `{ node, dispose }`, or nothing, which is the name.
  With `@ganttlane/react` the same is the `renderBarLabel` prop, which returns a `ReactNode`.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

| `renderBarLabel` returns | The label is                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| a `string`               | text, never parsed as HTML                                       |
| a DOM `Node`             | the node, as it is                                               |
| `{ node, dispose }`      | a node that is told (`dispose()`) when the chart is done with it |
| `null` or `undefined`    | the name of the task                                             |

## Files

- [`data.ts`](data.ts): nine tasks with an `owner` in their `data`, and bars of different widths, so
  that `'auto'` has something to decide.
- [`options.ts`](options.ts): `display.barLabel`, row and bar heights, the first scroll.
- [`styles.css`](styles.css): the avatar and the name inside a label.
- [`vanilla.ts`](vanilla.ts): a string, a DOM node and a `DisposableNode` with counters, swapped with
  `setOptions({ display })`.
- [`react.tsx`](react.tsx): the `renderBarLabel` prop with a string and a `<Label>` component.

## Options

| Option                                 | Value                                 | What it does                                                         |
| -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `display.barLabel`                     | `'auto'`; the select: all four values | Where the label goes: `'auto'`, `'inside'`, `'outside'` or `'none'`  |
| `display.renderBarLabel`               | functions (vanilla)                   | What the label is; `undefined` is the name                           |
| `renderBarLabel`                       | functions (React)                     | The same, returning a `ReactNode`; replaces `display.renderBarLabel` |
| `layout.rowHeight`, `layout.barHeight` | `34`, `22`                            | Room enough for a 16 px avatar                                       |
| `viewMode`                             | `'week'`                              | The scale of the timeline (React: `defaultViewMode`)                 |
| `scroll.initial`                       | `'first-task'`                        | Opens on the plan                                                    |

## What to try

Leave the placement on `auto` and look at the chart: "Research" is inside its bar, "Accessibility
audit" and "Database migrations" are beside theirs, because the text does not fit in five days.
Choose `inside`: they are clipped to the bar. Choose `outside` and `none`. Then change the
content: a string (name and progress), a DOM node with an avatar, and, in the vanilla example, a
`DisposableNode`: the status line counts the nodes it made and the nodes the chart has let go of.
Hide the labels (`none`), drag a bar, or scroll, and watch the counters: a node is disposed when its
label is hidden, made again from new inputs, or when its bar leaves the window.

## Notes

- **`'auto'` needs a width, and it only has an estimate.** The chart never measures text while it
  draws (that forces a layout). For a string or a name it estimates the width from the characters;
  for a plain node, from the node's `textContent`, so an avatar made of CSS is not counted and the
  label may be a little wider than it looks. For a `DisposableNode` or a React element the width is
  not known at all (the node is kept by its owner and holds whatever was drawn last), and `'auto'`
  puts it **inside** the bar. When the width matters, choose `'inside'` or `'outside'`.
- **Inside, a label is clipped to its bar; outside, it is not.** The node is in a `foreignObject`,
  in `div.gantt__bar-label-content`: a flex box the size of the bar (inside) or as wide as the
  estimate, starting at the bar's edge (outside). A label takes no pointer events.
- **Colour.** The text colour is the chart's: `--gantt-bar-label-color` inside a bar (white),
  `--gantt-bar-label-outside-color` beside it. A node inherits it; set your own `color` on the part
  that needs another.
- **Nodes and text.** Build a node with DOM APIs and `textContent`, never `innerHTML`: a task name
  is data. A string is inserted as text for you.
- **A `DisposableNode`** is for a node that has a life of its own (a widget, a framework's portal
  host). `dispose()` is called once, and the new label is asked for before the old one is disposed,
  so the two may share a node. `@ganttlane/react` is built on this: its `ReactNode` slots are
  portals into such nodes.
- **React.** The function is called as the body of a component of its own, once for each visible
  bar, so it may use hooks and sees your context providers. For hundreds of bars that is hundreds
  of portals: keep the label light. A function that is new on every render costs the chart
  nothing.
- **A renderer should not throw.** If it does, that bar shows its name and the error is rethrown
  from the frame, as the errors of every render function are.

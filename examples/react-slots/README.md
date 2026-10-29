---
title: Slots as React
description: The tooltip, the link menu and the label of a bar as React components that read your context, with a slotKey for functions that differ and errors reported to onError.
category: React
order: 640
height: 500
---

# Slots as React

React only. Three places of the chart have content of their own: the tooltip of a task, the menu a
click on an arrow opens, and the label of a bar. `renderTooltip`, `renderLinkMenu` and
`renderBarLabel` give each of them as React: a function from the chart's context to a `ReactNode`,
which React draws through a portal into the node the chart shows. The portals sit next to the chart,
in **your** tree, so the content reads your context providers and your state, and may use hooks.

Here the people come from a context provider (a directory of who is who): the labels of the bars
show the owner's initials, the tooltip the name and the role, and the menu of an arrow who hands
over to whom. The tasks carry only an owner id, in a typed `task.data`.

```sh
pnpm add @ganttlane/react react react-dom
```

## Files

- [`data.ts`](data.ts): the tasks, with a typed `data` (`Meta`: an owner id), and the links.
- [`directory.ts`](directory.ts): the application's own context (two teams of three people) that the
  slots read.
- [`options.ts`](options.ts): the view mode, the first scroll, when the tooltip opens, where the
  label goes.
- [`slots.tsx`](slots.tsx): the functions and components the slots draw.
- [`styles.css`](styles.css): the card inside a tooltip or a menu, and the chip on a bar.
- [`react.tsx`](react.tsx): the provider, `<Gantt>` with the three slots, and the controls.

## Options

| Option                         | Value                                            | What it does                                                                               |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `renderTooltip`                | `FullTooltip`, `CompactTooltip`, `BrokenTooltip` | The tooltip as React; replaces `tooltip.render`                                            |
| `renderLinkMenu`               | a function                                       | The menu of an arrow as React; replaces `linkMenu.render`                                  |
| `renderBarLabel`               | a function                                       | The label of a bar as React; replaces `display.renderBarLabel`                             |
| `tooltip.trigger`              | `'click'`                                        | A click opens the tooltip and keeps it open, so that its buttons can be pressed            |
| `display.barLabel`             | `'inside'`                                       | Where a React label goes; the chart cannot measure it, so `'auto'` would always say inside |
| `onError`                      | a function                                       | Hears what a slot function throws, named after its prop                                    |
| `onLinkDelete`                 | a function                                       | Hears of a link removed from the menu with `remove()`                                      |
| `ref`                          | `useRef<GanttHandle<Meta>>`                      | Puts the links back (`setLinks`) after the menu removed some                               |
| `defaultViewMode`              | `'week'`                                         | The scale of the timeline                                                                  |
| `scroll.initial`               | `'first-task'`                                   | Opens on the plan                                                                          |
| `defaultTasks`, `defaultLinks` | the tasks and links                              | Where the chart starts with its data                                                       |

## What to try

- **Click a bar.** The tooltip is a React component. The owner's name and role come from the
  context, the predecessors from the tooltip's context (`predecessors`, read with `api.getTask`),
  _Watch_ is a `useState` of its own, and _Close_ is `api.hide()`.
- **Press _Watch_, then drag the bar.** While a bar is dragged the tooltip shows where it would
  land (`preview`, marked _moving_), and it still says _Watching_: the chart makes the content
  again for each preview and keeps its place in the page, so the state inside it lives on.
- **Change the team.** The initials on the bars and the names in the open tooltip change at once.
  Only the value of the provider changed, and the chart was not touched.
- **Change the tooltip.** _compact_ is another function, with other hooks. Each function says it
  is a component of its own with a `slotKey`, so the slot starts the new one anew (_Watching_ is
  forgotten) and React has nothing to complain about.
- **Break the tooltip.** With _throws_, click a bar. The function throws while React renders its
  content. No tooltip opens, the chart and the page stay as they are, and `onError` says which
  prop it was. (React also logs the error to the console, as for any error caught around a
  component.)
- **Click an arrow.** The menu says who hands over to whom. _Remove dependency_ calls
  `context.remove()`: the chart removes the link and `onLinkDelete` says so. _Restore links_ puts
  them back.

## Notes

- **A slot function is the body of a component.** It is called while React renders, once for each
  tooltip, menu or label on show, and again when its context changes, so it may call hooks, and
  they keep their state while the chart shows the same task or link. An inline arrow function that
  is new on every render counts as the same function: the chart is not told, and the latest one
  draws.
- **The same hooks in the same order.** A function that is _swapped_ for another with different
  hooks is another component. Give each its own `slotKey`
  (`FullTooltip.slotKey = 'full'`) and the slot starts the new one anew. Without a `slotKey`, React
  cannot tell, and throws when the number of hooks differs; the slot recovers once, but React
  logs the error in development. Keeping the logic in a component and returning an element
  (`<HandoffMenu context={context} />`, as the menu and the label do here) avoids it altogether.
- **Errors.** A function that throws is caught around its own content: the tooltip or menu is
  hidden, a label draws nothing, and the error goes to `onError` as
  `{ error, source: 'listener', name: 'renderTooltip' }`, or to `reportError` without a handler.
  The slot is drawn again when its context or its function changes. Errors in event handlers and
  effects are yours, as everywhere in React.
- **Labels.** One portal for each visible bar. The chart does not measure what React draws, so it
  cannot tell if a label fits: `'auto'` always puts it inside the bar, clipped. Choose `'inside'`
  or `'outside'`. A label takes no pointer events.
- **Popovers take pointer events only when they stay open**: the menu, and a tooltip opened by a
  click. A hover tooltip is for reading and has no buttons.
- **Empty is nothing.** `null`, `false`, `''` and an element that wraps nothing show no tooltip or
  menu.
- **With `useGantt`**, render `slots` next to the container instead: [Hooks](../react-hooks/README.md).
  Nothing is drawn on a server; the slots come with the chart after hydration.
- **The vanilla functions still work** (`tooltip.render`, `linkMenu.render`,
  `display.renderBarLabel`); when both are given, the slot is used and development warns once. See
  [Custom tooltip](../custom-tooltip/README.md) for the vanilla side and a simple React tooltip.

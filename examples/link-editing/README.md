---
title: Link editing
description: Draw dependencies by dragging or by click-click, remove them from the menu of a link, turn it all off with editing.links, and hear about each with onLinkCreate and onLinkDelete.
category: Editing
order: 410
height: 500
---

# Link editing

The user draws a dependency from a round handle that appears at either end of a bar when it is
hovered, and removes one from the menu that a click on its arrow opens. The chart reports each with
`onLinkCreate` and `onLinkDelete`, tells you what it refused with `onEditRefused`, and changes
nothing it should not: a link that would close a cycle, repeat one, or link a task to itself is
never created.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks and six links; one link has `editable: false`.
- [`options.ts`](options.ts): `editing.links`, the type of the links the user draws, the layout.
- [`helpers.ts`](helpers.ts): the lines of the status, and the four link types.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the handlers, the checkbox for `editing.links` and the select for the type of new links.

## Options

| Option                           | Value                       | What it does                                                                      |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `editing.links`                  | `true`, toggled by the box  | Draw links from the handles and remove them from the menu; `false` turns both off |
| `scheduling.defaultLinkType`     | `'FS'`, set by the select   | The type of a link the user draws: `'FS'`, `'SS'`, `'FF'` or `'SF'`               |
| `link.editable`                  | `false` on QA to Launch     | The menu of that link does not offer to remove it                                 |
| `onLinkCreate`                   | a function (in the example) | `(link, id)`: a link was drawn, or added by `addLink`                             |
| `onLinkDelete`                   | a function (in the example) | `(record)`: a link was removed, from the menu or by `removeLink`                  |
| `onLinkClick`                    | a function (in the example) | `(record, event)`: the arrow of a link was clicked; the link is now selected      |
| `onEditRefused`                  | a function (in the example) | A link that was not drawn, with the `reason`                                      |
| `viewMode`                       | `'week'`                    | The scale of the timeline (React: `defaultViewMode`)                              |
| `scroll.initial`                 | `'first-task'`              | Opens on the plan                                                                 |
| `layout.rowHeight`, `.barHeight` | `36`, `24`                  | Smaller rows, so that every task is in view                                       |

## What to try

- **Draw by dragging.** Hover Docs: a round handle shows on each side of the bar. Press the one at
  the right end, drag onto QA and let go: `Created Docs → QA (FS)`. Nothing moves; a link without a
  `lag` keeps the gap it has.
- **Draw by clicking twice.** Click the handle (the link is now armed and follows the pointer),
  then click the target bar. `Escape`, a click on empty space or a click outside the chart cancels it.
- **Remove.** Click the arrow of a link and choose _Remove dependency_. The arrow from QA to Launch
  has `editable: false`: it is selected, and its menu has nothing to offer.
- **Be refused.** Draw a link from a bar onto itself (`self`), onto a task it already points
  at (`duplicate`), and from Launch back to Design (`cycle`: Design leads to Launch through the
  chain). Nothing is created, and the line under the chart says why.
- **Change the type.** Pick `SS` in the select and draw another link: it is a start-to-start link,
  drawn from the start of the source to the start of the target. A link of another type between
  the same two tasks is not a duplicate.
- **Turn it off.** Untick `editing.links`: the handles go and the links have no menu.

## Notes

- **Both handles make the same link.** The handle you press only says where the line starts; the
  type is `scheduling.defaultLinkType` (`'FS'` unless you set it), and the link is from the task
  you pressed on to the task you released on.
- **What `onEditRefused` says for links.** `{ gesture: 'link-create', id, target, reason, at }`:
  `id` is the source, `reason` is `'self'`, `'cycle'`, `'duplicate'` or `'permission'` (a task is
  [`linkable: false`](../read-only/README.md), or `editing.links` is off). While the pointer is over a
  target that would be refused the cursor is `not-allowed`, and the event comes on release.
- **The data is the chart's own.** The chart is uncontrolled here, so it appends the link to its
  links and removes it again by itself. If your state owns the links, take them from `onLinkCreate`
  and `onLinkDelete` (React: `onLinksChange` gives the whole list), as
  [Controlled data](../controlled-data/README.md) does.
- **From code.** `addLink(link)` and `removeLink(id)` run the same checks and, for `addLink`, the
  `onBeforeLinkCreate` hook, and return a result: see
  [Programmatic updates](../programmatic-updates/README.md) and [Before-hooks](../before-hooks/README.md).
- **The menu** is `linkMenu`: its `render` and its `onRemove` can be replaced, for a confirmation
  or your own buttons. By default `onRemove` is the chart's own `removeLink`.
- **React.** `editing` and `scheduling` are ordinary props, so the checkbox and the select are state.
  `tasks`, `links` and `viewMode` are the controlled ones: `defaultTasks` and `defaultLinks` are
  where the chart starts, and the links the user draws are then the chart's own.

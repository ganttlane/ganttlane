---
title: Link menu
description: The menu a click on an arrow opens, with your own actions to change the type, change the lag or remove, and your own handler for the remove action.
category: Customization
order: 550
height: 470
---

# Link menu

A click on an arrow selects the link and opens its **menu**. By default the menu has one action,
"Remove dependency", which calls the chart's own `removeLink`. The `linkMenu` option changes both
halves of that:

- **`linkMenu.render(context)`** returns the content of the menu: the same kinds of content as a
  tooltip (text sections with buttons, a DOM node, `{ node, dispose }`, `{ html }`), or `null` for no
  menu. With `@ganttlane/react` the same is the `renderLinkMenu` prop, which returns a `ReactNode`.
- **`linkMenu.onRemove(link)`** is what the remove action calls, with the record of the link. Give
  your own to ask first, or to remove the link from your own data (in controlled data the chart
  cannot do it for you).

This example adds three kinds of action to the menu: change the type of the link, change its lag,
and remove it, and shows what a menu says about a link that cannot be edited.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): seven tasks and seven links of three types, with different gaps. The last one
  (QA to Launch) is `editable: false`.
- [`options.ts`](options.ts): no weekends, row heights, the first scroll.
- [`helpers.ts`](helpers.ts): the actions (`actionsFor`), shared by both flavours.
- [`vanilla.ts`](vanilla.ts): `linkMenu.render` returning text sections, and `linkMenu.onRemove`.
- [`react.tsx`](react.tsx) and [`styles.css`](styles.css): `renderLinkMenu` returning a `<LinkMenu>`
  component, and the few rules its markup needs.

## Options

| Option                                 | Value                         | What it does                                                                                |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `linkMenu.render`                      | a function (vanilla)          | The content of the menu: sections of text and buttons, or `null` for no menu                |
| `renderLinkMenu`                       | a function (React)            | The same, returning a `ReactNode`; replaces `linkMenu.render`                               |
| `linkMenu.onRemove`                    | a function                    | What the remove action calls (default: the chart's `removeLink`)                            |
| `editing.links`                        | `true`; the checkbox: `false` | Whether the UI may draw and remove links. With `false` the context's `canRemove` is `false` |
| `link.editable`                        | `false` on QA to Launch       | A link that cannot be removed from the UI                                                   |
| `calendar.weekends`                    | `[]`                          | No days off, so a task moved by a day never lands on a weekend                              |
| `layout.rowHeight`, `layout.barHeight` | `40`, `26`                    | Rows a little shorter than the default                                                      |
| `viewMode`                             | `'week'`                      | The scale of the timeline (React: `defaultViewMode`)                                        |
| `scroll.initial`                       | `'first-task'`                | Opens on the plan                                                                           |

## What to try

Click the arrow from Build to Docs (start to start): the menu names the link, says what it is
("start to start · lag of 3 days") and offers the other three types, a day more or less of lag,
and Remove. Make it finish to finish, then click it again. Choose "Lag +1 day": Docs, and what
follows it, move a day later, and the status line says what the lag is now. Remove a link, then press
Reset. Click the last arrow, QA to Launch: it is fixed, so its menu only tells. Untick "Links can
be edited" and click any arrow: the same. Escape, a click outside or a scroll closes a menu; Tab
moves between its items.

## Notes

- **The context.** `render` is called with `{ link, source, target, canRemove, remove(), locale, api }`.
  `link` is the record of the link (`type`, `lag.days`, `editable`, …), `source` and `target` the
  records of its tasks, `remove()` calls `onRemove` and closes the menu, and `api` has `getTask`,
  `getLink` and `hide()`. It is called again when the link, its tasks, the locale or the strings
  change while the menu is open.
- **`canRemove`** asks again each time it is read: it is true when `linkMenu.onRemove` is set,
  `editing.links` is on, and the link is editable. A menu with actions should show them only then;
  this one shows text instead. Turning `editing.links` off under an open menu closes it.
- **There is no "change the type" call.** A link has no setter: this example adds a link of the new
  type, and removes the old one once the add worked (`addLink`, then `removeLink`), so that a
  refusal (a duplicate, a cycle, a hook that says no) leaves the old link in place. The new link has
  no `lag`, so it keeps the gap that its new anchors have. Each call is its own change for the
  before-hooks, and its own entry for `history`.
- **The lag is the gap.** A link without a `lag` keeps whatever gap its tasks have, so "Lag +1 day"
  moves the successor (`updateTask(target, { start })`), and propagation moves what follows it. A
  link with an explicit `lag` is a minimum instead: moving the successor closer reports a conflict.
  "Lag −1 day" is only offered while there is a gap to take from.
- **The status line is the application's.** The actions return a sentence from the result of the
  call (`'committed'`, `'rejected'` with a reason, `'busy'`), because a menu that cannot say why
  nothing happened is worse than none.
- **React.** The menu is drawn through a portal into the popover and sees your context providers. The
  popover does not know your buttons, so call `api.hide()` (or `remove()`, which closes it) from
  them; text sections in vanilla close the menu by themselves. Give your buttons `role="menuitem"`:
  the menu is `role="menu"`, and the focus goes to its first button when it opens.
- **The wording** of the default menu (`Remove dependency`, the title) is
  [`strings.removeLink` and `strings.linkTitle`](../locale-and-strings/README.md); a menu of your own
  writes its own.

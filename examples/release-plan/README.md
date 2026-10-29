---
title: A release plan
description: Phases with children pinned to them, a milestone, locked work, links with leads and lags, a work calendar, and status colours from your own CSS.
category: Plans
order: 700
height: 520
---

# A release plan

A plan with the pieces most charts need: phases that hold children, children pinned to the edges of
their phase, finished work that is locked, links with a lead and a lag, a milestone, a work
calendar with holidays, striped groups, status colours from CSS, and a typed `data` payload that
reaches every handler and render function.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the tasks (a `Task<Meta>` carries your own `data`), and the links.
- [`options.ts`](options.ts): the calendar, the hierarchy, `display`, the tooltip and a before-hook.
- [`styles.css`](styles.css): your own stylesheet, one custom property per status class.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): `createGantt<Meta>` and `<Gantt<Meta>>`,
  with buttons that expand and collapse the phases.

## Options

| Option                   | Value                                   | What it does                                                         |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| `calendar.holidays`      | two named days                          | Days off; they stripe the grid and name themselves on hover          |
| `hierarchy.moveChildren` | `'following'`                           | Moving a phase moves the children that follow it                     |
| `hierarchy.expandedKeys` | `['build']`                             | Which phases are open (React: `defaultExpandedKeys`); Design is shut |
| `display.rowStripes`     | `'group'`                               | Zebra stripes per phase with its children                            |
| `display.nonWorkingDays` | `'stripes'`                             | Days off are striped                                                 |
| `tooltip.render`         | a function                              | Reads the typed `task.data` (`owner`, `status`)                      |
| `onBeforeTaskChange`     | a function                              | Refuses a bar that would leave its phase                             |
| `task.className`         | `'is-done'`, `'is-active'`, `'is-late'` | Status colours, set in `styles.css`                                  |

## What to try

Drag Build: Backend and Frontend follow it, and QA follows along the link. Design is locked: it
does not move, and nothing pushes it. Hover a bar for its owner and status, and a striped day for
its name. The before-hook refuses any change that would put a child outside its phase.

## Notes

- **Phases and children.** `parentId` makes the tree and a pre-order list of rows. A parent with
  children gets a collapsed or expanded state from `hierarchy.expandedKeys` (`expand('design')`,
  `collapseAll()` change it later).
- **Pinned children.** `parentAnchor` pins a child's edges to its parent's: `'SS'` the start to the
  start, `'FF'` the end to the end, `'FS'` the start to the parent's end, `'SF'` the end to the
  parent's start. Moving _Build_ moves _Backend_; stretching _Build_ stretches _Frontend_, which is
  pinned at both edges.
- **Locked work.** `locked: true` removes a task from the user's reach and from propagation, but
  you can still link to it.
- **Lags and leads.** A number is days (negative for a lead), a string a duration (`'3d'`, `'4h'`).
  A link without a `lag` keeps the gap it has now.
- **Conflicts** (a child outside its phase, a bar on a day off, a link whose gap is below its
  minimum) are reported on the record (`record.conflicts`), drawn on the bar, and passed to
  `onBeforeTaskChange`.
- **A milestone** is a task of `type: 'milestone'` with just a `start`.
- **Your own stylesheet** is any stylesheet of the page, loaded after the library's. `task.className`
  is added to the bar's own element, so a custom property set on it reaches the bar and its progress.

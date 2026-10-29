---
title: Groups and children
description: Phases with children that you expand and collapse, and what moves the children when a phase moves (moveChildren, followParent, parentAnchor), with the outside-parent conflict.
category: Scheduling
order: 220
height: 590
---

# Groups and children

A task with `parentId` is a child; a task that has children is a group (a phase here). The rows
are the tasks in pre-order, a group followed by its children, and each group is open or shut. This
chart has three phases and the controls that decide what happens to their children: whether they
move with the phase, and which edges of a child stay pinned to which edges of its phase.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): the three phases and their children, with `followParent` and `parentAnchor`.
- [`options.ts`](options.ts): `hierarchy` (`moveChildren`, `childAnchor`, `expandedKeys`), the
  calendar and the row stripes.
- [`helpers.ts`](helpers.ts): the values the selects offer, and sentences for the status line.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the chart, the buttons and the selects.

## Options

| Option                   | Value                          | What it does                                                                              |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `hierarchy.moveChildren` | `'all'`                        | Which children move with their phase: `'all'`, `'following'` or `'none'` (the select)     |
| `hierarchy.childAnchor`  | `'FF'`                         | The pin of a child with `followParent` and no `parentAnchor` (default `'SS'`; the select) |
| `hierarchy.expandedKeys` | `['build']`                    | Which phases are open (React: `defaultExpandedKeys`); Plan and Launch start shut          |
| `task.followParent`      | `true`                         | The child moves with its phase, by its `parentAnchor`                                     |
| `task.parentAnchor`      | `'SS'`, `'FF'`, `['SS', 'FF']` | Which edges of the child are pinned to which edges of the phase                           |
| `calendar.weekends`      | `[]`                           | Every day is a working day, so the conflicts you see are about the hierarchy              |
| `display.rowStripes`     | `'group'`                      | Zebra stripes for each phase with its children                                            |
| `viewMode`               | `'week'`                       | One column a week: the whole plan fits                                                    |
| `onExpandedChange`       | a function (in the example)    | Called with the open phases after `expand`, `collapse`, `expandAll`, `collapseAll`        |
| `onTasksChange`          | a function (in the example)    | One `ChangeSet` per drag, with every child it moved                                       |

## What to try

- **Drag _Build_** with _Move children_ on `all`. _Backend_, _Frontend_ and _QA_ follow by their
  pins and _Docs_ follows with the start of _Build_. The status line lists what moved.
- **Change _Move children_ to `following`** and drag _Build_ again: _Docs_ stays, because it has no
  `followParent`. With `none` nothing follows, and the children that are left outside _Build_ are
  drawn with a red outline: that is the `outside-parent` conflict, reported in the status line.
- **Drag the right edge of _Build_.** _Frontend_ (pinned at both edges) stretches with it, _QA_
  (pinned by its end, from `childAnchor: 'FF'`) moves, and _Backend_ (pinned by its start only)
  stays. Change _Child anchor_ to `SS` and try again: _QA_ now stays and follows the start instead.
- **Collapse _Build_ and drag it.** The children you cannot see move all the same; expand it again to
  check. _Toggle Build_, _Expand all_ and _Collapse all_ call `expand`, `collapse`, `expandAll`
  and `collapseAll`, and `onExpandedChange` reports the open phases.
- **Drag a child** (say _Backend_) past the edge of _Build_: it is free to go, and the conflict says
  which edge it crossed.

## Notes

- **Rows.** A child follows its phase in the task list. While its phase is shut the child has no
  row and no bar (`rowIndex` of its record is `undefined`), and it still moves with the phase.
- **`moveChildren`.** `'all'` moves the children with `followParent` by their pin, and every other
  child with the start of its phase (it keeps its distance from it). `'following'` moves only the
  children with `followParent`. `'none'` moves no child; the children stay where they were, and may
  end up outside their phase.
- **Pins.** `'SS'` pins the start of the child to the start of its phase, `'FF'` the end to the end,
  `'FS'` the start to the end of the phase and `'SF'` the end to its start. Give two (one per edge,
  `['SS', 'FF']`) to pin both: the child then stretches with the phase. The distance a child had
  from its phase when the data was loaded is kept.
- **Conflicts are warnings.** A child outside its phase is accepted data: it is flagged on the bar
  (`data-conflict`), listed in `record.conflicts` and in `changeSet.conflicts`, and passed to
  `onBeforeTaskChange`, which may refuse it (see [A release plan](../release-plan/README.md)).
- **React.** The open phases are a prop of their own: `expandedKeys` is controlled, and
  `defaultExpandedKeys` is where an uncontrolled chart starts (the buttons then work through the
  `ref`). `hierarchy` takes only `moveChildren` and `childAnchor`, and is passed from state after the
  spread of `options`: in React the props are the truth, so an option changed with `setOptions` on
  the ref would be overwritten by the next render.

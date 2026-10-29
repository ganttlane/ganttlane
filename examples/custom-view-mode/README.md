---
title: Custom view modes
description: A fortnight sprint view and a quarter view of your own, and overrides of the day and week presets, all from the viewModes option.
category: Time scale
order: 110
height: 550
---

# Custom view modes

The `viewModes` option changes the zoom levels of the chart. It takes an object keyed by view mode
id, and each key does one of two things:

- the id of a **preset** (`day`, `week`, …) is an **override**: it is merged over the preset, and
  every field it gives replaces the preset's field. Here `day` is wider and has a weekday in its
  header, and `week` snaps a drag to whole weeks and has no thick line at the start of a month;
- any other id is a **new view mode**, which has to be complete (`unit`, `pxPerDay`, `headers`).
  Here `sprint` has a column of two weeks and a header cell that says which sprint it is, and
  `quarter` has a column of a quarter, a unit no preset uses.

The new modes are in the select next to the two overridden presets; the presets that are not
mentioned (`hour`, `month`, …) stay as they are and can still be switched to with `setViewMode`.

```sh
pnpm add @ganttlane/dom                     # vanilla
pnpm add @ganttlane/react react react-dom   # React
```

## Files

- [`data.ts`](data.ts): eight tasks that fill two-week sprints (one a milestone), three that run for months, and links.
- [`options.ts`](options.ts): `viewModes`, with the two overrides and the two new modes.
- [`helpers.ts`](helpers.ts): `describe`, the status line.
- [`vanilla.ts`](vanilla.ts) and [`react.tsx`](react.tsx): the select and `onViewModeChange`.

## What a view mode is made of

| Field       | What it is                                                                  | `sprint`              |
| ----------- | --------------------------------------------------------------------------- | --------------------- |
| `id`        | The name `viewMode` and `setViewMode` use; the key of the object            | `'sprint'`            |
| `label`     | A display name for your own switcher, apart from the id (translate it here) | `'Sprint'`            |
| `unit`      | The unit of a column: `hour`, `day`, `week`, `month`, `quarter` or `year`   | `'week'`              |
| `step`      | How many units a column is (default 1)                                      | `2`                   |
| `pxPerDay`  | The zoom: how many pixels a day is wide                                     | `12`                  |
| `headers`   | The header rows, top first: a `unit`, a `step` and a `format`               | month, then two weeks |
| `majorLine` | Thick grid lines: `{ unit }` at every start of a unit, or `false`           | `{ unit: 'month' }`   |
| `minorLine` | Faint grid lines every duration, shown while they are far enough apart      | `'1w'`                |
| `snap`      | The step a drag moves by; `scheduling.snap` overrides it for every mode     | `'1d'`                |
| `padding`   | Timeline before and after the data: one duration or `[before, after]`       | `['2w', '6w']`        |

A header `format` is the options of an `Intl.DateTimeFormat` (`{ month: 'long' }`), or a function
`(range, locale, adapter) => string` for a cell that has to say more than a date does. The `sprint`
header is one: it counts the sprints from the date the first one started, and writes the first and
the last day of the cell. It does its date arithmetic with the `adapter` it is given
(`diffDays`, `fromParts`, `add`, `format`), which reads the dates as wall-clock time.

## Options

| Option                          | Value                            | What it does                                                                |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `viewMode`                      | `'sprint'`                       | The view mode in use, a new one (React: a controlled prop)                  |
| `viewModes.day`                 | `pxPerDay`, `headers`, `padding` | Overrides of a preset: wider columns, a weekday in the header, more padding |
| `viewModes.week`                | `majorLine: false`, `snap: '1w'` | Overrides of a preset: no month lines, a drag moves by whole weeks          |
| `viewModes.sprint`              | a complete view mode             | A new mode: `unit: 'week'`, `step: 2`, three more fields below it           |
| `viewModes.quarter`             | a complete view mode             | A new mode: `unit: 'quarter'`, which presets do not use                     |
| `scroll.initial`                | `'first-task'`                   | Opens on the plan                                                           |
| `layout.rowHeight`, `barHeight` | `34`, `22`                       | Compact rows, so that every task fits                                       |
| `onViewModeChange`              | a function (in the example)      | Called with the `ViewMode` that is now in use                               |

## What to try

Start in **sprint**: each column is a fortnight, headed with its number and its dates, with a faint
line at every week and a thick one at every month. Every bar of the plan starts and ends on the edge
of a sprint. Pick **quarter** and the three long tasks make sense; the sprint-sized ones are a few
pixels wide. Pick **day** and the columns are wider than the preset's (64 px against 40) and have
the weekday in them. In **week**, drag a bar: it moves by whole weeks, and there are no month lines.

## Notes

- **An override is a merge, field by field.** `week: { snap: '1w' }` keeps the preset's unit,
  headers and the rest. A list such as `headers` is replaced as a whole, not concatenated. Give
  `false` to `majorLine`, `minorLine` or `snap` to take the preset's away.
- **A new mode must be complete.** A mode without `unit`, `pxPerDay` or `headers` is dropped and
  reported as an `invalid-view-mode` issue, which `getIssues()` and `onIssues` list. An invalid
  override of a preset leaves the preset as it was.
- **`viewModes` as an array** (a list of complete modes) replaces the presets altogether, so the
  chart has only the modes you list. The object form used here keeps them.
- **Columns do not move.** Header cells and grid lines are anchored to fixed points (a fortnight
  starts on every other Monday counted from the first week of 1970, a quarter on January, April,
  July and October), not to the start of the data, so they stay put while the chart scrolls or
  grows. That is why the sprints here start on 12 January.
- **A thick line is not a column line.** `majorLine: { unit: 'month' }` is drawn at every month
  start, also between the columns of a sprint; a function `(date) => boolean` is asked about column
  starts only.
- **React.** `viewMode` is a controlled prop, so the select changes your state and the chart
  follows it. `options` is spread as props and `viewMode` is passed after it, for it to win. The
  `viewModes` object is defined once, outside the component: a header `format` that is a function is
  compared by identity, so one written inline would be a change on every render.

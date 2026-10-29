# @ganttlane/core

The headless core of ganttlane: dates, work calendar, time scale, scheduling and propagation,
hierarchy, layout, interaction state machines, edit sessions, undo history and the facade that
composes them, `createGanttCore`. It has no DOM, no globals and no timers, so it runs in Node, in a
worker and in a browser, and it is what [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md) and
[`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md) are built on.

Use it directly when you:

- **write a renderer** (canvas, a native toolkit, another framework): the core hands you a
  memoized snapshot to draw and takes pointer, scroll and size input back;
- **schedule on a server**: validate tasks, work out dates through links, calendars and
  hierarchies, and turn a `ChangeSet` into your own records, with no chart at all;
- **test business rules** (working days, link types, lags) without a browser.

For a chart in a page, install [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md) or
[`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md) instead; both re-export the types you need.

> **Documentation:** the [documentation site](https://ganttlane.github.io/ganttlane/) has the guides,
> live examples next to their code, and the generated
> [API reference](https://ganttlane.github.io/ganttlane/api/) of every export. This README is the
> reference of the package.

> **Status:** pre-release (`0.0.0`), not published to npm yet. The API may still change before
> `0.1.0`.

Coming from frappe-gantt, or from a modified fork of it? See the [migration guide](https://github.com/ganttlane/ganttlane/blob/main/MIGRATION.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
  - [Tasks and links](#tasks-and-links)
  - [Dates, durations and time](#dates-durations-and-time)
  - [Granularity and alignment](#granularity-and-alignment)
  - [Work calendar](#work-calendar)
  - [Hierarchy](#hierarchy)
  - [Scheduling and propagation](#scheduling-and-propagation)
  - [Controlled and uncontrolled data](#controlled-and-uncontrolled-data)
  - [Changes, edit sessions and history](#changes-edit-sessions-and-history)
  - [Issues](#issues)
- [Options](#options)
- [Events](#events)
- [Methods](#methods)
- [Writing a renderer](#writing-a-renderer)
- [Building blocks](#building-blocks)
- [Development and production builds](#development-and-production-builds)
- [Accessibility](#accessibility)
- [Browser and runtime support](#browser-and-runtime-support)
- [Size](#size)
- [Limits and roadmap](#limits-and-roadmap)

## Install

```sh
pnpm add @ganttlane/core
```

- ESM only, with TypeScript declarations. Node 20 or newer; `require()` works only where Node
  can `require` an ES module (20.19+ and 22.12+).
- TypeScript must resolve package `exports`: `moduleResolution` of `bundler`, `node16` or
  `nodenext` (not `node10`).
- It depends on [`@internationalized/date`](https://react-spectrum.adobe.com/internationalized/date/)
  (calendar arithmetic) and [`valibot`](https://valibot.dev) (checks the shape of your tasks and
  links), both installed with it.
- With strict pnpm you can only import what your own `package.json` lists. If you installed
  `@ganttlane/dom` or `@ganttlane/react` only, you already have the **types** of the core
  (`Task`, `TaskRecord`, `ChangeSet`, …) from them; add `@ganttlane/core` yourself for runtime
  imports such as `createGanttCore` or `patchTasks` (the React package re-exports `patchTasks`).
  Keep the three packages on the same version.

## Quick start

A chart with no page: create it from data, ask it for computed records, edit through the same
path a drag would take, and read the problems it found.

```ts
import { createGanttCore } from '@ganttlane/core';

const core = createGanttCore({
  tasks: [
    { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
    { id: 'build', name: 'Build', start: '2026-03-09', duration: 10 },
  ],
  links: [{ source: 'design', target: 'build' }], // finish-to-start, the default type
  onTasksChange: (changeSet) => {
    console.log(
      changeSet.reason,
      changeSet.changes.map((change) => change.id),
    );
  },
});

// A TaskRecord: the computed form of a task, with `Date`s, lengths, progress and its problems.
const build = core.getTask('build');
console.log(build?.start, build?.endExclusive, build?.duration?.workingDays);

// A programmatic edit takes the path of a drag: it moves 'build' along the link, runs the
// before-hooks and emits one `tasksChange` with both tasks in it.
const result = await core.updateTask('design', { start: '2026-03-03' });
console.log(result.status); // 'committed'

console.log(core.getIssues()); // { data: [], options: [] }
core.destroy();
```

Nothing here needs a viewport. A renderer adds one with `setViewport` and draws
`getSnapshot()`; see [Writing a renderer](#writing-a-renderer).

## Concepts

### Tasks and links

A **task** is the object you pass in; the library never mutates it. A **link** joins two tasks. The
canonical form is a separate `links` array; `task.dependencies` (a list of ids, or
`{ id, type, lag }` objects) is a shorthand that is merged into it.

| `Task` field                   | Meaning                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`, `name`                   | Required. The id is a string or a number, compared with `===` (`5` and `'5'` are different tasks)            |
| `start`, `end`, `duration`     | Dates and length, see [Dates, durations and time](#dates-durations-and-time). `end` wins over `duration`     |
| `precision`                    | `'day'` or `'time'`: overrides what the input implies                                                        |
| `durationMode`                 | `'calendar'` or `'working'`: how `duration` and lags are counted (default `scheduling.durationMode`)         |
| `progress`                     | 0 to 100                                                                                                     |
| `progressAnchor`               | `'start'` (default) or `'end'`: what stays constant when the task is resized, the done part or the remainder |
| `type`                         | `'task'` (default), `'milestone'` (a point at `start`) or `'placeholder'` (a row without a bar)              |
| `parentId`                     | The parent task: see [Hierarchy](#hierarchy)                                                                 |
| `parentAnchor`, `followParent` | How the task is pinned to its parent's edges                                                                 |
| `locked`                       | Not editable and not moved by propagation (links can still be drawn)                                         |
| `fixedDuration`                | The length cannot change: only moving is allowed                                                             |
| `linkable`                     | `false` forbids links from and to the task in the UI                                                         |
| `editable`                     | `boolean` or `{ move, resize, progress, links }`: overrides the chart's `editing` for this task, both ways   |
| `className`, `rowClassName`    | CSS classes of the bar and the row                                                                           |
| `color`, `progressColor`       | Bar colours (renderers write them as `--gantt-bar-color` and `--gantt-bar-progress-color`)                   |
| `description`                  | Free text                                                                                                    |
| `dependencies`                 | The links-into-this-task shorthand                                                                           |
| `data`                         | Your payload, typed by the `TData` type argument and never read by the library                               |

| `Link` field | Meaning                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `source`     | The predecessor                                                                                                                    |
| `target`     | The successor                                                                                                                      |
| `type`       | `'FS'` finish-to-start (default, `scheduling.defaultLinkType`), `'SS'`, `'FF'` or `'SF'`                                           |
| `lag`        | The gap between the linked edges: a number of days, or a duration (`'4h'`); negative for a lead. Left out, the current gap is kept |
| `id`         | Defaults to `` `${source}:${type}:${target}` ``                                                                                    |
| `editable`   | `false` keeps the link out of reach of the UI                                                                                      |

Two links of different types between the same pair tie both edges of the successor. An `SS` and an
`FF` link make it stretch when the predecessor is resized. An `FS` and an `FF` link both hang from
the predecessor's end, so with no lags (each keeps the gap it has) the successor moves as a whole
and keeps its length; it takes another length only when explicit lags ask for it. A link that would
close a cycle is always refused; a cycle that arrives in the data is reported as a `cycle` issue,
and its links are flagged and take no part in propagation.

A task with no dates is a row without a bar (a warning, `no-dates`). A task with only a `start`, only an
`end` or only a `duration` is invalid (`incomplete-dates`): ends are never projected backwards. An
invalid task keeps its row and carries its issues; nothing throws.

### Dates, durations and time

- **Floating wall-clock time.** Dates are wall-clock values with no time zone and no daylight
  saving. A `Date` or an epoch-ms number is read through the runtime's **local** clock
  (`getFullYear()`, `getHours()`, …), so a task at 09:00 stays at 09:00 for every viewer. A string
  is `'2026-03-02'` or `'2026-03-02T09:30'` (`T` or a space; seconds and milliseconds allowed). A
  string with `Z` or a UTC offset is rejected with `unsupported-offset`: convert it first, or give
  `new Date(...)` and let the local clock decide.
- **Precision.** A date-only value makes a task `precision: 'day'` (it sits on whole days); a value
  with a time of day makes it `'time'`. A `Date` at local midnight counts as date-only. Set
  `task.precision` to override.
- **Inclusive end.** A date-only `end` is the **last day**, inclusive (`dates.endInclusive`,
  default `true`): `start: '2026-03-02', end: '2026-03-06'` is five days. A value with a time of day
  is the exact moment the task ends. `TaskRecord.endExclusive` is always the half-open end.
- **Durations.** A number is days (`3`, `0.5`). Strings: `'30min'`, `'6h'`, `'2d'`, `'1w'`, `'1mo'`,
  `'1q'`, `'1y'`, compound `'1d 4h'`, or ISO 8601 (`'P1DT4H'`). `'m'` alone is rejected, because it
  could mean minutes or months. Objects: `{ days: 2, hours: 4 }`.
- **Records come back as `Date`s.** `TaskRecord` and the convenience events carry local `Date`s.
  `ChangeSet`s and `SessionChanges` carry the core's floating numbers (epoch-ms-like), so they can
  be handed back to the core; turn one into a `Date` with `toDate()`, or apply it to your own tasks
  with [`patchTasks`](#controlled-and-uncontrolled-data).

### Granularity and alignment

`scheduling.granularity` is the data step: the smallest unit of time your tasks use. It is `'1d'`
by default (day planning). Set it to `'1h'`, `'30min'`, `'15min'`, … for planning inside the day;
it must divide 24 hours exactly (`1min` up to `12h`), or be `1d`.

**Invariant:** every date, duration and lag in a `TaskRecord`, a `LinkRecord` and a `ChangeSet` is a
multiple of the granularity, counted from midnight. Input that is not (`10:30` at `1h`) is reported
as a `misaligned` issue with `value` and `suggested`, and is then aligned by
`scheduling.alignInput`:

| `alignInput`         | `10:30–11:30` at `1h` becomes                                         |
| -------------------- | --------------------------------------------------------------------- |
| `'expand'` (default) | `10:00–12:00`: the start goes down, the end and lengths go up         |
| `'nearest'`          | The nearest boundary; a tie goes in the direction that grows the task |
| `'reject'`           | The task is invalid (a row without a bar)                             |

Date-only tasks are always aligned. A lag is aligned to the nearest multiple (it may be negative).
The progress percentage is kept as given and the progress date is rounded down. Drag **snap** (the
view mode's step, or `scheduling.snap`) is always a multiple of the granularity: a default that is
finer is raised silently (the hour view mode snaps to days at `'1d'`), an explicit one is raised with
an issue.

### Work calendar

`calendar` decides which days are working days. The first rule that applies wins:

1. `workingDays`: exceptions that are working whatever else is true (a worked Saturday);
2. `holidays`: non-working days, optionally named (`{ date, name }`);
3. `isWorkingDay(day)`: your function; it must be pure. `true`, `false`, or `undefined` to go on;
4. `weekends`: weekdays that are off, `0` = Sunday … `6` = Saturday. Default `[0, 6]`.

A working day is a whole 24 hours; working hours and shifts are not modelled. With
`durationMode: 'working'` (per task or in `scheduling`) a duration counts working time only: five
working days from a Friday end on the next Thursday, and a time of day is kept across the weekend.
`scheduling.skipNonWorkingDays` makes drags land on working days (`move` and `progress` default to
`true`, `resize` to `false`); a bar that still lands on a non-working day is reported as a conflict.

The calendar is also a standalone function, [`createWorkCalendar`](#building-blocks).

### Hierarchy

`parentId` makes a tree; rows come out in pre-order whatever the order of the input. `hierarchy.expandedKeys`
is `'all'` (default) or the ids of the expanded parents. An unknown parent makes the task a root
(`unknown-parent`); a loop of parents is broken at its first member (`parent-cycle`).

A child can be **pinned** to its parent's edges with `parentAnchor` (default `hierarchy.childAnchor`,
`'SS'`): `'SS'` and `'FS'` pin its start to the parent's start and end, `'FF'` and `'SF'` pin its
end to the parent's end and start. Pin both edges (`['SS', 'FF']`) and the child stretches with its
parent. **`parentAnchor` is read only for a child with `followParent: true`.** Any other child just
shifts with its parent's start (keeping its offset and its length), whatever its `parentAnchor` says.
`hierarchy.moveChildren` chooses which children move with a parent that moves: `'all'` (default:
the pinned ones follow their anchor, the others shift), `'following'` (only tasks with
`followParent: true`) or `'none'`.

### Scheduling and propagation

An edit of one task (a drag, `updateTask`) is turned into a `ChangeSet` by `propagate`. With
`scheduling.propagation: 'preserve-lag'` (default) every task linked to the edited one, and every
pinned child, is moved so that its links keep their lag; with `'none'` no link moves anything, and
they show their conflicts instead. `'none'` is about **links** only: children still follow their
parent under the default `hierarchy.moveChildren: 'all'`, so a chart where only the edited task
should move also needs `hierarchy: { moveChildren: 'none' }`. `'push-forward'` is planned and
reported as `unsupported-option`; it behaves as `'preserve-lag'` meanwhile. A `locked` task, and a task without a
bar, stop propagation.

The result is deterministic: each task changes at most once, in topological order. After the
change the plan is checked for **conflicts**, attached to the `ChangeSet` and to the records:

| `Conflict.type`                        | Meaning                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `non-working-start`, `non-working-end` | The first day or the last moment of a task is a non-working day        |
| `outside-parent`                       | A child extends beyond its parent's bar (`parentId`, `edges`)          |
| `link-violated`                        | A link's gap is below its minimum (`linkId`, `requiredMs`, `actualMs`) |

Conflicts are warnings: they never block a change by themselves. `onBeforeTaskChange` sees them
and decides.

### Controlled and uncontrolled data

`dataMode: 'uncontrolled'` (default): the core owns the tasks. A committed change is applied to its
own copy, which `getTask` reflects at once; your arrays are never touched.

`dataMode: 'controlled'`: **you** own the tasks. Every committed change is reported once to
`onTasksChange(changeSet)`, shown as a **draft** over your tasks, and applied only when you hand
the new tasks back with `setTasks`. While a committed change waits, the chart is `busy`: no gesture
and no `updateTask` starts. `setTasks` is your answer: hand back the patched tasks to accept the
change, or the old ones (the same array will do) to refuse it. Either way the draft ends. (The
React props work differently: see [`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md#controlled-and-uncontrolled).)

`patchTasks(tasks, changes, model)` writes a `ChangeSet` (or the `SessionChanges` of a rollback)
into your tasks, **in the shape each task already has**: a `Date` stays a `Date`, an ISO string
stays an ISO string of the same precision, a task with `duration` keeps a `duration`. Tasks it does
not change keep their identity, and with nothing to change it returns the array you gave it.

```ts
import { createGanttCore, patchTasks, type Task } from '@ganttlane/core';

let tasks: Task[] = [
  { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' },
  { id: 'b', name: 'B', start: '2026-03-09', duration: 5 },
];
const core = createGanttCore({
  tasks,
  links: [{ source: 'a', target: 'b' }],
  dataMode: 'controlled',
  onTasksChange: (changeSet) => {
    // `model` is the one the change set was computed on: the current snapshot's.
    tasks = patchTasks(tasks, changeSet, core.getSnapshot().state.derived.model);
    core.setTasks(tasks); // the answer: the draft ends and the chart shows your tasks
  },
});

await core.updateTask('a', { start: '2026-03-03' });
console.log(tasks[0]); // { id: 'a', name: 'A', start: '2026-03-03', end: '2026-03-07' }
```

### Changes, edit sessions and history

A **`ChangeSet`** is one user action or API call: `reason` (`'move'`, `'resize-start'`,
`'resize-end'`, `'progress'`, `'api'`, `'undo'`, `'redo'`, `'session'`, `'rollback'`), the
`changes` (`{ id, before, after, cause, via? }` with a `TaskPatch` of `start`, `endExclusive`,
`progress` and, when the change alters it, `precision`; `cause` is `'direct'`, `'link'` or
`'parent'`), and the `conflicts`. Exactly one `tasksChange` is emitted per action, with every task
it touched.

**Before-hooks** let your code veto or rewrite a change before it commits, synchronously or after a
confirmation:

```ts
import { createGanttCore } from '@ganttlane/core';

const core = createGanttCore({
  tasks,
  // The context is `{ changeSet, reason, conflicts }`.
  onBeforeTaskChange: async ({ conflicts }) => {
    if (conflicts.some((conflict) => conflict.type === 'non-working-start')) {
      return await askUser('This starts on a day off. Keep it?'); // false cancels
    }
    // nothing (or true) lets it pass; a ChangeSet replaces the one being committed
    // (it is re-validated and re-aligned like any other)
  },
  onBeforeLinkCreate: ({ link, wouldCreateCycle }) => !wouldCreateCycle,
});
```

A throwing or rejecting hook cancels the change and reports on `error`. A link that would close a
cycle is rejected whatever the hook answers.

**Edit sessions** are the "Edit, Save, Cancel" flow: `edit.begin()` marks the data as the base,
actions go through as usual (applied as they happen, so `getTask()` shows them, and still emitting
their events), `edit.getChanges()` is the net difference from the base (a task dragged out and back
is not listed), `edit.commit()` closes the session and returns that `SessionChanges`, and
`edit.rollback()` puts the base back **without asking the hooks**. In uncontrolled mode the base is
restored by the core; in controlled mode the rollback is one `editRollback` event whose
`SessionChanges` is the inverse for you to write into your state (`patchTasks` for the tasks;
`links.removed` are links to drop, `links.added` links to restore: link models with an `id` and, in
`link`, your own `Link`, which a link from `task.dependencies` does not have). Sessions do not nest.
`edit.isDirty` flips `dirtyChange`.

**History.** Undo and redo are off until you set `history: true` (or `{ limit }`, default 100): then
one action is one entry, and `undo()` and `redo()` replay entries without asking the hooks, but with
the same re-validation, inside a session too (a rollback puts the history back as it was at
`begin()`). They answer `'stale'` if your data changed behind the history's back. There are no
hotkeys at this level.

### Issues

The core never throws on bad options or data. A problem becomes an **`Issue`**:
`{ code, severity: 'error' | 'warning', message, path?, taskId?, linkId?, value?, suggested? }`, and
the thing is repaired or skipped: an unusable option takes its default, an invalid task becomes a
row without a bar, a bad link is dropped.

- **Where to read them:** `core.getIssues()` returns `{ data, options }`; the `issues` event
  (`onIssues`) fires when the list changes, with `source: 'data' | 'options' | 'change-set'`;
  `setOptions` returns the issues of the options now in use; a `TaskRecord` carries its own
  `issues`.
- **`code`, `path`, `value` and `suggested` are stable and identical in every build.** `message`
  is for people: the [development build](#development-and-production-builds) spells it out; the
  production build says only `'<path>: <code>'`. Never parse it.

| Group    | Codes                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dates    | `invalid-date`, `unsupported-offset`, `invalid-duration`, `invalid-granularity`, `misaligned`                                                                                |
| Tasks    | `invalid-shape`, `duplicate-id`, `no-dates`, `incomplete-dates`, `end-before-start`, `too-long`, `no-working-time`, `progress-out-of-range`                                  |
| Tree     | `unknown-parent`, `parent-cycle`, `invalid-parent-anchor`                                                                                                                    |
| Links    | `unknown-link-task`, `self-link`, `duplicate-link`, `inactive-link`, `cycle`                                                                                                 |
| Calendar | `invalid-weekend`, `invalid-holiday`, `invalid-working-day`, `invalid-rule`, `time-ignored`, `no-working-days`                                                               |
| Scale    | `invalid-view-mode`, `unknown-view-mode`, `invalid-snap`, `snap-below-granularity`, `snap-not-multiple`                                                                      |
| Options  | `invalid-option`, `unsupported-option`, `invalid-layout-option`, `invalid-timeline-option`, `invalid-scroll-option`                                                          |
| Changes  | `too-short`, `invalid-change`, `unknown-task`, `locked-task`, `duplicate-change`, plus `misaligned`, `end-before-start` and `progress-out-of-range` (`source: 'change-set'`) |

Keys the core does not know are ignored, not reported.

## Options

`createGanttCore(options)` takes these; `core.setOptions(patch)` changes any of them later without
recreating the chart. A key left out of a patch keeps its value. **Groups** (`calendar`, `dates`,
`scheduling`, `hierarchy`, `layout`, `timeline`, `scroll`, `interaction`) are merged field by field,
and a field set to `undefined` goes back to its default. **The merge is one level deep.** A field
that is itself an object or a list is replaced whole: `scheduling.skipNonWorkingDays`,
`scheduling.snap`, `timeline.range`, `timeline.infinite`, `scroll.autoScroll`,
`interaction.handles` and `calendar.holidays` are, so
`setOptions({ interaction: { handles: { resize: 12 } } })` sets the other handle sizes back to their
defaults, and `setOptions({ scheduling: { skipNonWorkingDays: { move: false } } })` does the same for
the other two flags: write the whole object. Every other option (`viewModes`, `editing`, `history`,
the lists) is replaced whole too. A key set to `undefined` that has no default is an
[issue](#issues), not a reset: `setOptions({ tasks: undefined })` is an `invalid-option` issue
(`tasks` is required) and the chart shows no tasks, so pass `tasks: []` to empty it on purpose.
`setOptions` recomputes only what a key invalidates, and swapping an `on<Event>` handler is O(1).

Keys the core does not know are ignored, so a renderer can pass its own options object whole. Every
value is validated; an unusable one is an [issue](#issues) and its default is used.

### Data

| Option     | Type                               | Default          | Meaning                                                                                       |
| ---------- | ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `tasks`    | `readonly Task<TData>[]`           | required         | The tasks, in display order                                                                   |
| `links`    | `readonly Link[]`                  | none             | The links; `task.dependencies` are merged in                                                  |
| `dataMode` | `'uncontrolled'` \| `'controlled'` | `'uncontrolled'` | Who owns the tasks: see [Controlled and uncontrolled data](#controlled-and-uncontrolled-data) |

### View

| Option      | Type                                                                                                       | Default          | Meaning                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `viewMode`  | `'hour'` \| `'quarter-day'` \| `'half-day'` \| `'day'` \| `'week'` \| `'month'` \| `'year'` or your own id | `'day'`          | The scale preset in use. An unknown id falls back to `'day'` (to the first mode when a custom `viewModes` list has no `'day'`) with an `unknown-view-mode` warning |
| `viewModes` | `ViewMode[]` or `{ [id]: Partial<ViewMode> }`                                                              | presets          | A complete list (replaces the presets), or overrides merged over them; a new id adds a mode                                                                        |
| `locale`    | BCP 47 tag                                                                                                 | `'en'`           | Formats header labels. Not the runtime's locale, so a server and a browser agree                                                                                   |
| `direction` | `'ltr'` \| `'rtl'`                                                                                         | `'ltr'`          | Stored only: mirroring is planned                                                                                                                                  |
| `now`       | `() => DateInput`                                                                                          | the system clock | The source of "today" (tests, a server clock)                                                                                                                      |

A **view mode** is `{ id, label?, unit, step?, pxPerDay, headers, majorLine?, minorLine?, snap?, padding? }`:
one column is `step` of `unit` (`'hour'`, `'day'`, `'week'`, `'month'`, `'quarter'`, `'year'`),
`pxPerDay` is the zoom, and `headers` are the header rows (top first), each with a `unit` and a
`format` (`Intl.DateTimeFormatOptions`, or a function of the cell's range and the locale). The
presets:

| `id`          | Column   | `pxPerDay` | Default snap | Padding |
| ------------- | -------- | ---------- | ------------ | ------- |
| `hour`        | 1 hour   | 960        | `15min`      | `7d`    |
| `quarter-day` | 6 hours  | 160        | `1h`         | `7d`    |
| `half-day`    | 12 hours | 80         | `1h`         | `14d`   |
| `day`         | 1 day    | 40         | `1d`         | `14d`   |
| `week`        | 1 week   | 20         | `1d`         | `4w`    |
| `month`       | 1 month  | 4          | `1d`         | `4mo`   |
| `year`        | 1 year   | 1          | `1mo`        | `2y`    |

The three hourly presets have 40 px columns, which have room for about two digits, so the hour row
of their header shows the hour of the 24-hour clock in two digits in every locale (`00`, `06`,
`12`, `17`): `5 PM` and `17 Uhr` do not fit, and the label would be cut to `5 …`, with noon and
midnight reading the same in `half-day`. To show the clock of the locale instead, replace the row
(`headers` is replaced whole) and give the columns the room it needs:

```ts
createGanttCore({
  tasks,
  viewMode: 'quarter-day',
  viewModes: {
    // 70 px per 6-hour column.
    'quarter-day': {
      pxPerDay: 280,
      headers: [
        { unit: 'day', format: { day: 'numeric', month: 'long' } },
        { unit: 'hour', step: 6, format: { hour: 'numeric' } },
      ],
    },
  },
});
```

```ts
import { createGanttCore } from '@ganttlane/core';

createGanttCore({
  tasks,
  viewMode: 'day',
  // Override a preset's zoom and add a mode of your own.
  viewModes: {
    day: { pxPerDay: 56 },
    sprint: {
      unit: 'week',
      pxPerDay: 12,
      headers: [
        { unit: 'month', format: { month: 'long', year: 'numeric' } },
        { unit: 'week', format: { day: 'numeric' } },
      ],
    },
  },
});
```

### Rules

| Option                          | Type / values                                                       | Default                                         | Meaning                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `dates.endInclusive`            | `boolean`                                                           | `true`                                          | A date-only `end` is the last day, inclusive                                                                                                  |
| `calendar.weekends`             | `number[]`                                                          | `[0, 6]`                                        | Weekdays that are off, `0` = Sunday                                                                                                           |
| `calendar.holidays`             | `(DateInput \| { date, name? })[]`                                  | none                                            | Non-working days, optionally named                                                                                                            |
| `calendar.workingDays`          | `DateInput[]`                                                       | none                                            | Days that work whatever the other rules say                                                                                                   |
| `calendar.isWorkingDay`         | `(day: CalendarDay) => boolean \| undefined`                        | none                                            | A pure custom rule; `undefined` defers to `weekends`                                                                                          |
| `scheduling.durationMode`       | `'calendar'` \| `'working'`                                         | `'calendar'`                                    | Default for tasks and lags                                                                                                                    |
| `scheduling.propagation`        | `'preserve-lag'` \| `'none'`                                        | `'preserve-lag'`                                | How an edit spreads along links (`'push-forward'` is planned). Children are `hierarchy.moveChildren`'s, not this option's                     |
| `scheduling.defaultLinkType`    | `'FS'` \| `'SS'` \| `'FF'` \| `'SF'`                                | `'FS'`                                          | Type of a link that names none                                                                                                                |
| `scheduling.granularity`        | duration that divides 24 h, or `'1d'`                               | `'1d'`                                          | The data step, see [above](#granularity-and-alignment)                                                                                        |
| `scheduling.alignInput`         | `'expand'` \| `'nearest'` \| `'reject'`                             | `'expand'`                                      | What to do with misaligned input                                                                                                              |
| `scheduling.snap`               | step, `'unit'`, `false` or `{ step, mode, move, resize, progress }` | the view mode's                                 | Drag snapping; overrides the view mode's. `mode: 'grid'` snaps to boundaries, `'relative'` moves by whole steps                               |
| `scheduling.keepDayPrecision`   | `boolean`                                                           | `true`                                          | Day-precision tasks snap to whole days at least. `false` lets a drag turn them into timed tasks                                               |
| `scheduling.skipNonWorkingDays` | `{ move, resize, progress }` booleans                               | `{ move: true, resize: false, progress: true }` | Whether the edited edge skips non-working days                                                                                                |
| `hierarchy.expandedKeys`        | `'all'` \| `TaskId[]`                                               | `'all'`                                         | The expanded parents                                                                                                                          |
| `hierarchy.childAnchor`         | link type or list                                                   | `'SS'`                                          | Default `task.parentAnchor`                                                                                                                   |
| `hierarchy.moveChildren`        | `'all'` \| `'following'` \| `'none'`                                | `'all'`                                         | Which children move with a moved parent                                                                                                       |
| `editing`                       | `boolean` \| `{ move, resize, progress, links }`                    | `true`                                          | What the UI may do (`false`: nothing; `updateTask`, `addLink` and `removeLink` from code still commit); `task.editable` overrides it per task |
| `history`                       | `boolean` \| `{ enabled, limit }`                                   | off, limit 100                                  | Undo and redo: `history: true` turns them on                                                                                                  |

### Layout, timeline and scrolling

| Option                            | Type / values                                                                  | Default                      | Meaning                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.rowHeight`                | `number` (px)                                                                  | `48`                         | Height of a row                                                                                                                                                            |
| `layout.barHeight`                | `number`                                                                       | `30`                         | Height of a bar, centred in its row                                                                                                                                        |
| `layout.barRadius`                | `number`                                                                       | `3`                          | Corner radius; each bar clamps it to half its height and width                                                                                                             |
| `layout.headerRowHeight`          | `number` \| `number[]`                                                         | `[45, 30]`                   | One height for every header row, or one per row, top first                                                                                                                 |
| `timeline.range`                  | `'auto'` \| `{ start, end }`                                                   | `'auto'`                     | `'auto'` spans the tasks plus padding; an explicit range with a date-only `end` includes that day                                                                          |
| `timeline.padding`                | duration or `[before, after]`                                                  | the view mode's              | Padding around the data                                                                                                                                                    |
| `timeline.includeToday`           | `boolean`                                                                      | `false`                      | The automatic range always contains today                                                                                                                                  |
| `timeline.infinite`               | `boolean` \| `{ threshold, extendBy, bounds: { min, max }, maxSpan }`          | `false`                      | The range grows as the viewport nears an edge. `threshold` is px (default the viewport width), `extendBy` a duration (default two viewports), `maxSpan` trims the far side |
| `scroll.initial`                  | `'today'` \| `'start'` \| `'end'` \| `'first-task'` \| `'none'` \| `DateInput` | `'today'`                    | Where the chart opens                                                                                                                                                      |
| `scroll.behavior`                 | `'smooth'` \| `'instant'` \| `'auto'`                                          | `'smooth'`                   | How `scrollTo*` moves                                                                                                                                                      |
| `scroll.align`                    | `'start'` \| `'center'` \| `'end'` or `0` … `1`                                | `'start'`                    | Where the target lands in the viewport                                                                                                                                     |
| `scroll.autoScroll`               | `false` \| `{ edge, maxSpeed }`                                                | `{ edge: 40, maxSpeed: 20 }` | Scrolling while a drag nears an edge: the zone in px and the speed in px per 60 Hz frame                                                                                   |
| `interaction.dragThreshold`       | `number` (px)                                                                  | `3`                          | Travel before a press becomes a drag                                                                                                                                       |
| `interaction.touchDragThreshold`  | `number`                                                                       | `8`                          | The same for touch                                                                                                                                                         |
| `interaction.doubleClickTime`     | `number` (ms)                                                                  | `500`                        | Longest gap between the two clicks of a double click                                                                                                                       |
| `interaction.doubleClickDistance` | `number` (px)                                                                  | `6`                          | Farthest distance between them                                                                                                                                             |
| `interaction.handles`             | `{ resize, progress, link, linkOffset }`                                       | `{ 8, 6, 6, 10 }`            | Sizes of the handles, which the hit test and the renderer share                                                                                                            |

`scroll.initial` is `'today'` by default. A plan that lies in the past or the future then opens at
the nearest end of its range, not at its first task; use `'first-task'` or `'start'` for a fixed plan.

Handlers are options too: see [Events](#events).

## Events

Every event has an `on<Event>` option and a listener through `core.on(name, handler)`, which returns
a function that removes it. Both take the same arguments. A listener that throws never breaks the
others: the error goes to `error` (and `onError`). With no one listening to `error`, what happens
depends on what caused the event:

- **An API call** (`updateTask`, `addLink`, `select`, `setTasks`, `setOptions`, `setViewMode`,
  `scrollTo*`, `edit.*`, `undo`, …) rethrows what its listeners threw, once it is done: one error
  as it is, several as an `AggregateError`. A plain method throws synchronously; an async one
  (`updateTask`, `addLink`, `removeLink`) rejects its promise. The change itself has happened.
- **Renderer input** (`setViewport`, `scroll`, `send`, `refreshNow`) never throws after it changed
  something, because the renderer needs its result: the error goes to the host's
  unhandled-rejection channel (an `unhandledrejection` event in a browser) instead.

**A handler given as an option can run before `createGanttCore` returns.** `onIssues` does when the
first options or data have issues, so a handler that reads the variable the core is assigned to must
not assume it is set yet (declare `let core: GanttCore | undefined`, or add the listener with
`core.on('issues', …)` afterwards). `onRangeChange` and `onScroll` first run when the renderer
reports its size with `setViewport`.

| Event                | Arguments                                         | When                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasksChange`        | `(changeSet)`                                     | A change committed: one per action, with every task it touched. Also for undo and redo                                                                                                                                                  |
| `taskDatesChange`    | `(record, { start, end, endExclusive })`          | A convenience after `tasksChange`, per task whose dates changed (`Date`s)                                                                                                                                                               |
| `taskProgressChange` | `(record, progress)`                              | The same for progress                                                                                                                                                                                                                   |
| `linkCreate`         | `(link, id)`                                      | A link was created; a controlled owner adds exactly this `link` (the id may be `…#2`)                                                                                                                                                   |
| `linkDelete`         | `(linkRecord)`                                    | A link was deleted                                                                                                                                                                                                                      |
| `linkClick`          | `(linkRecord, event)`                             | A link was clicked; it is now the selected link                                                                                                                                                                                         |
| `taskClick`          | `(record, event)`                                 | A bar was clicked (never after a drag)                                                                                                                                                                                                  |
| `taskDoubleClick`    | `(record, event)`                                 | A bar was double-clicked                                                                                                                                                                                                                |
| `taskHoverChange`    | `(record \| null, event)`                         | The task under the pointer changed                                                                                                                                                                                                      |
| `selectionChange`    | `(selectedKeys, selectedLink)`                    | The selected tasks or link changed                                                                                                                                                                                                      |
| `viewModeChange`     | `(viewMode)`                                      | The view mode in use changed                                                                                                                                                                                                            |
| `rangeChange`        | `({ start, end, reason })`                        | The timeline range changed (`Date`s): for lazy loading by date. `reason` is `'initial'`, `'data'`, `'options'`, `'view-mode'`, `'zoom'`, `'resize'`, `'drag'` or a viewport reason (extension, trim, scroll-to)                         |
| `expandedChange`     | `(expandedKeys)`                                  | `expand`, `collapse`, `expandAll` or `collapseAll` changed the expanded parents                                                                                                                                                         |
| `scroll`             | `({ x, y, date })`                                | The scroll position changed: the renderer reported one, or a request of the core's own moved it (the initial scroll, an instant `scrollTo*`), at once, before the renderer has performed it. `date` is at the left edge of the viewport |
| `editRollback`       | `(sessionChanges)`                                | A session was cancelled: the inverse for controlled data to apply                                                                                                                                                                       |
| `dirtyChange`        | `({ isDirty })`                                   | `edit.isDirty` flipped                                                                                                                                                                                                                  |
| `historyChange`      | `({ canUndo, canRedo })`                          | What undo and redo can do changed                                                                                                                                                                                                       |
| `editRefused`        | `({ gesture, id, target?, reason, at })`          | A gesture was refused (`'busy'`, `'permission'`, `'unknown-task'`, `'self'`, `'cycle'`, `'duplicate'`), `at` is `'start'` or `'commit'`                                                                                                 |
| `issues`             | `({ source, issues })`                            | The issues of the data or the options changed, or a change set needed correcting                                                                                                                                                        |
| `error`              | `({ error, source: 'listener' \| 'hook', name })` | A listener or a before-hook threw                                                                                                                                                                                                       |

The handler option names are `onTasksChange`, `onTaskDatesChange`, `onTaskProgressChange`,
`onLinkCreate`, `onLinkDelete`, `onLinkClick`, `onTaskClick`, `onTaskDoubleClick`,
`onTaskHoverChange`, `onSelectionChange`, `onViewModeChange`, `onRangeChange`, `onExpandedChange`,
`onScroll`, `onEditRollback`, `onDirtyChange`, `onHistoryChange`, `onEditRefused`, `onIssues` and
`onError`. The two **before-hooks**, `onBeforeTaskChange(context)` and `onBeforeLinkCreate(context)`,
are options only (a hook may answer a value, a promise of one, or nothing, so a function that returns
`Promise<boolean | void>` is a hook); see [Changes, edit sessions and history](#changes-edit-sessions-and-history).
The payloads are typed by `GanttEventMap<TData>`; pointer events (`event`) are whatever the renderer
passed to `send`.

## Methods

All members of the object `createGanttCore` returns are plain functions: they need no `this`, so
`const { getTask } = core` works. After `destroy()` the commands do nothing (the ones that return a
promise resolve `{ status: 'cancelled', reason: 'disposed' }`) and the queries keep answering from
the state the chart had.

| Group         | Members                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Data          | `setTasks(tasks)`, `setLinks(links)`, `updateTask(id, { start?, end?, progress? })`, `addLink(link)`, `removeLink(id)`       |
| Options       | `setOptions(patch)` returns the issues of the options now in use                                                             |
| View          | `setViewMode(id, { keepScroll })`, `zoomTo(pxPerDay, { anchor })`                                                            |
| Scrolling     | `scrollToDate(date, { align, behavior })`, `scrollToToday(options)`, `scrollToTask(id, { align, alignY, behavior, expand })` |
| Rows          | `expand(id)`, `collapse(id)`, `expandAll()`, `collapseAll()`                                                                 |
| Selection     | `select(ids)`, `selectLink(id)`, `clearSelection()`                                                                          |
| Edit session  | `edit.begin()`, `edit.commit()`, `edit.rollback()`, `edit.getChanges()`, `edit.isOpen`, `edit.isDirty`                       |
| History       | `undo()`, `redo()`, `canUndo`, `canRedo` (need `history: true`)                                                              |
| Queries       | `getTask(id)`, `getLink(id)`, `getVisibleRange()`, `getRowMetrics(id)`, `getBarRect(id)`, `getIssues()`                      |
| Events        | `on(name, handler)`, `subscribe(listener)`                                                                                   |
| For renderers | `setViewport(size)`, `scroll(position)`, `send(event)`, `refreshNow()`, `getSnapshot()`                                      |
| Life cycle    | `destroy()`                                                                                                                  |

- **`updateTask(id, { start, end, progress })`** is a programmatic change with `reason: 'api'`.
  `start` alone moves the task (its length is kept), `end` alone moves the end edge, both set both
  edges, `progress` sets the progress. It propagates like the same drag and runs the before-hooks.
  Values are exact: no snapping to the view mode, no rolling onto working days; misaligned values
  follow `alignInput`. It is async and resolves `{ status: 'committed', changeSet }`,
  `'unchanged'` (a locked task, or nothing to change), `'rejected'` (`reason: 'unknown-task'` or
  `'invalid-value'` with `issues`; an end not after the start is `end-before-start`),
  `{ status: 'cancelled', reason }` (`'hook'`: a hook answered `false`; `'error'`: it threw, rejected
  or answered something invalid; `'disposed'`: the core was destroyed) or `{ status: 'busy' }`.
  `editing` does not apply to it: that option is about the UI.
- **`addLink(link)` and `removeLink(id)`** are async and resolve `{ status: 'created' }` /
  `{ status: 'deleted' }`, `{ status: 'rejected', reason }` with `reason` one of `'invalid'`
  (shape, type or lag; with `issues`), `'unknown-task'`, `'duplicate'`, `'cycle'` or
  `'unknown-link'`, `{ status: 'cancelled', reason: 'hook' | 'error' | 'disposed' }` (a
  `beforeLinkCreate` hook answered `false`, or threw, or the core was destroyed; `removeLink` is
  cancelled only by the last) or `{ status: 'busy' }` (another change is waiting for a hook or, with
  controlled data, for your `setTasks`). `editing` does not apply to them either.
- **`edit.begin()`, `commit()` and `rollback()`** are synchronous and return a `status`:
  `'begun'` / `'already-open'`, `'committed'` / `'rolled-back'` (with `changes`), `'no-session'`,
  `'busy'` or `'cancelled'`.
- **`undo()` and `redo()`** are synchronous and return a `status`: `'undone'` / `'redone'` (with the
  `entry`), `'empty'` (nothing to step through), `'stale'` (your data changed behind the history's
  back, and the history was cleared), `'busy'` or `'cancelled'`.
- **`scrollTo*` and `setViewMode`/`zoomTo`** return a [`ScrollRequest`](#scroll-requests), or
  `undefined`. A `scrollTo*` made before the viewport has a width is remembered, the latest one
  wins, and it replaces `scroll.initial` when the chart mounts.
- **`subscribe(listener)`** is called after every change of the snapshot and returns a function
  that stops it; with `getSnapshot` it is the contract of React's `useSyncExternalStore`.

## Writing a renderer

A renderer does four things: tells the core how big it is, draws the snapshot, performs the
scrolls the core asks for, and sends input back.

```ts
import { barsInWindow, createGanttCore, type GanttSnapshot } from '@ganttlane/core';

const core = createGanttCore({ tasks, links, viewMode: 'week', scroll: { initial: 'first-task' } });

let appliedRequest = 0;

function draw(snapshot: GanttSnapshot): void {
  // 1. Perform a scroll request once (by id), in the frame that draws its snapshot.
  const request = snapshot.scrollRequest;
  if (request !== undefined && request.id > appliedRequest) {
    appliedRequest = request.id;
    performScroll(request); // see "Scroll requests" below
  }
  // 2. Draw only the window: the visible rows and time, with overscan.
  for (const bar of barsInWindow(snapshot.window, snapshot.layout)) {
    drawBar(bar.x, snapshot.layout.rows.headerHeight + bar.y, bar.width, bar.height);
  }
}

core.subscribe(() => draw(core.getSnapshot()));

// 2. Report the size. The first non-zero width mounts the chart and returns the initial request.
const initial = core.setViewport({ width: 1200, height: 600 });
```

- **The snapshot** (`getSnapshot()`) is a memoized view-model, new only when something in it
  changed, and its parts keep their identity while their inputs do. It holds the store state
  (`state.tasks`, `state.links`, `state.derived.model`, `.rows`, `.conflicts`, `.issues`, the
  draft and the edit session), `viewMode`, `timeline` (range, scale, scroll offset, viewport
  width), `contentWidth`, `header` (the input of `headerRows` and `gridLines`), `layout` (rows and
  bar geometry with the dragged draft laid over the data), `window` (what to draw), `selection`,
  `feedback` (the cursor, the hovered target, the dragged values, the link preview), `editing` and
  `handles` (the permissions and handle sizes to draw), `now`, `autoScroll`, `busy` and
  `scrollRequest`.
- **Input.** `core.send(event)` takes `{ type: 'down' | 'move' | 'up', pointerId, x, y, time, button?, pointerType?, isPrimary?, modifiers?, target?, event? }`
  in **content coordinates** (`x` on the time scale, `y` below the header), `{ type: 'key', key, modifiers? }`,
  `{ type: 'cancel', pointerId? }` and `{ type: 'timeline' }` (the timeline moved under a still
  pointer). It runs the interaction state machines (move, resize, progress, link creation) and
  applies previews, commits, links, clicks and range growth itself; what it returns are the
  `RendererEffect`s left to you: `autoscroll`, `link-preview` and `feedback`, all also in the
  snapshot. Drags keep their date under the pointer through autoscroll, range extension and
  zoom, because the state machine anchors in time, not in pixels.
- **Scrolling out.** Report the scroller's position with `core.scroll({ left, top })` on every
  scroll event, once per frame. With `timeline.infinite` it may return a `ViewportChange`: apply
  it in the same frame (`scrollLeft += change.shift`, and size the content to the snapshot's new
  `contentWidth`) so the date under the left edge does not move.
- **Clock.** Call `core.refreshNow()` from one timer aligned to the next minute so the today line
  follows `snapshot.now`; it publishes only when the minute changed.
- **Errors.** `setViewport`, `scroll`, `send` and `refreshNow` finish their change before they
  return, and never throw because an application handler did; those errors go to `error`, or to
  the unhandled-rejection channel.

### Scroll requests

The core cannot touch a scroller, so every scroll it wants is a **request**:
`{ id, reason, from?, left?, top?, behavior }`, returned by `setViewMode`, `zoomTo`, `scrollTo*` and
`setViewport`, and kept in the snapshot as `scrollRequest`. Perform each `id` once: if `from` is set,
jump there instantly first, then scroll to `left` and `top` (content and body pixels; a missing one
keeps its axis) with `behavior`. Values are absolute and already account for earlier requests, so
skipping a superseded one loses nothing.

## Building blocks

Everything `createGanttCore` is made of is exported, so you can use a part on its own. Each is a
plain function over plain values, with no hidden state.

| Area      | Exports                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time      | `parseDateInput`, `parseDuration`, `parseGranularity`, `toDate`, `toDayKey`, `fromDayKey`, `alignFloor`, `alignCeil`, `alignNearest`, `isAligned`, `createFloatingAdapter` (`DateAdapter`: `add`, `startOf`, `endOf`, `format`, …) |
| Calendar  | `createWorkCalendar`                                                                                                                                                                                                               |
| Scale     | `createTimeScale`, `resolveViewModes`, `VIEW_MODE_PRESETS`, `headerRows`, `headerCells`, `gridLines`, `currentCell`, `resolveSnap`, `snapTime`, `clampResize`                                                                      |
| Model     | `normalizeModel`, `patchTask`, `patchTasks`                                                                                                                                                                                        |
| Hierarchy | `buildHierarchy`, `visibleRows`, `expandAll`, `collapseAll`, `setExpanded`, `toggleExpanded`                                                                                                                                       |
| Schedule  | `buildLinkGraph`, `topoSort`, `wouldCreateCycle`, `propagate`, `detectConflicts`, `applyChangeSet`, `revalidateChangeSet`                                                                                                          |
| Progress  | `progressToDate`, `dateToProgress`, `progressFromDate`, `rebaseProgress`                                                                                                                                                           |
| Layout    | `layoutRows`, `createLayout`, `barGeometry`, `placeLabel`, `visibleWindow`, `barsInWindow`, `routeLink`, `linkBBox`                                                                                                                |
| Viewport  | `resolveRange`, `planExtension`, `planScrollTo`, `scrollToTask`, `keepAnchor`, `rebaseTimeline`                                                                                                                                    |
| Input     | `createInteraction`, `hitTest`, `barHandles`, `resolvePermissions`, `INTERACTION_DEFAULTS`                                                                                                                                         |
| State     | `createStore`, `createEmitter`, `createHooks`, `createChangeController`, `createEditSession`, `createChangeHistory`                                                                                                                |

A work calendar, a time scale and a propagation, with no chart:

```ts
import {
  buildHierarchy,
  buildLinkGraph,
  createFloatingAdapter,
  createTimeScale,
  createWorkCalendar,
  fromDayKey,
  normalizeModel,
  parseDateInput,
  propagate,
  toDate,
  toDayKey,
} from '@ganttlane/core';

// Dates inside the core are branded numbers; `parseDateInput` makes one from your input.
function at(input: string) {
  const parsed = parseDateInput(input);
  if (!parsed.ok) throw new Error(parsed.issue.code);
  return parsed.value.value;
}

// Calendar: Saturday and Sunday off, and one named holiday.
const { calendar, issues } = createWorkCalendar({
  weekends: [0, 6],
  holidays: [{ date: '2026-03-04', name: 'Office closed' }],
});
console.log(issues.length); // 0
console.log(calendar.explain(toDayKey(at('2026-03-04')))); // { working: false, reason: 'holiday', label: 'Office closed' }
console.log(calendar.countDays(toDayKey(at('2026-03-02')), toDayKey(at('2026-03-09')))); // { calendar: 7, working: 4, nonWorking: 3 }
const monday = calendar.addWorkingDays(toDayKey(at('2026-03-06')), 1); // the next working day after a Friday
console.log(monday && toDate(fromDayKey(monday)));

// Scale: pixels per day from an origin.
const dates = createFloatingAdapter(); // Monday-based weeks; `weekStartsOn` changes it
const origin = at('2026-03-02');
const scale = createTimeScale({ origin, pxPerDay: 40 });
console.log(scale.dateToX(dates.add(origin, 2, 'day'))); // 80

// Scheduling: move a task and see what follows.
const tasks = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', duration: 10 },
];
const model = normalizeModel(
  { tasks, links: [{ source: 'design', target: 'build' }] },
  { calendar },
);
const changeSet = propagate(
  { kind: 'move', id: 'design', start: at('2026-03-09') },
  { model, hierarchy: buildHierarchy(model), graph: buildLinkGraph(model) },
);
console.log(changeSet.changes.map((change) => [change.id, change.cause])); // [['design', 'direct'], ['build', 'link']]
```

## Development and production builds

The package ships two builds of the same code. They report the same issues (`code`, `severity`,
`path`, `value`, `suggested`, ids) and behave identically; only the issue `message` differs:

- `dist/index.js` (default, production): short messages, `'<path>: <code>'`;
- `dist/index.development.js` (export condition `development`): full English explanations with the
  offending value and a hint.

Vite and webpack choose the `development` condition in development mode on their own, which is why
`@ganttlane/dom` and `@ganttlane/react` give you readable issues while you build and short ones in
production. Elsewhere opt in explicitly: `node --conditions=development`, esbuild
`--conditions=development`, `@rollup/plugin-node-resolve` `exportConditions: ['development']`,
Jest `testEnvironmentOptions.customExportConditions`. The development build is about 4 kB larger.

## Accessibility

The core draws nothing. It does carry what an accessible renderer needs: stable task and link ids,
row order and depth (`state.derived.rows`), expanded state, the selection, per-task permissions
(`editing`), the names and dates of every `TaskRecord`, and the strings-free `Issue`s. Roles,
labels, focus order and keyboard editing belong to the renderer; keyboard editing and focusable bars
are planned for `@ganttlane/dom` (see its [accessibility status](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#accessibility)).

## Browser and runtime support

The core uses only standard ECMAScript and `Intl`. It targets the last two versions of Chrome, Edge,
Firefox and Safari, iOS Safari 16.4 and Node 20 or newer. It never touches `window` or `document`,
starts no timers, and reads the system clock only for `now` (replace it with the `now` option),
so it runs in a worker as it is.

## Size

Minified and gzipped, with its dependencies (`@internationalized/date`, `valibot`), the production
build is about 60 kB for the whole entry and about 56 kB for an application that imports only
`createGanttCore`; the development build adds about 4 kB. `pnpm size` measures the current numbers
against the budgets, and `pnpm size:report` breaks a build down by module and
dependency. `pnpm bench` measures the performance numbers.

Single utilities tree-shake: `parseDuration` on its own is about 1.2 kB and `createTimeScale` about
0.4 kB; utilities that need the date library, such as `createWorkCalendar` or `patchTasks`, about
7 kB. `pnpm size:each` lists every export, and `pnpm size:report --import <name>` breaks one down.

## Limits and roadmap

Limits you should know about today:

- **Time is floating.** No time zones, no daylight saving, no offsets in strings (`unsupported-offset`).
  Zoned dates are planned for later.
- **Minute precision**; the granularity is a divisor of 24 hours, or one day (no weekly or monthly steps).
- **A working day is 24 hours.** Working hours and shifts, and calendars per task or resource, are
  planned for later.
- **A task may span at most 10 years** (`too-long`).
- **Rows have one height**, and a row holds one task.
- `scheduling.propagation: 'push-forward'` is reported as `unsupported-option` and behaves as
  `'preserve-lag'`; `direction: 'rtl'` is stored but not mirrored.
- Unknown option keys are ignored without a hint (hints for old option names, an exported schema
  entry, `@ganttlane/core/schema`, and a `fromFrappeGanttOptions` adapter are planned).

The [API reference](https://ganttlane.github.io/ganttlane/api/) is generated from the TSDoc of the
sources and is on the documentation site.

Planned for 1.0: zoom gestures and `zoomToFit`, selection and keyboard navigation, undo and redo
hotkeys, `push-forward` propagation, week-start and weekend defaults from the locale, RTL, exported
validation schemas, a task list and compound React components. Later: zoned dates, working hours,
baselines, critical path, rollup of parent dates.

## License

[MIT](https://github.com/ganttlane/ganttlane/blob/main/LICENSE). See [NOTICE](https://github.com/ganttlane/ganttlane/blob/main/NOTICE) for attribution to frappe-gantt.

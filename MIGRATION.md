# Migrating to ganttlane

ganttlane is a from-scratch rewrite inspired by [frappe-gantt](https://github.com/frappe/gantt). It
is not a drop-in replacement: names, data shapes and some behaviours changed on purpose. This guide
maps what you have today to what exists now, and says where the behaviour is different.

- [Part 1](#part-1-from-frappe-gantt) is for apps on the public `frappe-gantt` package (1.0.x up
  to 1.2.x).
- [Part 2](#part-2-from-the-extended-fork) is for apps on a privately modified fork of it, with
  extra options such as dependencies with anchors, parent and child movement, ignored days, an
  infinite timeline and readonly flags.

> **Status:** pre-release (`0.0.0`), not published to npm yet, and the API may still change before
> `0.1.0`. The package names below (`@ganttlane/core`, `@ganttlane/dom`, `@ganttlane/react`) are the
> ones that will be published. There is no automatic converter yet: see
> [What is not available yet](#what-is-not-available-yet).

## Contents

- [The changes that matter most](#the-changes-that-matter-most)
- [Install and set up](#install-and-set-up)
- [Part 1: from frappe-gantt](#part-1-from-frappe-gantt)
  - [From `new Gantt` to `createGantt`](#from-new-gantt-to-creategantt)
  - [Tasks](#tasks)
  - [Dates, ends and durations](#dates-ends-and-durations)
  - [Options](#options)
  - [View modes](#view-modes)
  - [Events](#events)
  - [Methods](#methods)
  - [Popups](#popups)
  - [CSS](#css)
  - [Behaviour that will surprise you](#behaviour-that-will-surprise-you)
  - [React](#react)
  - [Before and after](#before-and-after)
- [Part 2: from the extended fork](#part-2-from-the-extended-fork)
  - [Where each fork feature lives now](#where-each-fork-feature-lives-now)
  - [Options by domain](#options-by-domain)
  - [Task fields](#task-fields)
  - [Events and methods](#events-and-methods)
  - [CSS variables and classes](#css-variables-and-classes)
  - [Semantics that changed](#semantics-that-changed)
  - [Recipes](#recipes)
- [Checklist](#checklist)
- [What is not available yet](#what-is-not-available-yet)

## The changes that matter most

These apply to both parts. The rest of the guide is detail.

1. **A factory instead of a constructor.** `createGantt(container, options)` draws the chart and
   returns an object with methods. The tasks and the links are options, not arguments.
2. **Options are camelCase and grouped by domain** (`layout`, `calendar`, `scheduling`,
   `hierarchy`, `display`, `editing`, `timeline`, `scroll`, `tooltip`, …).
3. **Unknown options are ignored silently.** An old key such as `bar_height` or `view_mode` does
   nothing and reports nothing; hints for old names are planned, not shipped. Walk your options
   object through the tables below instead of waiting for the chart to complain.
4. **Your data is never mutated.** The chart reads your tasks and links and keeps its own state.
   What it computes (dates, working days, issues, conflicts) is in a read-only `TaskRecord` that you
   get from `gantt.getTask(id)` or as the argument of an event, never written into your objects.
5. **A change is a `ChangeSet`**, delivered once per user action with every task it touched, after
   the drop and not while dragging. A before-hook can veto or rewrite it; you can keep the data
   yourself (controlled mode) or let the chart own it (the default).
6. **Dependencies are `links`**: a separate array with four types (`FS`, `SS`, `FF`, `SF`) and a
   lag. A `dependencies` array on a task still works as a shorthand.
7. **Dates are floating wall-clock time**, a date-only `end` still includes its day, every value is
   a multiple of `scheduling.granularity` (one day by default), and a value off the step is
   reported, not silently rounded.
8. **Bad input is an issue, never a throw or a console message.** Read issues from `onIssues`,
   `getIssues()` and `TaskRecord.issues`.
9. **CSS is a separate file** with `--gantt-*` custom properties in `@layer gantt`, and a stable
   set of `gantt__*` classes and `data-*` attributes.

## Install and set up

```sh
pnpm add @ganttlane/dom                    # vanilla; brings @ganttlane/core
pnpm add @ganttlane/react react react-dom  # React; brings both (and re-exports the types and patchTasks)
```

React and React DOM are peer dependencies of `@ganttlane/react`: an app that already has them needs
only `pnpm add @ganttlane/react`.

- The packages are ESM only. TypeScript must resolve package `exports` (`moduleResolution` of
  `bundler`, `node16` or `nodenext`).
- **Import the stylesheet once**, before the chart is created:
  `import '@ganttlane/dom/styles.css'` (or `@ganttlane/react/styles.css` in a React-only app). The
  JavaScript never imports it for you.
- **The container is an `HTMLElement`**, **it needs a height** (the chart fills it and scrolls
  inside it) and it should be empty. Or give the chart its own height with `layout.height`, a
  number of px or `'auto'` (see [Height](packages/dom/README.md#height)). A selector string, `null`
  or anything else that is not an element makes `createGantt` throw a `TypeError`; nothing else
  about its input throws.
- **Call `gantt.destroy()`** when the chart goes away. It removes every node, listener, observer and
  timer the chart added; several charts on one page are fine.
- Strict pnpm: `@ganttlane/dom` and `@ganttlane/react` re-export the _types_ you meet (`Task`, `Link`,
  `TaskRecord`, `ChangeSet`, …). For runtime helpers such as `patchTasks` or `toDate` add
  `@ganttlane/core` on the same version (`@ganttlane/react` re-exports `patchTasks`).
- Remove the old package and its stylesheet import once nothing else uses them: its rules are
  written for another DOM, and ganttlane reads none of its custom properties.

The full references are the READMEs of [`@ganttlane/core`](packages/core/README.md),
[`@ganttlane/dom`](packages/dom/README.md) and [`@ganttlane/react`](packages/react/README.md);
this guide links to their sections instead of repeating them.

---

# Part 1: from frappe-gantt

## From `new Gantt` to `createGantt`

Before:

```js
import Gantt from 'frappe-gantt';
// plus the stylesheet of frappe-gantt

const gantt = new Gantt('#chart', tasks, {
  view_mode: 'Week',
  on_click: (task) => console.log(task.id),
});
```

After:

```ts
import '@ganttlane/dom/styles.css';
import { createGantt, type Link, type Task } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart');
if (!container) throw new Error('#chart not found');

const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
];
const links: Link[] = [{ source: 'design', target: 'build' }];

const gantt = createGantt(container, {
  tasks,
  links,
  viewMode: 'week',
  onTaskClick: (record) => console.log(record.id),
});
```

What changes:

- The container is an element with a height, not a selector: a selector string makes `createGantt`
  throw a `TypeError`. The chart adds one `div.gantt` to it and removes it on `destroy()`.
- `tasks` and `links` go in the options object.
- Handlers are options named `on<Event>`, and `gantt.on(name, handler)` adds more, returning a
  function that removes the listener. A handler can be replaced later with `setOptions`.
- The result is typed: `createGantt<TData>(…)` carries the type of your `task.data` into every
  event and render function.

## Tasks

| Upstream task field                                                        | Now                                        | Notes                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                                       | `id`                                       | Required, a string or a number, **never rewritten**. Upstream turned it into a string, replaced spaces with `_` and made one up when it was missing. `5` and `'5'` are different tasks here: keep `id`, `parentId` and the ids in `links` and `dependencies` of the same type. |
| `name`                                                                     | `name`                                     | Required. Drawn as text, never as HTML.                                                                                                                                                                                                                                        |
| `start`                                                                    | `start`                                    | A `Date`, `'YYYY-MM-DD'`, `'YYYY-MM-DDTHH:mm[:ss]'` (a space instead of `T` reads too) or epoch ms. Optional: a task without dates is a row without a bar.                                                                                                                     |
| `end`                                                                      | `end`                                      | A date-only `end` is still the last day, inclusive. See [Dates, ends and durations](#dates-ends-and-durations).                                                                                                                                                                |
| `duration`                                                                 | `duration`                                 | A number is **days**; strings and objects are accepted (`'3d'`, `'1d 4h'`, `{ days: 3 }`). In strings `m` means nothing here: write `mo` for months, `min` for minutes.                                                                                                        |
| `progress`                                                                 | `progress`                                 | 0 to 100. A value outside is clamped, with a `progress-out-of-range` warning.                                                                                                                                                                                                  |
| `dependencies` (a comma-separated string, or an array of ids)              | `links`, or `dependencies` as an **array** | Split a string first: a string is an `invalid-shape` error and the task becomes a row without a bar. Every id is a finish-to-start link from that task to this one. See below.                                                                                                 |
| `custom_class`                                                             | `className`                                | Added to the bar's `g.gantt__bar`. Several space-separated classes work (upstream took one). `rowClassName` does the same for the row.                                                                                                                                         |
| `color`                                                                    | `color`                                    | The bar's colour, written as `--gantt-bar-color` on the bar.                                                                                                                                                                                                                   |
| `color_progress`                                                           | `progressColor`                            | The progress part's colour, written as `--gantt-bar-progress-color`.                                                                                                                                                                                                           |
| `description`                                                              | `description`                              | Free text. The default tooltip does not draw it: read `context.task.task.description` in `tooltip.render`.                                                                                                                                                                     |
| `thumbnail`                                                                | no field                                   | Put the image URL in `task.data` and draw it yourself with `display.renderBarLabel` (`renderBarLabel` in React).                                                                                                                                                               |
| `invalid`                                                                  | no input                                   | A task the chart cannot use is reported as an issue (`TaskRecord.issues`) and drawn as a row without a bar (`data-invalid`). To get such a row on purpose set `type: 'placeholder'`.                                                                                           |
| `_start`, `_end`, `_index`, `actual_duration`, … written into your objects | `TaskRecord`                               | Read-only, from `gantt.getTask(id)` or an event: `start`, `end`, `endExclusive`, `duration.workingDays`, `progressDate`, `issues`, `conflicts`, `rowIndex`, …                                                                                                                  |

`links` is the canonical form, and each link names its two ends and, optionally, a type and a lag:

```ts
const links: Link[] = [
  { source: 'design', target: 'build' }, // finish-to-start, the default type
  { source: 'build', target: 'review', type: 'SS', lag: 2 }, // start-to-start, two days apart
];
```

`dependencies: ['design']` on the target task means the same as the first link. See
[Tasks and links](packages/core/README.md#tasks-and-links) for every field.

A converter for the task shape of upstream, with the pieces above:

```ts
import type { Link, Task } from '@ganttlane/dom';

/** The fields of a frappe-gantt task that this guide maps. */
interface FrappeTask {
  id: string | number;
  name: string;
  start: string | Date;
  end?: string | Date;
  duration?: string;
  progress?: number;
  dependencies?: string | readonly string[];
  custom_class?: string;
  color?: string;
  color_progress?: string;
  description?: string;
}

const predecessors = (value: FrappeTask['dependencies']): string[] =>
  (typeof value === 'string' ? value.split(',') : [...(value ?? [])])
    .map((id) => id.trim())
    .filter((id) => id !== '');

function fromFrappeTasks(old: readonly FrappeTask[]): { tasks: Task[]; links: Link[] } {
  const links = old.flatMap((task) =>
    predecessors(task.dependencies).map((source): Link => ({ source, target: task.id })),
  );
  const tasks = old.map((task): Task => ({
    id: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    // Upstream's `m` is months (and `30min` was a bug there); here months are `mo`.
    duration: task.duration?.replace(/(\d)m\b/g, '$1mo'),
    progress: task.progress,
    className: task.custom_class,
    color: task.color,
    progressColor: task.color_progress,
    description: task.description,
  }));
  return { tasks, links };
}
```

If your ids were not strings, or had spaces, make `id`, `parentId` and the link ends agree before
you convert: nothing rewrites them any more.

## Dates, ends and durations

**The end of a date-only task is still its last day.** `start: '2026-03-02', end: '2026-03-06'` is
five days in upstream and here. What changed is what comes back out. Inside, the chart works with
the half-open interval `[start, endExclusive)`, and it hands you both ends:

|                                          | Upstream                                    | ganttlane                                                                                     |
| ---------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| You write                                | `end: '2026-03-06'`                         | `end: '2026-03-06'`                                                                           |
| `on_date_change` / `onTaskDatesChange`   | `end` is `end - 1 s`: `2026-03-06 23:59:59` | `end` is the last day: `2026-03-06 00:00`; `endExclusive` is `2026-03-07 00:00`               |
| `ChangeSet` (`onTasksChange`)            | n/a                                         | `after.endExclusive`, in the core's floating milliseconds (`toDate()` turns it into a `Date`) |
| With a time of day, `'2026-03-06 17:00'` | the exact moment                            | the exact moment (see granularity below)                                                      |

`TaskRecord.end` is "the end in the words of your input": the last day for a task of whole days
and the exact moment for a task with times. `endExclusive` is always the half-open end; compare
timestamps with it. `dates: { endInclusive: false }` makes a date-only `end` exclusive instead.

**Durations.** A number is days (`3`, `0.5`). Strings: `'30min'`, `'6h'`, `'2d'`, `'1w'`, `'1mo'`,
`'1q'`, `'1y'`, compound `'1d 4h'`, and ISO 8601 (`'P1DT4H'`). Objects: `{ days: 2, hours: 4 }`.
Upstream read `m` as months; here a bare `m` is rejected as ambiguous (`invalid-duration`). Seconds
and milliseconds do not exist: the finest unit is a minute.

**Time zones.** Dates are wall-clock values with no time zone and no daylight saving. A `Date` is
read through the local clock, so `09:00` stays `09:00` for every viewer. A string with `Z` or an
offset is rejected (`unsupported-offset`): convert it first, or pass `new Date(...)`.

**Granularity.** Every date, duration and lag must be a multiple of `scheduling.granularity`,
which is `'1d'` unless you say otherwise. A task with times of day under the default is
`misaligned`: it is reported and widened to whole days. For hour-level planning set the step:

```ts
createGantt(container, {
  tasks: [{ id: 'sync', name: 'Sync', start: '2026-03-02T10:00', end: '2026-03-02T11:30' }],
  viewMode: 'hour',
  scheduling: { granularity: '30min' },
});
```

What the chart does with a value off the step is `scheduling.alignInput`: `'expand'` (default,
the start goes down and the end up, so no time is lost), `'nearest'` or `'reject'`. See
[Granularity and alignment](packages/core/README.md#granularity-and-alignment).

## Options

Every upstream option, grouped by what it does. "Default" is upstream's. Where a result is "not
available yet", the option exists but is reserved: turning it on is reported as an
`unsupported-option` issue and draws nothing.

### View and scale

| Upstream       | Default     | Now                                 | Notes                                                                                                                                                                                                             |
| -------------- | ----------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view_mode`    | `'Day'`     | `viewMode`                          | An id, lower case: `'hour'`, `'quarter-day'`, `'half-day'`, `'day'`, `'week'`, `'month'`, `'year'`. `'Day'` is an unknown id: the chart falls back to `'day'` with an `unknown-view-mode` issue. Default `'day'`. |
| `view_modes`   | seven modes | `viewModes`                         | Overrides keyed by id, merged over the presets, or a complete list. See [View modes](#view-modes).                                                                                                                |
| `column_width` | none        | `viewModes: { <id>: { pxPerDay } }` | The scale is pixels per **day**, per view mode, with real month and year lengths. See [View modes](#view-modes).                                                                                                  |
| `snap_at`      | none        | `scheduling.snap`                   | `'1d'`, `'7d'`, `'unit'`, `false` or `{ step, mode, move, resize, progress }`. A step finer than `scheduling.granularity` is raised to a multiple of it. Drags snap to the nearest step.                          |
| `language`     | `'en'`      | `locale`                            | A BCP 47 tag. It formats the header and the dates of the tooltip with `Intl`. Texts of the chart itself are the `strings` option. Default `'en'`, not the browser's.                                              |

### Layout

| Upstream                                     | Default    | Now                                | Notes                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bar_height`                                 | `30`       | `layout.barHeight`                 | Same default.                                                                                                                                                                                                                                                     |
| `padding`                                    | `18`       | `layout.rowHeight`                 | **The meaning changed:** `padding` was the gap between bars, `rowHeight` is the whole row: `barHeight + padding`. The default is `48`, which is `30 + 18`.                                                                                                        |
| `bar_corner_radius`                          | `3`        | `layout.barRadius`                 | Each bar clamps it to half its height and width.                                                                                                                                                                                                                  |
| `upper_header_height`, `lower_header_height` | `45`, `30` | `layout.headerRowHeight: [45, 30]` | One height per header row, top first. The header is exactly the sum of its rows (75 px): the extra 10 px upstream added is gone.                                                                                                                                  |
| `container_height`                           | `'auto'`   | `layout.height`                    | **The default changed.** Left out, the chart is as tall as its container and scrolls inside it. `layout: { height: 'auto' }` grows with the rows and lets the page scroll, like upstream's `'auto'`. A number is px. See [Height](packages/dom/README.md#height). |
| `arrow_curve`                                | `5`        | `display.linkCurveRadius`          | The largest corner radius of an arrow.                                                                                                                                                                                                                            |

### Grid and display

| Upstream                 | Default              | Now                        | Notes                                                                                                                                                                    |
| ------------------------ | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lines`                  | `'both'`             | `display.gridLines`        | The same four values: `'both'`, `'vertical'`, `'horizontal'`, `'none'`.                                                                                                  |
| `auto_move_label`        | `false`              | `display.stickyBarLabels`  | **Not available yet.** Reserved.                                                                                                                                         |
| `show_expected_progress` | `false`              | `display.expectedProgress` | **Not available yet.** Reserved.                                                                                                                                         |
| `today_button`           | `true`               | `toolbar.todayButton`      | **Not available yet:** nothing draws a toolbar. Add your own button and call `gantt.scrollToToday()`.                                                                    |
| `view_mode_select`       | `false`              | `toolbar.viewModeSelect`   | **Not available yet.** Build a select with `gantt.setViewMode(id)` and `onViewModeChange`.                                                                               |
| `date_format`            | `'YYYY-MM-DD HH:mm'` | removed                    | It never formatted what you see: it was the key of CSS classes and of the "today" lookup. Dates in the tooltip follow `locale`; header labels are `viewModes[].headers`. |
| `hover_on_date`          | `false`              | removed                    | There is no date-click event (`on_date_click`). A hovered highlighted day shows its `label`: see `highlights`.                                                           |

The today line is `display.today` (default `true`), and zebra rows are opt-in
(`display.rowStripes: 'row'`).

### Calendar

| Upstream                                 | Now                                                               | Notes                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignore` (days off)                      | `calendar.weekends`, `calendar.holidays`, `calendar.isWorkingDay` | The same idea (shaded days that drags and progress skip), as one calendar: `display.nonWorkingDays` draws them, `durationMode: 'working'` counts durations in working time (upstream never rescheduled bars around days off), and every record has `duration.workingDays`. |
| `is_weekend`                             | `calendar.weekends: number[]`                                     | Weekday numbers, `0` = Sunday. Upstream used `is_weekend` for the weekend highlight only; here it is a real rule. For a rule of your own use `calendar.isWorkingDay(day)` (`false` for a day off, `undefined` to go on).                                                   |
| `holidays` (colour → dates, `'weekend'`) | `highlights[]`                                                    | A highlight is **visual only**. Each one is `{ id, dates?, range?, match?, label?, className?, color? }`; a named holiday of the calendar shows its name the same way.                                                                                                     |

```ts
createGantt(container, {
  tasks,
  // Days off that the schedule respects.
  calendar: {
    weekends: [0, 6], // 0 = Sunday; this is the default
    holidays: [{ date: '2026-03-04', name: 'Office closed' }],
  },
  display: { nonWorkingDays: 'stripes' },
  // A purely visual mark, with a label shown on hover.
  highlights: [{ id: 'launch', dates: ['2026-03-26'], label: 'Launch', color: '#f59e0b' }],
});
```

**Weekends are days off by default.** Upstream only highlighted weekends and scheduled over them.
Here `calendar.weekends` is `[0, 6]`: they are shaded, they do not count as working days, and a drag
skips them (`scheduling.skipNonWorkingDays.move` and `.progress` are `true`). To get the upstream
behaviour, make no day a day off and keep the highlight:

```ts
createGantt(container, {
  tasks,
  calendar: { weekends: [] },
  highlights: [{ id: 'weekends', match: (day) => day.weekday === 0 || day.weekday === 6 }],
});
```

Durations still count calendar days unless a task, or `scheduling.durationMode`, is `'working'`. See
[Work calendar](packages/core/README.md#work-calendar).

### Editing and scheduling

| Upstream            | Default | Now                                                   | Notes                                                                                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly`          | `false` | `editing: false`                                      | Turns off editing from the UI: no drag, resize, progress change or link drawing. It blocks only the UI: `updateTask`, `addLink`, `removeLink` and `setTasks` still commit. |
| `readonly_dates`    | `false` | `editing: { move: false, resize: false }`             | `editing` takes `move`, `resize`, `progress` and `links`, each `true` by default. `task.editable` overrides it for one task.                                               |
| `readonly_progress` | `false` | `editing: { progress: false }`                        |                                                                                                                                                                            |
| `fixed_duration`    | `false` | `editing: { resize: false }`, or `task.fixedDuration` | The chart-wide switch hides the resize handles; `fixedDuration` on a task keeps its length.                                                                                |
| `move_dependencies` | `true`  | `scheduling.propagation`                              | `'preserve-lag'` (default) or `'none'`. See [Behaviour that will surprise you](#behaviour-that-will-surprise-you).                                                         |

**New and on by default:** `editing.links` lets users draw links (drag from the circle beside a bar,
or click it and then the other bar) and delete them (click the arrow). Upstream could not. Set
`editing: { links: false }` if links must stay as your data has them.

### Popup options

| Upstream   | Default    | Now               | Notes                                                   |
| ---------- | ---------- | ----------------- | ------------------------------------------------------- |
| `popup`    | a function | `tooltip.render`  | See [Popups](#popups).                                  |
| `popup_on` | `'click'`  | `tooltip.trigger` | `'hover'` (**the default now**), `'click'` or `'none'`. |

### Scrolling and timeline

| Upstream           | Default   | Now                 | Notes                                                                                                                                                                                                                    |
| ------------------ | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll_to`        | `'today'` | `scroll.initial`    | `'today'` (default), `'start'`, `'end'`, `'first-task'`, `'none'` or a date. Applied **once, when the chart is created**, not on every render. `'start'` and `'end'` are the edges of the range (the data plus padding). |
| `infinite_padding` | `true`    | `timeline.infinite` | **Off by default now.** `true` or `{ threshold, extendBy, bounds, maxSpan }`. See [Scrolling](packages/dom/README.md#scrolling).                                                                                         |

`scroll.behavior` (`'smooth'` by default) and `scroll.align` (`'start'`, `'center'`, `'end'` or a
number from 0 to 1) set how `scrollTo*` calls move.

## View modes

The presets are `hour`, `quarter-day`, `half-day`, `day`, `week`, `month` and `year`. Their zoom
differs a little from upstream's column widths, because the scale is now pixels per day:

| Upstream name | Upstream column  | ganttlane id  | `pxPerDay` | Upstream width as `pxPerDay` |
| ------------- | ---------------- | ------------- | ---------- | ---------------------------- |
| Hour          | 45 px / hour     | `hour`        | 960        | 1080                         |
| Quarter Day   | 45 px / 6 hours  | `quarter-day` | 160        | 180                          |
| Half Day      | 45 px / 12 hours | `half-day`    | 80         | 90                           |
| Day           | 45 px / day      | `day`         | 40         | 45                           |
| Week          | 140 px / week    | `week`        | 20         | 20                           |
| Month         | 120 px / month   | `month`       | 4          | about 4                      |
| Year          | 120 px / year    | `year`        | 1          | about 0.3                    |

To keep upstream's zoom, override the preset (a preset id merges the override over the preset):

```ts
createGantt(container, {
  tasks,
  viewMode: 'day',
  viewModes: { day: { pxPerDay: 45 }, week: { pxPerDay: 20 } },
});
```

A view mode of your own is an object with an `id`, a column `unit` (and `step`), `pxPerDay` and
header rows. The fields map like this:

| Upstream view mode field              | Now                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                | `id` (the key in the record form) and `label`, which you can translate                                                                                                                        |
| `step: '7d'`                          | `unit: 'day'`, `step: 7`; `'6h'` is `unit: 'hour', step: 6`                                                                                                                                   |
| `column_width`                        | `pxPerDay`: the column width divided by the days a column spans                                                                                                                               |
| `padding`                             | `padding`: a duration, or `[before, after]`                                                                                                                                                   |
| `snap_at`                             | `snap`                                                                                                                                                                                        |
| `upper_text`, `lower_text`            | `headers`: a list of header rows, top first, each `{ unit, step?, format }`; `format` is `Intl.DateTimeFormatOptions` or `(range, locale, adapter) => string`; an empty string draws no label |
| `thick_line(date)`                    | `majorLine`: `{ unit }` or `(date) => boolean`                                                                                                                                                |
| `date_format`, `upper_text_frequency` | removed                                                                                                                                                                                       |

Before and after:

```js
view_modes: [
  'Day',
  {
    name: 'Fortnight',
    step: '14d',
    padding: '14d',
    column_width: 140,
    upper_text: (date, prev) =>
      !prev || date.getMonth() !== prev.getMonth()
        ? date.toLocaleString('en', { month: 'long' })
        : '',
    lower_text: (date) => String(date.getDate()),
  },
],
view_mode: 'Fortnight',
```

```ts
createGantt(container, {
  tasks,
  viewMode: 'fortnight',
  viewModes: {
    fortnight: {
      label: 'Fortnight',
      unit: 'day',
      step: 14,
      pxPerDay: 10, // 140 px for 14 days
      padding: '14d',
      headers: [
        { unit: 'month', format: { month: 'long', year: 'numeric' } },
        { unit: 'day', step: 14, format: { day: 'numeric' } },
      ],
      majorLine: { unit: 'month' },
      snap: '1d',
    },
  },
});
```

Presets also differ in padding (`day` pads 14 days, `week` four weeks, `month` four months) and in
their snap. `viewModes` can be a complete list too, which replaces the presets. The fields are
listed in [`@ganttlane/core`](packages/core/README.md#view).

## Events

Upstream had one handler per event, in `options['on_' + name]`. Here every event is an `on<Event>`
option, `gantt.on(name, handler)` adds a listener and returns a function that removes it, and
`setOptions({ onTaskClick })` swaps a handler without recreating the chart. A handler that throws
reaches `onError`, never the chart.

| Upstream             | Arguments and timing                                                        | Now                                                       | Arguments                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `on_click`           | `(task)`; also after a drag                                                 | `onTaskClick`                                             | `(record, event)`; **never after a drag**                                                                                           |
| `on_double_click`    | `(task)`, also a double tap                                                 | `onTaskDoubleClick`                                       | `(record, event)`                                                                                                                   |
| `on_hover`           | `(task, screenX, screenY, e)` on every mouseover                            | `onTaskHoverChange`                                       | `(record \| null, event)` when the task under the pointer **changes**; no coordinates                                               |
| `on_date_change`     | `(task, start, end - 1 s)` on **every mousemove**, and once more on mouseup | `onTasksChange`, and per changed task `onTaskDatesChange` | `(changeSet)` once per action, with every task touched, including those moved along links; `(record, { start, end, endExclusive })` |
| `on_progress_change` | `(task, progress)`                                                          | `onTaskProgressChange`, and `onTasksChange`               | `(record, progress)`                                                                                                                |
| `on_view_change`     | `(mode)`, also from the constructor                                         | `onViewModeChange`                                        | `(viewMode)`, the `ViewMode` object (read `.id`); **not** called when the chart is created                                          |
| `on_date_click`      | `('YYYY-MM-DD' \| null)`                                                    | none                                                      |                                                                                                                                     |

New events with no upstream counterpart: `onLinkCreate`, `onLinkDelete`, `onLinkClick`,
`onSelectionChange`, `onRangeChange`, `onExpandedChange`, `onScroll`, `onEditRollback`,
`onDirtyChange`, `onHistoryChange`, `onEditRefused`, `onIssues` and `onError`, and two before-hooks,
`onBeforeTaskChange` and `onBeforeLinkCreate`. See [Events](packages/dom/README.md#events) for
all payloads.

The `event` argument is typed `unknown`; the DOM renderer passes the pointer event that caused it.

Two things that follow from "a change is a `ChangeSet`":

- **There is no live `on_date_change`.** While a bar is dragged the chart shows a preview and
  tells nobody; the change is committed once, on the drop (also when the pointer is released
  outside the chart). For live numbers use the tooltip, which shows the previewed dates while
  dragging (`context.preview`).
- **You can say no.** `onBeforeTaskChange({ changeSet, reason, conflicts })` runs before the commit:
  return `false` to cancel, a `ChangeSet` to replace it, or nothing to let it pass. It may be async.

```ts
createGantt(container, {
  tasks,
  links,
  // Once per drop, per task whose dates changed. `end` is the last day, `endExclusive` the end of it.
  onTaskDatesChange: (record, { start, end, endExclusive }) => {
    console.log(record.id, start, end, endExclusive);
  },
  // Ask before a change that lands on a day off.
  onBeforeTaskChange: ({ conflicts }) =>
    conflicts.some((conflict) => conflict.type === 'non-working-start')
      ? window.confirm('This starts on a day off. Keep it?')
      : true,
  // Everything the chart did to the plan, as one change set per action.
  onTasksChange: (changeSet) => console.log(changeSet.reason, changeSet.changes.length),
});
```

## Methods

| Upstream                                                           | Now                                                                              | Notes                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Gantt(selector \| HTMLElement \| SVGElement, tasks, options)` | `createGantt(container, options)`                                                | An `HTMLElement` only. See [From `new Gantt` to `createGantt`](#from-new-gantt-to-creategantt).                                                                                                                                   |
| `refresh(tasks)`                                                   | `setTasks(tasks)`, `setLinks(links)`                                             | Diffed by id: only what changed is recomputed. The next call simply reads your objects again; the chart never wrote into them.                                                                                                    |
| `update_task(id, details)`                                         | `updateTask(id, { start?, end?, progress? })`                                    | Returns a promise of `{ status }` (`'committed'`, `'unchanged'`, `'rejected'`, `'cancelled'`, `'busy'`). Dates can be changed now (they propagate like a drag and pass `onBeforeTaskChange`). Other fields go through `setTasks`. |
| `update_options(opts)`                                             | `setOptions(patch)`                                                              | A key left out keeps its value; `undefined` restores the default. It does not reset the view mode. Returns the issues of the options now in use.                                                                                  |
| `change_view_mode(mode, maintain_pos)`                             | `setViewMode(id, { keepScroll })`                                                | `keepScroll` defaults to `true`: the date at the centre stays in place.                                                                                                                                                           |
| `scroll_current()`                                                 | `scrollToToday({ align, behavior })`                                             |                                                                                                                                                                                                                                   |
| `set_scroll_position(date \| 'start' \| 'end' \| 'today')`         | `scrollToDate(date, { align, behavior })`, `scrollToToday()`, `scrollToTask(id)` | `'start'` and `'end'` are values of `scroll.initial` at creation; at run time scroll to a date or a task.                                                                                                                         |
| `get_task(id)`                                                     | `getTask(id)`                                                                    | A read-only `TaskRecord`; `record.task` is your own object.                                                                                                                                                                       |
| `get_bar(id)`                                                      | `getBarRect(id)`, `getRowMetrics(id)`                                            | Geometry in px, not a DOM node.                                                                                                                                                                                                   |
| `show_popup`, `hide_popup`                                         | `hideTooltip()`                                                                  | Popovers open from the pointer (`tooltip.trigger`); there is no method to open one.                                                                                                                                               |
| `unselect_all`                                                     | `clearSelection()`                                                               | Also `select(ids)` and `selectLink(id)`.                                                                                                                                                                                          |
| `clear()`                                                          | `destroy()`                                                                      | Removes the DOM, every listener, observer and timer. Safe to call twice.                                                                                                                                                          |
| the internal helpers, public upstream                              | none                                                                             | Use the queries: `getTask`, `getLink`, `getVisibleRange`, `getRowMetrics`, `getBarRect`, `getIssues`.                                                                                                                             |

New methods: `addLink` and `removeLink`, `zoomTo`, `expand`, `collapse`, `expandAll`,
`collapseAll`, the edit session (`edit.begin()`, `commit()`, `rollback()`, `getChanges()`),
`undo()` and `redo()` (with `history: true`), and `on`. See
[Methods](packages/dom/README.md#methods).

### Who owns the data

`createGantt` is **uncontrolled** by default: the chart owns its copy of the tasks, applies a drag
to it, and `getTask(id)` shows the result at once. Your array does not change. If you need to know
the new dates, listen (`onTasksChange` or `onTaskDatesChange`) and save them. If your own array
(or store) must stay the truth, use `dataMode: 'controlled'`: every committed change is reported,
shown as a draft, and applied only when you give the new tasks back with `setTasks`. `patchTasks`
writes a `ChangeSet` into your tasks in the shape each task already has (a `Date` stays a `Date`, an
ISO string an ISO string):

```ts
import { patchTasks } from '@ganttlane/core';
import { createGantt, type Task } from '@ganttlane/dom';

let owned: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
];

const gantt = createGantt(container, {
  tasks: owned,
  links: [{ source: 'design', target: 'build' }],
  dataMode: 'controlled',
  onTasksChange: (changeSet) => {
    owned = patchTasks(owned, changeSet, gantt.core.getSnapshot().state.derived.model);
    gantt.setTasks(owned);
  },
});
```

See [Controlled and uncontrolled data](packages/core/README.md#controlled-and-uncontrolled-data).

## Popups

Upstream's `popup(ctx)` filled a title, a subtitle and details through setters that took HTML, or
returned a string that replaced the popup's HTML (`false` meant no popup). Here a tooltip is
described by a return value, and **a string is text, never markup**.

Before:

```js
popup: (ctx) => {
  ctx.set_title(`<b>${ctx.task.name}</b>`);
  ctx.set_subtitle(`${ctx.task.progress}% done`);
  ctx.add_action('Open', () => openTask(ctx.task.id));
},
popup_on: 'hover',
```

After:

```ts
createGantt(container, {
  tasks,
  tooltip: {
    trigger: 'hover',
    render: ({ task }) => ({
      title: task.name,
      subtitle: `${task.progress}% done`,
      actions: [{ label: 'Open', onSelect: () => console.log('open', task.id) }],
    }),
  },
});
```

- `render` returns a `string` (text), a `Node`, `{ html }` (the one way to insert markup, and
  sanitising it is your job), or `{ title, subtitle, details, actions }`. `null`, `''` or `{}` shows
  nothing (upstream's `false`).
- The context is `{ task, preview, isDragging, gesture, parent, predecessors, successors, locale, api }`.
  `task` is the `TaskRecord` (dates, working days, progress, issues), `predecessors` and `successors`
  carry the links with their lag, and `api` has `getTask`, `getLink` and `hide()`.
- An action calls `onSelect(context)` and closes the popover; it replaces `add_action`.
- `render` runs when its inputs change (another task, new previewed values), not on every mouse
  move. Without `render`, the tooltip shows the name, the dates in the chart's locale, the progress
  and the working days.
- `tooltip.followCursor`, `tooltip.delay`, `tooltip.placement` and `tooltip.showWhileDragging` (default
  `true`) are new. `linkMenu.render` is the menu a click on an arrow opens.
- In React, `renderTooltip` returns a `ReactNode`. See
  [Tooltips, the link menu and day labels](packages/dom/README.md#tooltips-the-link-menu-and-day-labels)
  and [Slots](packages/react/README.md#slots-tooltip-link-menu-and-bar-label-as-reactnode).

## CSS

The stylesheet is a separate import, all of it is in `@layer gantt`, and a style of yours that is not
in a layer wins without `!important`. Theme with custom properties on `.gantt`:

```css
.gantt {
  --gantt-bar-color: #0f766e;
  --gantt-today-color: #b45309;
}
```

`theme: 'auto'` (default) follows `prefers-color-scheme`; `'light'` and `'dark'` force one, per
chart (upstream's dark mode was global). The full token table is in
[Tokens](packages/dom/README.md#tokens).

**Class names.** Upstream's classes had no prefix. The structure, the classes and the `data-*`
attributes below are public API now (the complete list is the
[unstyled contract](packages/dom/README.md#unstyled-contract)), and states that were classes are
`data-*` attributes (`data-selected`, `data-hovered`, …).

| Upstream class               | Now                                                                      |
| ---------------------------- | ------------------------------------------------------------------------ |
| `.gantt-container`           | `div.gantt` (the root); `div.gantt__scroller` is what scrolls            |
| `.grid-row`                  | `.gantt__row`                                                            |
| `.bar-wrapper`               | `g.gantt__bar` (your `className` goes here)                              |
| `.bar`, `.bar-progress`      | `.gantt__bar-track`, `.gantt__bar-progress`                              |
| `.bar-label`                 | `.gantt__bar-label` (`data-placement` is `inside` or `outside`)          |
| `.handle`                    | `.gantt__handle[data-handle]` (`resize-start`, `resize-end`, `progress`) |
| `.popup-wrapper`             | `.gantt__popover[data-kind='task']`                                      |
| `.upper-text`, `.lower-text` | `.gantt__header-label`, in `.gantt__header-row[data-row]`                |

**Custom properties.** Upstream's `--g-*` variables (in `themes.css`) became the `--gantt-*` tokens of
[Tokens](packages/dom/README.md#tokens). Pairs that are the same job under another name:

| Upstream                                 | Now                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--g-bar-color`                          | `--gantt-bar-color`                                                                                           |
| `--g-progress-color`                     | `task.progressColor` per task, or `--gantt-bar-progress-shade-color` and `--gantt-bar-progress-shade` for all |
| `--g-header-background`                  | `--gantt-header-background-color`                                                                             |
| `--g-tick-color`, `--g-tick-color-thick` | `--gantt-grid-line-color`, `--gantt-grid-major-line-color`                                                    |
| `--g-arrow-color`                        | `--gantt-link-color` (`--gantt-link-selected-color` for a selected arrow)                                     |
| `--g-handle-color`                       | `--gantt-handle-color`                                                                                        |
| `--g-today-highlight`                    | `--gantt-today-color`                                                                                         |
| `--g-weekend-highlight-color`            | `--gantt-nonworking-color` for days off, `--gantt-highlight-color` for a highlight                            |

For the others (`--g-border-color`, `--g-row-border-color` and the `--g-text-*` colours) pick the
token of the same job: `--gantt-border-color`, `--gantt-grid-line-color`,
`--gantt-foreground-color`, `--gantt-header-text-color`, `--gantt-bar-label-color` and
`--gantt-bar-label-outside-color`.

The renderer writes the sizes itself (`layout.barHeight`, `layout.rowHeight`, …); the runtime
variables upstream wrote (`--gv-*`) are replaced by `--gantt-content-width`, `--gantt-header-height`
and `--gantt-body-height`, which only a replacement stylesheet needs. Ids inside the SVG are
prefixed per chart (`renderer.idPrefix`) and are not part of the contract: do not select them.

## Behaviour that will surprise you

1. **End dates and granularity.** See [Dates, ends and durations](#dates-ends-and-durations): the
   input rule is the same, the values you read back are not, and a time of day off the granularity
   is widened to whole days under the default `'1d'`, with a `misaligned` issue. Nothing is rounded
   silently.
2. **Nothing is mutated.** If your code reads `task._start`, `task._end` or `task.actual_duration`
   after a drag, read `gantt.getTask(id)` instead. If it expected your array to hold the new dates,
   listen to `onTasksChange` or use `dataMode: 'controlled'` ([Who owns the data](#who-owns-the-data)).
3. **Weekends are days off by default**, and drags skip them: see [Calendar](#calendar).
4. **`scroll.initial` is `'today'`, and it runs once.** The default value is upstream's, but upstream
   applied `scroll_to` on every render (a view change, `refresh`, `update_options`); here the chart
   scrolls when it is created, and `setViewMode` keeps the date at the centre in place. A plan in the
   past or the future opens at the nearest end of its range: set `scroll: { initial: 'first-task' }`
   (or `'start'`). Call `scrollToDate`, `scrollToToday` or `scrollToTask` when you want a move later.
5. **No infinite padding by default.** `timeline.infinite` is off; the range is the data plus the view
   mode's padding. Turn it on if users must scroll past the data.
6. **Dependencies work differently.** Arrows are drawn for all four link types, with proper routes.
   Moving or resizing a task moves the tasks linked to it so that their gap (the `lag`) is kept
   (`scheduling.propagation: 'preserve-lag'`), all in the same `ChangeSet`: upstream moved
   successors only when a bar was dragged, not when its right edge was resized, and its
   finish-to-start limit compared with the predecessor's start instead of its end. A link without a `lag` keeps whatever gap your data has, so converting the
   arrows of upstream moves nothing. A change that makes a gap smaller than the link allows is not
   blocked: it is reported as a `link-violated` conflict, and `onBeforeTaskChange` decides. A link
   that would close a cycle is refused, and a cycle in your data is reported (`cycle`) and takes no
   part in scheduling.
7. **A tooltip opens on hover** (`tooltip.trigger: 'hover'`), where upstream's popup opened on click.
8. **The container is an element, it needs a height, and it should be empty.** The chart does not
   accept a selector: `createGantt` throws a `TypeError` for anything that is not an element. With
   `layout.height: 'auto'` no ancestor between the chart and what scrolls it may clip
   (`overflow: hidden`), or the sticky header stops sticking.
9. **Rows follow the task tree, not the array index.** A row holds one task. A task the chart cannot
   use keeps its row and carries its issues, where upstream dropped it (and could shift the rows).
10. **Problems are issues.** The core and the renderer throw nothing and log nothing to the console
    over bad data or options (`@ganttlane/react` adds a few development-only warnings about how its
    props are used). A bad task is a row without a bar, a bad option falls back to its default, and
    a link to an unknown task is dropped.
    Read them from `onIssues`, `gantt.getIssues()` (`{ data, options }`) and `TaskRecord.issues`. Their
    `message` is short (`'<path>: <code>'`) unless your bundler picks the `development` export
    condition (Vite and webpack do in dev mode): see
    [Development and production builds](packages/core/README.md#development-and-production-builds).
11. **Ids and numbers.** `1` and `'1'` are different tasks, and an unknown id in `links` or
    `dependencies` is an `unknown-link-task` issue and the link is dropped.
12. **No globals, several charts per page.** Upstream patched `SVGElement.prototype` and used fixed
    element ids; ganttlane touches no global, and the ids are prefixed per instance.
13. **Time has no zone.** Strings with `Z` or an offset are rejected, and a `Date` is read through
    the local clock.

## React

Upstream has no React component. If you wrapped `new Gantt` in your own, replace the wrapper with
`<Gantt>` (or `useGantt`): every option of `createGantt` is a prop of the same name, every
`on<Event>` handler is a prop that is never stale (it may close over state), and the tooltip, the
link menu and the bar label are `ReactNode` slots.

```tsx
import '@ganttlane/react/styles.css';
import { Gantt, type Link, type Task } from '@ganttlane/react';

const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
];
const links: Link[] = [{ source: 'design', target: 'build' }];

export function Plan() {
  return (
    <Gantt
      style={{ height: 420 }}
      defaultTasks={tasks}
      defaultLinks={links}
      defaultViewMode="week"
      scroll={{ initial: 'first-task' }}
      onTaskDatesChange={(record, { start, end }) => console.log(record.id, start, end)}
      renderTooltip={({ task }) => <strong>{task.name}</strong>}
    />
  );
}
```

`defaultTasks` starts an uncontrolled chart; pass `tasks` instead to keep the data in your state (the
component then runs in controlled mode). Controlled data, Save and Cancel and the rest are in
[`@ganttlane/react`](packages/react/README.md#controlled-and-uncontrolled).

## Before and after

Upstream:

```js
import Gantt from 'frappe-gantt';

const tasks = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  {
    id: 'build',
    name: 'Build',
    start: '2026-03-09',
    end: '2026-03-20',
    dependencies: 'design',
    custom_class: 'bar-build',
  },
  { id: 'review', name: 'Review', start: '2026-03-23', end: '2026-03-25', dependencies: 'build' },
  { id: 'launch', name: 'Launch', start: '2026-03-26', end: '2026-03-26', dependencies: 'review' },
];

const gantt = new Gantt('#chart', tasks, {
  view_mode: 'Week',
  language: 'en',
  bar_height: 28,
  padding: 20,
  readonly_progress: true,
  infinite_padding: false,
  scroll_to: 'start',
  popup_on: 'hover',
  popup: (ctx) => {
    ctx.set_title(ctx.task.name);
    ctx.set_details(`${ctx.task.progress}% done`);
  },
  on_date_change: (task, start, end) => save(task.id, start, end),
});

gantt.change_view_mode('Month');
```

ganttlane:

```ts
import '@ganttlane/dom/styles.css';
import { createGantt, type Link, type Task } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart');
if (!container) throw new Error('#chart not found');

const tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  {
    id: 'build',
    name: 'Build',
    start: '2026-03-09',
    end: '2026-03-20',
    className: 'bar-build',
  },
  { id: 'review', name: 'Review', start: '2026-03-23', end: '2026-03-25' },
  { id: 'launch', name: 'Launch', start: '2026-03-26', end: '2026-03-26' },
];
// `dependencies: 'design'` became links (or `dependencies: ['design']` on the task).
const links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'review' },
  { source: 'review', target: 'launch' },
];

const gantt = createGantt(container, {
  tasks,
  links,
  viewMode: 'week',
  locale: 'en',
  layout: { barHeight: 28, rowHeight: 48 }, // padding 20 became rowHeight = 28 + 20
  editing: { progress: false }, // readonly_progress
  timeline: { infinite: false }, // infinite_padding (off is the default now)
  scroll: { initial: 'start' }, // scroll_to, applied once
  calendar: { weekends: [] }, // upstream scheduled over weekends; the default here skips them
  tooltip: {
    trigger: 'hover', // popup_on
    render: ({ task }) => ({ title: task.name, details: `${task.progress}% done` }),
  },
  // Once per drop and per changed task; `end` is the last day, `endExclusive` the end of it.
  onTaskDatesChange: (record, { start, end }) => save(record.id, start, end),
});

gantt.setViewMode('month'); // change_view_mode

function save(id: string | number, start: Date, end: Date): void {
  console.log(id, start, end);
}
```

---

# Part 2: from the extended fork

The extended fork is a privately modified frappe-gantt 1.0.3 with options and behaviour that upstream
does not have. Almost all of it exists in ganttlane as a first-class feature, usually under a clearer
name. Read [Part 1](#part-1-from-frappe-gantt) for what is shared with upstream (constructor,
dates, granularity, issues, no mutation, CSS contract): this part is the fork's own vocabulary.

## Where each fork feature lives now

| Fork feature                                                    | In ganttlane                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `day_width`, a linear scale with real month lengths             | The time scale: `pxPerDay` per view mode                                                             |
| `dependencies` with `pinned_to`, offsets computed on the fly    | `links` with a type (`FS`, `SS`, `FF`, `SF`) and an optional `lag`                                   |
| Propagation to successors, `move_dependencies`                  | `scheduling.propagation`                                                                             |
| `parent`, `move_children`, `follows_parent`, `display_children` | `task.parentId`, `task.parentAnchor`, `task.followParent`, `hierarchy.*`                             |
| `ignored_days`, `holidays`, three durations                     | `calendar` (days off), `highlights` (visual), `TaskRecord.duration` (calendar, working, non-working) |
| `on_move_skip_ignored_days`, `on_resize_skip_ignored_days`      | `scheduling.skipNonWorkingDays`                                                                      |
| `infinite_padding`                                              | `timeline.infinite`, rewritten                                                                       |
| `readonly*`, `frozen`, `duration_as_constant`                   | `editing`, `task.locked`, `task.fixedDuration`, `task.editable`                                      |
| `popup`, `dependency_popup`, hover labels                       | `tooltip`, `linkMenu`, `highlightTooltip`                                                            |
| Creating and deleting a dependency from the UI                  | `editing.links`, `addLink`, `removeLink`, `onLinkCreate`, `onLinkDelete`                             |
| `scroll_to_*`, the auto-scroll near the edges                   | `scroll.*`, `scroll.autoScroll`                                                                      |
| Reading `_start`, `_actual_duration`, `bar.dependencies[]…`     | `TaskRecord`, `LinkRecord.lag`, `getBarRect`                                                         |

Two things the fork never offered are in the library: a **work calendar** you can use without a
chart (`createWorkCalendar` in `@ganttlane/core`: `isWorkingDay`, `addWorkingDays`, `countDays`,
`explain`), and **conflicts** on every record and `ChangeSet` (a bar on a day off, a child outside
its parent, a violated link), so warnings need no code of your own.

## Options by domain

Defaults in the "Fork default" column are the fork's. Where it differs from the new default the
note says so.

### View, scale and timeline

| Fork option                                                                 | Fork default | Now                                                                        | Notes                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `view_mode: 'Day'`                                                          | `'Day'`      | `viewMode: 'day'`                                                          | Lower-case ids: `hour`, `quarter-day`, `half-day`, `day`, `week`, `month`, `year`. `'Day'` falls back to `'day'` with an issue.                                                                                                                        |
| `view_modes[].name`                                                         |              | `viewModes[].id` + `label`                                                 |                                                                                                                                                                                                                                                        |
| `view_modes[].step: '1d'`                                                   |              | `unit: 'day', step: 1`                                                     | `'6h'` is `unit: 'hour', step: 6`.                                                                                                                                                                                                                     |
| `view_modes[].day_width`, option `day_width`                                |              | `viewModes[].pxPerDay`; `setOptions({ viewModes: { day: { pxPerDay } } })` | Per mode, not global. `zoomTo(pxPerDay)` zooms the current mode at run time.                                                                                                                                                                           |
| `view_modes[].upper_text`, `lower_text`                                     |              | `viewModes[].headers[]`                                                    | See [View modes](#view-modes); formats are `Intl` options or a function.                                                                                                                                                                               |
| `view_modes[].thick_line`                                                   |              | `viewModes[].majorLine`                                                    |                                                                                                                                                                                                                                                        |
| `view_modes[].snap_at`, option `snap_at`                                    | `null`       | `viewModes[].snap`, `scheduling.snap`                                      | `scheduling.snap.mode: 'relative'` is the fork's behaviour (a shift that is a whole number of steps, the original offset kept). The default is `'grid'` (snap to the calendar boundary of the step); the two differ only for tasks with a time of day. |
| `view_modes[].padding`                                                      |              | `viewModes[].padding`, `timeline.padding`                                  | Beware: the option `padding` is something else (below).                                                                                                                                                                                                |
| `view_modes[].date_format`, `date_format`, `upper_text_frequency`, `ignore` |              | removed                                                                    | They were not used.                                                                                                                                                                                                                                    |
| `language`                                                                  | `'en'`       | `locale`                                                                   | BCP 47. Texts of the chart are the `strings` option.                                                                                                                                                                                                   |
| `infinite_padding`                                                          | `true`       | `timeline.infinite`                                                        | **Off by default now.** Rewritten: it grows from any source of scrolling (wheel, scrollbar, keys, touch, drag autoscroll) without a jump or a full redraw, and `{ threshold, extendBy, bounds, maxSpan }` bound it.                                    |
| `scroll_to`                                                                 | `'today'`    | `scroll.initial`                                                           | `'today'`, `'start'`, `'end'`, `'first-task'`, `'none'` or a date; applied once, at creation. The fork's `'current'` did not scroll anywhere in practice; `'none'` is that.                                                                            |
| `scroll_to_behavior`                                                        | `'smooth'`   | `scroll.behavior`                                                          | Same default.                                                                                                                                                                                                                                          |
| `scroll_to_viewport_position`                                               | `0`          | `scroll.align`                                                             | A number from 0 to 1, or `'start'`, `'center'`, `'end'`.                                                                                                                                                                                               |

### Layout and display

| Fork option                                  | Fork default    | Now                                                        | Notes                                                                                                                                                      |
| -------------------------------------------- | --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bar_height`                                 | `30`            | `layout.barHeight`                                         |                                                                                                                                                            |
| `padding`                                    | `18`            | `layout.rowHeight`                                         | `rowHeight = barHeight + padding`; the default `48` is `30 + 18`.                                                                                          |
| `bar_corner_radius`                          | `3`             | `layout.barRadius`                                         |                                                                                                                                                            |
| `upper_header_height`, `lower_header_height` | `45`, `30`      | `layout.headerRowHeight: [45, 30]`                         | The header is exactly the sum of its rows: the fork's extra 10 px is gone, so a list aligned to the rows needs `getRowMetrics(id)` rather than a constant. |
| `container_height`                           | `'auto'`        | `layout.height`                                            | Left out, the chart fills its container. `'auto'` lets the page scroll. See [Height](packages/dom/README.md#height).                                       |
| `lines`                                      | `'both'`        | `display.gridLines`                                        |                                                                                                                                                            |
| `tick_width`, `thick_width`                  | `1`, `2`        | `--gantt-grid-line-width`, `--gantt-grid-major-line-width` | CSS custom properties.                                                                                                                                     |
| `arrow_width`, `arrow_selected_width`        | `1`, `2`        | `--gantt-link-width`, `--gantt-link-selected-width`        |                                                                                                                                                            |
| `arrow_hit_width`                            | `8`             | `--gantt-link-hit-width`                                   |                                                                                                                                                            |
| `arrow_curve`                                | `5`             | `display.linkCurveRadius`                                  |                                                                                                                                                            |
| `auto_move_label`                            | `false`         | `display.stickyBarLabels`                                  | **Not available yet** (reserved).                                                                                                                          |
| `show_expected_progress`                     | `false`         | `display.expectedProgress`                                 | **Not available yet** (reserved).                                                                                                                          |
| `children_row_color_inherit`                 | `true`          | `display.rowStripes: 'group'`                              | Off by default now (`false`). It works: the fork's option did not.                                                                                         |
| `display_ignored_days`, `ignored_days_mask`  | `true`, `true`  | `display.nonWorkingDays: 'fill' \| 'stripes' \| false`     | The mask maps to `'stripes'`; the new default is `'fill'`.                                                                                                 |
| `holidays` (visual)                          | weekends        | `highlights[]`                                             | See below.                                                                                                                                                 |
| `display_holidays`                           | `true`          | `display.highlights`                                       |                                                                                                                                                            |
| `holiday_label_follows_cursor`               | `false`         | `highlightTooltip.followCursor`                            |                                                                                                                                                            |
| `today_button`, `view_mode_select`           | `true`, `false` | `toolbar.todayButton`, `toolbar.viewModeSelect`            | **Not available yet** (reserved). Use `scrollToToday()` and `setViewMode(id)` from your own controls.                                                      |

### Calendar and highlights

The fork keyed two maps by CSS colour: `ignored_days` (days off that affect the schedule) and
`holidays` (a visual mark). The colour is presentation and is gone from the data:

| Fork                                                | Now                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ignored_days: { colour: 'weekend' }`               | `calendar.weekends: [0, 6]`                                                                                                      |
| `ignored_days: { colour: [dates, { date, name }] }` | `calendar.holidays: [date, { date, name }]`; the name shows on hover                                                             |
| `ignored_days: { colour: (date) => boolean }`       | `calendar.isWorkingDay(day)`: return `false` for a day off, `undefined` to go on (never `true` unless you mean a worked day off) |
| the colour keys                                     | `--gantt-nonworking-color` for days off, `highlights[].color` for a highlight                                                    |
| `holidays: { colour: … }`                           | `highlights[]`: `{ id, dates?, range?, match?, label?, className?, color? }`, visual only                                        |

**If the fork had no `'weekend'` entry, set `calendar.weekends: []`.** The default is `[0, 6]`, and in
the fork nothing was ignored unless you listed it. A rule written for `Date` objects ports like
this (`day` is a `CalendarDay`: `{ dayKey, date, weekday, year, month, day }`, `weekday` is 0 for
Sunday, `month` starts at 1):

```ts
createGantt(container, {
  tasks,
  calendar: {
    weekends: [], // the old rule below is the only one
    isWorkingDay: (day) =>
      new Date(day.year, day.month - 1, day.day).getDay() === 6 ? false : undefined,
  },
});
```

A change of calendar at run time (`setOptions({ calendar })`) recomputes every duration, which the
fork did not.

### Scheduling, links and hierarchy

| Fork option                            | Fork default         | Now                                                                             | Notes                                                                                                                                                                                 |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on_move_skip_ignored_days`            | `true`               | `scheduling.skipNonWorkingDays.move`                                            | Same default.                                                                                                                                                                         |
| `on_resize_skip_ignored_days`          | `false`              | `scheduling.skipNonWorkingDays.resize`                                          | Same default. `.progress` (default `true`) is the progress handle.                                                                                                                    |
| `move_dependencies`                    | `true`               | `scheduling.propagation`                                                        | `true` is `'preserve-lag'` (default), `false` is `'none'`.                                                                                                                            |
| `dependencies_default_pinned_to`       | `{ start: 'start' }` | `scheduling.defaultLinkType`                                                    | **The default changed from start-to-start to `'FS'`.** A link written without a type was `SS` in the fork, and is finish-to-start now: give the type, or set `defaultLinkType: 'SS'`. |
| `move_children`, `task.follows_parent` | `true`               | `hierarchy.moveChildren`                                                        | `'all'` is `move_children: true`. `'following'` is `move_children: false` (children with `followParent` still move). `'none'` is new: not even those.                                 |
| `children_default_pinned_to`           | `{ start: 'start' }` | `hierarchy.childAnchor`                                                         | A link type, not an object: the default is `'SS'`. See `pinned_to` below.                                                                                                             |
| `display_children`                     | `true`               | `hierarchy.expandedKeys` (and `expand`, `collapse`, `expandAll`, `collapseAll`) | `true` is `'all'` (default), `false` is `[]`, a list of ids is the same list.                                                                                                         |

`pinned_to` has one reading in the fork, "my edge X is tied to that edge Y", and it maps to a link
type:

| `pinned_to`                    | Link type                                             |
| ------------------------------ | ----------------------------------------------------- |
| `{ start: 'end' }`             | `FS`: finish-to-start                                 |
| `{ start: 'start' }`           | `SS`: start-to-start                                  |
| `{ end: 'end' }`               | `FF`: finish-to-finish                                |
| `{ end: 'start' }`             | `SF`: start-to-finish                                 |
| `{ start: 'end', end: 'end' }` | **two links**, `FS` and `FF`: the successor stretches |

This is the same table for a dependency (`links[].type`) and for a parent
(`task.parentAnchor`, a type or a list with at most one type for the start, `SS` or `FS`, and at
most one for the end, `FF` or `SF`: `['SS', 'FF']` makes the child stretch with its parent).

### Editing flags

| Fork option             | Fork default | Now                                       | Notes                                                                           |
| ----------------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `readonly`              | `false`      | `editing: false`                          | UI only: calls from code (`updateTask`, `addLink`, `removeLink`) still commit.  |
| `readonly_dates`        | `false`      | `editing: { move: false, resize: false }` |                                                                                 |
| `readonly_progress`     | `false`      | `editing: { progress: false }`            |                                                                                 |
| `readonly_dependencies` | not set      | `editing: { links: false }`               | Stops drawing and deleting links from the UI. Per task: `task.linkable: false`. |

### Tooltips and menus

| Fork option            | Fork default | Now                         | Notes                                                                                                                                                                                                         |
| ---------------------- | ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `popup`                | a function   | `tooltip.render`            | Returns text, a `Node`, `{ html }` or `{ title, subtitle, details, actions }`: see [Popups](#popups). The context is `{ task, preview, isDragging, gesture, parent, predecessors, successors, locale, api }`. |
| `popup_on`             | `'click'`    | `tooltip.trigger`           | `'hover'` (**the default now**), `'click'` or `'none'`.                                                                                                                                                       |
| `popup_follows_cursor` | `false`      | `tooltip.followCursor`      |                                                                                                                                                                                                               |
| `popup_show_on_drag`   | `false`      | `tooltip.showWhileDragging` | **Default `true` now.** The tooltip shows the previewed dates while dragging, and `render` is called when its inputs change, not on every mouse move.                                                         |
| `dependency_popup`     | a function   | `linkMenu.render`           | The default menu has a remove action when `editing.links` allows it; `linkMenu.onRemove` defaults to `removeLink`. Its context has `link`, `source`, `target`, `canRemove` and `remove()`.                    |

## Task fields

| Fork task field                                                                                      | Now                                                                                                                                  | Notes                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `description`, `start`, `end`                                                          | the same                                                                                                                             | `id` is not rewritten (the fork replaced spaces with `_`). A date-only `end` is inclusive, as in the fork. |
| `duration` (days)                                                                                    | `duration`                                                                                                                           | A number is days.                                                                                          |
| `duration_is_actual: true`                                                                           | `durationMode: 'working'`                                                                                                            | The duration counts working days. `scheduling.durationMode` sets the default for all tasks and lags.       |
| `duration_as_constant`                                                                               | `fixedDuration`                                                                                                                      | The length cannot change: no resize.                                                                       |
| `frozen`                                                                                             | `locked`                                                                                                                             | Not editable, and not moved by propagation. Links can still be drawn to it.                                |
| `progress`, `progress_fix_to_end`                                                                    | `progress`, `progressAnchor: 'end'`                                                                                                  | `'start'` is the default.                                                                                  |
| `dependencies: [{ id, pinned_to }]`                                                                  | `links: [{ source: id, target, type }]`, or `dependencies: [{ id, type }]`                                                           | See the `pinned_to` table.                                                                                 |
| `readonly_dependencies`                                                                              | `linkable: false`                                                                                                                    |                                                                                                            |
| `parent: { id, pinned_to }`                                                                          | `parentId`, `parentAnchor`                                                                                                           |                                                                                                            |
| `follows_parent`                                                                                     | `followParent`                                                                                                                       | Matters for `hierarchy.moveChildren: 'following'`.                                                         |
| `virtual`                                                                                            | `type: 'placeholder'`                                                                                                                | A row without a bar. The fork marked such a task `invalid`.                                                |
| `custom_class`                                                                                       | `className`                                                                                                                          | The fork's library did not read `classes` or `custom_row_class`: `className` and `rowClassName` work now.  |
| `custom_row_class`                                                                                   | `rowClassName`                                                                                                                       |                                                                                                            |
| `color`, `color_progress`                                                                            | `color`, `progressColor`                                                                                                             | The fork painted `color_progress` with `color` (a bug); here each does its own job.                        |
| `thumbnail`                                                                                          | no field                                                                                                                             | Draw it from `task.data` with `display.renderBarLabel` (`renderBarLabel` in React).                        |
| any extra field of your own on the task                                                              | `data`                                                                                                                               | Typed with the `TData` argument and returned in every record and event as `record.task.data`.              |
| `_start`, `_end`, `_duration`, `_actual_duration`, `_ignored_duration`, `_progress`, `_progress_end` | `TaskRecord`: `start`, `end`, `endExclusive`, `duration.calendarDays`, `.workingDays`, `.nonWorkingDays`, `progress`, `progressDate` | Read-only. They were written into your objects before; now they are on `getTask(id)` and in events.        |

New task fields: `type: 'milestone'`, `editable` (per-task `editing`), `rowClassName`,
`precision` (`'day'` or `'time'`).

## Events and methods

| Fork                                 | Now                                                            | Notes                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on_click(task)`                     | `onTaskClick(record, event)`                                   | Never after a drag.                                                                                                                                                                                  |
| `on_double_click(task)`              | `onTaskDoubleClick(record, event)`                             |                                                                                                                                                                                                      |
| `on_hover(task, x, y, e)`            | `onTaskHoverChange(record \| null, event)`                     | When the task under the pointer changes.                                                                                                                                                             |
| `on_date_change(task)`               | `onTasksChange(changeSet)`, `onTaskDatesChange(record, dates)` | One `ChangeSet` per action with **every** task touched, including successors and children, not the dragged task alone. Once, after the drop.                                                         |
| `on_progress_change(task, progress)` | `onTaskProgressChange(record, progress)`                       |                                                                                                                                                                                                      |
| `on_view_change(mode)`               | `onViewModeChange(viewMode)`                                   | Receives the `ViewMode` object, as the fork did (read its `id`). Not called when the chart is created.                                                                                               |
| `on_arrow_click(from, to, e)`        | `onLinkClick(linkRecord, event)`                               | The record has `source`, `target`, `type` and `lag` (`{ ms, days, mode, derived }`; `undefined` for a link that touches a row without a bar, see [Semantics that changed](#semantics-that-changed)). |
| `on_dependency_created(task, dep)`   | `onLinkCreate(link, id)`                                       | A controlled owner adds exactly this `link`. `onBeforeLinkCreate` can refuse it; a link that closes a cycle is always refused.                                                                       |
| `on_dependency_removed(task, dep)`   | `onLinkDelete(linkRecord)`                                     |                                                                                                                                                                                                      |

| Fork method                                | Now                                                           | Notes                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refresh(tasks)`                           | `setTasks(tasks)`                                             | Diffed by id.                                                                                                                                                                                                                                |
| `update_options(opts)`                     | `setOptions(patch)`                                           | Handlers (`on<Event>`) and the calendar can be changed after creation; nothing goes stale.                                                                                                                                                   |
| `update_task(id, details)`                 | `updateTask(id, { start?, end?, progress? })`                 | A promise of `{ status }`; dates propagate like a drag.                                                                                                                                                                                      |
| `change_view_mode(mode, maintain_pos)`     | `setViewMode(id, { keepScroll })`                             |                                                                                                                                                                                                                                              |
| `scroll_current(behavior, pos)`            | `scrollToToday({ behavior, align })`                          |                                                                                                                                                                                                                                              |
| `set_scroll_position(date, behavior, pos)` | `scrollToDate(date, { behavior, align })`, `scrollToTask(id)` | Both axes for a task.                                                                                                                                                                                                                        |
| `create_dependency`, `remove_dependency`   | `addLink(link)`, `removeLink(id)`                             | Promises of `{ status }`: `'created'` or `'deleted'`; `'rejected'` with a `reason` (`'invalid'`, `'unknown-task'`, `'duplicate'`, `'cycle'`, `'unknown-link'`); `'cancelled'` with a `reason` (`'hook'`, `'error'`, `'disposed'`); `'busy'`. |
| `get_task(id)`                             | `getTask(id)`                                                 | A `TaskRecord`.                                                                                                                                                                                                                              |
| `get_bar(id)`                              | `getBarRect(id)`, `getRowMetrics(id)`                         | Geometry in px; no SVG element.                                                                                                                                                                                                              |
| `unselect_all`                             | `clearSelection()`                                            |                                                                                                                                                                                                                                              |
| `hide_popup`, `hide_dependency_popup`      | `hideTooltip()`                                               | Closes whichever popover is open.                                                                                                                                                                                                            |
| none                                       | `edit.begin()`, `edit.commit()`, `edit.rollback()`            | A session for "edit, then Save or Cancel": changes apply as they happen and `rollback()` puts the data back, see [Recipes](#save-and-cancel-with-an-edit-session).                                                                           |
| none (`destroy` did not exist)             | `destroy()`                                                   |                                                                                                                                                                                                                                              |

## CSS variables and classes

The classes and `data-*` attributes are in [Part 1](#css). The fork's `--g-*` variables map as
follows:

| Fork                                                  | Now                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--g-bar-color`                                       | `--gantt-bar-color`                                                                          |
| `--g-progress-color`                                  | `task.progressColor`, or `--gantt-bar-progress-shade-color` and `--gantt-bar-progress-shade` |
| `--g-header-background`                               | `--gantt-header-background-color`                                                            |
| `--g-tick-color`, `--g-tick-color-thick`              | `--gantt-grid-line-color`, `--gantt-grid-major-line-color`                                   |
| `--g-arrow-color`, `--g-arrow-selected-color`         | `--gantt-link-color`, `--gantt-link-selected-color`                                          |
| `--g-handle-color`                                    | `--gantt-handle-color`                                                                       |
| `--g-today-highlight`                                 | `--gantt-today-color`                                                                        |
| `--g-weekend-highlight-color`                         | `--gantt-nonworking-color` (days off), `--gantt-highlight-color` (a highlight)               |
| `--g-highlight-color`                                 | `--gantt-highlight-color`                                                                    |
| `--g-row-color`, `--g-row-color-even`                 | `--gantt-row-stripe-color`, with `display.rowStripes` turned on                              |
| `--g-row-color-invalid`, `--g-row-color-invalid-even` | `--gantt-row-invalid-color`                                                                  |

The rest (`--g-border-color`, `--g-row-border-color`, `--g-text-dark`, `--g-text-muted`,
`--g-text-light`, `--g-bar-border`) have no one-to-one token: pick from
[Tokens](packages/dom/README.md#tokens) by job (`--gantt-border-color`, `--gantt-grid-line-color`,
`--gantt-foreground-color`, `--gantt-header-text-color`, `--gantt-bar-label-color`,
`--gantt-bar-label-outside-color`).

Classes the fork added map like upstream's, plus:

| Fork class                                         | Now                                                        |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `.handle.dependency`, `.handle.dependency.process` | `.gantt__link-handle[data-side]` (a circle beside the bar) |
| `.dependency-popup-wrapper`                        | `.gantt__popover[data-kind='link']`                        |
| `.actions`, `.action-btn`                          | `.gantt__popover-actions`, `.gantt__popover-action`        |

Do not select the fork's internal pattern id (`#diagonalHatch`): ids are per instance and private. The
striped look is `display.nonWorkingDays: 'stripes'`, and `!important` is no longer needed to beat the
library, because its CSS is in `@layer gantt`.

## Semantics that changed

- **Default link type.** The fork's undeclared dependency was `SS`; here a link without a `type` is
  `FS`. Set `scheduling.defaultLinkType: 'SS'` if your data relies on the old default, or write the
  type in each link.
- **Lag.** The fork never stored a lag: it measured the gap from the current positions, in working or
  calendar days. A link without a `lag` does the same, so converted data does not jump. Give a
  `lag` (a number of days, or `'4h'`, negative for a lead) when the gap is a rule: it is measured in
  the successor's `durationMode`, a move of the predecessor puts the successor exactly that far
  from it, and a gap smaller than the lag is reported as a `link-violated` conflict, also when the
  data is loaded. `getLink(id).lag` has `{ ms, days, mode, derived }`, except for a link that touches
  a row without a bar (a placeholder or an invalid task): such a link is kept as data, neither drawn
  nor scheduled (`getLink(id).active` is `false`), and its `lag` is `undefined` unless you gave one.
- **Propagation.** The fork was a rigid link, in both directions in time, run by recursion with no
  protection against a cycle. `'preserve-lag'` is the same model. A cycle is now refused when a
  user draws it and reported when it is in your data (such links draw, but never schedule), a
  `locked` task stops propagation, and the whole result is one `ChangeSet` that a before-hook can
  veto, rewrite or confirm.
- **`move_children` and `follows_parent`.** The fork's latest behaviour is the one implemented: with
  `moveChildren: 'all'` children that do not follow their parent shift by the parent's start
  offset whatever their `pinned_to`, and children with `followParent` move by their own anchor.
  `'following'` moves only the second kind.
- **Parent anchors are per edge.** `{ start: 'start', end: 'end' }` is `['SS', 'FF']`. Defaults:
  `hierarchy.childAnchor` is `'SS'`.
- **`locked` and `fixedDuration`.** `locked` is the fork's `frozen`; `fixedDuration` is
  `duration_as_constant`.
- **Three durations** are on every record: `duration.calendarDays`, `.workingDays` and
  `.nonWorkingDays` (and `ms` forms), for a task of whole days or of times.
- **The mutation contract is gone.** A save that read `_start`, `_end` and the links from the objects the
  fork wrote into must listen to `onTasksChange`, or use the edit session below.
- **Rows.** `virtual` rows, rows for tasks without dates and invalid rows keep their place and carry
  issues. A row has one height (`layout.rowHeight`), so a list beside the chart can read
  `getRowMetrics(id)` and `layout.headerRowHeight` instead of constants.
- **Weekends.** See the calendar above: set `weekends: []` if the fork ignored none.

## Recipes

### `pinned_to` to link types

```ts
import type { Link, LinkType, Task } from '@ganttlane/dom';

type Edge = 'start' | 'end';
interface Pin {
  start?: Edge;
  end?: Edge;
}

/** What the fork's `pinned_to` means as link types; `fallback` is your `dependencies_default_pinned_to`. */
function pinTypes(pin: Pin | undefined, fallback: Pin = { start: 'start' }): LinkType[] {
  const { start, end } = pin?.start === undefined && pin?.end === undefined ? fallback : pin;
  const types: LinkType[] = [];
  if (start !== undefined) types.push(start === 'end' ? 'FS' : 'SS');
  if (end !== undefined) types.push(end === 'end' ? 'FF' : 'SF');
  return types;
}

/** The fork's task shape, for the fields this recipe maps. */
interface ForkTask {
  id: string | number;
  name: string;
  start?: Date;
  end?: Date;
  duration?: number;
  progress?: number;
  dependencies?: { id: string | number; pinned_to?: Pin }[];
  parent?: { id: string | number; pinned_to?: Pin };
  follows_parent?: boolean;
  duration_is_actual?: boolean;
  duration_as_constant?: boolean;
  frozen?: boolean;
  virtual?: boolean;
  custom_class?: string;
  custom_row_class?: string;
  color?: string;
  color_progress?: string;
}

function fromForkTasks(old: readonly ForkTask[]): { tasks: Task[]; links: Link[] } {
  const links = old.flatMap((task) =>
    (task.dependencies ?? []).flatMap((dep) =>
      pinTypes(dep.pinned_to).map((type): Link => ({ source: dep.id, target: task.id, type })),
    ),
  );
  const tasks = old.map((task): Task => ({
    id: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    duration: task.duration,
    progress: task.progress,
    durationMode: task.duration_is_actual === true ? 'working' : undefined,
    fixedDuration: task.duration_as_constant,
    locked: task.frozen,
    type: task.virtual === true ? 'placeholder' : undefined,
    parentId: task.parent?.id,
    parentAnchor: task.parent === undefined ? undefined : pinTypes(task.parent.pinned_to),
    followParent: task.follows_parent,
    className: task.custom_class,
    rowClassName: task.custom_row_class,
    color: task.color,
    progressColor: task.color_progress,
  }));
  return { tasks, links };
}
```

`pinTypes(undefined)` gives the fork's default for a dependency (`SS`). If you set
`dependencies_default_pinned_to`, pass it as `fallback` (for the parent's default pass
`children_default_pinned_to`). Two links of the same pair with different types are fine: their ids
are `a:FS:b` and `a:FF:b`.

### Save and Cancel with an edit session

The fork had no way back from a change, so an "edit, then Save or Cancel" mode had to be built
outside it, as a draft in your own state and a reset. The chart has it built in, as an edit
session. A session does not hold changes back: between `begin()` and `commit()` or `rollback()`
every change is applied as it happens (`getTask()` shows it and `tasksChange` fires). What it adds
is a memory: `begin()` marks the data, `commit()` closes the session and returns the net difference
from it, and `rollback()` puts the marked data back. With `history: true`, undo and redo work
inside the session too.

```ts
import { toDate } from '@ganttlane/core';

// `gantt` is the chart from createGantt.
gantt.edit.begin(); // "Edit"

// ... the user drags bars, draws links ...

const saved = gantt.edit.commit(); // "Save"
if (saved.status === 'committed') {
  for (const change of saved.changes.changes) {
    // One entry per task, the net result: a task dragged out and back is not listed.
    console.log(change.id, toDate(change.after.start), toDate(change.after.endExclusive));
  }
  const { added, removed } = saved.changes.links; // links the session created and deleted
  console.log(added.length, removed.length);
}

// "Cancel": gantt.edit.rollback()
```

Keep `onDirtyChange` for an "unsaved changes" flag. With controlled data, a cancel arrives as
`onEditRollback` (the inverse of the session) for you to write into your state. See
[Changes, edit sessions and history](packages/core/README.md#changes-edit-sessions-and-history) and,
for React, [Edit mode: Save and Cancel](packages/react/README.md#edit-mode-save-and-cancel).

### The popup and the link menu

```ts
const gantt = createGantt(container, {
  tasks,
  links,
  tooltip: {
    trigger: 'hover',
    followCursor: true,
    showWhileDragging: true,
    render: ({ task, preview, predecessors, parent }) => {
      const shown = preview ?? task;
      return {
        title: task.name,
        subtitle: `${shown.start?.toDateString() ?? ''}, ${task.duration?.workingDays ?? 0} working days`,
        details: `${predecessors.length} predecessors${parent ? `, in ${parent.name}` : ''}`,
      };
    },
  },
  linkMenu: {
    // The default content is a menu with a remove action; this adds a confirmation.
    onRemove: (link) => {
      if (window.confirm('Remove this dependency?')) void gantt.removeLink(link.id);
    },
  },
});
```

`preview` is the previewed values during a drag, `predecessors` and `successors` are the links with
their lag, and `parent` is the parent's record. A link click opens the menu; `linkMenu.render` makes
it your own.

---

## Checklist

- [ ] Install `@ganttlane/dom` or `@ganttlane/react`, and import `styles.css` once, before the chart
      is created.
- [ ] Give the container a height (or set `layout.height`), keep it empty, and call `destroy()` when
      the chart goes away.
- [ ] Replace the constructor with `createGantt(container, options)`; `tasks` and `links` are options.
- [ ] Convert tasks: `id`, `parentId` and link ends of the same type; `dependencies` as an array or
      `links`; durations with `mo` for months; `custom_class` to `className`; no `thumbnail` or
      `invalid`.
- [ ] Take every old option through the tables and delete the old keys: unknown keys are ignored
      silently. Then check that `gantt.getIssues().options` is empty.
- [ ] View modes: lower-case ids (`'week'`, not `'Week'`), `pxPerDay` for your zoom, `headers` for
      custom labels.
- [ ] Calendar: decide the weekends (`calendar.weekends`, `[]` for none), holidays, `durationMode`, and
      which days are only `highlights`.
- [ ] Sub-day times: set `scheduling.granularity` (and an hour view mode).
- [ ] Decide who owns the data: uncontrolled (the default) or `dataMode: 'controlled'` with `patchTasks`.
- [ ] Rewire events: `onTasksChange` or `onTaskDatesChange` instead of `on_date_change`, and
      `onBeforeTaskChange` where you need a confirmation. Stop reading `_start` and friends: use
      `getTask(id)`.
- [ ] Move popups to `tooltip.render` and `linkMenu.render`: text, a `Node`, `{ html }` or sections,
      and `null` for nothing.
- [ ] Port CSS: `.gantt__*` selectors, `--gantt-*` tokens, no `!important`.
- [ ] Wire `onIssues` (or read `getIssues()`) in development: nothing is logged to the console.
- [ ] Set `scroll.initial` for plans far from today (`'first-task'`), and `timeline.infinite` if users
      scroll past the data.
- [ ] Decide on `editing.links` (on by default) and `scheduling.propagation`, then test dragging near
      a weekend and along a link.
- [ ] Fork only: `defaultLinkType` (`SS` before), `pinned_to` as link types and anchors,
      `moveChildren`, `skipNonWorkingDays`, `display.nonWorkingDays`, and the Save and Cancel flow
      through `gantt.edit`.

## What is not available yet

Planned for a later release, so the old feature has no replacement today (**P1** means planned for
1.0; the complete lists are in "Limits and roadmap" in the READMEs of
[`@ganttlane/core`](packages/core/README.md#limits-and-roadmap),
[`@ganttlane/dom`](packages/dom/README.md#limits-and-roadmap) and
[`@ganttlane/react`](packages/react/README.md#limits-and-roadmap)):

- **A migration adapter.** A `fromFrappeGanttOptions` adapter is planned for a later release and is
  **not shipped now**: convert your options by hand with this guide (the converters above help with
  tasks). Dev-time hints for old option names and an exported validation schema
  (`@ganttlane/core/schema`) are P1 as well, so unknown keys are ignored silently today. No adapter
  for the extended fork's options is planned yet.
- **The toolbar.** `today_button`, `view_mode_select` and zoom buttons: the `toolbar` options are
  reserved. Use `scrollToToday()`, `setViewMode(id)` and `zoomTo(pxPerDay)` from your own controls.
- **Sticky bar labels and the expected-progress marker** (`auto_move_label`, `show_expected_progress`):
  the options are reserved (P1).
- **A left-hand task list.** Line your own list up with the rows through `getRowMetrics(id)`. The fork's
  "adjust" button (back to the bars) is not there either: `getVisibleRange()` and `scrollToTask(id)`
  are the pieces to build one.
- **Selecting bars by clicking, keyboard editing, ARIA roles on bars, a context menu, pinch and
  `Ctrl` + wheel zoom** (`zoomTo()` zooms from code), undo and redo hotkeys (P1).
- **`on_date_click` and `hover_on_date`.** There is no date-click event.
- **Right-to-left charts** and week-start and weekend defaults from the locale (`calendar.weekends` is
  explicit) (P1).
- **The `'push-forward'` propagation policy** (P1): it is reported as `unsupported-option` and behaves
  as `'preserve-lag'`.
- **A selector as the container** (it throws a `TypeError`), and a closed shadow root.
- **Time zones and offsets.** Time is floating wall-clock time (zoned dates are P2). Working hours and
  shifts, per-task calendars, baselines, a critical path and rollup of parent dates are P2.
- **React:** compound components, headless hooks as a public API and a `TaskList` component (P1).

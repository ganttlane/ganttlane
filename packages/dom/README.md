# @ganttlane/dom

An interactive gantt chart for the browser: a vanilla DOM renderer and a default CSS theme on top of
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md). `createGantt(container, options)` draws the chart, handles
pointer, touch, keyboard and scroll input, and returns an object with methods and events. It needs
no framework (it is what [`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md) wraps), ships a stylesheet you can
use as it is, re-theme with CSS custom properties, or replace entirely, and draws only what is on
screen, so plans of thousands of tasks stay smooth.

> **Status:** pre-release (`0.0.0`), not published to npm yet. The API may still change before
> `0.1.0`. Until then, clone the repository and run `pnpm dev` for the playground.

Coming from frappe-gantt, or from a modified fork of it? See the [migration guide](https://github.com/ganttlane/ganttlane/blob/main/MIGRATION.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Options](#options)
  - [Renderer options](#renderer-options)
- [Events](#events)
- [Methods](#methods)
- [Issues](#issues)
- [Tooltips, the link menu and day labels](#tooltips-the-link-menu-and-day-labels)
- [Locale and strings](#locale-and-strings)
- [Theme](#theme)
  - [Themes](#themes)
  - [Re-theming](#re-theming)
  - [Per-element colours](#per-element-colours)
  - [Tokens](#tokens)
  - [CSS support](#css-support)
- [Unstyled contract](#unstyled-contract)
- [Behaviour](#behaviour)
  - [Pointer input](#pointer-input)
  - [Scrolling](#scrolling), [initial scroll and `scrollTo*`](#initial-scroll-and-scrollto), [height](#height)
  - [Performance](#performance)
- [Bindings and building blocks](#bindings-and-building-blocks)
- [Accessibility](#accessibility)
- [Browser support](#browser-support)
- [Size](#size)
- [Limits and roadmap](#limits-and-roadmap)
- [Examples](#examples)

## Install

```sh
pnpm add @ganttlane/dom
```

- `@ganttlane/dom` depends on [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md), so this one install is enough to
  draw a chart. ESM only, with TypeScript declarations; TypeScript must resolve package `exports`
  (`moduleResolution` of `bundler`, `node16` or `nodenext`).
- **Strict pnpm** lets you import only what your own `package.json` lists. The **types** of the
  core that a signature of this package names, however deep (`Task`, `Link`, `TaskRecord`,
  `ChangeSet`, `Issue`, `GanttCore`, `GanttEventMap`, and the results of `updateTask`, `addLink`,
  `removeLink` and `undo`, the payloads of the events, the option groups, the before-hooks, …)
  are re-exported by this package, types only, so
  `import type { Task, ChangeSet, LinkCreateResult } from '@ganttlane/dom'` works. **Runtime** values of the core are
  not: add `@ganttlane/core` (the same version) to import `patchTasks` (controlled data),
  `createGanttCore` (a core of your own for `mountRenderer`) or the building blocks.
- **The stylesheet is a separate file**, `@ganttlane/dom/styles.css`. The JavaScript never imports
  it, so bundlers, CSS-in-JS setups and plain `<link>` tags all work. Import it once per page. With
  TypeScript 6, which checks side-effect imports (`noUncheckedSideEffectImports` is on by default),
  `import '@ganttlane/dom/styles.css'` type-checks as it is: the subpath ships an (empty) declaration
  file. The CSS is in `@layer gantt`, so any style of your own wins without `!important`.
- Have the stylesheet **in effect before you mount**: the chart measures its container when it is
  created, and a stylesheet that is still loading (WebKit may run a module script first) gives it the
  unstyled layout to measure. A position the chart could not take for that reason is taken again
  when the scroller is resized, but a date aligned to the middle of the viewport (`align`) was
  centred on the unstyled width.

## Quick start

```html
<div id="chart" style="height: 420px"></div>
```

```ts
import '@ganttlane/dom/styles.css';
import { createGantt } from '@ganttlane/dom';

// What `task.data` holds: it is the type of `record.task.data` in every event and render function.
interface Meta {
  owner: string;
}

const container = document.querySelector<HTMLElement>('#chart');
if (!container) throw new Error('#chart not found');

const gantt = createGantt<Meta>(container, {
  tasks: [
    {
      id: 'design',
      name: 'Design',
      start: '2026-03-02',
      end: '2026-03-06',
      progress: 60,
      data: { owner: 'Ann' },
    },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  ],
  links: [{ source: 'design', target: 'build' }],
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  theme: 'auto',
  tooltip: { delay: 300 },
  onTasksChange: (changeSet) => {
    console.log(changeSet.reason, changeSet.changes.length);
  },
});

// Later, without recreating the chart: options, view, scrolling, data, events.
gantt.setOptions({ theme: 'dark', locale: 'uk' });
gantt.setViewMode('month');
gantt.scrollToTask('build');
const off = gantt.on('taskClick', (record) => {
  console.log(record.task.data?.owner);
});

// The edit session ("Edit mode: Save / Cancel"). Changes are applied as they happen (`getTask()`
// shows them, `tasksChange` fires); `rollback()` puts back the data that `begin()` found.
gantt.edit.begin();
// ... the user drags bars ...
gantt.edit.getChanges(); // the net difference from the data at `begin()`
gantt.edit.commit(); // closes the session and returns that difference; or gantt.edit.rollback()

// Removes every node, listener, observer and timer the chart added, then destroys its core.
// Safe to call twice.
off();
gantt.destroy();
```

- **The container needs a height**: the chart fills it and scrolls inside it. Or give the chart its
  own with `layout.height`: a number of px, or `'auto'` to let it grow with its rows and the page
  scroll it (see [Height](#height)). The container should be empty; the chart adds one `div.gantt` to
  it and removes it on `destroy()`.
- **The container is an element.** `createGantt` throws a `TypeError` when `container` is not an
  element (a selector string, `null`, `undefined`); nothing else throws. A bad option or bad data is
  an [issue](#issues) and its default is used. (An error that one of your own handlers throws is
  reported as [Events](#events) describes.)
- **It needs a DOM.** `createGantt` measures and draws into the element, so it is for the browser.
  On a server import types only (`import type { Task } from '@ganttlane/dom'`), or use
  [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md), which has no DOM. `@ganttlane/react` renders its container
  on a server and draws the chart after hydration.
- **Open on your plan.** `scroll.initial` is `'today'` by default. A plan in the past or the future
  then opens at the nearest end of its range; use `'first-task'` or `'start'` for fixed dates.
- **Your options, tasks and links are never mutated**, and a value that cannot be used never throws:
  it is an [issue](#issues) and its default is used.

More complete, runnable examples (basic, controlled data, an edit session with Save and Cancel,
working days at hourly granularity, a custom tooltip, a release plan; each in vanilla and in React)
are in [`examples/`](https://github.com/ganttlane/ganttlane/tree/main/examples), one folder each, and run live, next to their code, on the
[documentation site](https://ganttlane.github.io/ganttlane/examples/); the playground (`pnpm dev`, see
[the root README](https://github.com/ganttlane/ganttlane/blob/main/README.md#the-playground)) is the demo of everything.

## Concepts

The data model, the scheduling rules and the edit flow are the core's. This is the short version;
the details are in [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#concepts).

- **Tasks and links.** A task has an `id`, a `name`, a `start` and an `end` (or a `duration`); a
  link joins a `source` to a `target` with a type (`FS`, `SS`, `FF`, `SF`) and a lag. Tasks nest
  through `parentId`, and a child can be pinned to its parent's edges. The chart never changes
  your objects: the computed form of a task is a `TaskRecord` (`gantt.getTask(id)`, or the argument
  of an event) with `Date`s, lengths, working days, progress, `issues` and `conflicts`.
- **Dates are floating wall-clock time.** `'2026-03-02'` is a day (its end is inclusive: the last day),
  `'2026-03-02T09:30'` a moment. There are no time zones, and strings with `Z` or an offset are
  rejected. A `Date` is read through the local clock.
- **Granularity and alignment.** `scheduling.granularity` (default `'1d'`) is the data step: every
  date, duration and lag is a multiple of it. For planning inside a day set `'1h'`, `'30min'`, …
  Input off the step is reported (`misaligned`) and aligned by `scheduling.alignInput`.
- **Work calendar.** `calendar` (`weekends`, `holidays`, `workingDays`, `isWorkingDay`) decides which
  days work; `durationMode: 'working'` counts durations in working time, and drags land on working
  days (`scheduling.skipNonWorkingDays`).
- **Propagation.** An edit moves the tasks linked to it, and the children pinned to it, keeping their
  lags (`scheduling.propagation`). The result is one `ChangeSet` with every task touched, and its
  `conflicts` (a bar on a day off, a child outside its parent, a violated link).
- **Controlled and uncontrolled data.** By default the chart owns the tasks: a drag changes them and
  `onTasksChange` tells you. With `dataMode: 'controlled'` you own them: every committed change is
  reported, shown as a draft, and applied when you pass the new tasks back with `setTasks`;
  `patchTasks(tasks, changeSet, gantt.core.getSnapshot().state.derived.model)` from
  `@ganttlane/core` writes a change set into your own tasks in their own shape (a short
  [example](https://github.com/ganttlane/ganttlane/tree/main/examples/controlled-data) has the whole loop). With React the `tasks` /
  `defaultTasks` props make the choice, see
  [`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md#controlled-and-uncontrolled).
- **Edit sessions and history.** `gantt.edit.begin()`, `commit()` and `rollback()` are the
  "Edit, Save, Cancel" flow. A session does not hold changes back: they are applied as they happen
  (`getTask()` shows them, `tasksChange` fires). `begin()` remembers the data, `edit.getChanges()` is
  the net difference from it, `commit()` closes the session and returns that difference, and
  `rollback()` puts the remembered data back. Undo and redo need `history: true`: then `undo()` and
  `redo()` step through one entry per action, inside a session too. A before-hook,
  `onBeforeTaskChange`, can cancel or rewrite a change, also after asking the user.
- **Issues.** Bad options and bad data are reported, repaired and never thrown. See
  [Issues](#issues).

## Options

`createGantt(container, options)` takes one flat object: the core's options and the renderer's.
`gantt.setOptions(patch)` changes any of them later without recreating the chart.

| Option                                                                       | Goes to      | What it is                                                                                          |
| ---------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `tasks`, `links`, `dataMode`, `dates`, `calendar`, `scheduling`, `hierarchy` | the core     | The data and the rules that schedule it                                                             |
| `viewMode`, `viewModes`, `locale`, `now`, `timeline`, `scroll`, `direction`  | the core     | The view: scale, range, scrolling                                                                   |
| `layout` (but `height`), `editing`, `history`, `interaction`                 | the core     | Sizes, editing from the UI, undo, gestures                                                          |
| `on<Event>`, `onBeforeTaskChange`, `onBeforeLinkCreate`                      | the core     | One handler per event (see [Events](#events)); `gantt.on` adds more                                 |
| `onIssues`                                                                   | the chart    | Problems with the data and the options, the renderer's included (see [Issues](#issues)); a function |
| `theme`                                                                      | the renderer | `'auto'` (default), `'light'` or `'dark'` (see [Themes](#themes))                                   |
| `strings`                                                                    | the renderer | The words of the chart (see [Locale and strings](#locale-and-strings))                              |
| `layout.height`                                                              | the renderer | `'auto'`, a number of px, or the container's (see [Height](#height))                                |
| `display`, `highlights`, `tooltip`, `linkMenu`, `highlightTooltip`           | the renderer | Grid lines, today line, non-working days, bar labels, … and popovers (see below)                    |
| `toolbar`, `direction: 'rtl'`                                                | nobody yet   | Planned for P1: accepted and reported as `unsupported-option`                                       |
| `renderer: { idPrefix, layers, frames }`                                     | the renderer | How the renderer is mounted (stable ids, replacement layers, a frame source); at creation only      |

The **core's options** (the first four rows) are listed with their types and defaults in
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#options): `tasks`, `links`, `dataMode`, `dates.endInclusive`,
`calendar.*`, `scheduling.*` (granularity, alignment, snap, propagation, durations),
`hierarchy.*`, `viewMode` / `viewModes`, `locale`, `now`, `timeline.*` (range, padding, infinite
timeline), `scroll.*` (initial position, behaviour, alignment, drag autoscroll), `layout.*` (row,
bar and header sizes), `editing`, `history` and `interaction.*`.

`editing` switches editing **from the UI** on and off, in whole (`false` is a view-only chart: no
drag, resize, progress change or link drawing) or by kind (`{ move, resize, progress, links }`), and
`task.editable` overrides it per task. It does not stop your own calls: `updateTask`, `addLink`,
`removeLink` and `setTasks` still commit. `history` is off until you set `history: true` (or
`{ limit }`, default 100): it records one entry per action for `undo()` and `redo()`.

Defaults: `locale` is `'en'`, not the browser's, so that a server and a browser draw the same text;
`theme` is `'auto'`; `scroll.initial` is `'today'`; `timeline.infinite` is off. Keys nobody knows are
ignored, your options, tasks and links are never mutated, and a value that cannot be used never
throws: it is an issue, and its default is used.

**`TData`** is the type of `task.data`. It flows through `tasks`, the records of every event and
query, and the context of `tooltip.render`, `linkMenu.render` and `display.renderBarLabel`; without a
type argument it is inferred from `tasks`.

### Renderer options

| Option                         | Type / values                                                            | Default                                                                            | Meaning                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `theme`                        | `'auto'` \| `'light'` \| `'dark'`                                        | `'auto'`                                                                           | The `data-theme` of the chart; changes at runtime without a redraw                                                     |
| `strings`                      | partial `GanttStrings`                                                   | English                                                                            | Every text the chart writes itself: [Locale and strings](#locale-and-strings)                                          |
| `layout.height`                | `number` \| `'auto'`                                                     | the container's                                                                    | [Height](#height): a number of px, or as tall as the rows with the page scrolling                                      |
| `display.gridLines`            | `'both'` \| `'vertical'` \| `'horizontal'` \| `'none'`                   | `'both'`                                                                           | Which grid lines the body draws                                                                                        |
| `display.today`                | `boolean`                                                                | `true`                                                                             | The today line, and its marker and highlighted cell in the header                                                      |
| `display.nonWorkingDays`       | `'fill'` \| `'stripes'` \| `false`                                       | `'fill'`                                                                           | How days off (weekends, holidays) are shown                                                                            |
| `display.highlights`           | `boolean`                                                                | `true`                                                                             | Whether the `highlights` below are drawn                                                                               |
| `display.rowStripes`           | `'row'` \| `'group'` \| `false`                                          | `false`                                                                            | Zebra rows, per row or per group (a parent with its children)                                                          |
| `display.barLabel`             | `'auto'` \| `'inside'` \| `'outside'` \| `'none'`                        | `'auto'`                                                                           | Where the label goes; `'auto'` puts it inside when it fits, else outside                                               |
| `display.renderBarLabel`       | `(context) => Node \| DisposableNode \| string \| null`                  | the name                                                                           | Custom label content: [Tooltips](#tooltips-the-link-menu-and-day-labels) has the node rules                            |
| `display.headerRangeHighlight` | `boolean`                                                                | `true`                                                                             | Highlights the hovered bar's range in the header                                                                       |
| `display.linkCurveRadius`      | `number` (px)                                                            | `5`                                                                                | The largest corner radius of an arrow                                                                                  |
| `display.stickyBarLabels`      | `boolean`                                                                | `false`                                                                            | Reserved (P1): `true` is an `unsupported-option` and draws as off                                                      |
| `display.expectedProgress`     | `boolean`                                                                | `false`                                                                            | Reserved (P1): the same                                                                                                |
| `highlights`                   | `{ id, dates?, range?, match?, label?, className?, color? }[]`           | none                                                                               | Highlighted days, visual only: they change no schedule (details below)                                                 |
| `tooltip`                      | `{ trigger, followCursor, showWhileDragging, render, delay, placement }` | `'hover'`, `false`, `true`, built in, `150`, `'top'` (field by field; named below) | The task tooltip: [Tooltips](#tooltips-the-link-menu-and-day-labels)                                                   |
| `linkMenu`                     | `{ render, onRemove }`                                                   | a remove action; `onRemove` is `removeLink`                                        | The menu a click on an arrow opens                                                                                     |
| `highlightTooltip`             | `{ followCursor }`                                                       | `{ followCursor: false }`                                                          | The label of a highlighted day or a holiday                                                                            |
| `toolbar`                      | `false` \| `{ todayButton, viewModeSelect, zoom }`                       | `false`                                                                            | Reserved (P1): enabling it is an `unsupported-option`; draws nothing                                                   |
| `renderer.idPrefix`            | `string`                                                                 | `gantt-1`, `gantt-2`, …                                                            | Prefix of every element id and the id of the root; give your own for ids that repeat across renders (server rendering) |
| `renderer.layers`              | `{ [name]: factory }`                                                    | built in                                                                           | Replaces built-in layers by name (advanced: custom renderers and tests)                                                |
| `renderer.frames`              | `{ request, cancel }`                                                    | `requestAnimationFrame`                                                            | Where frames come from; mainly for tests                                                                               |

A **highlight** marks days without touching any schedule: `dates` are single days, `range` is
`{ start, end }` with both ends inclusive, `match` is a predicate of a calendar day (`{ dayKey, date, weekday, year, month, day }`),
and they may be combined; `label` (text, or a function of the day) shows when the day is hovered,
`className` is added to the highlight's nodes and `color` sets `--gantt-highlight-color` on them. A
holiday of the work calendar shows its name the same way.

`display` is merged field by field with what was set before, and `undefined` puts a field back to
its default; the popover groups `tooltip`, `linkMenu` and `highlightTooltip` and the list
`highlights` are taken whole (see `setOptions` under [Methods](#methods)).

## Events

Every event has an `on<Event>` option and a listener added with `gantt.on(name, handler)`, which
returns a function that removes it; both take the same arguments. Payloads that carry a task are the
`TaskRecord` (with `Date`s); a `ChangeSet` carries the core's floating numbers so it can be handed
back to the core and to `patchTasks`.

| Event                | Arguments                                         | When                                                                                                         |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tasksChange`        | `(changeSet)`                                     | A change committed: one per action, with every task it touched. Also undo and redo                           |
| `taskDatesChange`    | `(record, { start, end, endExclusive })`          | A convenience after `tasksChange`, per task whose dates changed                                              |
| `taskProgressChange` | `(record, progress)`                              | The same for progress                                                                                        |
| `linkCreate`         | `(link, id)`                                      | A link was created (the id may be `…#2` if the default one was taken)                                        |
| `linkDelete`         | `(linkRecord)`                                    | A link was deleted                                                                                           |
| `linkClick`          | `(linkRecord, event)`                             | An arrow was clicked; it is now the selected link and its menu opens                                         |
| `taskClick`          | `(record, event)`                                 | A bar was clicked (never after a drag)                                                                       |
| `taskDoubleClick`    | `(record, event)`                                 | A bar was double-clicked                                                                                     |
| `taskHoverChange`    | `(record \| null, event)`                         | The task under the pointer changed                                                                           |
| `selectionChange`    | `(selectedKeys, selectedLink)`                    | The selected tasks (by `select()`) or link (by a click) changed                                              |
| `viewModeChange`     | `(viewMode)`                                      | The view mode changed                                                                                        |
| `rangeChange`        | `({ start, end, reason })`                        | The timeline range changed: for lazy loading by date. Also once at start (`'initial'`)                       |
| `expandedChange`     | `(expandedKeys)`                                  | `expand`, `collapse`, `expandAll` or `collapseAll` changed the expanded parents                              |
| `scroll`             | `({ x, y, date })`                                | The chart scrolled (and once at start); `date` is at the left edge of the viewport                           |
| `editRollback`       | `(sessionChanges)`                                | A session was cancelled: the inverse for controlled data to apply                                            |
| `dirtyChange`        | `({ isDirty })`                                   | `edit.isDirty` flipped                                                                                       |
| `historyChange`      | `({ canUndo, canRedo })`                          | What undo and redo can do changed                                                                            |
| `editRefused`        | `({ gesture, id, target?, reason, at })`          | A drag or a link was refused: `'busy'`, `'permission'`, `'unknown-task'`, `'self'`, `'cycle'`, `'duplicate'` |
| `issues`             | `({ source, issues })`                            | The issues of the data or the options changed (see [Issues](#issues))                                        |
| `error`              | `({ error, source: 'listener' \| 'hook', name })` | A listener or a before-hook threw                                                                            |

The option names are `onTasksChange`, `onTaskDatesChange`, `onTaskProgressChange`, `onLinkCreate`,
`onLinkDelete`, `onLinkClick`, `onTaskClick`, `onTaskDoubleClick`, `onTaskHoverChange`,
`onSelectionChange`, `onViewModeChange`, `onRangeChange`, `onExpandedChange`, `onScroll`,
`onEditRollback`, `onDirtyChange`, `onHistoryChange`, `onEditRefused`, `onIssues` and `onError`.

Two before-hooks are options only. `onBeforeTaskChange({ changeSet, reason, conflicts })` runs before
a change is committed (a drag, `updateTask`): return `false` to cancel it, a `ChangeSet` to
replace it (it is re-validated and re-aligned), or nothing (or `true`) to let it pass; it may be
async, for a confirmation (a function that returns `Promise<boolean | void>` is a hook).
`onBeforeLinkCreate({ link, id, wouldCreateCycle })` returns `false` to
refuse a link; a link that would close a cycle is refused whatever it answers. A hook that throws or
rejects cancels the change and reports to `error`. Rolling back an edit session and stepping through
the history never ask the hooks.

A handler that throws does not break the others or the chart: the error goes to `onError` when you
have one, and otherwise to the host's unhandled-rejection channel (the console, your error
tracker).

## Methods

All of them are on the object `createGantt` returns and need no `this`. After `destroy()` the
commands (everything but the queries and `core`) do nothing, and the queries (`getTask`, `getLink`,
`getVisibleRange`, `getRowMetrics`, `getBarRect`, `getIssues`, `canUndo`, `canRedo`) keep answering
from the state the chart had when it was destroyed, so that a clean-up can read what the user left
behind.

| Group        | Methods                                                                                                                      | Returns                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data         | `setTasks(tasks)`, `setLinks(links)`                                                                                         | nothing                                                                                                                                                                                                             |
|              | `updateTask(id, { start?, end?, progress? })`                                                                                | a promise of `{ status }`: `'committed'` (with `changeSet`), `'unchanged'`, `'rejected'` (`reason` `'unknown-task'` or `'invalid-value'`), `'cancelled'` (`reason` `'hook'`, `'error'` or `'disposed'`) or `'busy'` |
|              | `addLink(link)`, `removeLink(id)`                                                                                            | a promise of `{ status: 'created' \| 'deleted' }`, `{ status: 'rejected', reason }`, `{ status: 'cancelled', reason: 'hook' \| 'error' \| 'disposed' }` or `{ status: 'busy' }`                                     |
| Options      | `setOptions(patch)`                                                                                                          | the issues of the options now in use                                                                                                                                                                                |
| View         | `setViewMode(id, { keepScroll })`, `zoomTo(pxPerDay, { anchor })`                                                            | nothing                                                                                                                                                                                                             |
| Scrolling    | `scrollToDate(date, { align, behavior })`, `scrollToToday(options)`, `scrollToTask(id, { align, alignY, behavior, expand })` | nothing                                                                                                                                                                                                             |
| Rows         | `expand(id)`, `collapse(id)`, `expandAll()`, `collapseAll()`                                                                 | nothing                                                                                                                                                                                                             |
| Selection    | `select(ids)`, `selectLink(id)`, `clearSelection()`                                                                          | nothing                                                                                                                                                                                                             |
| Queries      | `getTask(id)`, `getLink(id)`, `getVisibleRange()`, `getRowMetrics(id)`, `getBarRect(id)`, `getIssues()`                      | a `TaskRecord`, a `LinkRecord`, `{ start, end }`, row metrics, bar geometry (in body px, a drag in progress included), `{ data, options }`                                                                          |
| Popovers     | `hideTooltip()`                                                                                                              | nothing                                                                                                                                                                                                             |
| Edit session | `edit.begin()`, `edit.commit()`, `edit.rollback()`, `edit.getChanges()`, `edit.isOpen`, `edit.isDirty`                       | `{ status }` (synchronous): `'begun'` or `'already-open'`; `'committed'` or `'rolled-back'` (with `changes`); `'no-session'`, `'busy'` or `'cancelled'`. The session's `SessionChanges`, booleans                   |
| History      | `undo()`, `redo()`, `canUndo`, `canRedo` (need `history: true`)                                                              | `{ status }`: `'undone'` or `'redone'` (with the `entry`), `'empty'`, `'stale'`, `'busy'` or `'cancelled'`                                                                                                          |
| Events       | `on(event, handler)`                                                                                                         | a function that removes the listener                                                                                                                                                                                |
| Life cycle   | `destroy()`; `core`                                                                                                          | `core` is the chart's `GanttCore`, for what the facade leaves out                                                                                                                                                   |

- **The view methods return nothing.** `setViewMode`, `zoomTo` and the `scrollTo*` methods make
  the chart scroll in its next frame; the request that the core makes for the renderer is not
  yours to apply (`gantt.core.scrollToTask(…)` returns it, and the renderer still applies it).
  `scrollToTask` scrolls both axes and expands the collapsed parents of a hidden row unless
  `expand: false`. A `scrollTo*` made before the chart has a width is not lost: it replaces
  `scroll.initial` when the chart gets one.
- **`updateTask(id, { start, end, progress })`** is a change from code. It propagates exactly like
  the drag it stands for (`start` alone moves the task, `end` alone moves its end edge, both set
  both) and runs `onBeforeTaskChange` with `reason: 'api'`. Values are exact (no snapping to the
  view mode and no rolling onto working days), and a value off the granularity follows
  `scheduling.alignInput`. A locked task is `'unchanged'`; an unknown task or an end that is not
  after the start is `'rejected'` (`reason` `'unknown-task'` or `'invalid-value'`, with `issues`); a
  before-hook that answers `false` makes it `'cancelled'` with `reason: 'hook'`, one that throws,
  rejects or answers something else with `reason: 'error'`; while a controlled change waits for your
  `setTasks` the chart is busy and the answer is `'busy'`. After `destroy()` it resolves
  `{ status: 'cancelled', reason: 'disposed' }`.
- **`addLink` and `removeLink`** check the link first (shape, type, lag), then that both tasks exist,
  that it is not a duplicate and that it closes no cycle, and run `onBeforeLinkCreate` for a new
  one. A refusal is `{ status: 'rejected', reason }` with `reason` `'invalid'`, `'unknown-task'`,
  `'duplicate'`, `'cycle'` or, for `removeLink` with an id that is no link, `'unknown-link'`. Two
  more answers: `{ status: 'cancelled', reason }`, where `reason` is `'hook'` (`onBeforeLinkCreate`
  answered `false`), `'error'` (it threw, rejected or answered something else than a boolean) or
  `'disposed'` (the chart was destroyed, the only way `removeLink` is cancelled), and
  `{ status: 'busy' }` while another change waits for a hook or, with controlled data, for your
  `setTasks`.
- **`editing` does not apply to calls from code.** `editing: false` turns off editing from the UI
  (drags, link drawing, the menu's remove action), so a read-only chart cannot be edited by its
  user; `updateTask`, `addLink`, `removeLink` and `setTasks` still commit. A `locked` task is the
  one `updateTask` leaves alone.
- **`setOptions(patch)`** changes the chart without recreating it. A key left out keeps its value,
  one set to `undefined` goes back to its default, and each key is routed to what depends on it
  and nothing else: core options to the core (which recomputes only what they invalidate),
  `theme`, `strings`, `layout.height` and the display options to the renderer's own setters.
  Swapping an `on<Event>` handler is O(1) and redraws nothing. The groups the core and the
  renderer know (`calendar`, `dates`, `scheduling`, `hierarchy`, `layout`, `timeline`, `scroll`,
  `interaction`, `display`, `strings`) are merged field by field with what was set before; the
  popover groups `tooltip`, `linkMenu` and `highlightTooltip`, `editing` and `history` as objects,
  `viewModes` and every list (`tasks`, `links`, `highlights`, `calendar.holidays`, …) are taken
  whole: what they leave out is back to its default. It returns the issues of the options now in
  use.
- **`select(ids)`** selects tasks (ids that are not in the data are left out) and `selectLink(id)` an
  arrow; clicking an arrow selects it too. Clicking a bar only emits `taskClick`.
- **Events** are the same whether you give an `on<Event>` option or call `gantt.on`: the payloads
  of [Events](#events), which the facade does not change.

## Issues

The core checks its options and its data; the renderer's options are checked the same way, and
their problems join the core's in one list. A value that cannot be used is an `invalid-option`
with the full path of the value (`tooltip.trigger`, `display.gridLines`, `layout.height`,
`highlights[1].dates`, `strings.removeLink`, `onIssues`, …), and the option's default is used.
`suggested` carries that default when it is a plain value (`'both'`, `150`, `'auto'`, `true`);
there is none for what has no default to name: functions (`tooltip.render`, `linkMenu.onRemove`,
`display.renderBarLabel`, `onIssues`), strings (`strings.*`), `layout.height` (the container's)
and the items of `highlights`. A highlight whose `id` is missing or repeats an earlier one is
left out (`highlights[2]`, `highlights[2].id`); a field of the wrong kind (`dates` that is no
array, a `range` without both ends, a `match` that is no function, a `label` that is neither a
string nor a function, a `className` or `color` that is no string) is dropped and the highlight
stays. A value planned for a later release (`toolbar` when it is on, `direction: 'rtl'`,
`tooltip.trigger: 'focus'`, `display.stickyBarLabels` and `display.expectedProgress` when `true`)
is an `unsupported-option` (so is the core's `scheduling.propagation: 'push-forward'`). All of it is
in `getIssues().options`, in what `setOptions` returns and in the `issues` event (`onIssues` or `gantt.on('issues', …)`,
`source: 'options'`), which fires when the list changes, also when the chart is created. A
listener that throws does not stop the others; its error goes to `onError` when the core's issues
changed, as for every event, and is rethrown by `setOptions` (or `createGantt`) when only the
renderer's changed. The messages of the renderer's own issues are always the short form
`'<path>: <code>'` (the renderer has no development build): read `path`, `value` and `suggested`.
The core's issues have full explanations under the `development` export condition, see
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#development-and-production-builds).

## Tooltips, the link menu and day labels

Popovers are one `div.gantt__popover` at a time inside `div.gantt__layer`, a sibling of the
scroller, so they are never clipped by it or scrolled away. They are the `tooltip`, `linkMenu`
and `highlightTooltip` options (and `highlights`, whose labels they show), each taken whole by
`setOptions`:

```ts
import { createGantt } from '@ganttlane/dom';

// `container`, `tasks` and `links` as in the quick start.
const gantt = createGantt(container, {
  tasks,
  links,
  tooltip: {
    trigger: 'hover', // 'hover' (default) | 'click' | 'none' ('focus' is reserved for P1)
    followCursor: false, // sit above the cursor and follow it, instead of on the bar
    showWhileDragging: true, // keep it during a drag, showing the previewed dates
    delay: 150, // ms before a hovered bar's tooltip opens
    placement: 'top', // 'top' (default) | 'bottom'; flips when there is no room
    render: (context) => ({ title: context.task.name, details: '…' }), // optional
  },
  // `onRemove` is the chart's own `removeLink` unless you give yours (to confirm, or to change
  // your own data in a controlled setup).
  linkMenu: {
    onRemove: (link) => {
      if (window.confirm('Remove this dependency?')) void gantt.removeLink(link.id);
    },
  },
  highlightTooltip: { followCursor: false },
  highlights: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch day' }],
});

gantt.hideTooltip(); // closes the popover that is open
```

The options of the three groups and their defaults (a field left out, or of the wrong kind, takes the
default, which an issue then suggests when it is a plain value):

| Option                          | Default                                                      | Meaning                                                                                                           |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `tooltip.trigger`               | `'hover'`                                                    | What opens it: `'hover'`, `'click'` or `'none'` (`'focus'` is reserved and opens nothing)                         |
| `tooltip.followCursor`          | `false`                                                      | It sits above the cursor and follows it, instead of sitting on the bar                                            |
| `tooltip.showWhileDragging`     | `true`                                                       | It stays during a drag and shows the previewed dates (`trigger: 'none'` shows none)                               |
| `tooltip.render`                | the built-in content: name, dates, progress, working days    | The content (see below); `null` shows nothing                                                                     |
| `tooltip.delay`                 | `150`                                                        | Milliseconds a hovered bar waits before its tooltip opens, `0` for none; a hovered highlighted day waits the same |
| `tooltip.placement`             | `'top'`                                                      | The side of the bar (or the cursor) it prefers, `'top'` or `'bottom'`; it flips when there is no room             |
| `linkMenu.render`               | a menu with one action, remove, when the link can be removed | The content of the menu a click on an arrow opens; `null` shows no menu                                           |
| `linkMenu.onRemove`             | the chart's own `removeLink`                                 | What the remove action calls, with the link's record                                                              |
| `highlightTooltip.followCursor` | `false`                                                      | The label of a highlighted day or a holiday follows the cursor, instead of staying where it opened                |

- **Content is safe by type.** `render` (and `linkMenu.render`) return a `string` (inserted as
  **text**, never parsed), a `Node` (appended as it is), `{ html }` (the one way to insert
  markup: parsed as it is, so sanitising it is your responsibility) or
  `{ title, subtitle, details, actions }` (text, plus buttons that call `onSelect(context)` and
  close the popover). `null`, `''`, whitespace, `{}`, a title of whitespace and markup that is
  only whitespace in elements (`{ html: '<div> </div>' }`) show nothing. Without `render`, a task
  tooltip shows the name, the dates in the chart's locale, the progress and the working days;
  during a drag it shows the previewed dates and working days.
- **Content that has a lifetime.** A `Node` that someone else keeps alive (a framework's portal
  host, a widget that has to be torn down) is returned as `{ node, dispose }`
  (`DisposableNode`): `node` is shown as any node is, and `dispose()` is called **once** when the
  renderer is done with it: the popover closes (a press outside, Escape, `api.hide()`, the hover
  leaving, `destroy`), is replaced by another task's, or is made again from new inputs. When the
  popover is made again the new content is asked for **before** the old is disposed, so the two
  may share a node (a framework can keep the node and its state, and count its uses); return a
  new `{ node, dispose }` from every call. A node that is already the only child of the popover
  **stays where it is** when the popover is made again: it is not taken out and put back, so the
  focus and the selection in it (an `<input>` the user is typing in) survive, and a popover that
  held the focus leaves it there as long as the new content still holds it (otherwise it goes to
  the first button, as before). Two more fields are optional and for popovers:
  - `attached()` is called once the popover is in the chart and **before it is measured**, each
    time the content is shown (opened or made again). Draw here what needs the document: a
    framework's synchronous render (`autoFocus`, layout effects that measure), a widget that reads
    its size. What the content draws or focuses here counts: the popover is judged empty after
    it, and a menu does not move the focus to its first button when the content has taken it.
  - `owns(target)` says whether a node belongs to the content though it is not inside `node`: what
    it renders elsewhere in the page (the portal of a select, a menu or a date picker). A press on
    it is **not a press outside** (which closes a popover that stays open) and a scroll of it
    does not close the popover. It is called with any node, must not read layout, and the one of
    the content shown now counts.

  Content that shows nothing opens no popover and is disposed at once: for a `DisposableNode` that
  is no text but whitespace _and no element that draws without text_ (`img`, `svg`, `canvas`,
  `video`, `iframe`, `hr`, `progress`, `meter` and the controls), the rule `{ html }` has;
  `showsNothing(element)` of `@ganttlane/dom/dom-utils` is that rule. A plain `Node` is shown as it
  is, however empty it looks. The node should have its content when it is returned, or draw it in
  `attached`; the popover measures it after. None of the functions may throw. It takes pointer
  events when the popover stays open (a link menu, a tooltip opened by `trigger: 'click'`), so that
  what is in it can be used. `display.renderBarLabel` takes the same form for a bar's label (not
  `attached` and `owns`): the node is disposed when the label is hidden (`barLabel: 'none'`), when
  its inputs change (the new label is made first, and a node it shares stays in the label), when the
  bar leaves the window and when the chart is destroyed, and is asked for again when the label comes
  back. **Its width is not known:** the node is kept between calls by whoever owns it and holds what
  was drawn last, so it is not measured, and `'auto'` placement puts it inside the bar (as for a
  label of no width); use `'inside'` or `'outside'` to choose. `@ganttlane/react` is built on this:
  its `ReactNode` slots are portals into such nodes.

- **`render` runs when its inputs change** (another task, a new record, new previewed values),
  not on every mouse move. The context carries the task's record, its predecessors and
  successors with their links (and lag), its parent, `isDragging`, the `preview` while dragging
  and `api` (`getTask`, `getLink`, `hide`). A `render` that throws closes the popover that was
  open and rethrows (from the frame, or from the timer of a delayed hover); it is not asked again
  for the same inputs.
- **The link menu** opens on a click on a link, near the click, with the remove action (the
  default content needs a link that can be removed, `editing.links` and an `onRemove`;
  `linkMenu.onRemove` defaults to `removeLink`). Escape, a press outside it or a scroll closes
  it; the focus goes to its first item (Tab moves between the items) and Escape gives the focus
  back. The context's `remove()` and `canRemove` ask again whenever they are used: the `onRemove`
  that is set now, `editing.links` and the link as they are now, so a context an application
  kept cannot remove what may no longer be removed.
- **Staying open.** A tooltip closes when the hover leaves its bar, except one with `actions` and
  one opened by `trigger: 'click'`: those stay until a press outside them or Escape, so that the
  buttons can be reached. Hovering another bar does not replace them, and a hover does not open a
  tooltip over a link menu (it would take the focus away); dragging a bar still shows its
  preview.
- **Staying current.** An open tooltip or menu is made again, in the same element, when its
  task's record, its parent or the links around it change, when the options that make it
  change, and when the locale or the strings do. It closes when its task or link is gone, when a
  click tooltip's trigger is no longer `click`, and when editing links is turned off under a link
  menu.
- **Day labels.** Hovering a highlighted day shows its `label`, and a holiday the name the work
  calendar gives it; both together are joined with a middle dot.
- **Position.** Above the anchor (the bar, or the cursor), flipped below when there is no room
  and shifted into the chart and the viewport (`placePopover` in `@ganttlane/dom/dom-utils`).
  Layout is read when a popover opens, never while scrolling, and a popover that is made again
  (a drag preview) reuses the boxes and measures only itself: a tooltip on a bar follows the bar
  from cached boxes and the scroll offsets. A scroll of the page or of anything but the chart
  closes the popover that is open (its boxes are stale), and a scroll of the chart (or of the
  pin that holds its header, with an automatic height) closes all but a task tooltip. A scroll
  never cancels a hover that is still waiting, and a drag preview that a scroll closed comes
  back with the next update. With `layout.height: 'auto'` the page scrolls the chart, so the
  bar's place on the screen takes no scroll offset of the chart's.
- **Accessibility.** A tooltip is `role="tooltip"` and the bar it describes gets
  `aria-describedby`, which follows the task when its bar leaves the window and comes back as a
  new node (or is removed when no bar shows it); a menu is `role="menu"` with `role="menuitem"` buttons. Escape
  dismisses any popover and gives the focus back to where it was before the popover opened (a
  menu always, another popover when it held the focus); so does choosing an action, before its
  `onSelect` runs.
- **Shadow DOM.** A chart in an open shadow root works: the press that decides whether a
  click is outside a popover is read from the event's composed path, the focus from the root
  the chart is in, and a scroll of the chart is heard on the chart itself (a scroll event does
  not leave a shadow root). The stylesheet has to be adopted into the root; a page's styles do
  not reach into it. A closed shadow root is not supported.

## Locale and strings

Two things make a chart speak your language, and they are separate on purpose.

**The locale** is the core's `locale` option, a BCP 47 tag (`'en'` when it is left out, so that a
server and a browser draw the same text). It decides how dates and numbers are written, with
`Intl`:

- the header labels (months, weekdays, hours: core formats them with the view mode's `format`);
- the dates and the numbers of the default task tooltip;
- `context.locale`, which `tooltip.render` and `linkMenu.render` receive, and the second argument
  of every function string below.

Change it at runtime with `gantt.setOptions({ locale })`: the header and an open tooltip or link
menu are redrawn in the next frame, without a remount. A locale that is not a valid tag is reported
as an option issue and the chart falls back to `'en'`. A tag that is well formed but that the
runtime does not have (`'xx'`) is not an error, and is drawn in English too, never in the
runtime's own language (the dates and numbers of the chart and of the default tooltip ask for the
tag and then for `'en'`); `context.locale` still names the tag you gave, so a function of yours
that formats with it should do the same (`toLocaleString([locale, 'en'])`). A locale with another calendar
(`'th-TH-u-ca-buddhist'`) writes its years; the cells themselves stay Gregorian (week starts and
weekends from the locale are P1).

**The strings** are every piece of text the renderer writes on its own. They are English, and
the `strings` option overrides any of them; `gantt.setOptions({ strings })` changes them later
(merged key by key, `strings: undefined` puts English back), with the same redraw. The words and
the grammar are yours, the numbers and the dates stay the locale's:

```ts
import { createGantt, type GanttStringsInput } from '@ganttlane/dom';

const uk: GanttStringsInput = {
  chartLabel: 'Діаграма Ганта',
  progress: (percent, locale) => `${percent.toLocaleString(locale)}% виконано`,
  workingDays: (days, locale) => {
    // A plural is the string's job: other languages have more forms than "one" and "other".
    const word = {
      one: 'робочий день',
      few: 'робочі дні',
      many: 'робочих днів',
      other: 'робочого дня',
    }[new Intl.PluralRules(locale).select(days) as 'one' | 'few' | 'many' | 'other'];
    return `${days.toLocaleString(locale)} ${word}`;
  },
  dateRange: (from, to) => `${from} — ${to}`,
  removeLink: 'Видалити залежність',
};

createGantt(container, { tasks, locale: 'uk', strings: uk });
```

| Key                                                                        | Default                                     | Used for                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `chartLabel`                                                               | `Gantt chart`                               | The `aria-label` of the chart's focusable region          |
| `progress(percent, locale)`                                                | `60% done`                                  | The progress line of the task tooltip (whole percent)     |
| `workingDays(days, locale)`                                                | `1 working day`, `2.5 working days`         | The length line of the task tooltip (days to one decimal) |
| `dateRange(from, to, locale)`                                              | `Mar 2, 2026 – Mar 6, 2026`                 | The dates line of a task of more than one moment          |
| `linkTitle(source, target, locale)`                                        | `Design → Build`                            | The title of the link menu                                |
| `removeLink`                                                               | `Remove dependency`                         | The action of the link menu                               |
| `today`, `zoomIn`, `zoomOut`, `viewMode`                                   | `Today`, `Zoom in`, `Zoom out`, `View mode` | The toolbar (P1: reserved, nothing draws them yet)        |
| `hour`, `quarterDay`, `halfDay`, `day`, `week`, `month`, `quarter`, `year` | `Hour`, `Quarter day`, … `Year`             | The view mode switcher's items (P1: reserved)             |

- A string that puts a number or a name into a sentence is a **function** of the value and the
  chart's locale; the others are plain strings. Strings are inserted as text, never as markup.
- Any subset works, and `setStrings` merges over what is set. A key that is not in the table is
  ignored, a value of the wrong kind (a function where a string goes, a number, an empty string)
  falls back to the default of its key, and `undefined` puts the default back.
- `DEFAULT_STRINGS` and `resolveStrings(patch, base?)` are exported for custom setups; a custom
  layer reads `context.strings`, which is a new object exactly when a string changed.
- What is not in `strings`: task names and highlight or holiday labels (yours), the output of
  `tooltip.render`, and core's issue messages (developer-facing, English).
- `strings.chartLabel` is the chart's name (the `aria-label` of its focusable region).

## Theme

The look of the chart is a stylesheet made of custom properties. Pick a theme, override tokens,
or skip the stylesheet and style the [unstyled contract](#unstyled-contract) yourself.

### Themes

The `theme` option sets `data-theme` on the root element `div.gantt`; anything but the three
values below is `'auto'`, and `gantt.setOptions({ theme })` changes it at any time, with no
redraw:

| Value   | Look                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `light` | The light tokens (the default values of every token).                    |
| `dark`  | The dark tokens, always.                                                 |
| `auto`  | Light, and the dark tokens while `prefers-color-scheme: dark` is active. |

`auto` is the default. A theme is nothing but a set of token values, so the rules never change
between themes:

- the light values are declared on `.gantt` and apply to every theme;
- `dark` overrides the colour tokens under `.gantt[data-theme='dark']`;
- `auto` repeats those overrides under `@media (prefers-color-scheme: dark)`, on
  `.gantt[data-theme='auto']`.

Each theme also sets `color-scheme`, so the scrollbars follow it. The chart does not need to be
redrawn when the theme changes, so you can also set the attribute yourself
(`root.dataset.theme = 'dark'`).

### Re-theming

All of the library's CSS is in `@layer gantt`, and no selector is more specific than a class plus
`data-*` or a pseudo-class. Any style of your own that is not in a layer therefore wins without
`!important`:

```css
/* Every chart on the page */
.gantt {
  --gantt-font-family: 'Inter', sans-serif;
  --gantt-bar-color: #0f766e;
  --gantt-today-color: #b45309;
}

/* One chart (give its container a class and use the descendant) */
.roadmap .gantt {
  --gantt-link-width: 2px;
}

/* A theme-specific value: use the selectors of the theme, as the library does */
.gantt[data-theme='dark'] {
  --gantt-bar-color: #2dd4bf;
}
@media (prefers-color-scheme: dark) {
  .gantt[data-theme='auto'] {
    --gantt-bar-color: #2dd4bf;
  }
}

/* A single bar (`task.className` is added to its `g.gantt__bar`) */
.gantt__bar.is-milestone-review .gantt__bar-track {
  fill: tomato;
}
```

If your own styles live in cascade layers, declare the order once, `@layer gantt, app;`, so that
yours come later.

### Per-element colours

Some tokens are also written by the renderer on a single element, through the CSSOM (never as
`style` text, so a strict `style-src` CSP is fine). An element without its own value
inherits the one of the theme.

| Property                     | Set on         | From                                                             |
| ---------------------------- | -------------- | ---------------------------------------------------------------- |
| `--gantt-bar-color`          | `.gantt__bar`  | `task.color`. The progress colour is derived from it, see below. |
| `--gantt-bar-progress-color` | `.gantt__bar`  | `task.progressColor`: replaces the derived progress colour.      |
| `--gantt-highlight-color`    | highlight node | The highlight's `color`.                                         |

The progress colour is `color-mix(in srgb, <bar colour>, <shade> <amount>)`, with the shade and
the amount taken from `--gantt-bar-progress-shade-color` and `--gantt-bar-progress-shade`. A
browser without `color-mix()` (none of the [supported ones](#browser-support)) draws the shade as a
translucent overlay of the same amount, which gives the same colour for the derived progress
colour. It does not for `task.progressColor`: the overlay keeps the opacity of the shade (the
`--gantt-bar-progress-shade` amount: 30% in the light theme, 35% in the dark one), so a colour you
set is drawn translucent over the bar instead of as given. The outline of a hovered bar is a
`color-mix()` too, and there it is not drawn.

### Tokens

Every custom property below is declared on `.gantt`. A dash in the Dark column means the dark
theme keeps the light value (sizes and widths).

| Token                              | Light                                                      | Dark                      | Used for                                                  |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------- | --------------------------------------------------------- |
| `--gantt-font-family`              | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | —                         | Every text of the chart, header and bar labels            |
| `--gantt-font-size`                | `12px`                                                     | —                         | Every text of the chart                                   |
| `--gantt-transition-duration`      | `120ms`                                                    | —                         | Fade of the handles (none under `prefers-reduced-motion`) |
| `--gantt-background-color`         | `#fff`                                                     | `#15171c`                 | The chart's background                                    |
| `--gantt-foreground-color`         | `#1b2230`                                                  | `#e4e8ef`                 | Default text, the current header cell                     |
| `--gantt-border-color`             | `#d3d9e1`                                                  | `#333a46`                 | Header borders and cell separators                        |
| `--gantt-border-width`             | `1px`                                                      | —                         | Header borders, the outline of a hovered bar              |
| `--gantt-header-background-color`  | `#f5f6f8`                                                  | `#1c1f26`                 | The header                                                |
| `--gantt-header-text-color`        | `#465163`                                                  | `#a9b3c3`                 | Header labels                                             |
| `--gantt-header-current-color`     | `rgb(229 72 77 / 10%)`                                     | `rgb(255 99 105 / 16%)`   | The header cell that contains today                       |
| `--gantt-header-range-color`       | `rgb(37 99 235 / 14%)`                                     | `rgb(110 160 255 / 20%)`  | The hovered bar's range in the header                     |
| `--gantt-grid-line-color`          | `#e7eaef`                                                  | `#242932`                 | Grid lines                                                |
| `--gantt-grid-line-width`          | `1px`                                                      | —                         | Grid lines                                                |
| `--gantt-grid-major-line-color`    | `#c8cfd9`                                                  | `#3a4252`                 | Major grid lines (month, year boundaries)                 |
| `--gantt-grid-major-line-width`    | `1px`                                                      | —                         | Major grid lines                                          |
| `--gantt-grid-minor-line-color`    | `#eff1f4`                                                  | `#1e222a`                 | Minor grid lines (the snap steps inside a column, dotted) |
| `--gantt-row-stripe-color`         | `rgb(15 23 42 / 3.5%)`                                     | `rgb(255 255 255 / 3.5%)` | Striped rows (the `rowStripes` display option)            |
| `--gantt-row-invalid-color`        | `rgb(229 72 77 / 8%)`                                      | `rgb(255 99 105 / 12%)`   | A row whose task is invalid                               |
| `--gantt-row-placeholder-color`    | `rgb(100 116 139 / 8%)`                                    | `rgb(148 163 184 / 8%)`   | A placeholder row (a task of type `placeholder`)          |
| `--gantt-nonworking-color`         | `rgb(100 116 139 / 10%)`                                   | `rgb(148 163 184 / 9%)`   | Non-working days, `fill` mode                             |
| `--gantt-nonworking-stripe-color`  | `rgb(100 116 139 / 30%)`                                   | `rgb(148 163 184 / 26%)`  | Non-working days, `stripes` mode (the pattern's lines)    |
| `--gantt-highlight-color`          | `#f5b301`                                                  | `#f5b301`                 | Highlighted days; a highlight's `color` overrides it      |
| `--gantt-highlight-opacity`        | `0.2`                                                      | `0.16`                    | Opacity of highlights, so any colour stays readable       |
| `--gantt-today-color`              | `#e5484d`                                                  | `#ff6369`                 | The today line and the marker in the header               |
| `--gantt-today-width`              | `1.5px`                                                    | —                         | The today line                                            |
| `--gantt-popover-background-color` | `#fff`                                                     | `#222731`                 | Tooltips, the link menu and day labels: background        |
| `--gantt-popover-foreground-color` | `#1b2230`                                                  | `#e4e8ef`                 | Popover text                                              |
| `--gantt-popover-border-color`     | `#d3d9e1`                                                  | `#3a4252`                 | Popover border, action button border                      |
| `--gantt-popover-shadow-color`     | `rgb(15 23 42 / 18%)`                                      | `rgb(0 0 0 / 55%)`        | Popover shadow                                            |
| `--gantt-popover-radius`           | `6px`                                                      | —                         | Popover corner radius                                     |
| `--gantt-popover-max-width`        | `320px`                                                    | —                         | Widest a popover grows before its text wraps              |
| `--gantt-bar-color`                | `#3f6fd1`                                                  | `#4170d3`                 | Bars without their own colour                             |
| `--gantt-bar-progress-shade-color` | `#000`                                                     | `#000`                    | What the progress colour is mixed towards                 |
| `--gantt-bar-progress-shade`       | `30%`                                                      | `35%`                     | How much of the shade the progress colour has             |
| `--gantt-bar-label-color`          | `#fff`                                                     | `#fff`                    | A bar's label inside the bar                              |
| `--gantt-bar-label-outside-color`  | `#1b2230`                                                  | `#e4e8ef`                 | A bar's label next to the bar                             |
| `--gantt-bar-selected-color`       | `#111827`                                                  | `#f3f4f6`                 | The outline of a selected bar                             |
| `--gantt-bar-selected-width`       | `2px`                                                      | —                         | Outline of a selected, conflicting or invalid bar         |
| `--gantt-bar-conflict-color`       | `#e5484d`                                                  | `#ff6369`                 | The outline of a bar in conflict                          |
| `--gantt-bar-invalid-color`        | `#d97706`                                                  | `#f0a43a`                 | The (dashed) outline of an invalid bar                    |
| `--gantt-handle-color`             | `rgb(255 255 255 / 55%)`                                   | `rgb(255 255 255 / 50%)`  | Resize and progress handles                               |
| `--gantt-link-color`               | `#7a8699`                                                  | `#8794a8`                 | Link arrows                                               |
| `--gantt-link-width`               | `1.5px`                                                    | —                         | Link arrows                                               |
| `--gantt-link-selected-color`      | `#2563eb`                                                  | `#6ea0ff`                 | A selected or hovered link, a valid link preview          |
| `--gantt-link-selected-width`      | `2.5px`                                                    | —                         | A selected link, the link preview                         |
| `--gantt-link-conflict-color`      | `#e5484d`                                                  | `#ff6369`                 | A link in conflict or in a cycle, an invalid preview      |
| `--gantt-link-hit-width`           | `12px`                                                     | —                         | Width of the invisible area that catches clicks on a link |
| `--gantt-focus-ring-color`         | `#2563eb`                                                  | `#7aa7ff`                 | Keyboard focus ring (`:focus-visible`)                    |
| `--gantt-focus-ring-width`         | `2px`                                                      | —                         | Keyboard focus ring                                       |

Geometry is not a token: the row height, bar height, bar radius and every coordinate come from
the chart's options and are written by the renderer (`layout.rowHeight`, `layout.barHeight`, …).
CSS only decides how it looks.

That includes the size of the round link handles. It is `interaction.handles.link` (the radius
in px, default 6), the same number the hit test uses, and the renderer writes it as the `r` of
each circle. The sheet sets no `r` (there is no `--gantt-handle-size` token), so the renderer's
radius is the one drawn, and a click lands exactly where the circle is; to make the handles
bigger or smaller, set that option.

### CSS support

The sheet uses cascade layers, `:is()`, `overflow: clip` and `color-mix()`. The newest of them is
`color-mix()` (Chrome and Edge 111, Firefox 113, Safari and iOS Safari 16.2), which is why the
progress colour has the fallback above. Every browser under [Browser support](#browser-support) has
all four.

## Unstyled contract

You can skip `styles.css` and style the chart yourself, or use it and add to it. The
DOM structure, the class names and the `data-*` attributes below are part of the public API: they
change only in a major version. Everything else (the order of siblings inside a group, SVG
geometry attributes such as `x`, `width` or `d`, ids) is an implementation detail.

```
div.gantt[data-theme][data-height]
  div.gantt__pin                                  (only with height 'auto': the header sits here)
  div.gantt__scroller
    div.gantt__header                             (inside the scroller unless height is 'auto')
      div.gantt__header-row[data-unit][data-row]
        div.gantt__header-cell[data-unit][data-current][data-major]
          span.gantt__header-label[data-sticky]
      div.gantt__header-range
      div.gantt__today-marker
    svg.gantt__body
      g.gantt__grid
        g.gantt__rows
          rect.gantt__row[data-row][data-task-id][data-stripe][data-invalid][data-placeholder]
        g.gantt__nonworking[data-mode]
          rect.gantt__nonworking-day[data-day][data-reason]
          defs > pattern.gantt__stripes > line.gantt__stripes-line        (stripes mode only)
        g.gantt__highlights
          rect.gantt__highlight[data-highlight][data-day]
        g.gantt__gridlines
          line.gantt__gridline[data-orientation][data-major][data-minor]
        line.gantt__today
      g.gantt__links
        g.gantt__link[data-link-id][data-type][data-selected][data-conflict][data-cycle]
          path.gantt__link-path[fill=none]
          path.gantt__link-arrow
          path.gantt__link-hit[data-link-id][fill=none]
      g.gantt__bars
        g.gantt__bar[data-task-id][data-type][data-selected][data-hovered][data-dragging]
                    [data-resizing][data-locked][data-readonly][data-movable][data-invalid]
                    [data-conflict]
          rect.gantt__bar-track
          rect.gantt__bar-progress
          polygon.gantt__bar-milestone                (a milestone instead of the two rects)
          text.gantt__bar-label[data-placement]
          foreignObject.gantt__bar-label[data-placement]    (custom label: instead of the text)
            div.gantt__bar-label-content
          rect.gantt__handle[data-handle]
          circle.gantt__link-handle[data-side]
      g.gantt__overlay
        path.gantt__link-preview[data-valid]
  div.gantt__layer
    div.gantt__popover[data-kind][data-placement][data-interactive][role=tooltip|menu]
      div.gantt__popover-title
      div.gantt__popover-subtitle
      div.gantt__popover-details
      div.gantt__popover-actions
        button.gantt__popover-action[data-action][role=menuitem]
```

Attributes marked optional appear only while they are true (`data-selected`, `data-current`, …).
`data-theme` is `light`, `dark` or `auto`; `data-height` is `auto` while the chart's height follows its rows (the header is then in `div.gantt__pin`, in front of the scroller, instead of in the scroller) and absent otherwise; `data-unit` is a time scale unit (`day`, `week`, …);
`data-handle` is `resize-start`, `resize-end` or `progress`; `data-side` is `start` or `end`;
`data-orientation` is `vertical` or `horizontal`; `data-mode` is `fill` or `stripes`;
`data-placement` is `inside` or `outside`; `data-type` is the task type on a bar and the link type
(`FS`, `SS`, `FF`, `SF`) on a link; `data-day` is a day key (days since 1970-01-01, an integer) and
`data-reason` the calendar's reason a day does not work (`weekend`, `holiday`, `custom` or
`exception`); `data-link-id` is the link's id, on the group and on its hit path, so that a pointer target finds it with
`closest`; `data-task-id` is the task id on a bar and on the row of its task.
On a popover, `data-kind` is what it is about (`task`, `link` or `day`), `data-placement` the side of
its anchor it sits on (`top` or `bottom`, after a flip), `data-interactive` marks a
popover with action buttons (the only one that takes pointer events) and `data-action` is the index
of an action in the content it was rendered from.

### States

| Attribute                        | On                | Meaning                                                  |
| -------------------------------- | ----------------- | -------------------------------------------------------- |
| `data-selected`                  | bar, link         | Selected                                                 |
| `data-hovered`                   | bar               | The pointer is over it (the sheet also uses `:hover`)    |
| `data-dragging`, `data-resizing` | bar               | A drag or a resize of it is in progress                  |
| `data-locked`                    | bar               | The task is locked                                       |
| `data-readonly`                  | bar               | The task cannot be edited                                |
| `data-movable`                   | bar               | The task may be moved: its body can be dragged           |
| `data-invalid`                   | bar, row          | The task is invalid                                      |
| `data-conflict`                  | bar, link         | The schedule violates a link                             |
| `data-cycle`                     | link              | The link closes a cycle (drawn dashed)                   |
| `data-stripe`                    | row               | Gets the stripe colour                                   |
| `data-placeholder`               | row               | The row of a placeholder task                            |
| `data-current`                   | header cell       | The cell contains today                                  |
| `data-major`                     | header cell, line | A major boundary                                         |
| `data-minor`                     | line              | A minor line (the snap steps; the sheet draws it dotted) |
| `data-sticky`                    | header label      | The label stays in view while its cell scrolls out       |
| `data-valid`                     | link preview      | The link being created is allowed                        |
| `data-cursor`                    | root (`.gantt`)   | The cursor of the gesture in progress; absent otherwise  |
| `data-interactive`               | popover           | Has actions: takes pointer events (the rest do not)      |

`data-movable` is the `move` permission of the task (`resolvePermissions` over the chart's
`editing` option and the task's `editable`, `locked`, …) and nothing else: a bar that may only be
resized, progressed or linked does not have it, and neither does a bar that is `data-readonly`
or `data-locked`. `data-readonly` is the opposite of "any of move, resize and progress": a bar
can lack `data-movable` and still not be read-only. The renderer's touch handling relies on it
(a movable bar takes the whole touch for itself, the others stay scrollable), and so can a
stylesheet: `.gantt__bar[data-movable] { touch-action: none }`.

When states combine on a bar, the sheet resolves the outline like this: the keyboard focus ring
beats everything, the outline of a selected bar beats the invalid and conflict outlines (an
invalid bar that is selected keeps its dashes and its fade, a bar in conflict that is selected
shows the selection only: its links still show the conflict), and those two beat the hover
outline. Replacement sheets keep selection visible in the same way.

### What a replacement stylesheet must honour

The renderer writes these custom properties on `.gantt` (CSSOM), and a stylesheet that does not
use ours has to size the structure from them:

| Property                | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `--gantt-content-width` | Width of the scrolled content: both the header and the body are this wide |
| `--gantt-header-height` | Height of the sticky header                                               |
| `--gantt-body-height`   | Height of the rows: the body is this tall                                 |
| `--gantt-height`        | Height of the chart when `layout.height` is a number (else not set)       |

On top of that:

- `.gantt` fills its container (or is `--gantt-height` tall) and is the positioning context of
  `.gantt__layer`. With `data-height="auto"` it is as tall as its content.
- `.gantt__scroller` is the one scroll container, on both axes (`overflow: auto`). The renderer
  owns its scroll position: keep `overflow-anchor: none` (the infinite timeline compensates
  `scrollLeft` itself, which the browser's scroll anchoring would fight) and
  `scroll-behavior: auto` (those writes must be instant; programmatic scrolls pass their own
  `behavior`). It is a keyboard-focusable named region (`tabindex="0"`, `role="region"`,
  `aria-label`, see the `chartLabel` string), so the arrow keys scroll it in every browser.
- With `data-height="auto"` the scroller has `height: auto`, `overflow-y: hidden`, a
  `padding-block-start` of `--gantt-header-height` (the header's room) and a negative
  `margin-block-start` of the same, and `.gantt__pin` is the header's container:
  `position: sticky; top: 0`, `--gantt-header-height` tall, `overflow: hidden` (the renderer
  scrolls it sideways with the scroller), above the scroller and below `.gantt__layer`.
- `.gantt__header` is `position: sticky; top: 0`, `--gantt-content-width` wide and
  `--gantt-header-height` tall. Its rows stack vertically; the renderer places each cell, the
  range and the today marker inside by `left` / `width` (or `transform`), so those need
  `position: absolute`.
- **Header descendants clip with `overflow: clip`, never `hidden`** (nor `auto` or `scroll`). A
  header label with `data-sticky` sticks to the left edge of the viewport, which only works while
  no element between it and the scroller is a scroll container, and `overflow: hidden` makes its
  element one (even though nothing scrolls it). That goes for the header, its rows and its cells,
  and for any wrapper you add around a label. `clip` cuts the same pixels without the side
  effect. The label itself may use `overflow: hidden; text-overflow: ellipsis`, as it is the
  sticky element, not a container of one.
- `.gantt__body` is `display: block`, `--gantt-content-width` wide and `--gantt-body-height` tall.
  Positions and sizes inside it are SVG attributes; do not override them with CSS.
- `.gantt__link-hit` needs `fill: none`, a transparent stroke, a wide `stroke-width` and
  `pointer-events: stroke`; the other link paths should not take pointer events.
- `.gantt__layer` (tooltips and popovers) covers the chart, above the scroller, and does not take
  pointer events itself.
- A `.gantt__popover` is `position: absolute` at the top left of the layer, and the renderer
  places it with `--gantt-popover-x` and `--gantt-popover-y` (px, from the layer's top left): a
  stylesheet that replaces ours moves it with
  `transform: translate(var(--gantt-popover-x, 0), var(--gantt-popover-y, 0))`, sizes it to its
  content and gives `[data-interactive]` popovers `pointer-events: auto`.
- A `.gantt__bar-label` is SVG text or HTML in a `foreignObject`: set both `fill` and `color`.
  The HTML node a `renderBarLabel` returns lives in `.gantt__bar-label-content` inside it: its box
  is the bar's (inside) or as wide as the estimated text (outside, where the node may overflow).
- Presentation attributes the renderer writes on the nodes, which a stylesheet should leave alone:
  `fill="none"` on `.gantt__link-path` and `.gantt__link-hit` (so they are not filled black without
  a sheet), `fill="url(#<prefix>-stripes)"` on `.gantt__nonworking-day` in `stripes` mode,
  `text-anchor` and `dy` on SVG label text, `overflow="visible"` on an outside `foreignObject`
  label, and the geometry (`x`, `y`, `width`, `height`, `rx`, `ry`, `points`, `d`, `cx`, `cy`,
  `r`). Never set `r` (or any of those) in CSS: a CSS value out-ranks the attribute.
- `.gantt__nonworking-day` gets its `fill` from the renderer in `stripes` mode (a reference to
  the pattern); set it only for `.gantt__nonworking[data-mode='fill']`.

The package's test suite checks the stylesheet against this contract and this file: every class and
attribute has a rule or is listed as intentionally unstyled, every token is declared in each
theme, and every token is documented here with its default.

## Behaviour

How the chart reacts to the pointer, the scroll and the size of its container.

### Pointer input

Editing is driven by Pointer Events (mouse, touch and pen) heard on `div.gantt__scroller`, and the
keyboard while a gesture runs:

- **Gestures.** Drag a bar's body to move it, an edge handle to resize it, the progress handle to
  change the progress; drag from a link handle (the circles beside a bar) onto another bar, or
  click the handle and then the target bar, to create a link. The core decides what the pointer
  does (`createInteraction`): the drag threshold (3 px, 8 px for touch), the snap, the preview
  of the tasks that follow, the permissions, the commit. `Escape` cancels, and holding `Alt`
  snaps to the data step. There are no native `click` / `dblclick` listeners: the core reports
  `taskClick`, `taskDoubleClick` and `linkClick`, and no click follows a drag.
- **Capture.** A press with the primary button captures the pointer on the scroller, so a drag
  goes on, and is committed, wherever the pointer is released, outside the chart too. A
  `pointercancel`, or a capture lost in the middle, rolls the gesture back. A press on the
  scrollbar is left to the browser. A captured pointer over the sticky header, left of the
  chart or past its scrollbars is over nothing: what the layout has under that point is scrolled
  out of sight, so a link released there creates no link to a hidden task.
- **Coordinates.** The chart is measured when a press starts and when the pointer comes in, and
  that measurement is dropped when the page or an ancestor of the chart scrolls or the window is
  resized, so hover, `data-hovered` and tooltips stay right on a page that scrolls under a
  still pointer. A CSS `transform: scale()` on an ancestor is allowed (rotation is not): offsets
  are converted from page px to chart px. With `height: 'auto'` the page scrolls the chart, and
  the scroller's own rectangle carries that offset already.
- **Touch.** A touch that starts on a bar that may be moved (`data-movable`), on a resize or
  progress handle, or on a link handle drags it instead of scrolling the chart. The body of any
  other bar (read only, or resizable but not movable), a row and the header still scroll it, and
  the swipe is not a refused drag: a tap there (up to 8 px of travel) is a click, a longer
  touch is cancelled, and no `editRefused` is reported for it. The sheet gives
  `.gantt__bar[data-movable]` and the handles `touch-action: none`, but Chromium ignores
  `touch-action` on SVG elements, so the renderer also cancels the `touchstart` of such a touch
  (the one non-passive listener of the chart, and only for that event; a chart that cannot be
  edited does not listen to it, nor to the keyboard, until editing is turned on). A custom
  stylesheet needs neither, as long as its bars keep `data-movable` while the task may be moved.
- **Edge autoscroll.** Dragging near the left or right edge of the viewport scrolls it, faster
  the closer the pointer is to the edge (`scroll.autoScroll`, px per frame of a 60 Hz display;
  the speed is the same on 120 Hz or 30 Hz ones), and an infinite timeline grows as you go. The
  loop is one `requestAnimationFrame` chain of the chart, alive only while the drag is in the edge
  zone.
- **Ending a gesture.** `Escape` cancels a drag or an armed link. A click-click link that was
  armed is also ended by a press outside the chart and by the window losing focus; the window
  losing focus ends a drag too (its release will not come). Destroying the chart (or the
  renderer) in the middle of a gesture cancels it in the core, which may outlive the chart.
- **Cursor.** While a gesture lasts, the interaction's cursor is `data-cursor` on `div.gantt`
  (`grabbing`, `ew-resize`, `crosshair`, `not-allowed`, …); the sheet turns it into the CSS
  cursor of the whole chart, because browsers differ in whose cursor a captured pointer shows
  (the scroller's or the one under it). Outside gestures the bars and handles have their own
  cursors.
- **Link preview.** While a link is being created, `path.gantt__link-preview` runs from the
  link handle to the pointer or, over a valid target, to the target's anchor. It has
  `data-valid` unless the core refuses the target (itself, a cycle, a duplicate, a task that
  may not be linked).

Targets come from the DOM where it can tell (`.gantt__bar[data-task-id]`, `data-handle`,
`data-side`, `[data-link-id]`) and from the core's hit test otherwise, so a custom stylesheet or
bar content keeps working as long as it keeps the unstyled contract below. The helpers behind
this (the adapter from DOM events to the core's input, the target resolver, the autoscroll loop)
are exported from `@ganttlane/dom/dom-utils` for other renderers.

### Scrolling

The scroller (`div.gantt__scroller`) is the only scroll container, and the renderer is the only
thing that writes its position.

- **One trigger for every source.** The wheel, the scrollbar, the keyboard, touch, `scrollTo*`
  and the drag autoscroll all end in a `scroll` event of the scroller, and that event is the
  only thing the infinite timeline (`timeline.infinite`) listens to. It reads `scrollLeft` and
  `scrollTop`, nothing else, and tells the core.
- **No jump.** When the core extends or trims the range, the content is resized and the
  compensated `scrollLeft` is written, with `behavior: 'instant'` so that a page-wide
  `scroll-behavior: smooth` cannot slide it, and the new snapshot is rendered, all in the same
  task, before paint. The date under the left edge moves less than a pixel; the bars in view
  keep their nodes. The handler asks the core again at the new position until it has nothing
  more to do, so the trim that an extension makes necessary comes out of the same event.
- **A request in flight comes first.** Between the moment the application asks for a scroll
  (`scrollToDate`, `setViewMode`, `zoomTo`, …) and the frame that performs it, the scroller still
  shows the picture that is being replaced, and a smooth scroll or a momentum goes on firing
  `scroll` events in that picture's coordinates. The renderer never reports such a position to
  the core: a scroll event first renders the pending request (it moves the scroller to the
  request's picture) and then reports where the scroller is, and the page's geometry is read in
  the frame after the request is performed.
- **A handler of yours that throws does not break the chart.** The renderer's input methods of the
  core (`setViewport`, `scroll`, `send`, `refreshNow`) never throw after they changed something:
  what your `onRangeChange` or `onScroll` threw goes to `onError` when you have one, and to the
  host's unhandled-rejection channel (the console, your error tracker) when you have not.
  Compensation and extension go on working, handler or no handler.
- **Left to right.** `.gantt` sets `direction: ltr` whatever the host page's `dir` is: an RTL
  scroller counts `scrollLeft` from its right edge, down to negative numbers, which neither the
  renderer nor the core expects. A mirrored scale is the P1 `direction` option.
- **Moving the scroller yourself** (your own autoscroll, a keyboard shortcut): use
  `scrollByInstant(scroller, { left, top })` from `@ganttlane/dom/dom-utils`. It is relative to
  where the scroller is now and instant; a write from a position you remembered would undo a
  compensation, and a smooth one never arrives when it restarts every frame.
- **Keyboard.** The scroller is `tabindex="0"` with `role="region"` and an `aria-label` (the
  `chartLabel` string, default "Gantt chart"; see Locale and strings). Chromium and Firefox focus a scroller on their own,
  WebKit does not, and a labelled region is what a screen reader should announce. The arrow keys
  scroll it by the browser's step, PageUp, PageDown, Home and End scroll the rows. The focus ring
  is `:focus-visible` with `--gantt-focus-ring-*`. Bars, links and handles get their own focus
  stops in P1 (roving tabindex), which will replace the role of the scroller.
- Browsers that scroll on the compositor thread (touch fling, smooth wheel) may stop that
  animation when the compensation writes the position: it happens once per extension, which is
  once per `extendBy` of scrolling.

#### Initial scroll and `scrollTo*`

`scroll.initial` (`today`, `start`, `end`, `first-task`, a date, `none`) and `scrollToDate`,
`scrollToToday` and `scrollToTask` are scroll requests of the core: absolute positions with an
id, which the renderer performs once, in the frame that draws their snapshot, after the content
has its new size. A smooth request first jumps instantly to its `from` (the picture it starts
from, after the range grew at its start), then scrolls. `scrollToTask` moves both axes.

A `scrollToDate`, `scrollToToday` or `scrollToTask` made before the chart has a width to place
it on (a hidden container, a stylesheet that is late) is not lost: the core keeps the latest
such call and the first width performs it, at once, in place of `scroll.initial` (which a later
`setOptions({ scroll: { initial } })` cannot override either). A task that is not there leaves
`scroll.initial` in charge.

#### Height

The `layout.height` option (`height` of `mountRenderer`) decides who scrolls the rows:

| `height` | The chart is             | Vertical scrolling   | Header sticks to        | Horizontal scrolling |
| -------- | ------------------------ | -------------------- | ----------------------- | -------------------- |
| left out | as tall as its container | inside the scroller  | the top of the scroller | inside the scroller  |
| a number | that many px tall        | inside the scroller  | the top of the scroller | inside the scroller  |
| `'auto'` | as tall as its rows      | the page (see below) | the top of the page     | inside the scroller  |

With `'auto'` the scroller cannot hold a sticky header, because a header sticks to its nearest
scroll container, and a scroller that grows to its content does not scroll vertically. So the
header lives in `div.gantt__pin` in front of the scroller (`data-height="auto"` on the root):
the pin sticks to the top of what scrolls the chart, and follows the scroller sideways by the
renderer scrolling it in the same task as the scroller (in a browser that scrolls on the
compositor thread the header may trail the rows by a frame while a wheel or touch scroll is in
flight). The scroller keeps the header's room as padding under the pin, so its box is the
header plus the rows in every mode.

What scrolls the chart is its host: the nearest ancestor with `overflow-y: auto`, `scroll` or
`overlay` that has something to scroll (its `scrollHeight` is more than its `clientHeight`), or
the page. An ancestor that fits its content is no host: a wrapper with `overflow-x: auto` alone
computes to `overflow-y: auto` as well, grows with the chart and never scrolls, and asking it
would draw every row. Whether an ancestor can scroll is a fact of the moment, so the host is
looked up when the mode is set and again whenever the chart's height changes (the first render,
rows added or collapsed) and the host or the window is resized; a change of host is told to the
core in the same frame. `overflow: hidden` on an ancestor between the chart and its host stops
the header sticking (a clipping ancestor is a scroll container that never scrolls), and so does
a wrapper that fits (the header sticks to the nearest ancestor that is a scroll container,
whether it scrolls or not). The core is told the height of the host that is below the header's
sticky position as the viewport and, as its `scrollTop`, the body position at the bottom of the
stuck header, so it still draws only the rows that are visible and `scrollToTask` aims at them:
the renderer turns the `top` of a request into a `scrollBy` of the host, with the request's
`behavior`. The host's scroll and resize handlers only set a flag; the frame that follows reads
the geometry (one `getBoundingClientRect` of the scroller, plus one of the host when it is not
the page, and the computed `padding-top`, `scroll-padding-top` and the pin's `top`), so no
handler reads layout.

With `'auto'` the horizontal scrollbar is at the bottom of the chart, as far down the page as
the last row; the wheel (with Shift), a trackpad, touch and the keyboard (focus the chart first)
scroll sideways wherever the pointer is, over the header too: the header's pin covers the
scroller there and scrolls nothing by hand, so the renderer passes a sideways wheel and a
sideways touch on it on to the scroller (`forwardScroll` in `@ganttlane/dom/dom-utils`; the pin
has `touch-action: pan-y`, so a vertical touch still scrolls the page; a touch drag has no
fling).

A sticky header of your own above the chart is accounted for. Give `.gantt__pin` the `top` it
sticks at (`.gantt__pin { top: 64px }`); the part of the host that shows rows starts below it.
The host's `padding-top` counts too (an element's sticky children stick inside its padding, the
page's do not), and so does `scroll-padding-top` of the host (`html { scroll-padding-top: 64px }`
is the usual way to keep a header clear): a row that `scrollToTask` aims at the top lands below
whichever of the two is more. Both are read in the frame, and again when the host or the window
is resized; a `top` that you change at run time is noticed at the next such moment.

`gantt.setOptions({ layout: { height } })` changes the mode of a mounted chart (`setHeight` of a
renderer made with `mountRenderer`); `height: undefined` makes it fill its container again.

### Performance

The chart draws what is on screen, not what is in the plan:

- **The window.** The core publishes `snapshot.window`: the visible rows and time plus an
  overscan (5 rows, 400 px). Header cells, grid rows, days and lines, bars and links exist only
  for it, so the DOM holds a few hundred elements whether the plan has 100 or 10 000 tasks.
  Bars and links follow the window exactly; the header and the grid, which redraw many small
  nodes at once, keep what they drew until the viewport is within half an overscan of its edge,
  so a few pixels of scroll write nothing to the DOM at all.
- **One render per frame.** Every change (data, options, scroll, the clock, display options) only
  asks the frame scheduler for a render, which coalesces them: any number of changes before a
  frame make one render of the latest snapshot. The one exception is the scroll compensation of
  the infinite timeline, which renders at once, in the scroll handler, so that the date under
  the left edge does not move before paint.
- **No layout reads.** Nothing on the scroll or render path measures the DOM (`getBBox`,
  `getBoundingClientRect`, `offsetWidth`, `getComputedStyle`): the scroll handler reads
  `scrollLeft` and `scrollTop`, label widths are estimated, and geometry comes from the core.
  The package's test suite fails on any such read.
- **One timer.** The renderer asks the core to read its clock once a minute (`refreshNow`), from
  a single timeout aligned to the minute boundary, so the today line follows `snapshot.now`.
  `destroy()` clears it.

The benchmark page of the playground (`pnpm dev`, then `/bench/?bench=1k` or `/bench/?bench=10k`,
`&run=1` to start at load) auto-scrolls and drags a generated plan and shows the first paint, the
frame times, the script work per frame, the node count and the DOM churn per frame, and the cost
of `core.send` for a drag. An end-to-end test runs it in Chromium, Firefox and WebKit, and
`pnpm bench` in the repository prints the numbers against their targets.

## Bindings and building blocks

- **`mountRenderer(container, core, options)`** is the renderer alone, for a core you create and
  share yourself (`createGanttCore` of `@ganttlane/core`). It takes the renderer's options (`theme`,
  `strings`, `height`, `display`, `idPrefix`, `layers`, `frames`), returns
  `{ destroy(), setDisplay, setStrings, setHeight, setTheme, hideTooltip, display, strings, core }`
  and leaves the core alone on `destroy()`.
- **`@ganttlane/dom/facade`** is the part of `createGantt` that needs no DOM: `createChart(options)`
  makes the same chart, with the same routing of the options to the core and the renderer, the same
  validation and the one list of issues, but draws nothing and touches no DOM, so
  `chart.gantt.core.getSnapshot()` already answers, also on a server. `chart.mount(container)` draws
  the renderer, `chart.unmount()` takes it away (the core and its state stay) and `mount` draws it
  again, with whatever `setOptions` changed meanwhile. It is what a binding for another framework
  needs, and what [`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md) is built on; application code uses
  `createGantt`, which is `createChart(options, container).gantt`.

  ```ts
  import { createChart } from '@ganttlane/dom/facade';

  const chart = createChart({ tasks, viewMode: 'week' });
  chart.gantt.setOptions({ theme: 'dark' }); // kept until the chart is mounted
  chart.mount(element); // or later, again and again: unmount(), mount(other)
  chart.gantt.destroy(); // ends the renderer and the core
  ```

- **`@ganttlane/dom/dom-utils`** holds the helpers the renderer and other renderers share, none of
  which knows the layers or the core: `createDisposables`, `listen` (the signal is required),
  `observeSize` / `measureSize`, `allocateIdPrefix` / `prefixedId`, the Pointer Events adapter
  (`pointerInput`, `keyInput`, `measureFrame`, `hitTargetOf`, `pointerOnScrollbar`), the drag
  autoscroll loop (`createAutoScroller`), popover placement (`placePopover`), scrolling helpers
  (`scrollByInstant`, `scrollHostOf`, `forwardScroll`) and the rule for markup that shows nothing
  (`showsNothing`).
- **The rest of the main entry:** `DISPLAY_DEFAULTS` and `resolveDisplay`, `DEFAULT_STRINGS` and
  `resolveStrings`, `LAYER_ORDER`, `VERSION`, and the types of every option and context.

## Accessibility

What the chart does today:

- The scroller is a **named, focusable region** (`role="region"`, `tabindex="0"`, `aria-label` from
  `strings.chartLabel`, default "Gantt chart"). The arrow keys scroll it, Page Up, Page Down, Home
  and End scroll the rows, and the focus ring (`:focus-visible`, `--gantt-focus-ring-*`) shows where
  the focus is.
- A **tooltip** is `role="tooltip"` and the bar it describes gets `aria-describedby`. A **link menu**
  is `role="menu"` with `role="menuitem"` buttons: the focus goes to its first item, Tab moves between
  the items, `Escape` closes it and gives the focus back to where it was.
- **Motion** respects `prefers-reduced-motion`: every transition is off.
- Colours come from tokens, in a light and a dark theme (`prefers-color-scheme` when `theme` is
  `'auto'`).

What it does not do yet (P1, planned for 1.0): bars, links and handles are not focusable and have no
roles, so a screen reader reads the chart as an unlabelled graphic apart from its region and its
tooltips; dragging has no keyboard equivalent (move and resize with arrow keys); changes are not
announced; the contrast of the default themes has not been audited against WCAG AA. If your users
rely on assistive technology, give them the same plan as a table or a list next to the chart, and
let them edit it there.

## Browser support

The last two versions of Chrome, Edge, Firefox and Safari, and iOS Safari 16.4 or newer. (16.4 is the
oldest iOS Safari that can load the core, which uses a regular expression with a lookbehind; the
stylesheet alone needs 16.2, for `color-mix()`.) The chart uses Pointer Events, `ResizeObserver`,
SVG, and in the stylesheet cascade layers, `:is()`, `overflow: clip` and `color-mix()`, see
[CSS support](#css-support). It is tested in Chromium, Firefox and WebKit (Playwright); real touch
input is tested in Chromium only, and iOS momentum scrolling is not tested automatically. React 18.3 and 19 for [`@ganttlane/react`](https://github.com/ganttlane/ganttlane/blob/main/packages/react/README.md).

## Size

Minified and gzipped, the JavaScript of this package is about 20 kB on top of
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#size), which is about 56 kB for the part `createGantt` uses.
The stylesheet (`@ganttlane/dom/styles.css`) is shipped as written, not minified: 24 kB, which is
6.2 kB gzipped. A build that minifies your CSS brings it to about 13.7 kB, under 3 kB gzipped.
`pnpm size` in the repository checks the budgets, `pnpm size:report --package dom` breaks the
package down by layer, and `pnpm bench` measures the performance numbers.

## Limits and roadmap

Limits you should know about today (**P1** means planned for 1.0):

- The container is an **element**, not a selector (`createGantt` throws a `TypeError` for anything
  else), and it should be empty. A chart in an open shadow root works (adopt the stylesheet into the
  root); a closed one is not supported.
- **A browser is needed.** `createGantt` draws into a DOM element: on a server import types only,
  or use `@ganttlane/core`. There is no server-rendered markup of the vanilla chart;
  `@ganttlane/react` renders its container on a server and draws the chart after hydration.
- **Left to right only.** `.gantt` sets `direction: ltr` whatever the page says; `direction: 'rtl'`
  is reported as unsupported.
- **No left-hand task list** and no toolbar. Line your own list up with the rows through
  `gantt.getRowMetrics(id)`; the toolbar options are reserved.
- **Bars are not selected by clicking** (`select()` and a click on an arrow select), and there is no
  keyboard editing, context menu, pinch or `Ctrl` + wheel zoom (`zoomTo()` zooms from code), sticky
  bar labels, expected-progress marker or markers.
- With `layout.height: 'auto'` no ancestor between the chart and what scrolls it may clip
  (`overflow: hidden`), and vertical autoscroll during a drag is not implemented.
- The infinite timeline trims its content down to about 4 000 000 px and never grows past twice
  that, because browsers cap the size of an element.
- The core's limits apply: floating time without time zones, a working day is 24 hours, `granularity`
  divides a day, a task spans at most 10 years (see
  [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#limits-and-roadmap)).

Planned for 1.0 (P1): zoom gestures and a toolbar, selection and keyboard navigation with ARIA roles
and keyboard editing, undo and redo hotkeys, a task list, markers, sticky labels and the
expected-progress marker, right-to-left charts, week-start and weekend defaults from the locale,
the `push-forward` propagation policy, a context menu, dev-time hints for old option names with a
frappe-gantt option adapter, and a generated API reference (the
[documentation site](https://ganttlane.github.io/ganttlane/) has the guides and live examples).

## Examples

[`examples/`](https://github.com/ganttlane/ganttlane/tree/main/examples) has copy-pasteable examples, one folder each, with the data, the options, the
vanilla code and the React code: a basic chart, controlled data, an edit session with Save and
Cancel, working days at hourly granularity, a custom tooltip and a release plan. They run live on the
[documentation site](https://ganttlane.github.io/ganttlane/examples/), next to the code that runs them. The playground is the demo of everything: `pnpm dev`
in the repository, then `/vanilla/`, `/edit/`, `/scroll/`, `/bench/`, `/react/`, `/react-edit/` and
`/react-ssr/` (the root README says [what each page shows](https://github.com/ganttlane/ganttlane/blob/main/README.md#the-playground)).

## License

[MIT](https://github.com/ganttlane/ganttlane/blob/main/LICENSE). See [NOTICE](https://github.com/ganttlane/ganttlane/blob/main/NOTICE) for attribution to frappe-gantt.

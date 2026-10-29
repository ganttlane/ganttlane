# @ganttlane/react

React bindings for [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md): a `<Gantt>` component and the `useGantt` /
`useGanttState` hooks. It is a wrapper over the vanilla renderer of [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md):
the chart in the page is the one `createGantt` draws, with the same DOM, classes, stylesheet,
pointer input and scrolling, and this package adds the React side: props for options, controlled and
uncontrolled state, handlers that are never stale, `ReactNode` slots for the tooltip, the link menu
and the bar label, a `ref` handle, StrictMode and server rendering.

> **Status:** pre-release (`0.0.0`), not published to npm yet. The API may still change before
> `0.1.0`. Compound components and a task list come later (see
> [Limits and roadmap](#limits-and-roadmap)).

Coming from frappe-gantt, or from a modified fork of it? See the [migration guide](https://github.com/ganttlane/ganttlane/blob/main/MIGRATION.md).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Props](#props)
  - [How props reach the chart](#how-props-reach-the-chart)
- [Controlled and uncontrolled](#controlled-and-uncontrolled)
  - [Edit mode: Save and Cancel](#edit-mode-save-and-cancel)
- [Events](#events)
- [Methods](#methods)
- [`patchTasks` on a server: `@ganttlane/react/core`](#patchtasks-on-a-server-ganttlanereactcore)
- [Hooks](#hooks)
- [Slots: tooltip, link menu and bar label as `ReactNode`](#slots-tooltip-link-menu-and-bar-label-as-reactnode)
- [The `ref` handle](#the-ref-handle)
- [StrictMode, server rendering and hidden trees](#strictmode-server-rendering-and-hidden-trees)
- [Theme and styling](#theme-and-styling)
- [Accessibility](#accessibility)
- [Browser and React support](#browser-and-react-support)
- [Size](#size)
- [Limits and roadmap](#limits-and-roadmap)
- [Examples](#examples)

## Install

```sh
pnpm add @ganttlane/react react react-dom
```

- React 18.3 or 19 (`react` and `react-dom` are peer dependencies, `^18.3.0 || ^19.0.0`).
  ESM only, with TypeScript declarations; TypeScript must resolve package `exports`
  (`moduleResolution` of `bundler`, `node16` or `nodenext`).
- `@ganttlane/react` depends on [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md) and
  [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md), so this one install is enough. **Strict pnpm** lets you
  import only what your own `package.json` lists, so this package re-exports what a React
  application meets: `patchTasks`, and every type that the props and the `ref` handle name, however
  deep (`Task`, `Link`, `TaskRecord`, `ChangeSet`, `Change`, `Conflict`, `SessionChanges`, `Issue`,
  `IssuesPayload`, `EditRefusedPayload`, `UpdateTaskResult`, `LinkType`, `SnapRule`, `ViewMode`,
  `TaskTooltipContext`, `LinkMenuContext`, `BarLabelContext`, `GanttStringsInput`, …), types only.
  For the building blocks (`createGanttCore` and the like) add `@ganttlane/core`, on the same version.
- **The stylesheet is a separate import**, once per page: `@ganttlane/react/styles.css`. It is a copy of
  [`@ganttlane/dom/styles.css`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#theme) that the build of this package makes, byte for
  byte, so that an app that installed only `@ganttlane/react` can import it (under strict pnpm the
  app cannot reach `@ganttlane/dom`, which is this package's dependency, not its own). Import one of
  the two, not both; the styles are the same and the classes, data attributes and `--gantt-*` custom
  properties are those of the vanilla chart. The package marks CSS as a side effect
  (`"sideEffects": ["**/*.css"]`), so that a bundler which drops unused imports of side-effect-free
  packages keeps the import. TypeScript 6 checks side-effect imports (`noUncheckedSideEffectImports`
  is on by default) and would report TS2882 for a file it has no declarations for: the stylesheet
  subpath has an (empty) declaration file of its own, so `import '@ganttlane/react/styles.css'`
  type-checks as it is.

## Quick start

```tsx
import '@ganttlane/react/styles.css';
import { Gantt } from '@ganttlane/react';

export function Plan() {
  return (
    <Gantt
      style={{ height: 480 }}
      defaultTasks={[
        { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
        { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
      ]}
      defaultLinks={[{ source: 'design', target: 'build' }]}
      defaultViewMode="week"
      scroll={{ initial: 'first-task' }}
      theme="auto"
      onTaskClick={(record) => {
        console.log(record.id);
      }}
    />
  );
}
```

- `<Gantt>` renders one `div` (give it `className` and `style`) and draws the chart into it. The
  container needs a height, as with `createGantt`: the chart fills it and scrolls inside it. Or
  give the chart its own with `layout.height`. `id`, `aria-*` and `data-*` props go to the same
  `div` as they are (`<Gantt id="plan" aria-label="Release plan" data-testid="plan" />`, typed as
  React types them); they are no options of the chart.
- `defaultTasks` and `defaultLinks` are where an **uncontrolled** chart starts: it owns the data and
  the handlers tell you what happened. To keep the tasks in your own state, pass `tasks` instead; see
  [Controlled and uncontrolled](#controlled-and-uncontrolled).
- A chart opens at today (`scroll.initial: 'today'`), which for a plan in the past or the future is
  the nearest end of its range; use `'first-task'` or `'start'` for fixed dates.
- The caller's props, tasks and links are never mutated.

## Concepts

The data model, the scheduling rules and the edit flow are the core's; the short version is in
[`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#concepts) and the details in
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#concepts). What this package adds:

- **Options are props.** Every option of `createGantt` is a prop, with the same name and type
  (`calendar`, `scheduling`, `layout`, `display`, `theme`, `locale`, `strings`, `tooltip`,
  `timeline`, `editing`, `history`, …), and so is every `on<Event>` handler. A prop that changes
  later changes the chart without recreating it.
- **Five groups can be controlled** by your state, with the React Aria naming: `tasks`, `links`,
  `viewMode`, `expandedKeys`, `selectedKeys`, each with a `default…` twin and a change handler.
- **Handlers are never stale**, so they may close over state and be new on every render.
- **Tooltip, link menu and bar label are `ReactNode`s**, drawn through portals in your tree.
- **A `ref` handle** gives the methods of the chart; **`useGantt`** is the component without the `div`
  and **`useGanttState`** reads the chart's state in your render.
- **StrictMode, server rendering and hidden `<Activity>` trees are supported.**

## Props

| Prop                                           | Type                            | Meaning                                                                                           |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `tasks` / `defaultTasks`                       | `Task<TData>[]`                 | The tasks: controlled / the start of an uncontrolled chart                                        |
| `links` / `defaultLinks`                       | `Link[]`                        | The links, the same way                                                                           |
| `viewMode` / `defaultViewMode`                 | `string` (a view mode id)       | The view mode                                                                                     |
| `expandedKeys` / `defaultExpandedKeys`         | `'all'` \| `TaskId[]`           | The expanded parents (in place of `hierarchy.expandedKeys`)                                       |
| `selectedKeys` / `defaultSelectedKeys`         | `TaskId[]`                      | The selected tasks                                                                                |
| `onLinksChange`                                | `(links) => void`               | The links after one was drawn or removed (your `links` with the change applied)                   |
| `renderTooltip`                                | `(context) => ReactNode`        | The tooltip of a task, as React: see [Slots](#slots-tooltip-link-menu-and-bar-label-as-reactnode) |
| `renderLinkMenu`                               | `(context) => ReactNode`        | The menu a click on an arrow opens                                                                |
| `renderBarLabel`                               | `(context) => ReactNode`        | The label of a bar                                                                                |
| `hierarchy`                                    | `{ childAnchor, moveChildren }` | The `hierarchy` group without `expandedKeys`, which is a prop of its own                          |
| `className`, `style`, `id`, `aria-*`, `data-*` | as React types them             | Go to the container `div`                                                                         |
| `renderer`                                     | `{ idPrefix, layers, frames }`  | Read when the chart is created and never again                                                    |

Every other option of [`createGantt`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#options) is a prop with the same name, type and
default: `calendar`, `scheduling`, `dates`, `layout` (with `height`), `timeline`, `scroll`, `locale`,
`strings`, `theme`, `display`, `highlights`, `tooltip`, `linkMenu`, `highlightTooltip`, `editing`,
`history`, `interaction`, `viewModes`, `now`, `direction`, `toolbar`, and the `on<Event>` handlers.

There is no `dataMode` prop: `tasks` makes the chart controlled and `defaultTasks` leaves it
uncontrolled. The full lists, types and defaults of the options are in
[`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#options) (the renderer's) and
[`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#options) (the data and the rules).

`TData`, the type of `task.data`, flows through `tasks` / `defaultTasks` into every handler and
render function.

### How props reach the chart

After every commit the component works out what changed since the last one and gives
`setOptions` exactly that, so a re-render costs nothing when nothing changed, and a prop that
changes costs what the same `setOptions` costs on the vanilla chart.

- **Compared by data, not only by identity.** An option written inline is the same option while
  its data is: `calendar={{ weekends: [0, 6] }}` or `tooltip={{ delay: 300 }}` on every render
  sends nothing. Arrays, plain objects and `Date`s are compared by their contents; **functions are
  compared by identity**, so an option object that holds a function (`tooltip.render`,
  `display.renderBarLabel`, `calendar.isWorkingDay`, `linkMenu.render`, `now`) changes on every
  render unless the function is memoized (`useCallback`, or defined outside the component).
- **Groups go field by field, the way `setOptions` merges them** (`calendar`, `dates`,
  `scheduling`, `hierarchy`, `layout`, `timeline`, `scroll`, `interaction`, `display`,
  `strings`). `scheduling={{ snap: '1h' }}` after `{ snap: '1h', propagation: 'none' }` sends
  `{ scheduling: { propagation: undefined } }`: `setOptions` alone would keep the old field,
  props do not. A group you drop altogether is reset the same way, field by field (not as one
  `undefined`, which would also reset what is the chart's own, such as the expanded parents an
  uncontrolled chart holds in `hierarchy`). `tooltip`, `linkMenu`, `highlightTooltip`, `editing`,
  `history`, `viewModes` and every list are taken whole.
- **A prop that goes away goes back to its default.** Remove `locale` and the chart is `'en'`
  again.
- **`tasks` and `links` are compared by identity.** The same array again is nothing; a new array
  is given to the core, which diffs it by id. Controlled `tasks` have a consequence: a new array is
  the owner's answer and **ends the draft** of a change you have not applied yet (the bar goes back
  to where your tasks have it), also when its content is the same. So **memoize the tasks you
  derive** (`useMemo`, or keep them in state), or any re-render of the parent (the `saving` state you
  set in `onTasksChange`!) would end the draft of the change that is being saved; and to
  **discard a draft** after a failed save, pass a new array (`setTasks((tasks) => [...tasks])`). In
  development a new array with the same content while a draft is pending is reported once. Links
  that equal the ones the chart has are not sent: giving them to an uncontrolled chart would end
  its undo history.
- **Handlers are always current.** The core is given one stable function per `on<Event>` prop that
  calls the latest one, so a handler that is new on every render, or closes over state, is never
  stale and never a `setOptions`. Giving a handler for the first time, or removing it, is the only
  change. A before-hook (`onBeforeTaskChange`, `onBeforeLinkCreate`) is a handler too, and its
  answer is the core's.
- **The first events arrive after the first commit.** What the chart emits while it is created and
  mounted (`onIssues` for the first options, `onRangeChange` with reason `'initial'`) is held back
  while the component renders and delivered in order once it is committed. Nothing in the
  application is called during a render. With `<Gantt ref>` they come after the `ref` is set, so
  `ref.current` is the handle in these handlers.
- **A handler that throws never breaks the commit.** What a handler throws while the chart is
  brought to the props (the first events, and the events a prop change causes) goes where the
  core sends the error of a listener: to `onError` (and the listeners of `instance.on('error')`)
  as `{ error, source: 'listener', name }`, `name` being the event (`'rangeChange'`), one call for
  each error, and the other handlers still run. With nobody listening to `error` it is rethrown
  outside the commit, to the host's unhandled-rejection channel, as the core does (one error as it
  is, several as an `AggregateError`). The same holds where the core drives the chart: a click.
- **The issues of the options** are one list, as on the vanilla chart: `onIssues`, and
  `instance.getIssues()`.

## Controlled and uncontrolled

Five groups follow the React Aria convention (`value` / `defaultValue` / `onValueChange`):

| Value prop     | Start value           | Handler (arguments as in [Events](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#events)) |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tasks`        | `defaultTasks`        | `onTasksChange(changeSet)`                                                                                         |
| `links`        | `defaultLinks`        | `onLinksChange(links)` (also `onLinkCreate`, `onLinkDelete`)                                                       |
| `viewMode`     | `defaultViewMode`     | `onViewModeChange(viewMode)`, the `ViewMode` (read its `id`)                                                       |
| `expandedKeys` | `defaultExpandedKeys` | `onExpandedChange(expandedKeys)`                                                                                   |
| `selectedKeys` | `defaultSelectedKeys` | `onSelectionChange(selectedKeys, selectedLink)`                                                                    |

A group is **controlled** when its value prop is not `undefined` the first time the chart
renders, **uncontrolled** otherwise, and keeps that mode for the life of the component. A switch
(`viewMode={undefined}` on a later render, or a `viewMode` that appears) is reported once in
development with `console.warn` and ignored: a controlled group holds the last value it had, an
uncontrolled one ignores the new prop.

**Data that loads is the exception.** `tasks={data?.tasks}` is `undefined` until the data is
there, and a chart that ignored the tasks that then arrive would stay empty for good. So `tasks`
(and `links`) going from `undefined` to a value **makes the group controlled** from then on: the
value is applied (the chart becomes `dataMode: 'controlled'`), and development warns once. Going
from a value back to `undefined` is the switch above: the chart keeps the last tasks. To avoid
the warning, pass `tasks={data?.tasks ?? []}` from the first render.

- **Uncontrolled.** The chart keeps the value, `default…` is where it starts, and the handler
  only tells you what happened. A different `default…` later is not a change.
- **Controlled.** The prop is the truth. The chart follows it whenever it changes (and tells no
  handler about it: you caused it). When the chart changes the value itself (the user selects a
  link, a method such as `instance.collapse('p')` runs) the handler is called, the component
  renders again, and if the prop did not change the chart is set back to it. So the value changes
  only when your state does.
- **`tasks` is the exception** to "set back". Controlled tasks run the core with
  `dataMode: 'controlled'`: the core never changes them, every committed change is a `ChangeSet`
  given to `onTasksChange`, and it is **shown as a draft** until you pass the new tasks back, so
  you may take your time (a save request) without the bar jumping back. Write the change set into
  your own tasks with `patchTasks`:

  ```tsx
  import { useState } from 'react';

  import { type ChangeSet, patchTasks, type Task, useGantt } from '@ganttlane/react';

  export function Plan({ initialTasks }: { initialTasks: Task[] }) {
    const [tasks, setTasks] = useState(initialTasks);
    // Give the handler a return type: it reads `gantt`, which it is passed to.
    const apply = (changes: ChangeSet): void => {
      // `patchTasks` writes dates in the form the task has (Date, ISO string, epoch ms).
      const { model } = gantt.core.getSnapshot().state.derived;
      setTasks((current) => patchTasks(current, changes, model));
    };
    const gantt = useGantt({ tasks, onTasksChange: apply });
    return <div ref={gantt.setContainer} style={{ height: 480 }} />;
  }
  ```

  Passing the same array again is a no-op. A new array, even an equal one, is your answer and
  ends a pending draft: memoize what you derive, and pass a new array to discard a draft after a
  failed save (see above). A controlled chart with editing on (the default; `editing: false`
  turns off editing from the UI) and no `onTasksChange` is reported once in development: the
  change would never be given to you.

- **Links.** `links` is controlled like the others. With controlled `tasks`, pass `links` too: a
  link the user draws or removes is not applied until you pass the new list back, and
  `onLinksChange` gives you that list (your `links` with the change). A link that comes from
  `task.dependencies` is in no list of links, so deleting one leaves `links` as it was and only
  `onLinkDelete` reports it. `defaultLinks` with controlled `tasks` starts the links but leaves the
  application to keep them.
- **Selection.** `selectedKeys` is the selected tasks; the selected link (a click on an arrow) is
  the chart's own and survives it. Keys that name tasks the chart does not have yet are selected
  when the tasks arrive (`tasks` loaded later), and a `defaultSelectedKeys` that names tasks that
  load later is finished the same way, until the user (or a method) selects something else. A key
  that names no task at all is ignored.
- **`expandedKeys`** replaces `hierarchy.expandedKeys` (a `hierarchy` prop holds the other
  hierarchy options). `'all'` or a list of ids.

### Edit mode: Save and Cancel

An edit session (`instance.edit.begin()`, `commit()`, `rollback()`, see [Methods](#methods))
works with controlled `tasks` and `links` as it does on the vanilla chart, with one more step
that is yours: the chart does not change controlled data, so what a **Cancel** puts back arrives as
`onEditRollback` (the inverse of the session) and you write it into your state, the way you write
`onTasksChange`.

```tsx
import { useState } from 'react';

import {
  type ChangeSet,
  type Link,
  patchTasks,
  type SessionChanges,
  type Task,
  useGantt,
} from '@ganttlane/react';

const INITIAL_TASKS: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
];
const INITIAL_LINKS: readonly Link[] = [{ source: 'design', target: 'build' }];

const linkId = (link: Link): string =>
  link.id ?? `${String(link.source)}:${link.type ?? 'FS'}:${String(link.target)}`;

// The links after a cancelled session: `removed` are to drop, `added` to restore. They are the
// chart's link models: `model.id` is the link's id and `model.link` is your own `Link`.
function restoreLinks(links: readonly Link[], { added, removed }: SessionChanges['links']): Link[] {
  const dropped = new Set(removed.map((model) => model.id));
  return [
    ...links.filter((link) => !dropped.has(linkId(link))),
    ...added.flatMap((model) => model.link ?? []),
  ];
}

export function Plan() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [links, setLinks] = useState(INITIAL_LINKS);

  // A committed change (`onTasksChange`) and the inverse of a cancelled session
  // (`onEditRollback`) are both written with `patchTasks`.
  const apply = (changes: ChangeSet): void => {
    const { model } = gantt.core.getSnapshot().state.derived;
    setTasks((current) => patchTasks(current, changes, model));
  };

  const gantt = useGantt({
    tasks,
    links,
    editing: true,
    onTasksChange: apply,
    onLinksChange: setLinks,
    onEditRollback: (changes) => {
      apply(changes);
      setLinks((current) => restoreLinks(current, changes.links));
    },
  });

  return (
    <>
      <button type="button" onClick={() => gantt.edit.begin()}>
        Edit
      </button>
      <button type="button" onClick={() => gantt.edit.commit()}>
        Save
      </button>
      <button type="button" onClick={() => gantt.edit.rollback()}>
        Cancel
      </button>
      <div ref={gantt.setContainer} style={{ height: 480 }} />
      {gantt.slots}
    </>
  );
}
```

`commit()` returns `{ status: 'committed', changes }` with the net changes of the session
(`SessionChanges`; `'no-session'` or `'busy'` mean nothing was committed), and the data is already
yours (every gesture was applied as it happened);
`edit.getChanges()`, `edit.isOpen` and `edit.isDirty` tell where the session stands, and the session
is part of the snapshot (`state.session`), so
`useGanttState(gantt, (snapshot) => snapshot.state.session !== undefined)` re-renders the buttons.
The `ref` handle is a source of snapshots like the instance of `useGantt`. The full recipe, with a
Save that sends the plan to a server and puts the last saved plan back when that fails, is in
[`examples/edit-session`](https://github.com/ganttlane/ganttlane/tree/main/examples/edit-session). A restored link is the `link` of
the model the session kept (`model.link`, your own `Link`; none for a link that came from
`task.dependencies`). The playground page `/react/`
([`apps/playground/src/react-app.tsx`](https://github.com/ganttlane/ganttlane/blob/main/apps/playground/src/react-app.tsx)) is this recipe in
full: view and edit mode, Save and Cancel with the changes panel, theme and locale as props, the
`ReactNode` slots and an event log.

An edit session also ends, as a Cancel, when a hidden `<Activity>` takes the chart away; see
"StrictMode, server rendering and hidden trees" below.

## Events

Every event of the chart is an `on<Event>` prop, with the arguments listed under
[Events](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#events) in the `@ganttlane/dom` README: `onTasksChange`,
`onTaskDatesChange`, `onTaskProgressChange`, `onLinkCreate`, `onLinkDelete`, `onLinkClick`,
`onTaskClick`, `onTaskDoubleClick`, `onTaskHoverChange`, `onSelectionChange`, `onViewModeChange`,
`onRangeChange`, `onExpandedChange`, `onScroll`, `onEditRollback`, `onDirtyChange`,
`onHistoryChange`, `onEditRefused`, `onIssues` and `onError`. This package adds `onLinksChange`
(the links after one was drawn or removed), and the two before-hooks, `onBeforeTaskChange` and
`onBeforeLinkCreate`, are props too.

- `onViewModeChange` receives the `ViewMode` object (read its `id`); `onSelectionChange` receives
  `(selectedKeys, selectedLink)`; `onExpandedChange` the expanded keys.
- A handler may close over state and be a new function on every render: the chart is given one
  stable function per event that calls the latest one (see [How props reach the
  chart](#how-props-reach-the-chart)).
- What a handler throws goes to `onError` (`{ error, source: 'listener', name }`), never into React.
- Listeners that are not tied to a render (a log, an analytics call) can be added to the instance
  or the handle with `on(name, handler)`, which returns a function that removes them.

## Methods

The methods of the chart are the ones of the vanilla [`Gantt`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#methods), without
`destroy`, which React does for you, on two objects: the **`ref` handle** of `<Gantt>`
(`useRef<GanttHandle>(null)`) and the **instance** `useGantt` returns. They are data
(`setTasks`, `setLinks`, `updateTask`, `addLink`, `removeLink`), `setOptions` (an escape hatch: a prop
that changes later wins over it), the view and scrolling (`setViewMode`, `zoomTo`, `scrollToDate`,
`scrollToToday`, `scrollToTask`), rows (`expand`, `collapse`, `expandAll`, `collapseAll`), selection
(`select`, `selectLink`, `clearSelection`), queries (`getTask`, `getLink`, `getVisibleRange`,
`getRowMetrics`, `getBarRect`, `getIssues`), `hideTooltip`, the edit session (`edit.begin`,
`commit`, `rollback`, `getChanges`, `isOpen`, `isDirty`), history (`undo`, `redo`, `canUndo`,
`canRedo`; they need `history: true`), `on` and `core`, plus `getSnapshot()` and `subscribe()`. See
[The `ref` handle](#the-ref-handle) and [Hooks](#hooks) for how to hold them.

## `patchTasks` on a server: `@ganttlane/react/core`

The main entry starts with `'use client'`, since everything in it is a component or a hook. A
server component (or a server action, a route handler) that imports `patchTasks` from it does not
get the function but a reference to a client module, which it cannot call. `@ganttlane/react/core`
has no directive and nothing of React in it: it exports `patchTasks` and the types of the data you
give, the events you get and the results of the handle's methods (`Task`, `ChangeSet`,
`SessionChanges`, `TaskRecord`, `Link`, `UpdateTaskResult`, …), the same ones the main entry exports.

```ts
// In a module that server code and client code share, or in a server action.
import { patchTasks, type ChangeSet, type Task } from '@ganttlane/react/core';
```

`patchTasks(tasks, changes, model)` takes the `model` of a core (`core.getSnapshot().state.derived.model`),
so on a server it goes with a core made there (`createGanttCore` of `@ganttlane/core`); the types
need nothing. In client code the main entry exports the same function.

## Hooks

### `useGantt(options)`

`useGantt` is the component without the `div`: `<Gantt {...options} />` is
`useGantt(options)`, `<div ref={gantt.setContainer} />` and `{gantt.slots}`. It returns an **instance**, the same
object for the life of the component, with the methods of the vanilla
[`Gantt`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#methods) (`setTasks`, `updateTask`, `setViewMode`, `scrollToTask`,
`select`, `edit.begin` / `commit` / `rollback`, `undo`, `on`, queries, …) without `destroy`
(React ends the chart), and:

| Member                  | What it is                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `setContainer(element)` | The ref of the element the chart fills: drawn while attached, removed when detached |
| `slots`                 | The portals of the `ReactNode` slots, to render next to the container (see Slots)   |
| `core`                  | The headless core (`GanttCore`), the same object for the life of the component      |
| `getSnapshot()`         | The core's current snapshot                                                         |
| `subscribe(listener)`   | Calls `listener` after every change of the snapshot                                 |

The core is made while the component renders, so `instance.getTask(…)` and `getSnapshot()` already
answer in the first render and on a server. The renderer is drawn when a container is attached.
The first events (those of the creation) reach the handlers in the last layout effect of
`useGantt`, so a layout effect you declare after the hook runs after them; `<Gantt>` sets its `ref`
before them. `instance.setOptions(patch)` is an escape hatch: a prop that changes later wins over it.

`instance.core` is **one object whichever core is behind it**, like the instance: it stands for
the core the chart has now, which is a new one when a hidden `<Activity>` shows the chart again,
and its `getSnapshot`, `subscribe` and `on` follow the chart. So it can be kept, and given to
`useGanttState(instance.core, …)`, which keeps reading the chart after that.

### `useGanttState(instance, selector, isEqual?)`

Reads a slice of the snapshot through `useSyncExternalStore` and renders again only when the
slice changes:

```tsx
import { useGantt, useGanttState } from '@ganttlane/react';

export function Status() {
  const gantt = useGantt({ defaultTasks: tasks, defaultViewMode: 'week' });
  const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);
  const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks);
  return (
    <>
      <div ref={gantt.setContainer} style={{ height: 480 }} />
      {gantt.slots}
      <p>
        {mode}, {selected.length} selected
      </p>
    </>
  );
}
```

The selector may be written inline. The default `isEqual` is `Object.is`: pick primitives or parts
of the snapshot, which keep their identity until they change. A selector that builds a new object
or array each time needs an `isEqual` (a shallow one), or the component renders on every change
of the chart. `useGanttState` also takes a core made with `createGanttCore`. It has a server
snapshot, so it works in a server render and hydrates.

## Slots: tooltip, link menu and bar label as `ReactNode`

Three places of the chart have content of their own: the tooltip of a task, the menu a click on a
link opens, and a bar's label. Each takes a function that returns a `ReactNode`, which React draws
through a portal into the node the vanilla renderer shows there:

```tsx
import { Gantt } from '@ganttlane/react';

// `TaskCard` and `LinkMenu` are your own components.
export function Plan() {
  return (
    <Gantt
      style={{ height: 480 }}
      defaultTasks={tasks}
      tooltip={{ trigger: 'click' }}
      display={{ barLabel: 'outside' }}
      renderTooltip={({ task, preview, isDragging }) => (
        <TaskCard task={task} dates={preview} dragging={isDragging} />
      )}
      renderLinkMenu={({ source, target, canRemove, remove }) => (
        <LinkMenu from={source?.name} to={target?.name} onRemove={canRemove ? remove : undefined} />
      )}
      renderBarLabel={({ name, progress }) => (
        <b>
          {name} {Math.round(progress)}%
        </b>
      )}
    />
  );
}
```

| Prop             | Called with                            | Same as in `createGantt` |
| ---------------- | -------------------------------------- | ------------------------ |
| `renderTooltip`  | `TaskTooltipContext` (`api.hide()`)    | `tooltip.render`         |
| `renderLinkMenu` | `LinkMenuContext` (`remove()`)         | `linkMenu.render`        |
| `renderBarLabel` | `BarLabelContext` (id, name, progress) | `display.renderBarLabel` |

- **Your tree, your context.** The portals are rendered next to the container, so what is in them
  sees the providers above `<Gantt>` (theme, i18n, a store), reads your state and can use hooks:
  each tooltip, menu or label is the body of a component of its own (see "Hooks in the function"
  below), drawn once for each the chart shows. For labels that is one portal per visible bar, which is the cost to know: measured on
  the playground (`/react/?slots=1`), 107 bars in a 5000 px tall chart are 107 portals that mount
  in 5 to 20 ms (Firefox to WebKit) and leave the frame time of a scroll unchanged at normal CPU
  speed in Chromium, Firefox and WebKit. Keep the logic in a component and return an element:
  `renderTooltip={({ task }) => <TaskCard task={task} />}`.
- **Always the latest function, and no churn.** The function is read when the portals draw, like a
  handler: a new one on every render (an inline arrow function) is no option change and costs
  the chart nothing. A state change in the parent draws the portals again, without making the
  popover or the bar again; the state _inside_ the content (a counter, an input) survives the chart
  making its tooltip again for the same task (a drag preview, a new record), because the tooltip,
  the menu or the label of one task or link keeps the same host while the chart shows it.
- **Nothing leaks.** A portal is unmounted when its tooltip or menu closes (the hover leaves, a
  press outside, Escape, `api.hide()`), when the tooltip is replaced by another task's, when a bar
  leaves the window, when labels are hidden (`display.barLabel: 'none'`) or replaced, and when the
  chart unmounts, under StrictMode too. The renderer tells React through a small contract
  (`DisposableNode` in [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md)).
- **Empty is nothing.** `null`, `undefined`, `false`, `''`, whitespace and elements that wrap
  nothing (`<div />`, `<p> </p>`) show no tooltip or menu, as `null` does for `tooltip.render`; an
  element that draws without text (an `img`, an `svg`, an `input`, a `button`) is something. A box
  that CSS alone draws (a colour swatch) counts as nothing: give it an `svg` or some text. A
  tooltip whose content becomes empty while it is open closes. It is the rule of `{ html }` in
  the vanilla popover (`showsNothing` in `@ganttlane/dom/dom-utils`).
- **Pointer events and focus.** A menu, and a tooltip that stays open (`tooltip.trigger: 'click'`),
  take pointer events, so buttons and inputs in them work; a hover tooltip is for reading and
  takes none (it closes when the pointer leaves the bar). The menu moves the focus to its first
  button unless your content has taken it (`autoFocus`), and Escape and a press outside close it.
  The focus and what is typed in an `<input>` in a tooltip, menu or label survive the chart
  making it again (a controlled `tasks` that follows every keystroke is the case): the host is
  kept in the page, never taken out and put back. A bar's label takes no pointer events.
- **In the document.** A tooltip or menu is drawn when its host is in the page and about to be
  measured, so `autoFocus`, a layout effect that reads a size and a `ref` that measures see
  attached nodes. The popover is placed by what you drew.
- **Portals inside the content.** A select, a menu or a date picker in your content that renders
  into `document.body` (its own `createPortal`, however deep) is part of the content: a press on
  it is not a press outside, and a scroll of its list does not close the popover. This is read off
  React's fiber tree (the nearest rendered ancestor of the pressed element leads, through
  `return`, to the portal of the host), because the chart asks in the capture phase of the
  document, before React has seen the event; it reads a private pointer of React 18 and 19, and
  if a future React changes it a press in such a portal closes the popover, as any press outside.
- **Labels and `'auto'` placement.** The chart does not measure what React draws (it never reads
  layout while it renders), and the node of a label is kept between draws, holding what was drawn
  last: the width of a React label is not known, and not guessed from that text. `'auto'`
  places a React label **inside** the bar (clipped to it), the same on every draw whatever the
  label said before; it goes outside only in a bar narrower than the label's padding. Choose
  `'inside'` or `'outside'` for a label that needs the one or the other (outside, the label does
  not clip). A tooltip is sized when it opens and is not measured again, so content whose size
  changes while it is open is not placed again.
- **Hooks in the function.** The function is called as the body of the slot's component, so it
  may use hooks, and they stay: **the same hooks in the same order** for as long as the function
  is the one the slot shows. A function that is new on every render (an inline arrow) is the same
  function as far as this goes, and the state in it survives. A _different_ function with other
  hooks (`renderTooltip={compact ? renderCompact : renderFull}`) is another component: give each
  its own `slotKey` and the slot starts it anew with no error:

  ```tsx
  import type { TaskTooltipContext } from '@ganttlane/react';

  // `Compact` is your own component.
  const renderCompact = Object.assign((c: TaskTooltipContext) => <Compact {...c} />, {
    slotKey: 'compact',
  });
  ```

  Without a `slotKey` React cannot tell the swap, and throws when the hooks differ in number; the
  slot catches that, starts the new function anew once and shows it (React still logs the
  error in development), and hooks of the same number and other kinds go unnoticed, so key the
  functions that differ. Keeping the logic in a component (`<TaskCard task={task} />`) avoids all
  of it.

- **A function that throws.** What the function throws while React renders its content does not
  unmount your app: it is caught around the slot, the tooltip or menu is hidden (`api.hide()`), a
  label draws nothing, and the error is reported to `onError`, as the errors of the vanilla
  functions are (to the page, with `reportError`, when there is no handler). The slot is drawn
  again when its context or its function changes. Errors in event handlers and effects are yours,
  as everywhere in React.
- **Not on a server.** There is no renderer on a server, so there are no portals: the server
  markup is the container `div` only, and the slots are drawn after hydration.
- **With `useGantt`**, render `slots` next to the container: a stable element that draws the
  portals and updates itself. A slot given and not drawn is reported once in development.
  Destructure it together with `setContainer`, which keeps the lint rules of React
  (`react-hooks/refs`) quiet:

  ```tsx
  import { useGantt } from '@ganttlane/react';

  export function Plan() {
    const { setContainer, slots } = useGantt({
      defaultTasks: tasks,
      renderTooltip: (context) => <TaskCard task={context.task} />,
    });
    return (
      <>
        <div ref={setContainer} style={{ height: 480 }} />
        {slots}
      </>
    );
  }
  ```

- **The vanilla functions still work** (`tooltip.render`, `linkMenu.render`,
  `display.renderBarLabel`, returning a `Node` or `{ node, dispose }`); when both are given the
  slot is used and one warning says so in development.

## The `ref` handle

`<Gantt ref>` is the chart's handle: the object of `useGantt` without what is for React
(`setContainer`, `slots`), so the methods of [Methods](#methods), `core`, `getSnapshot()` and
`subscribe()`.

```tsx
import { useRef } from 'react';

import { Gantt, type GanttHandle } from '@ganttlane/react';

export function Plan() {
  const chart = useRef<GanttHandle>(null);
  return (
    <>
      <button type="button" onClick={() => chart.current?.scrollToTask('build')}>
        Go to Build
      </button>
      <Gantt ref={chart} defaultTasks={tasks} style={{ height: 480 }} />
    </>
  );
}
```

- **The same object for the life of the component**, set when the chart is committed (before the
  layout effects of the parent, which may use it at once, and before the handlers hear of the
  first events) and `null` after the component unmounts, and while a hidden `<Activity>` has the
  chart. It survives StrictMode (the one object, one chart). It is an object of its own, frozen,
  without `setContainer` and `slots`: they are not there at run time either.
- **Typed with `TData`.** `GanttHandle<TData>` is the handle of a chart of `Task<TData>`:
  `useRef<GanttHandle<Row>>(null)` goes with `defaultTasks` of `Task<Row>[]` (or `<Gantt<Row> …>`),
  and another `TData` is a type error.
- **`forwardRef`, which works in React 18.3 and 19.** A `forwardRef` component cannot be generic,
  so `Gantt` is `forwardRef` cast to a generic function component. Do the same to wrap `<Gantt>`
  in a component of your own that keeps the `ref` and the `TData` type:

  ```tsx
  import { type ForwardedRef, forwardRef, type ReactElement, type RefAttributes } from 'react';

  import { Gantt, type GanttHandle, type GanttProps } from '@ganttlane/react';

  function PlanImpl(props: GanttProps, ref: ForwardedRef<GanttHandle>): ReactElement {
    return <Gantt {...props} ref={ref} className="plan" />;
  }

  export const Plan = forwardRef(PlanImpl) as <TData = unknown>(
    props: GanttProps<TData> & RefAttributes<GanttHandle<TData>>,
  ) => ReactElement | null;
  ```

  With React 19 only, `ref` as a prop would do without `forwardRef`; this package does not need
  19 for it.

- **One object.** With `useGantt` the handle is the instance the hook returns, and `ref` is for when
  you render `<Gantt>` and want its methods.

## StrictMode, server rendering and hidden trees

- **StrictMode.** Mount, unmount, mount leaves one chart, no leaked listener, timer or
  subscription, and the instance, and its core, stay the same. The renderer is drawn into the
  container each time it is attached; the core is destroyed only when the component really goes:
  an effect cleanup cannot tell a real unmount from StrictMode's, so the core is destroyed a
  microtask after the cleanup, if the effects were not set up again by then.
- **Server rendering.** Importing the package reads no `window` or `document`. A server render
  gives the container (`<div class="…" style="…"></div>`) and creates, but does not draw, the
  chart: nothing runs there but render. Hydration keeps the server's `div` and draws the chart
  into it before the browser paints. `useGanttState` reads the same snapshot on the server and in
  the browser. The entry of the built package starts with `'use client'`.
- **`<Activity mode="hidden">` (React 19.2).** React tears effects down for a hidden tree and
  sets them up again when it is shown, with the state kept. The core of a chart cannot be
  restarted, so the chart is made again from the latest props and what the old core held: the
  uncontrolled tasks, links, view mode, expanded parents and selected tasks, the selected link, the
  zoom (`zoomTo`) and the date at the left edge of the viewport (the chart opens where it was
  scrolled to, the vertical position is not kept). Listeners added with `instance.on` and
  `instance.core.on`, `useGanttState` subscribers and `instance.core.subscribe` move to the new
  core, and `instance.core` is the same object. What is **not** carried over is told to the
  application when the chart is shown:
  - **An open edit session ends as a Cancel.** It is rolled back (the data is what it was when
    `edit.begin()` ran, the edits are not kept), and the application hears what a rollback tells,
    in its order: `onHistoryChange` (when there was undo history, which is not carried either),
    `onDirtyChange({ isDirty: false })` (when the session was dirty) and `onEditRollback` with the
    inverse, which a controlled chart writes into its tasks with `patchTasks` like any Cancel. So an
    "unsaved changes" flag that follows `onDirtyChange` clears together with the data, and no
    half-open session survives. Nothing is said while the chart is hidden, and nothing when the
    component is really unmounted.
  - **While hidden, the chart is gone.** `ref.current` of `<Gantt ref>` is `null` (React detaches
    refs of a hidden tree), and the commands of an instance you kept (`select`, `updateTask`,
    `edit.begin`, …) do nothing and are not queued; its queries (`getTask`, `getSnapshot`)
    answer from the state the chart had. Call them after it is shown.

## Theme and styling

The theme, the tokens and the unstyled contract are those of the vanilla chart, because the DOM and
the stylesheet are the same: see [Theme](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#theme) (the `--gantt-*` token table,
light and dark themes, per-element colours) and the
[unstyled contract](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#unstyled-contract) (the stable classes and `data-*`
attributes) in the `@ganttlane/dom` README. In short:

- `theme="auto" | "light" | "dark"` is a prop (`'auto'` follows `prefers-color-scheme`), and changing
  it costs no redraw.
- Re-theme with custom properties on `.gantt`, or on a class of the container, which is the parent of
  `div.gantt`. All of the library's CSS is in `@layer gantt`, so styles of your own win without
  `!important`:

  ```tsx
  import { Gantt } from '@ganttlane/react';

  export const Plan = () => (
    <Gantt className="roadmap" defaultTasks={tasks} style={{ height: 480 }} />
  );
  ```

  ```css
  .roadmap .gantt {
    --gantt-bar-color: #0f766e;
    --gantt-today-color: #b45309;
  }
  ```

- `task.className` is added to the bar's `g.gantt__bar`, and `task.color` / `task.progressColor` set
  the bar's colours, so status colours are one class each.
- Text the chart writes itself (the tooltip's lines, the link menu, the region's label) is the
  `strings` prop; dates and numbers follow the `locale` prop. See
  [Locale and strings](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#locale-and-strings).

## Accessibility

The chart is the vanilla chart, so its accessibility is that of
[`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#accessibility): a named, focusable scroller region (its label is
the `strings.chartLabel` prop), tooltips with `role="tooltip"` and `aria-describedby`, link menus with
`role="menu"`, focus rings and `prefers-reduced-motion`. Bars, links and handles are not focusable
yet, and dragging has no keyboard equivalent (P1, together with ARIA roles and announcements).

What React adds: `id`, `aria-*` and `data-*` props go to the container `div`, and the content you
draw through the [slots](#slots-tooltip-link-menu-and-bar-label-as-reactnode) is your React, so its
semantics, labels and focus behaviour are yours. A tooltip or menu that holds buttons or inputs is
interactive (`tooltip.trigger: 'click'`, or a link menu): it takes pointer events, a link menu also
moves the focus to its first button, and `Escape` or a press outside closes it. Until bars are focusable, give users who rely on
assistive technology the same plan as a table or a list next to the chart.

## Browser and React support

React 18.3 and 19 (peer dependencies `^18.3.0 || ^19.0.0`; `react-dom` for portals and `flushSync`).
Nothing here uses an API that is only in 19: no `use`, no `ref` as a prop (`forwardRef`), no
`useEffectEvent`. Browsers as in [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#browser-support).

The whole unit test suite of the package runs twice, against React 19 and against React 18.3.1 (the
`react` and `react-18` Vitest projects of the repository), and the sources and tests are type-checked
against `@types/react` 19 and 18. The playground page (`/react/`) is also run in Chromium, Firefox
and WebKit, in a production build, in one with React's development bundles (StrictMode, which makes
React report its warnings) and in one with React 18.3, and as server-rendered markup that the
browser hydrates (`/react-ssr/`). What differs on 18.3:

- **StrictMode renders a component twice on its first render and keeps the second pass's state**
  (19 reuses the first pass's). The first pass of `useGantt` makes a core that is never committed
  and nothing holds, so it is garbage: it has no timer, listener or subscription of its own.
- **`<Activity>` is 19.2 only.** A chart in a hidden `<Activity>` is made again when it is shown (see
  above); on 18.3 there is no such component.
- **A server render that has a `document`** (a test with jsdom or happy-dom, not a server) makes
  React 18 report that `useLayoutEffect` does nothing on the server. The component uses
  `useEffect` where there is no `document`, so a server proper never sees it; render with `document`
  and `window` hidden, or ignore the message in such a test. React 19 does not report it.
- **Type packages.** With `@types/react` 18, `useRef<GanttHandle>(null)` is a read-only
  `RefObject<GanttHandle>` and with 19 a `RefObject<GanttHandle | null>`; both are a valid `ref`.

## Size

`@ganttlane/react` adds about 6.5 kB (min + gzip) to what an application already ships of
`@ganttlane/core` and `@ganttlane/dom` (budget 10 kB), React excluded.

## Limits and roadmap

Limits you should know about today:

- **Compound components, headless hooks as a public API, React Aria integration and a `TaskList`
  component are not here yet** (planned, P1). What exists is `<Gantt>`, `useGantt`,
  `useGanttState`, the `ref` handle and the three slots.
- A hidden `<Activity>` takes the chart away and brings a new one back: uncontrolled data, view mode,
  expanded parents, selection and zoom are carried over, but an open edit session ends as a Cancel
  and the undo history is cleared (see
  [StrictMode, server rendering and hidden trees](#strictmode-server-rendering-and-hidden-trees)).
- A React label does not have a measurable width, so `display.barLabel: 'auto'` puts it inside the
  bar; choose `'inside'` or `'outside'`. Each visible bar's label is one portal.
- The server renders the container only; the chart is drawn after hydration.
- Controlled `tasks` need `onTasksChange` while editing is on (development warns), and a new array
  with equal contents ends a pending draft.
- The limits of the renderer and the core apply too: left to right only, no toolbar, no zoom
  gestures, no selection by clicking a bar, no keyboard editing, floating time without time zones,
  and so on. See [`@ganttlane/dom`](https://github.com/ganttlane/ganttlane/blob/main/packages/dom/README.md#limits-and-roadmap) and
  [`@ganttlane/core`](https://github.com/ganttlane/ganttlane/blob/main/packages/core/README.md#limits-and-roadmap).

## Examples

[`examples/`](https://github.com/ganttlane/ganttlane/tree/main/examples) has [a basic chart](https://github.com/ganttlane/ganttlane/tree/main/examples/basic),
[controlled data](https://github.com/ganttlane/ganttlane/tree/main/examples/controlled-data),
[an edit session with Save and Cancel](https://github.com/ganttlane/ganttlane/tree/main/examples/edit-session),
[a custom tooltip](https://github.com/ganttlane/ganttlane/tree/main/examples/custom-tooltip) and
[a release plan](https://github.com/ganttlane/ganttlane/tree/main/examples/release-plan), each with a `react.tsx`. They run live on the
[documentation site](https://ganttlane.github.io/ganttlane/examples/), next to their code. The playground page `/react/`
([`apps/playground/src/react-app.tsx`](https://github.com/ganttlane/ganttlane/blob/main/apps/playground/src/react-app.tsx)) is the whole
library in one page: view and edit mode, Save and Cancel with a changes panel, theme and locale as
props, the `ReactNode` slots and an event log; run it with `pnpm dev` in the repository.

## License

[MIT](https://github.com/ganttlane/ganttlane/blob/main/LICENSE). See [NOTICE](https://github.com/ganttlane/ganttlane/blob/main/NOTICE) for attribution to frappe-gantt.

# Vanilla controlled data

By default the chart owns the tasks: a drag changes its own copy and tells you. With
`dataMode: 'controlled'` **you** own them, for an application whose tasks live in a store, a query
cache or a database. The chart never changes your tasks; instead:

- every committed change (a drag, `updateTask`, an undo with `history: true`) is reported once, as
  a `ChangeSet`, to `onTasksChange`, and is shown as a **draft** over your tasks;
- you write it into your own tasks with `patchTasks` from `@ganttlane/core`, which keeps the shape of
  each task (ISO strings stay ISO strings, a `duration` stays a `duration`);
- you hand the result back with `setTasks`, which ends the draft. Handing back the old tasks refuses
  the change: the bar goes back to where your data has it.

While a change waits for your answer the chart is busy: no new drag starts. That makes a save
request a natural place to answer from, as below.

```sh
pnpm add @ganttlane/dom @ganttlane/core
```

`@ganttlane/dom` re-exports the _types_ of the core (`Task`, `Link`, `ChangeSet`, …) but not its
runtime functions, so `patchTasks` is imported from `@ganttlane/core`: add it to your own
`package.json`, on the same version.

`main.ts`:

```ts
import '@ganttlane/dom/styles.css';
import { patchTasks } from '@ganttlane/core';
import { createGantt, type Link, type Task } from '@ganttlane/dom';

const container = document.querySelector<HTMLElement>('#chart'); // give it a height in CSS
if (!container) throw new Error('#chart not found');

// Your own state: two variables here, a store in an application.
let tasks: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  { id: 'test', name: 'Test', start: '2026-03-23', duration: 5 },
];
let links: Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'test' },
];

const linkId = (link: Link): string =>
  link.id ?? `${String(link.source)}:${link.type ?? 'FS'}:${String(link.target)}`;

// Stands for your API: resolves when the server keeps the new tasks, rejects when it does not.
async function saveTasks(plan: readonly Task[]): Promise<void> {
  const response = await fetch('/api/tasks', { method: 'PUT', body: JSON.stringify(plan) });
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
}

// The handler reads `gantt`, which it is passed to: give it a return type.
const gantt = createGantt(container, {
  tasks,
  links,
  dataMode: 'controlled',
  viewMode: 'week',
  scroll: { initial: 'first-task' },

  onTasksChange: (changeSet): void => {
    // `model` is the one the change set was computed on: the chart's current one.
    const next = patchTasks(tasks, changeSet, gantt.core.getSnapshot().state.derived.model);
    // The bars show the change as a draft until the answer comes.
    void saveTasks(next).then(
      () => {
        tasks = next;
        gantt.setTasks(tasks); // accepted: the draft becomes your data
      },
      () => {
        gantt.setTasks(tasks); // refused: your old tasks, and the bars go back
      },
    );
  },

  // Links are yours the same way: the chart reports the one drawn or removed, you keep the list.
  onLinkCreate: (link): void => {
    links = [...links, link];
    gantt.setLinks(links);
  },
  onLinkDelete: (record): void => {
    links = links.filter((link) => linkId(link) !== record.id);
    gantt.setLinks(links);
  },
});
```

What to try: drag a bar. The change set holds the dragged task and every task that follows it along
the links, and `patchTasks` writes all of them. To see a refusal, make `saveTasks` reject: the bars
jump back. Draw a link from the round handle beside a bar: `onLinkCreate` adds it to your list.

Notes:

- `patchTasks(tasks, changeSet, model)` takes the array you give it and returns a new one, or the
  same array when nothing changes. It never mutates `tasks`.
- The same answer is how a **rollback** works: after `gantt.edit.rollback()` the chart emits
  `onEditRollback(changes)`, which you write the same way (`patchTasks(tasks, changes, model)` for
  the tasks, and `changes.links` for the links). See
  [React controlled data, Save and Cancel](react-controlled.md), where the whole flow is built with
  React.
- In React the choice is made by props (`tasks` or `defaultTasks`), without `dataMode`; see
  [`@ganttlane/react`](../packages/react/README.md#controlled-and-uncontrolled).

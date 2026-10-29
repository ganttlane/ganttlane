# React controlled data, Save and Cancel

Your state owns the tasks and the links. The chart never changes them: it reports every committed
change and shows it as a draft until you pass the new tasks back. An **edit session** wraps a spell
of editing between **Edit**, **Save** and **Cancel**:

- every drag is an `onTasksChange(changeSet)`, which you write into your tasks with `patchTasks`;
- **Save** closes the session (`edit.commit()`) and sends the plan to your server;
- **Cancel** rolls the session back (`edit.rollback()`): the chart does not touch your data, it tells you
  what to undo with `onEditRollback`, and you write that into your state the way you wrote the drags.

```sh
pnpm add @ganttlane/react react react-dom
```

`Plan.tsx`:

```tsx
import '@ganttlane/react/styles.css';

import { useState } from 'react';

import {
  type ChangeSet,
  type Link,
  patchTasks,
  type SessionChanges,
  type Task,
  useGantt,
  useGanttState,
} from '@ganttlane/react';

const INITIAL_TASKS: Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06', progress: 60 },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-20' },
  { id: 'test', name: 'Test', start: '2026-03-23', duration: 5 },
];
const INITIAL_LINKS: readonly Link[] = [
  { source: 'design', target: 'build' },
  { source: 'build', target: 'test' },
];

const linkId = (link: Link): string =>
  link.id ?? `${String(link.source)}:${link.type ?? 'FS'}:${String(link.target)}`;

/**
 * The links after a cancelled session: drop what the session added, bring back what it removed.
 * `added` and `removed` are the chart's link models; `model.link` is your own `Link`.
 */
function restoreLinks(links: readonly Link[], { added, removed }: SessionChanges['links']): Link[] {
  const dropped = new Set(removed.map((model) => model.id));
  return [
    ...links.filter((link) => !dropped.has(linkId(link))),
    ...added.flatMap((model) => model.link ?? []),
  ];
}

// Stands for your API.
async function savePlan(plan: { tasks: readonly Task[]; links: readonly Link[] }): Promise<void> {
  await fetch('/api/plan', { method: 'PUT', body: JSON.stringify(plan) });
}

export function Plan() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [saved, setSaved] = useState({ tasks: INITIAL_TASKS, links: INITIAL_LINKS });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Write a change set (a drag, or the inverse of a cancelled session) into your own tasks.
  // `patchTasks` keeps the shape of every task: ISO strings stay ISO strings, durations stay durations.
  const apply = (changes: ChangeSet): void => {
    const { model } = gantt.core.getSnapshot().state.derived;
    setTasks((current) => patchTasks(current, changes, model));
  };

  const gantt = useGantt({
    tasks,
    links,
    editing, // false is view mode: the UI cannot drag or draw (your own calls still work)
    scroll: { initial: 'first-task' },
    onTasksChange: apply,
    onLinksChange: setLinks, // a link drawn or removed: your links with the change applied
    onEditRollback: (changes) => {
      apply(changes);
      setLinks((current) => restoreLinks(current, changes.links));
    },
  });

  // Re-render when the session gains or loses changes: Save is only useful when there are some.
  const dirty = useGanttState(gantt, () => gantt.edit.isDirty);

  const save = async (): Promise<void> => {
    if (gantt.edit.commit().status !== 'committed') return;
    setSaving(true);
    try {
      await savePlan({ tasks, links });
      setSaved({ tasks, links });
      setEditing(false);
    } catch {
      // The save failed: show the last saved plan. A new array of tasks ends any draft.
      setTasks(saved.tasks);
      setLinks(saved.links);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p>
        {editing ? (
          <>
            <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
              Save
            </button>{' '}
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                gantt.edit.rollback(); // `onEditRollback` puts your data back
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              gantt.edit.begin();
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </p>
      <div ref={gantt.setContainer} style={{ height: 420 }} />
      {gantt.slots}
    </>
  );
}
```

How it fits together:

- `useGantt(options)` is `<Gantt>` without the `div`: you render the container yourself
  (`ref={gantt.setContainer}`) and `gantt.slots` next to it, which is where React-rendered tooltips
  and labels go. Use `<Gantt ref={…}>` and `ref.current?.edit.begin()` if you prefer a component.
- `tasks` going in as a prop makes the chart **controlled** from its first render. The same array
  again is nothing; a **new** array, even with equal contents, is your answer to the change and ends
  the draft. So derive nothing from `tasks` in the render body without `useMemo`, or any re-render
  (the `saving` flag!) would discard the change that is being saved.
- `patchTasks(tasks, changes, model)` takes the `model` of the core that computed the change set,
  which is `core.getSnapshot().state.derived.model`.
- `edit.commit()` returns `{ status: 'committed', changes }`: the net difference between the start of
  the session and now (a task dragged away and back is not listed); any other status (`'no-session'`,
  `'busy'`) means nothing was committed. The data is already in your state, since every drag was
  applied as it happened; send the whole plan, or `changes` as a diff.
- `edit.rollback()` never asks `onBeforeTaskChange` (a cancel is not vetoed). In controlled mode its
  whole effect is the `onEditRollback(changes)` event: apply `changes` to your tasks with
  `patchTasks`, and drop `changes.links.removed` / restore `changes.links.added` in your links.
- Tasks that depend on others keep following: with the default `scheduling.propagation`
  (`'preserve-lag'`) a drag moves the successors, and they are all in the one `ChangeSet`.

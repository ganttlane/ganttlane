import '@ganttlane/react/styles.css';

import {
  type ChangeSet,
  type Link,
  patchTasks,
  type Task,
  useGantt,
  useGanttState,
} from '@ganttlane/react';
import { useState } from 'react';

import { links as initialLinks, tasks as initialTasks } from './data';
import { restoreLinks, savePlan } from './helpers';
import { options } from './options';

export default function Example() {
  // Your own state: what you hold now, and what the server has.
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks);
  const [links, setLinks] = useState<readonly Link[]>(initialLinks);
  const [saved, setSaved] = useState<{ tasks: readonly Task[]; links: readonly Link[] }>({
    tasks: initialTasks,
    links: initialLinks,
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [status, setStatus] = useState('Press Edit, drag the bars, then Save or Cancel.');

  // Write a change set (a drag, or the inverse of a cancelled session) into your own tasks.
  // `patchTasks` keeps the shape of every task: ISO strings stay ISO strings, durations stay durations.
  const apply = (changes: ChangeSet): void => {
    const { model } = gantt.core.getSnapshot().state.derived;
    setTasks((current) => patchTasks(current, changes, model));
  };

  const gantt = useGantt({
    ...options,
    tasks,
    links,
    editing, // false is view mode: the UI cannot drag or draw (your own calls still work)
    onTasksChange: apply,
    onLinksChange: setLinks, // a link drawn or removed: your links with the change applied
    // A cancelled session: what to undo, which you write the way you wrote the drags.
    onEditRollback: (changes) => {
      apply(changes);
      setLinks((current) => restoreLinks(current, changes.links));
    },
  });

  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;

  // Re-render when the session gains or loses changes: Save is only useful when there are some.
  const dirty = useGanttState(gantt, () => gantt.edit.isDirty);

  const save = async (): Promise<void> => {
    // Closes the session. Anything but 'committed' ('no-session', 'busy') committed nothing.
    if (gantt.edit.commit().status !== 'committed') return;
    setSaving(true);
    setStatus('Saving…');
    try {
      await savePlan(refuse);
      setSaved({ tasks, links });
      setStatus('Saved.');
    } catch {
      // The save failed: show the last saved plan. A new array of tasks ends any draft.
      setTasks(saved.tasks);
      setLinks(saved.links);
      setStatus('The server refused the plan: the last saved one is back.');
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return (
    <>
      <div role="toolbar">
        {editing ? (
          <>
            <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                gantt.edit.rollback(); // `onEditRollback` puts your data back
                setEditing(false);
                setStatus('Cancelled: the plan is as it was.');
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              gantt.edit.begin(); // starts a session: the chart remembers the data it has now
              setEditing(true);
              setStatus('Drag the bars, then Save or Cancel.');
            }}
          >
            Edit
          </button>
        )}
        <label>
          <input type="checkbox" checked={refuse} onChange={(e) => setRefuse(e.target.checked)} />{' '}
          The server refuses the save
        </label>
      </div>
      {/* `useGantt` is <Gantt> without the `div`: you render the container, and the slots next to it. */}
      <div ref={setContainer} style={{ height: 360 }} />
      {slots}
      <p>{status}</p>
    </>
  );
}

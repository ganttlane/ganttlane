import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type Link, patchTasks } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links as initialLinks, tasks as initialTasks } from './data';
import { saveTasks } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // Your own state. `tasks` going in as a prop makes the chart controlled from its first render.
  const [tasks, setTasks] = useState(initialTasks);
  const [links, setLinks] = useState<readonly Link[]>(initialLinks);
  const [refuse, setRefuse] = useState(false);
  const [status, setStatus] = useState(
    'Drag a bar: the change is saved, or refused if you tick the box.',
  );

  return (
    <>
      <div role="toolbar">
        <label>
          <input type="checkbox" checked={refuse} onChange={(e) => setRefuse(e.target.checked)} />{' '}
          The server refuses the save
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 380 }}
        {...options}
        tasks={tasks}
        links={links}
        onTasksChange={(changeSet) => {
          // `model` is the one the change set was computed on: the chart's current one.
          const model = chart.current?.core.getSnapshot().state.derived.model;
          if (!model) return;
          const next = patchTasks(tasks, changeSet, model);
          setStatus('Saving…');
          // The bars show the change as a draft until you pass new tasks back.
          void saveTasks(refuse).then(
            () => {
              setTasks(next); // accepted: the draft becomes your data
              setStatus('Saved.');
            },
            () => {
              // Refused: a new array (even with the same content) ends the draft, and the bars go back.
              setTasks([...tasks]);
              setStatus('The server refused the change: the bars went back.');
            },
          );
        }}
        // A link drawn or removed: your links with the change applied.
        onLinksChange={setLinks}
      />
      <p>{status}</p>
    </>
  );
}

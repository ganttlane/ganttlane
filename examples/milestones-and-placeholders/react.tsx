import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type Task } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe, describeTask, toggleHiring } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // The tasks are yours: a new list goes in with `setTasks` on the ref, and the chart diffs it by id.
  const [current, setCurrent] = useState<Task[]>([...tasks]);
  const [scheduled, setScheduled] = useState(false);
  const [status, setStatus] = useState('Click a milestone or a bar, or drag Kick-off.');

  return (
    <>
      <div role="toolbar">
        <button
          type="button"
          onClick={() => {
            const next = toggleHiring(current);
            const nowScheduled = !scheduled;
            setCurrent(next);
            setScheduled(nowScheduled);
            chart.current?.setTasks(next);
            setStatus(
              nowScheduled
                ? 'Hiring is a task now: it has dates and a bar.'
                : 'Hiring is a placeholder again: a row with no bar.',
            );
          }}
        >
          {scheduled ? 'Unschedule Hiring' : 'Schedule Hiring'}
        </button>
        <button
          type="button"
          onClick={() => {
            setCurrent([...tasks]);
            setScheduled(false);
            chart.current?.setTasks(tasks);
            setStatus('Back to the start.');
          }}
        >
          Reset
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 490 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // The record says what the row is: `type`, and a `duration` of 0 for a milestone.
        onTaskClick={(record) => setStatus(describeTask(record))}
        // One event per drag: the dragged task first, then the tasks its links moved.
        onTasksChange={(changeSet) => {
          setStatus(describe(changeSet, (id) => chart.current?.getTask(id)?.name ?? String(id)));
        }}
      />
      <p>{status}</p>
    </>
  );
}

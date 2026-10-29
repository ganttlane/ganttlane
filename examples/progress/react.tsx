import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe, describeUnchanged } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [skip, setSkip] = useState<boolean>(options.scheduling.skipNonWorkingDays.progress);
  const [status, setStatus] = useState(
    'Drag the little handle at the foot of the done part of a bar.',
  );
  // What the change was, from `onTasksChange`, for the sentence `onTaskProgressChange` writes.
  const reason = useRef('');

  return (
    <>
      <div role="toolbar">
        <label>
          <input
            type="checkbox"
            checked={skip}
            onChange={(event) => setSkip(event.target.checked)}
          />{' '}
          Skip days off for progress
        </label>
        {/* The ref is the chart's methods. */}
        <button
          type="button"
          onClick={() => {
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
        style={{ height: 370 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // In React the props are the truth: `scheduling` is passed from state after the spread,
        // not changed with `setOptions` on the ref, which the next render would overwrite.
        scheduling={{ skipNonWorkingDays: { progress: skip } }}
        // One event per change, whatever it was (a move, a resize, the handle)...
        onTasksChange={(changeSet) => {
          reason.current = changeSet.reason;
          setStatus(describeUnchanged(changeSet.reason));
        }}
        // ...and one per task whose progress changed, after it: a resize rebases the percentage.
        onTaskProgressChange={(record, progress) => {
          setStatus(describe(record, progress, reason.current));
        }}
      />
      <p>{status}</p>
    </>
  );
}

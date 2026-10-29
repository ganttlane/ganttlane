import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'];

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // `viewMode` is controlled by its prop: the chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [status, setStatus] = useState(
    'Click a bar, or drag it, its edges or the handle at its foot.',
  );

  return (
    <>
      <div role="toolbar">
        {VIEW_MODES.map((id) => (
          <button key={id} type="button" onClick={() => setViewMode(id)}>
            {id}
          </button>
        ))}
        {/* The ref is the chart's methods. */}
        <button type="button" onClick={() => chart.current?.scrollToTask('qa')}>
          Go to QA
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 380 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        onTaskClick={(record) => {
          setStatus(`Clicked ${record.name}`);
        }}
        // One event per drag, with every task it moved (the dragged one and what follows it).
        onTasksChange={(changeSet) => {
          const moved = changeSet.changes.map((change) => String(change.id)).join(', ');
          setStatus(`${changeSet.reason}: moved ${moved}`);
        }}
      />
      <p>{status}</p>
    </>
  );
}

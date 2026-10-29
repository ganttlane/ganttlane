import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'quarter-day', 'hour'];

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [status, setStatus] = useState('Drag Code freeze: QA keeps its gap, and Monitor its lag.');

  return (
    <>
      <div role="toolbar">
        {VIEW_MODES.map((id) => (
          <button key={id} type="button" onClick={() => setViewMode(id)}>
            {id}
          </button>
        ))}
      </div>
      <Gantt
        ref={chart}
        style={{ height: 380 }}
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        onTasksChange={() => {
          // The records are computed from the calendar: `Date`s with the wall-clock time the data says.
          setStatus(describe(chart.current?.getTask('qa')));
        }}
      />
      <p>{status}</p>
    </>
  );
}

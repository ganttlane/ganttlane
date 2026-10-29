// No `import '@ganttlane/react/styles.css'`: the chart is styled by this example's own sheet alone.
import './styles.css';

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
    'This example imports no default stylesheet. Click a bar (data-selected), or hover one for its handles.',
  );

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
        // The class is what `styles.css` hangs every rule on (`.paper .gantt__bar`, …).
        className="paper"
        style={{ height: 400 }}
        // In React `tasks`, `links` and `viewMode` are controlled props and `defaultTasks` and
        // `defaultLinks` are where an uncontrolled chart starts (there is no `dataMode` prop).
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        // Clicking a bar only reports it; selecting it is the application's call.
        onTaskClick={(record) => {
          chart.current?.select([record.id]);
          setStatus(`${record.name} is selected: its bar has data-selected.`);
        }}
      />
      <p>{status}</p>
    </>
  );
}

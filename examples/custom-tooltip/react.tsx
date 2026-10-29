import '@ganttlane/react/styles.css';

import { Gantt, type TaskTooltipContext } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { options } from './options';

// The tooltip is a component: it sees your context providers and your state, and may use hooks.
// Keep the logic here and return `<TaskCard context={context} />` from `renderTooltip`.
function TaskCard({ context }: { context: TaskTooltipContext }) {
  const { task, preview, isDragging, api } = context;
  // While a bar is dragged, show where it would land.
  const start = preview?.start ?? task.start;
  const end = preview?.end ?? task.end;
  if (!start || !end) return null; // an empty tooltip is not shown
  return (
    <div>
      <strong>{task.name}</strong>
      <div>
        {start.toLocaleDateString(context.locale)} to {end.toLocaleDateString(context.locale)}
        {isDragging ? ' (moving)' : null}
      </div>
      <progress max={100} value={task.progress} />
      <button type="button" onClick={() => api.hide()}>
        Close
      </button>
    </div>
  );
}

export default function Example() {
  // A tooltip with a button is easier to reach after a click.
  const [trigger, setTrigger] = useState<'hover' | 'click'>('click');

  return (
    <>
      <div role="toolbar">
        <button type="button" onClick={() => setTrigger('hover')}>
          Hover
        </button>
        <button type="button" onClick={() => setTrigger('click')}>
          Click
        </button>
      </div>
      <Gantt
        style={{ height: 380 }}
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        tooltip={{ ...options.tooltip, trigger }}
        renderTooltip={(context) => <TaskCard context={context} />}
      />
      <p>The tooltip opens on a {trigger}.</p>
    </>
  );
}

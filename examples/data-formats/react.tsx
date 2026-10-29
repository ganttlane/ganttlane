import '@ganttlane/react/styles.css';

import { Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { describe, inputOf } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'half-day', 'quarter-day'];
const HINT = 'Click a bar to see how its input was written, and how the chart read it.';

export default function Example() {
  // The two options the controls change are state. `viewMode` is a controlled prop in React: the
  // chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [endInclusive, setEndInclusive] = useState<boolean>(options.dates.endInclusive);
  const [status, setStatus] = useState(HINT);

  return (
    <>
      <div role="toolbar">
        <label>
          View{' '}
          <select
            value={viewMode}
            onChange={(event) => {
              setViewMode(event.target.value);
            }}
          >
            {VIEW_MODES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={endInclusive}
            onChange={(event) => {
              setEndInclusive(event.target.checked);
              setStatus(HINT); // what the last click said is out of date now
            }}
          />{' '}
          dates.endInclusive
        </label>
      </div>
      <Gantt
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 470 }}
        // The chart owns the data (uncontrolled): these are where it starts. `Meta`, the type of
        // `task.data`, is inferred from them and flows to every handler.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // After `options`, so that the state wins over what it holds.
        viewMode={viewMode}
        dates={{ endInclusive }}
        onTaskClick={(record) => {
          // `record.task` is the task as you gave it, never changed by the chart; the rest of
          // the record is what the chart made of it.
          setStatus(
            `${record.name}: written as ${inputOf(record.task, links)}. Read as ${describe(record)}.`,
          );
        }}
      />
      <p>{status}</p>
    </>
  );
}

import '@ganttlane/react/styles.css';

import { Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options, VIEW_MODES } from './options';

export default function Example() {
  // `viewMode` is controlled by its prop: the chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [status, setStatus] = useState(
    'Pick a view mode: day and week are presets with overrides, the others are new.',
  );

  return (
    <>
      <div role="toolbar">
        <label>
          View mode{' '}
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
      </div>
      <Gantt
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 450 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        // The handler gets the `ViewMode` that is now in use, whether it is a preset or one of ours.
        onViewModeChange={(mode) => {
          setStatus(describe(mode));
        }}
      />
      <p>{status}</p>
    </>
  );
}

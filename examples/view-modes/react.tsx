import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe, VIEW_MODES, zoomed } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // `viewMode` is controlled by its prop: the chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [status, setStatus] = useState('Pick a view mode, or zoom in and out.');

  // `zoomTo` sets the pixels per day of the view mode in use, keeping the date in the middle.
  // Another view mode starts again from its own preset.
  const zoom = (factor: number): void => {
    const gantt = chart.current;
    if (!gantt) return;
    gantt.zoomTo(zoomed(gantt.core.getSnapshot().timeline.scale.pxPerDay, factor));
    const { viewMode: mode, timeline } = gantt.core.getSnapshot();
    setStatus(describe(mode, timeline.scale.pxPerDay));
  };

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
        <button type="button" onClick={() => zoom(1.25)}>
          Zoom in
        </button>
        <button type="button" onClick={() => zoom(0.8)}>
          Zoom out
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 470 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        // The view mode in use changed: the handler gets the `ViewMode` itself.
        onViewModeChange={(mode) => {
          setStatus(describe(mode, mode.pxPerDay));
        }}
      />
      <p>{status}</p>
    </>
  );
}

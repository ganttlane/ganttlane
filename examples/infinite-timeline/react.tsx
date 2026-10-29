import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options, SETTINGS } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [setting, setSetting] = useState<(typeof SETTINGS)[number]['id']>('defaults');
  const [status, setStatus] = useState(
    'Scroll the chart sideways, as far as you like, or press a button.',
  );
  // How many times each kind of change has happened since the setting was chosen. A ref, not state:
  // several changes can come before React renders again, and none may be lost.
  const counts = useRef(new Map<string, number>());
  // In React `viewMode` is a controlled prop, and `defaultViewMode` is its uncontrolled twin: here
  // nothing changes the view mode, so the chart owns it and starts from the option.
  const { viewMode, ...rest } = options;
  const infinite = SETTINGS.find((candidate) => candidate.id === setting)?.infinite ?? false;

  return (
    <>
      <div role="toolbar">
        <label>
          timeline.infinite:{' '}
          <select
            value={setting}
            onChange={(event) => {
              const next = SETTINGS.find((candidate) => candidate.id === event.target.value);
              if (!next) return;
              counts.current.clear();
              setStatus('Setting changed: scroll the chart sideways.');
              setSetting(next.id);
            }}
          >
            {SETTINGS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="toolbar">
        {/* A date far outside the timeline: it grows to reach it (unless `bounds` say no). A jump
            is `instant` here, so that the chart does not glide for a year. */}
        <button
          type="button"
          onClick={() =>
            chart.current?.scrollToDate('2025-01-06', { behavior: 'instant', align: 'center' })
          }
        >
          Go to Jan 2025
        </button>
        <button
          type="button"
          onClick={() =>
            chart.current?.scrollToDate('2027-12-06', { behavior: 'instant', align: 'center' })
          }
        >
          Go to Dec 2027
        </button>
        <button
          type="button"
          onClick={() => chart.current?.scrollToTask('design', { behavior: 'instant' })}
        >
          Back to the plan
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 400 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        timeline={{ infinite }}
        // The range of the timeline changed: why, and what it is now. The first one is
        // `'initial'`; an infinite timeline adds `'extend-start'`, `'extend-end'`, `'trim-start'`
        // and `'trim-end'`.
        onRangeChange={(range) => {
          counts.current.set(range.reason, (counts.current.get(range.reason) ?? 0) + 1);
          setStatus(describe(range, range.reason, counts.current));
        }}
      />
      <p>{status}</p>
    </>
  );
}

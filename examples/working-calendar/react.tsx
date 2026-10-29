import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe, DURATION_MODES, type Skip } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [durationMode, setDurationMode] = useState<string>(options.scheduling.durationMode);
  const [skip, setSkip] = useState<Skip>({ ...options.scheduling.skipNonWorkingDays });
  const [status, setStatus] = useState(
    'Drag a bar onto a day off, drag an edge, or drag the little handle at the foot of a bar.',
  );

  const checkbox = (label: string, flag: keyof Skip) => (
    <label>
      <input
        type="checkbox"
        checked={skip[flag]}
        onChange={(event) => setSkip({ ...skip, [flag]: event.target.checked })}
      />{' '}
      {label}
    </label>
  );

  return (
    <>
      <div role="toolbar">
        <label>
          Durations count{' '}
          <select value={durationMode} onChange={(event) => setDurationMode(event.target.value)}>
            {DURATION_MODES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {checkbox('Skip days off: move', 'move')}
        {checkbox('resize', 'resize')}
        {checkbox('progress', 'progress')}
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
        style={{ height: 380 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // In React the props are the truth: `scheduling` is passed from state after the spread,
        // not changed with `setOptions` on the ref, which the next render would overwrite.
        scheduling={{
          durationMode: DURATION_MODES.find((value) => value === durationMode),
          skipNonWorkingDays: skip,
        }}
        // The records are computed from the calendar: dates, working days, conflicts.
        onTasksChange={(changeSet) => {
          const [edited] = changeSet.changes;
          if (edited) setStatus(describe(chart.current?.getTask(edited.id), changeSet.reason));
        }}
      />
      <p>{status}</p>
    </>
  );
}

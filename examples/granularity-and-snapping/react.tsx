import '@ganttlane/react/styles.css';

import { type Issue, useGantt, useGanttState } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import {
  ALIGN_INPUTS,
  describeEdit,
  describeIssues,
  GRANULARITIES,
  SNAPS,
  stepName,
  VIEW_MODES,
} from './helpers';
import { options } from './options';

export default function Example() {
  // In React the props are the truth, so what the selects change is state, passed below.
  const [granularity, setGranularity] = useState<string>(options.scheduling.granularity);
  const [alignInput, setAlignInput] = useState<string>(options.scheduling.alignInput);
  const [snapLabel, setSnapLabel] = useState<string>(SNAPS[0].label);
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [status, setStatus] = useState('Drag a bar, then hold Alt and drag it again.');
  const nameOf = (id: string | number): string => gantt.getTask(id)?.name ?? String(id);

  // `viewMode` is a controlled prop in React, and `defaultViewMode` is its uncontrolled twin: the
  // chart owns the view mode, so the buttons can call `setViewMode` with `keepScroll: false`.
  const { viewMode, ...rest } = options;

  const gantt = useGantt({
    ...rest,
    // The chart owns the data and the view mode (uncontrolled): these are where it starts.
    defaultTasks: tasks,
    defaultLinks: links,
    defaultViewMode: viewMode,
    // `scheduling` is passed from state, not changed with `setOptions` on the instance, which the
    // next render would overwrite.
    scheduling: {
      granularity,
      alignInput: ALIGN_INPUTS.find((value) => value === alignInput),
      snap: SNAPS.find((entry) => entry.label === snapLabel)?.snap,
    },
    // The data issues change with the granularity and `alignInput`.
    onIssues: ({ source, issues: found }) => {
      if (source === 'data') setIssues(found);
    },
    onTasksChange: (changeSet) => {
      const [edited] = changeSet.changes;
      if (edited) setStatus(describeEdit(gantt.getTask(edited.id), changeSet.reason));
    },
  });
  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;
  // The step a drag snaps to is resolved from the view mode, `scheduling.snap` and the
  // granularity; the snapshot has the result, and the component re-renders when it changes.
  const step = useGanttState(gantt, (snapshot) => snapshot.state.derived.snap.snap.move);

  return (
    <>
      <div role="toolbar">
        {VIEW_MODES.map((id) => (
          // `keepScroll: false` scrolls to the first task again, as when the chart opened; by
          // default the date at the centre of the chart stays where it is.
          <button
            key={id}
            type="button"
            onClick={() => gantt.setViewMode(id, { keepScroll: false })}
          >
            {id}
          </button>
        ))}
        <label>
          Snap{' '}
          <select value={snapLabel} onChange={(event) => setSnapLabel(event.target.value)}>
            {SNAPS.map((entry) => (
              <option key={entry.label}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label>
          Granularity{' '}
          <select value={granularity} onChange={(event) => setGranularity(event.target.value)}>
            {GRANULARITIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Align input{' '}
          <select value={alignInput} onChange={(event) => setAlignInput(event.target.value)}>
            {ALIGN_INPUTS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            gantt.setTasks(tasks);
            setStatus('Back to the start.');
          }}
        >
          Reset
        </button>
      </div>
      {/* `useGantt` is <Gantt> without the `div`: you render the container, and the slots next to it. */}
      <div ref={setContainer} style={{ height: 370 }} />
      {slots}
      <p>
        Snap step: {stepName(step)}; with Alt: {granularity}. {describeIssues(issues, nameOf)}
      </p>
      <p>{status}</p>
    </>
  );
}

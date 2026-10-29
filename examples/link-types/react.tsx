import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe, LINK_TYPES, type LinkType, RADII } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [defaultLinkType, setDefaultLinkType] = useState<LinkType>(
    options.scheduling.defaultLinkType,
  );
  const [radius, setRadius] = useState(options.display.linkCurveRadius);
  const [status, setStatus] = useState(
    'Drag Design, or one of its edges, and watch the nine tasks linked to it.',
  );

  return (
    <>
      <div role="toolbar">
        <label>
          Default link type{' '}
          <select
            value={defaultLinkType}
            onChange={(event) => {
              const type = LINK_TYPES.find((candidate) => candidate === event.target.value);
              if (type) setDefaultLinkType(type);
            }}
          >
            {LINK_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          Corner radius{' '}
          <select value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            {RADII.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            chart.current?.setTasks(tasks);
            chart.current?.setLinks(links);
            setStatus('Back to the start.');
          }}
        >
          Reset
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 440 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // In React the props are the truth: a value changed with `setOptions` on the ref would be
        // overwritten by the next render. So the two options the selects change are passed here,
        // from state, after the spread.
        scheduling={{ ...options.scheduling, defaultLinkType }}
        display={{ ...options.display, linkCurveRadius: radius }}
        // One event per drag: the dragged task first, then the tasks its links moved.
        onTasksChange={(changeSet) => {
          setStatus(describe(changeSet, (id) => chart.current?.getTask(id)?.name ?? String(id)));
        }}
      />
      <p>{status}</p>
    </>
  );
}

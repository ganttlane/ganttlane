import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type TaskId } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { changeText, refusalText } from './helpers';
import { options } from './options';

const FLAGS = ['move', 'resize', 'progress', 'links'] as const;

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [enabled, setEnabled] = useState(true);
  const [flags, setFlags] = useState({ move: true, resize: true, progress: true, links: true });
  const [status, setStatus] = useState(
    'Drag a bar, an edge or a handle. What the chart refuses is reported here.',
  );
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it. (`editing` is an ordinary prop: it is the option, as it is.)
  const { viewMode, ...rest } = options;
  const nameOf = (id: TaskId): string => chart.current?.getTask(id)?.name ?? String(id);

  return (
    <>
      <div role="toolbar">
        <label>
          <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} /> editing
        </label>
        {FLAGS.map((flag) => (
          <label key={flag}>
            <input
              type="checkbox"
              checked={flags[flag]}
              disabled={!enabled}
              onChange={() => setFlags({ ...flags, [flag]: !flags[flag] })}
            />{' '}
            {flag}
          </label>
        ))}
      </div>
      <Gantt
        ref={chart}
        style={{ height: 370 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        defaultViewMode={viewMode}
        // `false` is read-only; the object turns single kinds of edit off.
        editing={enabled ? flags : false}
        // A drag that the chart would not start, or would not commit: nothing changed.
        onEditRefused={(refusal) => {
          setStatus(refusalText(refusal, nameOf));
        }}
        onTasksChange={(changeSet) => {
          setStatus(changeText(changeSet, nameOf));
        }}
        onLinkCreate={(link) => {
          setStatus(`Linked ${nameOf(link.source)} to ${nameOf(link.target)}.`);
        }}
      />
      <p>{status}</p>
    </>
  );
}

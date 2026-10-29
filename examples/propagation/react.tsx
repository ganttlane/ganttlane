import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { brokenLinks, describe, PROPAGATION, startMoved } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [propagation, setPropagation] = useState<string>(options.scheduling.propagation);
  const [refuse, setRefuse] = useState(false);
  const [status, setStatus] = useState(
    'Drag Design, then switch Propagation to none and drag it again.',
  );
  const nameOf = (id: string | number): string => chart.current?.getTask(id)?.name ?? String(id);

  return (
    <>
      <div role="toolbar">
        <label>
          Propagation{' '}
          <select value={propagation} onChange={(event) => setPropagation(event.target.value)}>
            {PROPAGATION.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={refuse}
            onChange={(event) => setRefuse(event.target.checked)}
          />{' '}
          Refuse a broken link
        </label>
        {/* The ref is the chart's methods. The same edits as a drag, from code (`reason: 'api'`). */}
        <button
          type="button"
          onClick={() => {
            void chart.current?.updateTask('design', {
              start: startMoved(chart.current.getTask('design'), 3),
            });
          }}
        >
          Design +3 days
        </button>
        <button
          type="button"
          onClick={() => {
            void chart.current?.updateTask('review', {
              start: startMoved(chart.current.getTask('review'), -3),
            });
          }}
        >
          Review -3 days
        </button>
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
        style={{ height: 320 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        // In React the props are the truth: `scheduling` is passed from state after the spread,
        // not changed with `setOptions` on the ref, which the next render would overwrite.
        scheduling={{
          ...options.scheduling,
          propagation: PROPAGATION.find((value) => value === propagation),
        }}
        // Asked before a change is applied, with the conflicts it would have; `false` cancels it.
        onBeforeTaskChange={({ conflicts }) => {
          const broken = brokenLinks(conflicts);
          if (!refuse || broken.length === 0) return true;
          setStatus(`Refused: ${broken.map((conflict) => conflict.message).join('; ')}.`);
          return false;
        }}
        // One event per change, a drag or `updateTask`: the edited task first, then the tasks the
        // links moved, and the conflicts of the result.
        onTasksChange={(changeSet) => setStatus(describe(changeSet, nameOf))}
      />
      <p>{status}</p>
    </>
  );
}

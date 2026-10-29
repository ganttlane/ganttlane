import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { type Action, ACTIONS, changeText, issuesText } from './actions';
import { links, tasks } from './data';
import { options } from './options';

const IDLE = 'Press a button: the call and what it returned show above, the events below.';
const GROUPS = [...new Set(ACTIONS.map((action) => action.group))];

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [result, setResult] = useState(IDLE);
  // The events that the last call caused, in the order they came.
  const [events, setEvents] = useState<readonly string[]>([]);
  const report = (line: string): void => {
    setEvents((current) => [...current, line]);
  };
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it.
  const { viewMode, ...rest } = options;

  async function run(action: Action): Promise<void> {
    const handle = chart.current;
    if (!handle) return;
    setEvents([]);
    setResult(await action.run(handle));
  }

  return (
    <>
      {GROUPS.map((group) => (
        <div key={group} role="toolbar" aria-label={group}>
          <span className="updates-group">{group}</span>
          {ACTIONS.filter((action) => action.group === group).map((action) => (
            <button key={action.label} type="button" onClick={() => void run(action)}>
              {action.label}
            </button>
          ))}
        </div>
      ))}
      <Gantt
        ref={chart}
        style={{ height: 330 }}
        // `tasks` and `links` are controlled props in React: these are where the chart starts,
        // and then it owns them, so `updateTask`, `addLink` and `setTasks` change its own copy.
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        defaultViewMode={viewMode}
        // The events tell everybody else what a call did; the call's own result tells its caller.
        onTasksChange={(changeSet) => {
          report(changeText(changeSet));
        }}
        onLinkCreate={(link) => {
          report(`onLinkCreate (${String(link.source)} → ${String(link.target)})`);
        }}
        onLinkDelete={(link) => {
          report(`onLinkDelete (${String(link.source)} → ${String(link.target)})`);
        }}
        onIssues={(payload) => {
          report(issuesText(payload));
        }}
      />
      <pre className="updates-result" aria-live="polite">
        {result}
      </pre>
      <p>{events.length === 0 ? 'Events: none.' : `Events: ${events.join('; ')}.`}</p>
    </>
  );
}

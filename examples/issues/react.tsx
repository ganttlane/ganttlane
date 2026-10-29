import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { fixedLinks, fixedTasks, links, tasks } from './data';
import { detailOf, type Found, locationOf } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [fixed, setFixed] = useState(false);
  // The two lists, kept as `onIssues` reports them.
  const [found, setFound] = useState<Found>({ data: [], options: [] });
  const [status, setStatus] = useState('');

  return (
    <div className="issues-demo">
      <div role="toolbar">
        {/* The ref is the chart's methods. */}
        <button
          type="button"
          onClick={() => {
            chart.current?.setTasks(fixedTasks);
            chart.current?.setLinks(fixedLinks);
            setFixed(true);
          }}
        >
          Fix the input
        </button>
        <button
          type="button"
          onClick={() => {
            chart.current?.setTasks(tasks);
            chart.current?.setLinks(links);
            setFixed(false);
          }}
        >
          Break it again
        </button>
      </div>
      <div className="issues-demo__body">
        <Gantt
          ref={chart}
          // The chart fills its container and scrolls inside it, so the container needs a height.
          style={{ height: 420 }}
          // The chart owns the data (uncontrolled): these are where it starts.
          defaultTasks={tasks}
          defaultLinks={links}
          {...options}
          // In React the props are the truth: the options are passed from state after the spread,
          // and left out (`undefined`) once fixed, which puts them back to their defaults.
          scheduling={fixed ? undefined : options.scheduling}
          display={fixed ? undefined : options.display}
          // Called when the list of issues of the data (`'data'`) or of the options (`'options'`)
          // changes, also while the chart is created. It carries the whole list.
          onIssues={({ source, issues }) => {
            if (source === 'change-set') return; // a change set that was committed with issues
            setFound((previous) => ({ ...previous, [source]: issues }));
            setStatus(`onIssues: ${source}, ${String(issues.length)} issues.`);
          }}
        />
        <aside className="issues-demo__panel" aria-label="Issues">
          {(['data', 'options'] as const).map((source) => (
            <section key={source}>
              <h3>
                {source === 'data' ? 'Data' : 'Options'} ({found[source].length})
              </h3>
              {found[source].length === 0 ? (
                <p className="issues-demo__empty">No issues.</p>
              ) : (
                <ul>
                  {found[source].map((issue, index) => (
                    <li key={index} data-severity={issue.severity}>
                      <strong>{issue.code}</strong> <code>{locationOf(issue)}</code>
                      {/* `message` is for people: never parse it. `code`, `path`, `value` and
                          `suggested` say the same. */}
                      <small>{issue.message}</small>
                      <small>{detailOf(issue)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </aside>
      </div>
      <p>{status}</p>
    </div>
  );
}

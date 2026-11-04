import '@ganttlane/react/styles.css';

import { type ChangeSet, Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { options } from './options';

/** What the list shows of a change set: the reason and the tasks it moved. */
const line = (changeSet: ChangeSet): string =>
  `${changeSet.reason}: ${changeSet.changes.map((change) => String(change.id)).join(', ')}`;

export default function Example() {
  const [received, setReceived] = useState<string[]>([]);
  const { viewMode, ...rest } = options;

  return (
    <>
      <Gantt
        {...rest}
        defaultViewMode={viewMode}
        // `tasks` and `links` are controlled props: these are where the chart starts.
        defaultTasks={tasks}
        defaultLinks={links}
        style={{ height: 300 }}
        // Every arrow key press that changed something, like a drag, arrives here once.
        onTasksChange={(changeSet) => {
          setReceived((before) => [line(changeSet), ...before]);
        }}
      />
      <p>onTasksChange received:</p>
      <ol>
        {received.map((text, index) => (
          <li key={received.length - index}>{text}</li>
        ))}
      </ol>
    </>
  );
}

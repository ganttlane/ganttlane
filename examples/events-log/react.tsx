import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { broken, links, tasks } from './data';
import { append, type Entry, type GroupId, GROUPS, lineText, loggingHandlers } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'] as const;

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  // ---- the log: every event of the chart ends in `log`, and the filter decides what is shown ----
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [shown, setShown] = useState<ReadonlySet<GroupId>>(
    new Set(GROUPS.filter((group) => group.hidden !== true).map((group) => group.id)),
  );
  const visible = entries.filter((entry) => shown.has(entry.group));
  // Whether the data has the broken task in it, and the listener that throws (to remove it again).
  const [isBroken, setIsBroken] = useState(false);
  const failing = useRef<(() => void) | undefined>(undefined);
  const [isFailing, setIsFailing] = useState(false);
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // `setViewMode` of the handle changes it from there.
  const { viewMode, ...rest } = options;

  const toggle = (id: GroupId): void => {
    setShown((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const breakData = (): void => {
    const handle = chart.current;
    if (!handle) return;
    const without = handle.core.getSnapshot().state.tasks.filter((task) => task.id !== broken.id);
    handle.setTasks(isBroken ? without : [...without, broken]);
    setIsBroken(!isBroken);
  };

  // `error`: a listener that throws. `onError` catches what it threw, and the log shows it;
  // select something to make it throw.
  const toggleFailing = (): void => {
    if (failing.current === undefined) {
      failing.current = chart.current?.on('selectionChange', () => {
        throw new Error('This listener always throws');
      });
    } else {
      failing.current();
      failing.current = undefined;
    }
    setIsFailing(failing.current !== undefined);
  };

  return (
    <>
      <div role="toolbar" aria-label="Make events happen">
        <label>
          View mode {/* `viewModeChange`, `rangeChange`, and a `scroll` that comes with them. */}
          <select
            defaultValue={options.viewMode}
            onChange={(event) => chart.current?.setViewMode(event.target.value)}
          >
            {VIEW_MODES.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        {/* `selectionChange` */}
        <button type="button" onClick={() => chart.current?.select(['build'])}>
          Select Build
        </button>
        <button type="button" onClick={() => chart.current?.clearSelection()}>
          Clear selection
        </button>
        {/* `expandedChange` */}
        <button type="button" onClick={() => chart.current?.collapseAll()}>
          Collapse
        </button>
        <button type="button" onClick={() => chart.current?.expandAll()}>
          Expand
        </button>
        {/* `tasksChange` (reason 'undo') and `historyChange` */}
        <button type="button" onClick={() => chart.current?.undo()}>
          Undo
        </button>
        <button type="button" onClick={() => chart.current?.redo()}>
          Redo
        </button>
      </div>
      {/* An edit session: `dirtyChange` when the first change is made and when it ends, and
          `editRollback` when it is rolled back. */}
      <div role="toolbar" aria-label="Edit session, data and listeners">
        <button type="button" onClick={() => chart.current?.edit.begin()}>
          Begin edit
        </button>
        <button type="button" onClick={() => chart.current?.edit.commit()}>
          Commit
        </button>
        <button type="button" onClick={() => chart.current?.edit.rollback()}>
          Rollback
        </button>
        {/* `issues`: data with a problem in it, and the same data with the problem gone. */}
        <button type="button" onClick={breakData}>
          {isBroken ? 'Fix data' : 'Break data'}
        </button>
        <button type="button" onClick={toggleFailing}>
          {isFailing ? 'Remove it' : 'Add a failing listener'}
        </button>
        <button type="button" onClick={() => setEntries([])}>
          Clear the log
        </button>
      </div>
      <div role="group" aria-label="Show these events" className="events-filters">
        {GROUPS.map(({ id, label }) => (
          <label key={id}>
            <input type="checkbox" checked={shown.has(id)} onChange={() => toggle(id)} /> {label}
          </label>
        ))}
      </div>
      <Gantt
        ref={chart}
        style={{ height: 330 }}
        // `tasks` and `links` are controlled props in React: these are where the chart starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        defaultViewMode={viewMode}
        // One handler for each event of the chart: see helpers.ts. They are props in React.
        {...loggingHandlers((group, name, text) => {
          setEntries((current) => append(current, group, name, text));
        })}
      />
      {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrolling region has to take focus, or the keyboard cannot scroll it */}
      <ol className="events-log" role="log" aria-label="Events" tabIndex={0}>
        {visible.map((entry) => (
          <li key={entry.id} data-group={entry.group}>
            <span>{entry.time}</span>
            <code>{entry.name}</code>
            <span>{lineText(entry)}</span>
          </li>
        ))}
      </ol>
      <p>
        Showing {visible.length} of {entries.length} events.
      </p>
    </>
  );
}

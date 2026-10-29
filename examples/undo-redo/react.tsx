import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type TaskId } from '@ganttlane/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { links, tasks } from './data';
import { changeText, historyText, isTyping, LIMITS, shortcutOf, undoAll } from './helpers';
import { options } from './options';

export default function Example() {
  const root = useRef<HTMLDivElement>(null);
  const chart = useRef<GanttHandle>(null);
  const [limit, setLimit] = useState<number>(options.history.limit);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The status: the last thing a button or a key did, the last change, and the last history event.
  const [call, setCall] = useState('');
  const [change, setChange] = useState('Drag bars, draw a link, then undo.');
  const [history, setHistory] = useState('');
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it.
  const { viewMode, ...rest } = options;
  const nameOf = (id: TaskId): string => chart.current?.getTask(id)?.name ?? String(id);
  // Whether a button or a key is making a call just now: its events belong to it, and the line
  // of the last call is no news for the ones that come from a drag.
  const calling = useRef(false);
  const note = (text: string): void => {
    if (!calling.current) setCall('');
    setChange(text);
  };

  const perform = useCallback((make: (handle: GanttHandle) => string): void => {
    if (!chart.current) return;
    setChange('');
    calling.current = true;
    try {
      setCall(make(chart.current));
    } finally {
      calling.current = false;
    }
  }, []);
  // The result says what happened: 'undone' or 'redone', or 'empty' when there was nothing.
  const run = useCallback(
    (action: 'undo' | 'redo'): void => {
      perform((handle) => `${action}(): ${handle[action]().status}.`);
    },
    [perform],
  );

  // The library has no hotkeys, so the page makes its own: Ctrl or Cmd + Z, with Shift to redo.
  // They work while the focus is in this example (after a click on the chart, for one).
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const controller = new AbortController();
    element.addEventListener(
      'keydown',
      (event) => {
        const action = shortcutOf(event);
        if (action === undefined || isTyping(event.target)) return;
        event.preventDefault();
        run(action);
      },
      { signal: controller.signal },
    );
    return () => {
      controller.abort();
    };
  }, [run]);

  return (
    <div ref={root}>
      <div role="toolbar">
        <button
          type="button"
          title="Undo (Ctrl or Cmd + Z)"
          disabled={!canUndo}
          onClick={() => run('undo')}
        >
          Undo
        </button>
        <button
          type="button"
          title="Redo (Shift + Ctrl or Cmd + Z)"
          disabled={!canRedo}
          onClick={() => run('redo')}
        >
          Redo
        </button>
        <button
          type="button"
          title="Undo until nothing is left"
          disabled={!canUndo}
          onClick={() => {
            perform((handle) => `Undid ${undoAll(handle)} actions.`);
          }}
        >
          Undo all
        </button>
        <label>
          Keep the last{' '}
          <select
            aria-label="Actions the history keeps"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {LIMITS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>{' '}
          actions
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 340 }}
        // `tasks` and `links` are controlled props in React: these are where the chart starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        defaultViewMode={viewMode}
        // The history keeps the last `limit` actions: a smaller limit drops the oldest at once.
        history={{ limit }}
        onTasksChange={(changeSet) => {
          note(changeText(changeSet, nameOf));
        }}
        onLinkCreate={(link) => {
          note(`onLinkCreate: ${nameOf(link.source)} → ${nameOf(link.target)}.`);
        }}
        onLinkDelete={(link) => {
          note(`onLinkDelete: ${nameOf(link.source)} → ${nameOf(link.target)}.`);
        }}
        // `canUndo` or `canRedo` changed: the buttons follow it.
        onHistoryChange={(payload) => {
          setCanUndo(payload.canUndo);
          setCanRedo(payload.canRedo);
          setHistory(historyText(payload));
        }}
      />
      <p>{[call, change, history].filter(Boolean).join(' ')}</p>
    </div>
  );
}

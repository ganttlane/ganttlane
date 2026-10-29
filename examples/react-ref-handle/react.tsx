import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useEffect, useRef, useState } from 'react';

import { links, tasks } from './data';
import { options } from './options';

/** A button: its label, the call it makes (shown in the status line), and the call itself. */
type Action = readonly [label: string, call: string, run: (handle: GanttHandle) => unknown];
type UpdateResult = Awaited<ReturnType<GanttHandle['updateTask']>>;

/** `1 task changed`, `5 tasks changed`: a change set lists every task it changed. */
function changed(changes: readonly unknown[]): string {
  return `${changes.length} ${changes.length === 1 ? 'task' : 'tasks'} changed`;
}

/** What `updateTask` did, in a few words. */
function summarize(result: UpdateResult): string {
  return result.status === 'committed'
    ? `committed, ${changed(result.changeSet.changes)}`
    : result.status;
}

// Every method is on the handle: `handle.setViewMode(…)`, `handle.edit.begin()`, … What they
// return is shown after the arrow. These tables only describe the buttons.
const VIEW: Action[] = [
  ...['day', 'week', 'month'].map((id): Action => [
    id,
    `setViewMode('${id}')`,
    (handle) => {
      handle.setViewMode(id);
    },
  ]),
  [
    'Go to Launch',
    "scrollToTask('launch')",
    (handle) => {
      handle.scrollToTask('launch', { align: 'center' });
    },
  ],
  [
    'Select Design',
    "select(['design'])",
    (handle) => {
      handle.select(['design']);
    },
  ],
  [
    'Clear',
    'clearSelection()',
    (handle) => {
      handle.clearSelection();
    },
  ],
];

const CHANGES: Action[] = [
  [
    'Design +10%',
    "updateTask('design', { progress })",
    async (handle) => {
      const progress = Math.min(100, (handle.getTask('design')?.progress ?? 0) + 10);
      return summarize(await handle.updateTask('design', { progress }));
    },
  ],
  [
    'Build +1 week',
    "updateTask('build', { start })",
    async (handle) => {
      const start = handle.getTask('build')?.start; // a `Date`: never mutate it
      if (!start) return 'no such task';
      // Alone, a new `start` moves the task and keeps its length; its successors follow.
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      return summarize(await handle.updateTask('build', { start: next }));
    },
  ],
  ['Undo', 'undo()', (handle) => handle.undo().status],
  ['Redo', 'redo()', (handle) => handle.redo().status],
  ['Edit', 'edit.begin()', (handle) => handle.edit.begin().status],
  [
    'Save',
    'edit.commit()',
    (handle) => {
      const result = handle.edit.commit();
      return result.status === 'committed'
        ? `committed, ${changed(result.changes.changes)}`
        : result.status;
    },
  ],
  ['Cancel', 'edit.rollback()', (handle) => handle.edit.rollback().status],
];

function Buttons({
  label,
  actions,
  onRun,
}: {
  label: string;
  actions: readonly Action[];
  onRun: (call: string, run: Action[2]) => void;
}) {
  return (
    <div role="toolbar" aria-label={label}>
      {actions.map(([name, call, run]) => (
        <button
          key={name}
          type="button"
          onClick={() => {
            onRun(call, run);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export default function Example() {
  // The handle: the methods of the chart, for code that does not run while rendering (a click, an
  // effect). It is `null` before the chart is committed and after the component unmounts.
  const chart = useRef<GanttHandle>(null);
  const [returned, setReturned] = useState(
    'Press a button: this line says what the method returned.',
  );
  const [heard, setHeard] = useState('Press Select Design, or click an arrow between two bars.');

  // `on` adds a listener that is not tied to a render, and returns the function that removes it.
  useEffect(
    () =>
      chart.current?.on('selectionChange', (tasks, link) => {
        setHeard(`selectionChange: tasks [${tasks.join(', ')}], link ${link ?? 'none'}`);
      }),
    [],
  );

  /** Calls a method on the handle, then says what it returned (a string, or a promise of one). */
  const onRun = (call: string, run: Action[2]): void => {
    const handle = chart.current;
    if (!handle) return;
    void Promise.resolve(run(handle)).then((value) => {
      setReturned(typeof value === 'string' ? `${call} → ${value}` : call);
    });
  };

  // `viewMode` is a controlled prop in React: the chart would show the one your state holds, and
  // put back what `setViewMode` on the handle sets. So the chart starts from `defaultViewMode`
  // and owns the mode; `defaultTasks` and `defaultLinks` are where it starts with the data.
  const { viewMode, ...rest } = options;

  return (
    <>
      <Buttons label="View, scrolling and selection" actions={VIEW} onRun={onRun} />
      <Buttons label="Changes, history and edit session" actions={CHANGES} onRun={onRun} />
      {/* What the last call returned, and what the listener heard: next to the buttons. */}
      <p>{returned}</p>
      <p>{heard}</p>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 340, marginTop: '0.5rem' }}
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
      />
    </>
  );
}

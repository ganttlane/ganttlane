import '@ganttlane/react/styles.css';
import './styles.css';

import { type GanttInstance, type TaskId, useGantt, useGanttState } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { createHooks, type HookEnv, refusalText, type Rule, RULES } from './hooks';
import { options } from './options';

const NOTHING = 'Nothing is waiting for an answer.';

export default function Example() {
  // The rule of the task hook, and whether the link hook refuses links into Release.
  const [rule, setRule] = useState<Rule>('allow');
  const [refuse, setRefuse] = useState(true);
  // The lines of the status: what happened to the last action, in the order it happened.
  const [lines, setLines] = useState<readonly string[]>([
    'Drag a bar, or its progress handle, and watch what the hook does. Link Docs or QA to Release.',
  ]);
  // The question of a hook that answers later, and the function that settles its promise.
  const [waiting, setWaiting] = useState<{
    question: string;
    answer: (approved: boolean) => void;
  }>();
  const settle = (approved: boolean): void => {
    waiting?.answer(approved);
    setWaiting(undefined);
  };
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it.
  const { viewMode, ...rest } = options;

  // The handlers read `gantt`, which they are passed to: give it a type.
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);
  const say = (text: string): void => {
    setLines((current) => [...current, text]);
  };
  const env: HookEnv = {
    rule,
    refuseLinks: refuse,
    nameOf,
    begin: () => {
      setLines([]);
    },
    say,
    ask: (question) =>
      new Promise((answer) => {
        setWaiting({ question, answer });
      }),
  };

  const gantt: GanttInstance = useGantt({
    ...rest,
    defaultViewMode: viewMode,
    // `tasks` and `links` are controlled props in React: these are where the chart starts.
    defaultTasks: tasks,
    defaultLinks: links,
    ...createHooks(env), // onBeforeTaskChange and onBeforeLinkCreate: see hooks.ts
    // What the chart reports after a change that went through.
    onTasksChange: (changeSet) => {
      const names = changeSet.changes.map((change) => nameOf(change.id)).join(', ');
      say(`Committed (${changeSet.reason}): ${names}.`);
    },
    onLinkCreate: (link) => {
      say(`Created ${nameOf(link.source)} → ${nameOf(link.target)}.`);
    },
    // A gesture the chart would not start: here, because a hook has not answered (`busy`).
    onEditRefused: (refusal) => {
      say(refusalText(refusal, nameOf));
    },
  });
  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;

  // `busy` is in the snapshot of the chart: true while a hook has not answered.
  const busy = useGanttState(gantt, (snapshot) => snapshot.busy);

  return (
    <>
      <div role="toolbar">
        <label>
          onBeforeTaskChange:{' '}
          <select
            aria-label="What onBeforeTaskChange does"
            value={rule}
            onChange={(event) => setRule(event.target.value as Rule)}
          >
            {RULES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={refuse} onChange={() => setRefuse(!refuse)} />{' '}
          onBeforeLinkCreate refuses links into Release
        </label>
        <span className="hooks-busy" data-busy={busy ? '' : undefined}>
          busy: {busy ? 'yes' : 'no'}
        </span>
      </div>
      {/* Where an answer that comes later is asked for: the hook returns a promise, and these
          buttons settle it. */}
      <div role="group" aria-label="Answer to the hook" className="hooks-ask">
        <span>{waiting?.question ?? NOTHING}</span>
        <button type="button" disabled={waiting === undefined} onClick={() => settle(true)}>
          Approve
        </button>
        <button type="button" disabled={waiting === undefined} onClick={() => settle(false)}>
          Reject
        </button>
      </div>
      {/* `useGantt` is <Gantt> without the `div`: you render the container, and the slots next to it. */}
      <div ref={setContainer} style={{ height: 370 }} />
      {slots}
      <p>{lines.join(' ')}</p>
    </>
  );
}

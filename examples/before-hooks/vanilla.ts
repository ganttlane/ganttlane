import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import { createHooks, type HookEnv, refusalText, type Rule, RULES } from './hooks';
import { options } from './options';

const NOTHING = 'Nothing is waiting for an answer.';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '370px';
  const status = document.createElement('p');
  status.textContent =
    'Drag a bar, or its progress handle, and watch what the hook does. Link Docs or QA to Release.';

  // The rule of the task hook, and whether the link hook refuses links into Release.
  const rule = document.createElement('select');
  rule.setAttribute('aria-label', 'What onBeforeTaskChange does');
  for (const { id, label } of RULES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    rule.append(option);
  }
  const ruleLabel = document.createElement('label');
  ruleLabel.append('onBeforeTaskChange: ', rule);
  const refuse = document.createElement('input');
  refuse.type = 'checkbox';
  refuse.checked = true;
  const refuseLabel = document.createElement('label');
  refuseLabel.append(refuse, ' onBeforeLinkCreate refuses links into Release');
  // Whether the chart is busy: a hook has not answered yet.
  const busy = document.createElement('span');
  busy.className = 'hooks-busy';
  toolbar.append(ruleLabel, refuseLabel, busy);

  // Where an answer that comes later is asked for: the hook returns a promise, and these buttons
  // settle it.
  const ask = document.createElement('div');
  ask.setAttribute('role', 'group');
  ask.setAttribute('aria-label', 'Answer to the hook');
  ask.className = 'hooks-ask';
  const question = document.createElement('span');
  question.textContent = NOTHING;
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.textContent = 'Approve';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.textContent = 'Reject';
  ask.append(question, approve, reject);
  root.append(toolbar, ask, chart, status);
  container.append(root);

  // The lines of the status: what happened to the last action, in the order it happened.
  let lines: string[] = [];
  let answer: ((approved: boolean) => void) | undefined;
  const settle = (approved: boolean): void => {
    answer?.(approved);
    answer = undefined;
    question.textContent = NOTHING;
    approve.disabled = reject.disabled = true;
  };
  settle(false);
  approve.addEventListener(
    'click',
    () => {
      settle(true);
    },
    { signal },
  );
  reject.addEventListener(
    'click',
    () => {
      settle(false);
    },
    { signal },
  );

  // The handlers read `gantt`, which they are passed to: give it a type.
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);
  const env: HookEnv = {
    get rule() {
      return rule.value as Rule;
    },
    get refuseLinks() {
      return refuse.checked;
    },
    nameOf,
    begin: () => {
      lines = [];
    },
    say: (text) => {
      lines.push(text);
      status.textContent = lines.join(' ');
    },
    ask: (text) =>
      new Promise((resolve) => {
        answer = resolve;
        question.textContent = text;
        approve.disabled = reject.disabled = false;
      }),
  };

  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    ...createHooks(env), // onBeforeTaskChange and onBeforeLinkCreate: see hooks.ts
    // What the chart reports after a change that went through.
    onTasksChange: (changeSet) => {
      const names = changeSet.changes.map((change) => nameOf(change.id)).join(', ');
      env.say(`Committed (${changeSet.reason}): ${names}.`);
    },
    onLinkCreate: (link) => {
      env.say(`Created ${nameOf(link.source)} → ${nameOf(link.target)}.`);
    },
    // A gesture the chart would not start: here, because a hook has not answered (`busy`).
    onEditRefused: (refusal) => {
      env.say(refusalText(refusal, nameOf));
    },
  });

  // `busy` is in the snapshot of the core, which tells its subscribers whenever it changes.
  const showBusy = (): void => {
    const isBusy = gantt.core.getSnapshot().busy;
    busy.textContent = `busy: ${isBusy ? 'yes' : 'no'}`;
    busy.toggleAttribute('data-busy', isBusy);
  };
  const unsubscribe = gantt.core.subscribe(showBusy);
  showBusy();

  return () => {
    controller.abort();
    unsubscribe();
    // A hook that is still waiting must not be left hanging.
    settle(false);
    gantt.destroy();
    root.remove();
  };
}

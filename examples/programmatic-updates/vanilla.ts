import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { type Action, ACTIONS, changeText, issuesText } from './actions';
import { links, tasks } from './data';
import { options } from './options';

const IDLE = 'Press a button: the call and what it returned show above, the events below.';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.createElement('div');
  const toolbars = new Map<string, HTMLElement>();
  const chart = document.createElement('div');
  chart.style.height = '330px';
  const result = document.createElement('pre');
  result.className = 'updates-result';
  result.setAttribute('aria-live', 'polite');
  result.textContent = IDLE;
  const status = document.createElement('p');
  status.textContent = 'Events: none yet.';
  root.append(chart, result, status);
  container.append(root);

  // The events that the last call caused, in the order they came.
  let events: string[] = [];
  const report = (line: string): void => {
    events.push(line);
    status.textContent = `Events: ${events.join('; ')}.`;
  };

  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The events tell everybody else what a call did; the call's own result tells its caller.
    onTasksChange: (changeSet) => {
      report(changeText(changeSet));
    },
    onLinkCreate: (link) => {
      report(`onLinkCreate (${String(link.source)} → ${String(link.target)})`);
    },
    onLinkDelete: (link) => {
      report(`onLinkDelete (${String(link.source)} → ${String(link.target)})`);
    },
    onIssues: (payload) => {
      report(issuesText(payload));
    },
  });

  async function run(action: Action): Promise<void> {
    events = [];
    status.textContent = 'Events: none.';
    result.textContent = await action.run(gantt);
  }

  // One row of buttons for each group of actions, above the chart.
  for (const action of ACTIONS) {
    let toolbar = toolbars.get(action.group);
    if (toolbar === undefined) {
      toolbar = document.createElement('div');
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', action.group);
      const label = document.createElement('span');
      label.className = 'updates-group';
      label.textContent = action.group;
      toolbar.append(label);
      toolbars.set(action.group, toolbar);
      root.insertBefore(toolbar, chart);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener(
      'click',
      () => {
        void run(action);
      },
      { signal: controller.signal },
    );
    toolbar.append(button);
  }

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

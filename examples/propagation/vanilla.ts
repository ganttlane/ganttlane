import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { brokenLinks, describe, PROPAGATION, startMoved } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '320px';
  const status = document.createElement('p');
  status.textContent = 'Drag Design, then switch Propagation to none and drag it again.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The "refuse" box is read by the before-hook each time a change is about to be applied.
  const refuse = document.createElement('input');
  refuse.type = 'checkbox';

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // Asked before a change is applied, with the conflicts it would have; `false` cancels it.
    onBeforeTaskChange: ({ conflicts }) => {
      const broken = brokenLinks(conflicts);
      if (!refuse.checked || broken.length === 0) return true;
      status.textContent = `Refused: ${broken.map((conflict) => conflict.message).join('; ')}.`;
      return false;
    },
    // One event per change, a drag or `updateTask`: the edited task first, then the tasks the
    // links moved, and the conflicts of the result.
    onTasksChange: (changeSet): void => {
      status.textContent = describe(changeSet, (id) => gantt.getTask(id)?.name ?? String(id));
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
  };

  // `scheduling.propagation` changes without recreating the chart; it matters at the next edit.
  const policy = document.createElement('select');
  for (const value of PROPAGATION) {
    const option = document.createElement('option');
    option.value = option.textContent = value;
    option.selected = value === options.scheduling.propagation;
    policy.append(option);
  }
  policy.addEventListener(
    'change',
    () => {
      const propagation = PROPAGATION.find((value) => value === policy.value);
      if (propagation) gantt.setOptions({ scheduling: { propagation } });
    },
    { signal },
  );
  const policyLabel = document.createElement('label');
  policyLabel.append('Propagation ', policy);
  const refuseLabel = document.createElement('label');
  refuseLabel.append(refuse, ' Refuse a broken link');
  toolbar.append(policyLabel, refuseLabel);

  // The same edits as a drag, from code (`reason: 'api'`): they go through the before-hook too.
  addButton('Design +3 days', () => {
    void gantt.updateTask('design', { start: startMoved(gantt.getTask('design'), 3) });
  });
  addButton('Review -3 days', () => {
    void gantt.updateTask('review', { start: startMoved(gantt.getTask('review'), -3) });
  });
  addButton('Reset', () => {
    gantt.setTasks(tasks);
    status.textContent = 'Back to the start.';
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

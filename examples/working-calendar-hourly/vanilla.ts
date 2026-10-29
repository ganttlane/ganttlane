import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'quarter-day', 'hour'] as const;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '380px';
  const status = document.createElement('p');
  status.textContent = 'Drag Code freeze: QA keeps its gap, and Monitor its lag.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handler reads `gantt`, which it is passed to: give it a return type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    onTasksChange: (): void => {
      // The records are computed from the calendar: `Date`s with the wall-clock time the data says.
      status.textContent = describe(gantt.getTask('qa'));
    },
  });

  const controller = new AbortController();
  for (const id of VIEW_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = id;
    button.addEventListener('click', () => gantt.setViewMode(id), { signal: controller.signal });
    toolbar.append(button);
  }

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

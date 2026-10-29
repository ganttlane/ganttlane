import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'] as const;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '380px';
  const status = document.createElement('p');
  status.textContent = 'Click a bar, or drag it, its edges or the handle at its foot.';
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    onTaskClick: (record) => {
      status.textContent = `Clicked ${record.name}`;
    },
    // One event per drag, with every task it moved (the dragged one and what follows it).
    onTasksChange: (changeSet) => {
      const moved = changeSet.changes.map((change) => String(change.id)).join(', ');
      status.textContent = `${changeSet.reason}: moved ${moved}`;
    },
  });

  // Everything can change later without recreating the chart.
  const controller = new AbortController();
  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal: controller.signal });
    toolbar.append(button);
  };
  for (const id of VIEW_MODES) addButton(id, () => gantt.setViewMode(id));
  addButton('Go to QA', () => gantt.scrollToTask('qa'));

  // When the page is done with the chart: removes every node, listener and timer it added.
  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

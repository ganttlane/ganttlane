// No `import '@ganttlane/dom/styles.css'`: the chart is styled by this example's own sheet alone.
import './styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'] as const;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height. The
  // class is what `styles.css` hangs every rule on (`.paper .gantt__bar`, …).
  const chart = document.createElement('div');
  chart.className = 'paper';
  chart.style.height = '400px';
  const status = document.createElement('p');
  status.textContent =
    'This example imports no default stylesheet. Click a bar (data-selected), or hover one for its handles.';
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  // Clicking a bar only reports it (`taskClick`); selecting it is the application's call.
  gantt.on('taskClick', (record) => {
    gantt.select([record.id]);
    status.textContent = `${record.name} is selected: its bar has data-selected.`;
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

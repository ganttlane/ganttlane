import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, type Meta, tasks } from './data';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '420px';
  root.append(toolbar, chart);
  container.append(root);

  // `Meta` is the type of `task.data`: it flows to every handler and render function.
  const gantt = createGantt<Meta>(chart, { tasks, links, ...options });

  const controller = new AbortController();
  const actions = [
    ['Expand all', () => gantt.expandAll()],
    ['Collapse all', () => gantt.collapseAll()],
  ] as const;
  for (const [label, run] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', run, { signal: controller.signal });
    toolbar.append(button);
  }

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

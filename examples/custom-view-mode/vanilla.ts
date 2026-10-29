import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options, VIEW_MODES } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '450px';
  const status = document.createElement('p');
  status.textContent =
    'Pick a view mode: day and week are presets with overrides, the others are new.';
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The handler gets the `ViewMode` that is now in use, whether it is a preset or one of ours.
    onViewModeChange: (viewMode) => {
      status.textContent = describe(viewMode);
    },
  });

  const controller = new AbortController();
  const select = document.createElement('select');
  for (const id of VIEW_MODES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    select.append(option);
  }
  select.value = options.viewMode;
  select.addEventListener('change', () => gantt.setViewMode(select.value), {
    signal: controller.signal,
  });
  const label = document.createElement('label');
  label.append('View mode ', select);
  toolbar.append(label);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

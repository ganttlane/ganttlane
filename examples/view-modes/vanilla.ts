import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, VIEW_MODES, zoomed } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '470px';
  const status = document.createElement('p');
  status.textContent = 'Pick a view mode, or zoom in and out.';
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The view mode in use changed: the handler gets the `ViewMode` itself.
    onViewModeChange: (viewMode) => {
      status.textContent = describe(viewMode, viewMode.pxPerDay);
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const select = document.createElement('select');
  for (const id of VIEW_MODES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    select.append(option);
  }
  select.value = options.viewMode;
  select.addEventListener('change', () => gantt.setViewMode(select.value), { signal });
  const label = document.createElement('label');
  label.append('View mode ', select);
  toolbar.append(label);

  // `zoomTo` sets the pixels per day of the view mode in use, keeping the date in the middle.
  // Another view mode starts again from its own preset.
  const addZoom = (name: string, factor: number): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener(
      'click',
      () => {
        gantt.zoomTo(zoomed(gantt.core.getSnapshot().timeline.scale.pxPerDay, factor));
        const { viewMode, timeline } = gantt.core.getSnapshot();
        status.textContent = describe(viewMode, timeline.scale.pxPerDay);
      },
      { signal },
    );
    toolbar.append(button);
  };
  addZoom('Zoom in', 1.25);
  addZoom('Zoom out', 0.8);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, LINK_TYPES, RADII } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '440px';
  const status = document.createElement('p');
  status.textContent = 'Drag Design, or one of its edges, and watch the nine tasks linked to it.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handler reads `gantt`, which it is passed to: give it a return type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // One event per drag: the dragged task first, then the tasks its links moved.
    onTasksChange: (changeSet): void => {
      status.textContent = describe(changeSet, (id) => gantt.getTask(id)?.name ?? String(id));
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const addSelect = (
    label: string,
    values: readonly (string | number)[],
    selected: string | number,
    onChange: (value: string) => void,
  ): void => {
    const field = document.createElement('label');
    const select = document.createElement('select');
    for (const value of values) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      option.selected = value === selected;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value), { signal });
    field.append(`${label} `, select);
    toolbar.append(field);
  };

  // Both options change without recreating the chart: the core re-reads the link types, and the
  // renderer redraws the routes.
  addSelect('Default link type', LINK_TYPES, options.scheduling.defaultLinkType, (value) => {
    const type = LINK_TYPES.find((candidate) => candidate === value);
    if (type) gantt.setOptions({ scheduling: { defaultLinkType: type } });
  });
  addSelect('Corner radius', RADII, options.display.linkCurveRadius, (value) => {
    gantt.setOptions({ display: { linkCurveRadius: Number(value) } });
  });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener(
    'click',
    () => {
      gantt.setTasks(tasks);
      gantt.setLinks(links);
      status.textContent = 'Back to the start.';
    },
    { signal },
  );
  toolbar.append(reset);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

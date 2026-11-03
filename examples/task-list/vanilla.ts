import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt } from '@ganttlane/dom';
import { createTaskList } from '@ganttlane/dom/task-list';

import { links, tasks } from './data';
import { CHART_HEIGHT, columns, type HeightMode, HEIGHTS, THEMES, VIEW_MODES } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const plan = document.createElement('div');
  plan.className = 'plan';
  const side = document.createElement('div');
  const chart = document.createElement('div');
  chart.className = 'plan__chart';
  plan.append(side, chart);
  const status = document.createElement('p');
  status.textContent = 'Click a name or a bar. Drag a bar, and the Dates column follows.';
  root.append(toolbar, plan, status);
  container.append(root);

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    layout: { ...options.layout, height: CHART_HEIGHT },
    onSelectionChange: (keys) => {
      const [id] = keys;
      status.textContent = id === undefined ? 'Nothing selected.' : `Selected: ${String(id)}.`;
    },
  });
  // Everything else is kept in sync by the list: rows, sizes, selection, hover, focus, scrolling.
  const list = createTaskList(side, gantt, { columns });

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
  };
  const addSelect = <T extends string>(
    label: string,
    values: readonly T[],
    selected: T,
    onChange: (value: T) => void,
  ): void => {
    const field = document.createElement('label');
    const select = document.createElement('select');
    for (const value of values) {
      // `new Option()` does not exist in happy-dom, where the examples are tested.
      const item = document.createElement('option');
      item.value = item.textContent = value;
      item.selected = value === selected;
      select.append(item);
    }
    select.addEventListener(
      'change',
      () => {
        const value = values.find((candidate) => candidate === select.value);
        if (value !== undefined) onChange(value);
      },
      { signal },
    );
    field.append(`${label} `, select);
    toolbar.append(field);
  };

  addButton('Expand all', () => gantt.expandAll());
  addButton('Collapse all', () => gantt.collapseAll());
  addSelect('View', VIEW_MODES, options.viewMode, (viewMode) => gantt.setViewMode(viewMode));
  addSelect('Theme', THEMES, 'auto', (theme) => gantt.setOptions({ theme }));
  addSelect<HeightMode>('Height', HEIGHTS, 'fixed', (mode) => {
    plan.dataset.height = mode;
    gantt.setOptions({ layout: { height: mode === 'auto' ? 'auto' : CHART_HEIGHT } });
  });

  return () => {
    controller.abort();
    list.destroy();
    gantt.destroy();
    root.remove();
  };
}

import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { CHILD_ANCHORS, describe, describeExpanded, MOVE_CHILDREN } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '420px';
  const status = document.createElement('p');
  status.textContent = 'Drag Build, then change Move children and drag it again.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // One event per drag: the dragged task first, then the children that moved with it.
    onTasksChange: (changeSet): void => {
      status.textContent = describe(changeSet, (id) => gantt.getTask(id)?.name ?? String(id));
    },
    // Called by `expand`, `collapse`, `expandAll` and `collapseAll`.
    onExpandedChange: (keys): void => {
      status.textContent = describeExpanded(keys, (id) => gantt.getTask(id)?.name ?? String(id));
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

  const addSelect = (
    label: string,
    values: readonly string[],
    selected: string,
    onChange: (value: string) => void,
  ): void => {
    const field = document.createElement('label');
    const select = document.createElement('select');
    for (const value of values) {
      const option = document.createElement('option');
      option.value = option.textContent = value;
      option.selected = value === selected;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value), { signal });
    field.append(`${label} `, select);
    toolbar.append(field);
  };

  // The methods that open and shut phases (the chart has no button of its own for it).
  addButton('Expand all', () => gantt.expandAll());
  addButton('Collapse all', () => gantt.collapseAll());
  addButton('Toggle Build', () => {
    if (gantt.getTask('build')?.isExpanded) gantt.collapse('build');
    else gantt.expand('build');
  });

  // Both options change without recreating the chart; they matter at the next drag.
  addSelect('Move children', MOVE_CHILDREN, options.hierarchy.moveChildren, (value) => {
    const moveChildren = MOVE_CHILDREN.find((candidate) => candidate === value);
    if (moveChildren) gantt.setOptions({ hierarchy: { moveChildren } });
  });
  addSelect(
    'Child anchor',
    CHILD_ANCHORS.map((entry) => entry.label),
    options.hierarchy.childAnchor,
    (value) => {
      const entry = CHILD_ANCHORS.find((candidate) => candidate.label === value);
      if (entry) gantt.setOptions({ hierarchy: { childAnchor: entry.anchor } });
    },
  );

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

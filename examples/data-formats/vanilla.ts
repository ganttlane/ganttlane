import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, type Meta, tasks } from './data';
import { describe, inputOf } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'half-day', 'quarter-day'] as const;
const HINT = 'Click a bar to see how its input was written, and how the chart read it.';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '470px';
  const status = document.createElement('p');
  status.textContent = HINT;
  root.append(toolbar, chart, status);
  container.append(root);

  // `Meta` is the type of `task.data`: it flows to every handler and render function.
  const gantt = createGantt<Meta>(chart, {
    tasks,
    links,
    ...options,
    onTaskClick: (record) => {
      // `record.task` is the task as you gave it, never changed by the chart; the rest of the
      // record is what the chart made of it.
      status.textContent = `${record.name}: written as ${inputOf(record.task, links)}. Read as ${describe(record)}.`;
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  // `dates.endInclusive`: what a date-only `end` means.
  const endInclusive = document.createElement('input');
  endInclusive.type = 'checkbox';
  endInclusive.checked = options.dates.endInclusive;
  endInclusive.addEventListener(
    'change',
    () => {
      // `dates` is merged field by field with the one set before: only this field changes.
      gantt.setOptions({ dates: { endInclusive: endInclusive.checked } });
      status.textContent = HINT; // what the last click said is out of date now
    },
    { signal },
  );
  const endLabel = document.createElement('label');
  endLabel.append(endInclusive, ' dates.endInclusive');

  // The scale: the finer ones show the times of day of the timed tasks.
  const view = document.createElement('select');
  for (const id of VIEW_MODES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    view.append(option);
  }
  view.value = options.viewMode;
  view.addEventListener(
    'change',
    () => {
      gantt.setViewMode(view.value);
    },
    { signal },
  );
  const viewLabel = document.createElement('label');
  viewLabel.append('View ', view);

  toolbar.append(viewLabel, endLabel);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

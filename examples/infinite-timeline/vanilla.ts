import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe } from './helpers';
import { options, SETTINGS } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const actions = document.createElement('div');
  actions.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '400px';
  const status = document.createElement('p');
  status.textContent = 'Scroll the chart sideways, as far as you like, or press a button.';
  root.append(toolbar, actions, chart, status);
  container.append(root);

  // How many times each kind of change has happened since the setting was chosen.
  const counts = new Map<string, number>();
  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The range of the timeline changed: why, and what it is now. The first one is `'initial'`;
    // an infinite timeline adds `'extend-start'`, `'extend-end'`, `'trim-start'` and `'trim-end'`.
    onRangeChange: (range) => {
      counts.set(range.reason, (counts.get(range.reason) ?? 0) + 1);
      status.textContent = describe(range, range.reason, counts);
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const select = document.createElement('select');
  for (const { id, label } of SETTINGS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    select.append(option);
  }
  select.value = 'defaults';
  select.addEventListener(
    'change',
    () => {
      const setting = SETTINGS.find((candidate) => candidate.id === select.value);
      if (!setting) return;
      counts.clear();
      status.textContent = 'Setting changed: scroll the chart sideways.';
      // `timeline` merges field by field with the options set before.
      gantt.setOptions({ timeline: { infinite: setting.infinite } });
    },
    { signal },
  );
  const label = document.createElement('label');
  label.append('timeline.infinite: ', select);
  toolbar.append(label);

  const addButton = (name: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', onClick, { signal });
    actions.append(button);
  };
  // A date far outside the timeline: it grows to reach it (unless `bounds` say no). A jump is
  // `instant` here, so that the chart does not glide for a year.
  addButton('Go to Jan 2025', () => {
    gantt.scrollToDate('2025-01-06', { behavior: 'instant', align: 'center' });
  });
  addButton('Go to Dec 2027', () => {
    gantt.scrollToDate('2027-12-06', { behavior: 'instant', align: 'center' });
  });
  addButton('Back to the plan', () => {
    gantt.scrollToTask('design', { behavior: 'instant' });
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

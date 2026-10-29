import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { COUNTS, DEFAULT_COUNT, generate, links, tasks } from './data';
import { describe, onFirstPaint } from './helpers';
import { options } from './options';

/** A chart on the screen, with what it takes to take it away again. */
interface Mounted {
  readonly gantt: Gantt;
  readonly size: number;
  /** Stops watching for the first paint. */
  readonly stop: () => void;
}

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '400px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const create = (size: number): Mounted => {
    const plan = size === DEFAULT_COUNT ? { tasks, links } : generate(size);
    status.textContent = describe(plan.tasks.length, plan.links.length);
    const started = performance.now();
    const gantt = createGantt(chart, { tasks: plan.tasks, links: plan.links, ...options });
    // The chart is made at once and draws its bars in the next animation frame: the time to the
    // first bars is what a visitor waits for.
    const stop = onFirstPaint(chart, started, (milliseconds) => {
      status.textContent = describe(plan.tasks.length, plan.links.length, milliseconds);
    });
    return { gantt, size, stop };
  };
  let current = create(DEFAULT_COUNT);

  const controller = new AbortController();
  const { signal } = controller;

  const select = document.createElement('select');
  for (const size of COUNTS) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = size.toLocaleString('en');
    select.append(option);
  }
  select.value = String(DEFAULT_COUNT);
  select.addEventListener(
    'change',
    () => {
      const size = COUNTS.find((candidate) => String(candidate) === select.value);
      if (size === undefined) return;
      // A new plan is a new chart: the old one is taken away first.
      current.stop();
      current.gantt.destroy();
      current = create(size);
    },
    { signal },
  );
  const label = document.createElement('label');
  label.append('Tasks ', select);
  toolbar.append(label);

  const addButton = (name: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
  };
  // Only the rows in view are drawn, so a jump to the last row of the plan costs no more than the
  // first screen did.
  addButton('First task', () => {
    current.gantt.scrollToTask('t1', { behavior: 'instant' });
  });
  addButton('Last task', () => {
    current.gantt.scrollToTask(`t${String(current.size)}`, { behavior: 'instant' });
  });

  return () => {
    controller.abort();
    current.stop();
    current.gantt.destroy();
    root.remove();
  };
}

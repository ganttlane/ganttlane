import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, describeUnchanged } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '370px';
  const status = document.createElement('p');
  status.textContent = 'Drag the little handle at the foot of the done part of a bar.';
  root.append(toolbar, chart, status);
  container.append(root);

  // What the change was, from `onTasksChange`, for the sentence `onTaskProgressChange` writes.
  let reason = '';
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // One event per change, whatever it was (a move, a resize, the handle)...
    onTasksChange: (changeSet): void => {
      reason = changeSet.reason;
      status.textContent = describeUnchanged(reason);
    },
    // ...and one per task whose progress changed, after it: a resize rebases the percentage.
    onTaskProgressChange: (record, progress): void => {
      status.textContent = describe(record, progress, reason);
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  // `skipNonWorkingDays` is one object: it is given whole, and `setOptions` replaces it.
  const skip = document.createElement('input');
  skip.type = 'checkbox';
  skip.checked = options.scheduling.skipNonWorkingDays.progress;
  skip.addEventListener(
    'change',
    () => gantt.setOptions({ scheduling: { skipNonWorkingDays: { progress: skip.checked } } }),
    { signal },
  );
  const skipLabel = document.createElement('label');
  skipLabel.append(skip, ' Skip days off for progress');
  toolbar.append(skipLabel);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener(
    'click',
    () => {
      gantt.setTasks(tasks);
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

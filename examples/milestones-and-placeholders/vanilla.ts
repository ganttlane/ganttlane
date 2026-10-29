import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt, type Task } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, describeTask, toggleHiring } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '490px';
  const status = document.createElement('p');
  status.textContent = 'Click a milestone or a bar, or drag Kick-off.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The record says what the row is: `type`, and a `duration` of 0 for a milestone.
    onTaskClick: (record): void => {
      status.textContent = describeTask(record);
    },
    // One event per drag: the dragged task first, then the tasks its links moved.
    onTasksChange: (changeSet): void => {
      status.textContent = describe(changeSet, (id) => gantt.getTask(id)?.name ?? String(id));
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const addButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
    return button;
  };

  // The tasks are yours: a new list goes in with `setTasks`, and the chart diffs it by id.
  let current: Task[] = [...tasks];
  const schedule = addButton('Schedule Hiring', () => {
    current = toggleHiring(current);
    gantt.setTasks(current);
    const scheduled = gantt.getTask('hiring')?.type === 'task';
    schedule.textContent = scheduled ? 'Unschedule Hiring' : 'Schedule Hiring';
    status.textContent = scheduled
      ? 'Hiring is a task now: it has dates and a bar.'
      : 'Hiring is a placeholder again: a row with no bar.';
  });
  addButton('Reset', () => {
    current = [...tasks];
    gantt.setTasks(current);
    schedule.textContent = 'Schedule Hiring';
    status.textContent = 'Back to the start.';
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

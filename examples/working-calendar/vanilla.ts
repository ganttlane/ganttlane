import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, DURATION_MODES, type Skip } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '380px';
  const status = document.createElement('p');
  status.textContent =
    'Drag a bar onto a day off, drag an edge, or drag the little handle at the foot of a bar.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handler reads `gantt`, which it is passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // The records are computed from the calendar: dates, working days, conflicts.
    onTasksChange: (changeSet): void => {
      const [edited] = changeSet.changes;
      if (edited) status.textContent = describe(gantt.getTask(edited.id), changeSet.reason);
    },
  });

  const controller = new AbortController();
  const { signal } = controller;

  const durations = document.createElement('select');
  for (const value of DURATION_MODES) {
    const option = document.createElement('option');
    option.value = option.textContent = value;
    option.selected = value === options.scheduling.durationMode;
    durations.append(option);
  }
  // The mode changes without recreating the chart: the core counts every duration again.
  durations.addEventListener(
    'change',
    () => {
      const durationMode = DURATION_MODES.find((value) => value === durations.value);
      if (durationMode) gantt.setOptions({ scheduling: { durationMode } });
    },
    { signal },
  );
  const durationsLabel = document.createElement('label');
  durationsLabel.append('Durations count ', durations);
  toolbar.append(durationsLabel);

  // `skipNonWorkingDays` is one object: give all three flags each time.
  const skip: Skip = { ...options.scheduling.skipNonWorkingDays };
  const addCheckbox = (label: string, flag: keyof Skip): void => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = skip[flag];
    box.addEventListener(
      'change',
      () => {
        skip[flag] = box.checked;
        gantt.setOptions({ scheduling: { skipNonWorkingDays: { ...skip } } });
      },
      { signal },
    );
    const field = document.createElement('label');
    field.append(box, ` ${label}`);
    toolbar.append(field);
  };
  addCheckbox('Skip days off: move', 'move');
  addCheckbox('resize', 'resize');
  addCheckbox('progress', 'progress');

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

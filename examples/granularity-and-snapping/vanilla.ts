import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import {
  ALIGN_INPUTS,
  describeEdit,
  describeIssues,
  GRANULARITIES,
  SNAPS,
  stepName,
  VIEW_MODES,
} from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '370px';
  // The first line says what the options do now, the second what the last drag did.
  const info = document.createElement('p');
  const status = document.createElement('p');
  status.textContent = 'Drag a bar, then hold Alt and drag it again.';
  root.append(toolbar, chart, info, status);
  container.append(root);

  // The handler reads `gantt`, which it is passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    onTasksChange: (changeSet): void => {
      const [edited] = changeSet.changes;
      if (edited) status.textContent = describeEdit(gantt.getTask(edited.id), changeSet.reason);
    },
  });

  // The step a drag snaps to is resolved from the view mode, `scheduling.snap` and the granularity;
  // the snapshot has the result. The data issues are the chart's own.
  let granularity: string = options.scheduling.granularity;
  const refresh = (): void => {
    const { move } = gantt.core.getSnapshot().state.derived.snap.snap;
    const nameOf = (id: string | number): string => gantt.getTask(id)?.name ?? String(id);
    const text =
      `Snap step: ${stepName(move)}; with Alt: ${granularity}. ` +
      describeIssues(gantt.getIssues().data, nameOf);
    if (info.textContent !== text) info.textContent = text;
  };
  // Called after every change of the chart's state: a view mode, an option, the data.
  gantt.core.subscribe(refresh);
  refresh();

  const controller = new AbortController();
  const { signal } = controller;

  for (const id of VIEW_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = id;
    // `keepScroll: false` scrolls to the first task again, as when the chart opened; by default the
    // date at the centre of the chart stays where it is.
    button.addEventListener('click', () => gantt.setViewMode(id, { keepScroll: false }), {
      signal,
    });
    toolbar.append(button);
  }

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

  // Each of these changes without recreating the chart: the core re-reads the data and the snap.
  addSelect(
    'Snap',
    SNAPS.map((entry) => entry.label),
    SNAPS[0].label,
    (value) => {
      const entry = SNAPS.find((candidate) => candidate.label === value);
      if (entry) gantt.setOptions({ scheduling: { snap: entry.snap } });
    },
  );
  addSelect('Granularity', GRANULARITIES, options.scheduling.granularity, (value) => {
    granularity = value;
    gantt.setOptions({ scheduling: { granularity: value } });
  });
  addSelect('Align input', ALIGN_INPUTS, options.scheduling.alignInput, (value) => {
    const alignInput = ALIGN_INPUTS.find((candidate) => candidate === value);
    if (alignInput) gantt.setOptions({ scheduling: { alignInput } });
  });

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

import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import { changeText, refusalText } from './helpers';
import { options } from './options';

const FLAGS = ['move', 'resize', 'progress', 'links'] as const;

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '370px';
  const status = document.createElement('p');
  status.textContent = 'Drag a bar, an edge or a handle. What the chart refuses is reported here.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // A drag that the chart would not start, or would not commit: nothing changed.
    onEditRefused: (refusal) => {
      status.textContent = refusalText(refusal, nameOf);
    },
    onTasksChange: (changeSet) => {
      status.textContent = changeText(changeSet, nameOf);
    },
    onLinkCreate: (link) => {
      status.textContent = `Linked ${nameOf(link.source)} to ${nameOf(link.target)}.`;
    },
  });
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);

  // One checkbox turns editing on or off as a whole (`editing: false`); the four others are its
  // flags. The option is replaced as a whole each time: `setOptions({ editing })`.
  const checkbox = (label: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', apply, { signal: controller.signal });
    const wrapper = document.createElement('label');
    wrapper.append(input, ` ${label}`);
    toolbar.append(wrapper);
    return input;
  };
  const master = checkbox('editing');
  const boxes = FLAGS.map((flag) => ({ flag, input: checkbox(flag) }));
  function apply(): void {
    const flags = Object.fromEntries(boxes.map(({ flag, input }) => [flag, input.checked]));
    gantt.setOptions({ editing: master.checked ? flags : false });
    for (const { input } of boxes) input.disabled = !master.checked;
  }

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

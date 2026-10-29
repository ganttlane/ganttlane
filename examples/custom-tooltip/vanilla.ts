import '@ganttlane/dom/styles.css';

import { createGantt, type TooltipOptions } from '@ganttlane/dom';

import { links, tasks } from './data';
import { options } from './options';

type Render = NonNullable<TooltipOptions['render']>;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '380px';
  const status = document.createElement('p');
  status.textContent = 'Hover a bar. The buttons change what the tooltip is made of.';
  root.append(toolbar, chart, status);
  container.append(root);

  // Text sections: `{ title, subtitle, details, actions }` are lines of text and buttons.
  const sections: Render = ({ task, preview, isDragging, predecessors, locale, api }) => {
    // While a bar is dragged, show where it would land.
    const start = preview?.start ?? task.start;
    const end = preview?.end ?? task.end;
    if (!start || !end) return null; // no tooltip
    const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    // A link record names its tasks by id; `api` reads them.
    const after = predecessors.map((link) => api.getTask(link.source)?.name).join(', ');
    return {
      title: task.name,
      subtitle: `${day.format(start)} to ${day.format(end)}${isDragging ? ' (moving)' : ''}`,
      details: [`${Math.round(task.progress)}% done`, after && `after ${after}`]
        .filter(Boolean)
        .join(' · '),
      actions: [
        {
          label: 'Open',
          onSelect: () => {
            status.textContent = `Open ${task.name}`;
          },
        },
      ],
    };
  };

  // A DOM node, for anything the sections cannot say.
  const node: Render = ({ task }) => {
    const card = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = task.name; // textContent: the name is data, never markup
    const bar = document.createElement('progress');
    bar.max = 100;
    bar.value = task.progress;
    card.append(name, bar);
    return card;
  };

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    tooltip: { ...options.tooltip, render: sections },
  });

  // `tooltip` is taken whole: a new object replaces the one before.
  const controller = new AbortController();
  const choices = [
    ['Text sections', sections],
    ['DOM node', node],
  ] as const;
  for (const [label, render] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener(
      'click',
      () => gantt.setOptions({ tooltip: { ...options.tooltip, render } }),
      { signal: controller.signal },
    );
    toolbar.append(button);
  }

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

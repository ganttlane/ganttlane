import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt, type TooltipOptions } from '@ganttlane/dom';

import { links, tasks } from './data';
import { datesText, gapRows, PROPAGATION } from './helpers';
import { options } from './options';

type Render = NonNullable<TooltipOptions['render']>;

/** An element with a class and a text: the text is data, so `textContent`, never `innerHTML`. */
function element(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '390px';
  const status = document.createElement('p');
  status.textContent = 'Hover Build, then drag it: the rows follow the bar.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The rows of the tooltip are measured from the chart's core: the context of `render` says which
  // links there are, and the core where their bars are now.
  const render: Render = ({ task, preview, isDragging, predecessors, locale }) => {
    // While a bar is dragged, `preview` says where it would land.
    const start = preview?.start ?? task.start;
    const end = preview?.end ?? task.end;
    if (!start || !end) return null; // no tooltip
    const card = element('div', 'gap-card', '');
    const dates = `${datesText(start, end, locale)}${isDragging ? ' (moving)' : ''}`;
    card.append(element('strong', '', task.name), element('div', 'gap-card-note', dates));
    const rows = gapRows(task.id, predecessors, gantt.core);
    if (rows.length === 0) card.append(element('div', 'gap-card-note', 'No predecessors'));
    else {
      const list = element('ul', 'gap-card-rows', '');
      for (const { name, gap, type } of rows) {
        const row = document.createElement('li');
        row.append(
          element('span', 'gap-card-name', `${name}:`),
          element('span', '', gap),
          element('span', 'gap-card-type', type),
        );
        list.append(row);
      }
      card.append(list);
    }
    return card;
  };

  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    tooltip: { ...options.tooltip, render },
  });

  const controller = new AbortController();
  const label = document.createElement('label');
  label.textContent = 'Propagation ';
  const policy = document.createElement('select');
  for (const value of PROPAGATION) {
    const option = document.createElement('option');
    option.value = option.textContent = value;
    policy.append(option);
  }
  policy.addEventListener(
    'change',
    () => {
      const propagation = policy.value as (typeof PROPAGATION)[number];
      gantt.setOptions({ scheduling: { propagation } });
    },
    { signal: controller.signal },
  );
  label.append(policy);
  toolbar.append(label);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

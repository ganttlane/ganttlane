import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type RowStripesOption } from '@ganttlane/dom';

import { coloured, links, type Meta, tasks } from './data';
import { options } from './options';

const STATUSES = ['done', 'active', 'late', 'blocked', 'review'] as const;
const STRIPES: Record<string, RowStripesOption> = { group: 'group', row: 'row', off: false };

export function mount(container: HTMLElement): () => void {
  // `.statuses` holds the palette of `styles.css` and keeps its rules to this chart.
  const root = document.createElement('div');
  root.className = 'statuses';
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const status of STATUSES) {
    const item = document.createElement('li');
    item.dataset.status = status;
    item.textContent = status;
    legend.append(item);
  }
  const chart = document.createElement('div');
  chart.style.height = '420px';
  const status = document.createElement('p');
  root.append(toolbar, legend, chart, status);
  container.append(root);

  const gantt = createGantt<Meta>(chart, { tasks, links, ...options });

  const controller = new AbortController();
  const addSelect = (
    label: string,
    choices: readonly (readonly [value: string, text: string])[],
    onChange: (value: string) => void,
  ): void => {
    const wrapper = document.createElement('label');
    wrapper.append(`${label} `);
    const select = document.createElement('select');
    for (const [value, text] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value), { signal: controller.signal });
    wrapper.append(select);
    toolbar.append(wrapper);
  };

  const describe = (byColour: boolean): string =>
    byColour
      ? 'Styled from the data: every task has a color and a progressColor. No class, so no row tint.'
      : 'Styled by classes: className colours the bar, rowClassName tints the row (see styles.css).';
  status.textContent = describe(false);

  addSelect(
    'Style from',
    [
      ['classes', 'classes (a stylesheet)'],
      ['colours', 'colours in the data'],
    ],
    (value) => {
      // The tasks are the only thing that changes: the same plan, styled the other way.
      gantt.setTasks(value === 'colours' ? coloured : tasks);
      status.textContent = describe(value === 'colours');
    },
  );
  addSelect(
    'Row stripes',
    [
      ['group', "'group'"],
      ['row', "'row'"],
      ['off', 'false'],
    ],
    // `display` is merged field by field, so this changes the stripes and nothing else.
    (value) => gantt.setOptions({ display: { rowStripes: STRIPES[value] ?? false } }),
  );

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

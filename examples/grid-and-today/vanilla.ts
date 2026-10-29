import '@ganttlane/dom/styles.css';
import './styles.css';

import {
  createGantt,
  type GanttOptions,
  type GridLinesOption,
  type NonWorkingDaysOption,
} from '@ganttlane/dom';

import { links, tasks } from './data';
import { noLines, options, sprintLines } from './options';

const GRID_LINES: readonly GridLinesOption[] = ['both', 'vertical', 'horizontal', 'none'];
const DAYS_OFF: Record<string, NonWorkingDaysOption> = {
  fill: 'fill',
  stripes: 'stripes',
  off: false,
};
const VIEW_MODES = ['day', 'week', 'month'] as const;
// `viewModes` replaces the `majorLine` of the modes it names; `undefined` puts the presets back.
const MAJOR_LINES: Record<string, GanttOptions['viewModes']> = {
  preset: undefined,
  sprint: sprintLines,
  none: noLines,
};

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The container of the chart. The look is its `data-look` attribute, which `styles.css` selects
  // on (`[data-look='violet'] .gantt`).
  const chart = document.createElement('div');
  chart.style.height = '320px';
  chart.dataset.look = 'library';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  // Clicking a bar only reports it (`taskClick`); selecting it is the application's call.
  gantt.on('taskClick', (record) => {
    gantt.select([record.id]);
  });

  let gridLines: GridLinesOption = options.display.gridLines;
  let nonWorkingDays: NonWorkingDaysOption = options.display.nonWorkingDays;
  let today: boolean = options.display.today;
  let major = 'preset';
  const show = (): void => {
    status.textContent = `gridLines: ${gridLines} · nonWorkingDays: ${String(nonWorkingDays)} · today: ${String(today)} · major lines: ${major}. Click a bar to select it.`;
  };
  show();

  const controller = new AbortController();
  const listen = (element: HTMLElement, onChange: () => void): void => {
    element.addEventListener('change', onChange, { signal: controller.signal });
  };
  const addSelect = (
    label: string,
    choices: readonly string[],
    onChange: (id: string) => void,
    initial: string = choices[0] ?? '',
  ): void => {
    const wrapper = document.createElement('label');
    const select = document.createElement('select');
    for (const id of choices) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.append(option);
    }
    select.value = initial;
    listen(select, () => onChange(select.value));
    wrapper.append(`${label} `, select);
    toolbar.append(wrapper);
  };
  const addCheckbox = (label: string, onChange: (checked: boolean) => void): void => {
    const wrapper = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    listen(input, () => onChange(input.checked));
    wrapper.append(input, ` ${label}`);
    toolbar.append(wrapper);
  };

  // `display` is merged field by field, so each control changes one field and nothing else.
  addSelect('Grid lines', GRID_LINES, (id) => {
    gridLines = GRID_LINES.find((option) => option === id) ?? 'both';
    gantt.setOptions({ display: { gridLines } });
    show();
  });
  addSelect('Days off', Object.keys(DAYS_OFF), (id) => {
    nonWorkingDays = DAYS_OFF[id] ?? 'fill';
    gantt.setOptions({ display: { nonWorkingDays } });
    show();
  });
  addSelect(
    'View',
    VIEW_MODES,
    (id) => {
      gantt.setViewMode(id);
    },
    options.viewMode,
  );
  addSelect('Major lines', Object.keys(MAJOR_LINES), (id) => {
    major = id;
    gantt.setOptions({ viewModes: MAJOR_LINES[id] });
    show();
  });
  addSelect('Look', ['library', 'violet'], (id) => {
    chart.dataset.look = id;
  });
  addCheckbox('Today', (checked) => {
    today = checked;
    gantt.setOptions({ display: { today } });
    show();
  });
  addCheckbox('Header range', (headerRangeHighlight) => {
    gantt.setOptions({ display: { headerRangeHighlight } });
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, type Settings } from './helpers';
import { FRIDAYS, HIGHLIGHTS, NON_WORKING_DAYS, options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '340px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  let settings: Settings = {
    nonWorkingDays: options.display.nonWorkingDays,
    highlights: options.display.highlights,
    fridays: true,
    followCursor: options.highlightTooltip.followCursor,
  };
  const show = (): void => {
    status.textContent = describe(settings);
  };
  show();

  const controller = new AbortController();
  const { signal } = controller;

  // The select of non-working days: `display` merges field by field with what was set before.
  const select = document.createElement('select');
  NON_WORKING_DAYS.forEach(({ label }, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = label;
    select.append(option);
  });
  select.addEventListener(
    'change',
    () => {
      const choice = NON_WORKING_DAYS[Number(select.value)];
      if (!choice) return;
      settings = { ...settings, nonWorkingDays: choice.value };
      gantt.setOptions({ display: { nonWorkingDays: choice.value } });
      show();
    },
    { signal },
  );
  const selectLabel = document.createElement('label');
  selectLabel.append('Non-working days ', select);
  toolbar.append(selectLabel);

  const addCheckbox = (
    name: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): void => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener(
      'change',
      () => {
        onChange(input.checked);
        show();
      },
      { signal },
    );
    const label = document.createElement('label');
    label.append(input, ` ${name}`);
    toolbar.append(label);
  };
  addCheckbox('Highlights', settings.highlights, (highlights) => {
    settings = { ...settings, highlights };
    gantt.setOptions({ display: { highlights } });
  });
  addCheckbox('Fridays', settings.fridays, (fridays) => {
    settings = { ...settings, fridays };
    // A list is replaced as a whole: this is the new list of highlights.
    gantt.setOptions({ highlights: fridays ? [...HIGHLIGHTS, FRIDAYS] : HIGHLIGHTS });
  });
  addCheckbox('Label follows the cursor', settings.followCursor, (followCursor) => {
    settings = { ...settings, followCursor };
    gantt.setOptions({ highlightTooltip: { followCursor } });
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

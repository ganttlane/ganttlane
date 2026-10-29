import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type ThemeOption } from '@ganttlane/dom';

import { links, tasks } from './data';
import { options, presets } from './options';

const THEMES: readonly ThemeOption[] = ['auto', 'light', 'dark'];

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The container of the chart. The preset is its `data-preset` attribute, which `styles.css`
  // selects on (`[data-preset='brand'] .gantt`). The chart fills it, so it needs a height.
  const chart = document.createElement('div');
  chart.style.height = '330px';
  chart.dataset.preset = 'default';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  const controller = new AbortController();
  const addSelect = (
    label: string,
    choices: readonly (readonly [value: string, text: string])[],
    onChange: (value: string) => void,
  ): HTMLSelectElement => {
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
    return select;
  };

  let note: string = presets[0].note;
  // The `theme` option is the `data-theme` attribute of the chart's root, `div.gantt`. Read it
  // back rather than trusting the select: a page may set the attribute itself (this site does, to
  // keep every chart in its own theme), and then the select should show what the chart has.
  const chartRoot = chart.querySelector('.gantt');
  const themeSelect = addSelect(
    'Theme',
    THEMES.map((id) => [id, id]),
    (value) => {
      const theme = THEMES.find((id) => id === value);
      if (theme) gantt.setOptions({ theme });
    },
  );
  const show = (): void => {
    const theme = chartRoot?.getAttribute('data-theme') ?? '';
    themeSelect.value = theme;
    status.textContent = `data-theme="${theme}" · ${note}`;
  };

  addSelect(
    'Palette and density',
    presets.map(({ id, label }) => [id, label]),
    (value) => {
      const preset = presets.find(({ id }) => id === value);
      if (!preset) return;
      // The palette is CSS: an attribute on the container. The density has a second half that is
      // not a token, the size of rows and bars, which is the `layout` option.
      chart.dataset.preset = preset.id;
      gantt.setOptions({ layout: preset.layout });
      note = preset.note;
      show();
    },
  );

  const observer = new MutationObserver(show);
  if (chartRoot) observer.observe(chartRoot, { attributes: true, attributeFilter: ['data-theme'] });
  show();

  return () => {
    controller.abort();
    observer.disconnect();
    gantt.destroy();
    root.remove();
  };
}

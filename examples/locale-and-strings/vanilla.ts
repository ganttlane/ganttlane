import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { locales, options } from './options';
import { wordings } from './strings';

const VIEW_MODES = ['day', 'week', 'month'] as const;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '360px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  // The accessible name of the chart is one of the strings (`chartLabel`): read it from the DOM, as
  // a screen reader does. It changes in the frame after `setOptions`.
  let locale: string = options.locale;
  let wording = wordings[0].label;
  const scroller = chart.querySelector('.gantt__scroller');
  const show = (): void => {
    const label = scroller?.getAttribute('aria-label') ?? '';
    status.textContent = `locale: ${locale} · strings: ${wording} · aria-label: “${label}” · weeks start on Monday in every locale`;
  };
  const observer = new MutationObserver(show);
  if (scroller) observer.observe(scroller, { attributes: true, attributeFilter: ['aria-label'] });
  show();

  const controller = new AbortController();
  const addSelect = (
    label: string,
    choices: readonly (readonly [value: string, text: string])[],
    onChange: (value: string) => void,
    initial: string,
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
    select.value = initial;
    select.addEventListener('change', () => onChange(select.value), {
      signal: controller.signal,
    });
    wrapper.append(select);
    toolbar.append(wrapper);
  };

  addSelect(
    'Locale',
    locales,
    (tag) => {
      // Dates and numbers: the header, and the dates and numbers of the tooltip. The words stay.
      locale = tag;
      gantt.setOptions({ locale: tag });
      show();
    },
    options.locale,
  );
  addSelect(
    'Strings',
    wordings.map(({ id, label }) => [id, label]),
    (id) => {
      const chosen = wordings.find((candidate) => candidate.id === id) ?? wordings[0];
      // `strings` is merged key by key, so go back to English first (`undefined`), then apply the
      // set: otherwise the keys a smaller set leaves out would keep the previous language.
      gantt.setOptions({ strings: undefined });
      gantt.setOptions({ strings: chosen.strings });
      wording = chosen.label;
      show();
    },
    wordings[0].id,
  );
  addSelect(
    'View',
    VIEW_MODES.map((id) => [id, id]),
    (id) => {
      gantt.setViewMode(id);
    },
    options.viewMode,
  );

  return () => {
    controller.abort();
    observer.disconnect();
    gantt.destroy();
    root.remove();
  };
}

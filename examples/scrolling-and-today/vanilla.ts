import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe } from './helpers';
import {
  type Align,
  ALIGNS,
  type Behavior,
  BEHAVIORS,
  type Initial,
  INITIALS,
  options,
} from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const actions = document.createElement('div');
  actions.setAttribute('role', 'toolbar');
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '400px';
  const status = document.createElement('p');
  status.textContent = 'Scroll the chart, or press a button.';
  root.append(toolbar, actions, chart, status);
  container.append(root);

  // What the controls hold. `scroll.initial` is read when a chart is created, so a new one is
  // made when it changes; the rest is changed on the chart that is there, with `setOptions`.
  const state: { initial: Initial; align: Align; behavior: Behavior; today: boolean } = {
    initial: options.scroll.initial,
    align: options.scroll.align,
    behavior: options.scroll.behavior,
    today: options.display.today,
  };

  const create = (): Gantt => {
    const created = createGantt(chart, {
      tasks,
      links,
      ...options,
      scroll: { initial: state.initial, align: state.align, behavior: state.behavior },
      display: { today: state.today },
    });
    // The chart scrolled, by the user or by a call: where it is, in px and as dates. `on` is the
    // `onScroll` option for a chart that already exists, so the handler can ask it for the
    // visible range (the option's handler would run for the first scroll, inside `createGantt`).
    const show = (x: number, y: number): void => {
      status.textContent = describe(created.getVisibleRange(), x, y);
    };
    created.on('scroll', ({ x, y }) => {
      show(x, y);
    });
    const { timeline, scrollTop } = created.core.getSnapshot();
    show(timeline.scrollLeft, scrollTop);
    return created;
  };
  let gantt = create();

  const controller = new AbortController();
  const { signal } = controller;

  const addSelect = <T extends string>(
    name: string,
    values: readonly T[],
    current: T,
    onChange: (value: T) => void,
  ): void => {
    const select = document.createElement('select');
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    select.value = current;
    select.addEventListener(
      'change',
      () => {
        const value = values.find((candidate) => candidate === select.value);
        if (value !== undefined) onChange(value);
      },
      { signal },
    );
    const label = document.createElement('label');
    label.append(`${name} `, select);
    toolbar.append(label);
  };
  addSelect('Opens at', INITIALS, state.initial, (value) => {
    state.initial = value;
    gantt.destroy();
    gantt = create();
  });
  addSelect('Align', ALIGNS, state.align, (align) => {
    state.align = align;
    gantt.setOptions({ scroll: { align } });
  });
  addSelect('Behavior', BEHAVIORS, state.behavior, (behavior) => {
    state.behavior = behavior;
    gantt.setOptions({ scroll: { behavior } });
  });

  const marker = document.createElement('input');
  marker.type = 'checkbox';
  marker.checked = state.today;
  marker.addEventListener(
    'change',
    () => {
      state.today = marker.checked;
      gantt.setOptions({ display: { today: marker.checked } });
    },
    { signal },
  );
  const markerLabel = document.createElement('label');
  markerLabel.append(marker, ' Today marker');
  toolbar.append(markerLabel);

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    actions.append(button);
  };
  // The three ways to scroll from code. They use `scroll.align` and `scroll.behavior`, unless the
  // call gives its own: `gantt.scrollToDate('2026-06-01', { align: 'end', behavior: 'instant' })`.
  addButton('Today', () => {
    gantt.scrollToToday();
  });
  addButton('1 June', () => {
    gantt.scrollToDate('2026-06-01');
  });
  addButton('Review', () => {
    gantt.scrollToTask('review');
  });
  addButton('Retrospective', () => {
    gantt.scrollToTask('retro');
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

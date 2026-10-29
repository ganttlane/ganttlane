import '@ganttlane/dom/styles.css';

import { createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { describe, FIXED_HEIGHT, type HeightKind, HEIGHTS, type Sizes, SLIDERS } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  // The page: a box with a height of its own, which scrolls, as a page does. A chart with
  // `layout.height: 'auto'` is as tall as its rows and the page scrolls it.
  const page = document.createElement('div');
  page.style.height = '360px';
  page.style.overflow = 'auto';
  page.style.border = '1px dashed currentColor';
  // This container has no height: the chart is given one by `layout.height`.
  const chart = document.createElement('div');
  page.append(chart);
  const status = document.createElement('p');
  root.append(toolbar, page, status);
  container.append(root);

  const gantt = createGantt(chart, { tasks, links, ...options });

  const sizes: Sizes = {
    rowHeight: options.layout.rowHeight,
    barHeight: options.layout.barHeight,
    barRadius: options.layout.barRadius,
    headerRowHeight: options.layout.headerRowHeight,
  };
  let height: HeightKind = 'fixed';
  // `layout` merges field by field with the sizes set before.
  const apply = (): void => {
    gantt.setOptions({ layout: { ...sizes, height: height === 'auto' ? 'auto' : FIXED_HEIGHT } });
    status.textContent = describe(sizes, height);
  };
  status.textContent = describe(sizes, height);

  const controller = new AbortController();
  const { signal } = controller;

  for (const { key, label, min, max, step } of SLIDERS) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(sizes[key]);
    input.style.width = '5.5rem';
    const output = document.createElement('output');
    output.textContent = input.value;
    input.addEventListener(
      'input',
      () => {
        sizes[key] = Number(input.value);
        output.textContent = input.value;
        apply();
      },
      { signal },
    );
    const wrap = document.createElement('label');
    wrap.append(`${label} `, input, ' ', output);
    toolbar.append(wrap);
  }

  const select = document.createElement('select');
  for (const kind of HEIGHTS) {
    const option = document.createElement('option');
    option.value = kind;
    option.textContent = kind === 'auto' ? "'auto'" : String(FIXED_HEIGHT);
    select.append(option);
  }
  select.addEventListener(
    'change',
    () => {
      const kind = HEIGHTS.find((candidate) => candidate === select.value);
      if (!kind) return;
      height = kind;
      apply();
    },
    { signal },
  );
  const selectLabel = document.createElement('label');
  selectLabel.append('Height ', select);
  toolbar.append(selectLabel);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

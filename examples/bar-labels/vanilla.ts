import '@ganttlane/dom/styles.css';
import './styles.css';

import { type BarLabelOption, type BarLabelRenderer, createGantt } from '@ganttlane/dom';

import { links, type Meta, tasks } from './data';
import { options } from './options';

type Renderer = BarLabelRenderer<Meta>;
type Content = 'name' | 'text' | 'node' | 'disposable';

const PLACEMENTS: readonly BarLabelOption[] = ['auto', 'inside', 'outside', 'none'];
const CONTENTS: readonly (readonly [Content, string])[] = [
  ['name', 'name (default)'],
  ['text', 'string'],
  ['node', 'DOM node'],
  ['disposable', 'DisposableNode'],
];

/** An avatar and a name, built from DOM APIs: the name is data, so it goes in as text. */
function labelNode(name: string, owner: string): HTMLElement {
  const label = document.createElement('span');
  label.className = 'bar-label';
  const avatar = document.createElement('span');
  avatar.className = 'bar-label__avatar';
  avatar.dataset.owner = owner;
  avatar.dataset.initial = owner.slice(0, 1);
  const text = document.createElement('span');
  text.className = 'bar-label__name';
  text.textContent = name;
  label.append(avatar, text);
  return label;
}

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '390px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  let content: Content = 'name';
  let made = 0;
  let disposed = 0;
  const describe = (): string => {
    switch (content) {
      case 'name':
        return 'The label is the name of the task: the default.';
      case 'text':
        return 'A string, inserted as text: the name and the progress.';
      case 'node':
        return 'A DOM node: an avatar and the name. "auto" counts the text only, so pick inside or outside.';
      case 'disposable':
        return `A DisposableNode: ${made} made, ${disposed} disposed, ${made - disposed} alive. Hide the labels, drag a bar, scroll.`;
    }
  };

  // 1. A string: inserted as text, never parsed as HTML.
  const text: Renderer = ({ name, progress }) => `${name} · ${Math.round(progress)}%`;

  // 2. A DOM node: appended as it is. Its width is estimated from its text, so for 'auto' the
  //    avatar (which has no text) is not counted.
  const node: Renderer = ({ name, task }) => labelNode(name, task.data?.owner ?? '');

  // 3. A DisposableNode, `{ node, dispose }`: the chart calls `dispose()` once when it is done
  //    with the node (the label is hidden, the bar leaves the window, the label is made again from
  //    new inputs, the chart is destroyed). The counters show that it happens.
  const disposable: Renderer = ({ name, task }) => {
    made += 1;
    status.textContent = describe();
    return {
      node: labelNode(name, task.data?.owner ?? ''),
      dispose: () => {
        disposed += 1;
        status.textContent = describe();
      },
    };
  };
  const renderers: Record<Content, Renderer | undefined> = {
    name: undefined, // `undefined` puts the default back: the name of the task
    text,
    node,
    disposable,
  };

  status.textContent = describe();
  const gantt = createGantt<Meta>(chart, { tasks, links, ...options });

  const controller = new AbortController();
  const addSelect = <T extends string>(
    label: string,
    choices: readonly (readonly [value: T, text: string])[],
    onChange: (value: T) => void,
  ): void => {
    const wrapper = document.createElement('label');
    wrapper.append(`${label} `);
    const select = document.createElement('select');
    for (const [value, caption] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = caption;
      select.append(option);
    }
    select.addEventListener(
      'change',
      () => {
        const chosen = choices.find(([value]) => value === select.value);
        if (chosen) onChange(chosen[0]);
      },
      { signal: controller.signal },
    );
    wrapper.append(select);
    toolbar.append(wrapper);
  };

  addSelect(
    'Placement',
    PLACEMENTS.map((id) => [id, id] as const),
    // `display` is merged field by field: this changes the placement and nothing else.
    (barLabel) => gantt.setOptions({ display: { barLabel } }),
  );
  addSelect('Content', CONTENTS, (value) => {
    content = value;
    gantt.setOptions({ display: { renderBarLabel: renderers[value] } });
    status.textContent = describe();
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import {
  addsToSelection,
  afterClick,
  type Field,
  linkFields,
  selectionText,
  taskFields,
} from './helpers';
import { options } from './options';

/** A card of the side panel: a title and a list of labels and values. */
function card(title: string, fields: readonly Field[]): HTMLElement {
  const element = document.createElement('div');
  element.className = 'selection-card';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of fields) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(term, description);
  }
  element.append(heading, list);
  return element;
}

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '370px';
  const panel = document.createElement('div');
  panel.className = 'selection-panel';
  panel.setAttribute('aria-live', 'polite');
  const status = document.createElement('p');
  root.append(toolbar, chart, panel, status);
  container.append(root);

  // What the chart reported last: the selected tasks, and the selected link (a click on an arrow).
  let selected: readonly TaskId[] = [];
  let selectedLink: string | undefined;

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // A click on a bar does not select it: that is up to you. Here it selects the task, and
    // with Shift, Ctrl or Cmd held it adds the task to the selection (or takes it out).
    onTaskClick: (record, event) => {
      gantt.select(afterClick(selected, record.id, addsToSelection(event)));
    },
    // `select`, `selectLink`, `clearSelection` and a click on a link all end here.
    onSelectionChange: (keys, link) => {
      selected = keys;
      selectedLink = link;
      status.textContent = selectionText(keys, link);
      render();
    },
    // A dragged bar changes its record, so the panel is drawn again.
    onTasksChange: () => {
      render();
    },
  });
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);

  /** The side panel: the record of each selected task, and of the selected link. */
  function render(): void {
    const cards: HTMLElement[] = [];
    for (const id of selected) {
      const record = gantt.getTask(id); // the task as the chart computed it
      if (record) cards.push(card(record.name, taskFields(record, nameOf)));
    }
    const link = selectedLink === undefined ? undefined : gantt.getLink(selectedLink);
    if (link) cards.push(card(`${nameOf(link.source)} → ${nameOf(link.target)}`, linkFields(link)));
    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'selection-empty';
      empty.textContent =
        'Nothing is selected. Click a bar (hold Shift, Ctrl or Cmd to add one) or the arrow of a link.';
      cards.push(empty);
    }
    panel.replaceChildren(...cards);
  }

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal: controller.signal });
    toolbar.append(button);
  };
  // `select(ids)` replaces the selected tasks; ids the chart does not know are left out.
  addButton('Select Backend and Frontend', () => {
    gantt.select(['backend', 'frontend']);
  });
  addButton('Select all', () => {
    gantt.select(tasks.map((task) => task.id));
  });
  // A link is selected by its id: `source:type:target`, unless the link has an `id` of its own.
  addButton('Select Design → Build', () => {
    gantt.selectLink('design:FS:build');
  });
  addButton('Clear selection', () => {
    gantt.clearSelection();
  });

  gantt.select(['backend']);
  render();

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

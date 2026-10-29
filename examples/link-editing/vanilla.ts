import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt, type LinkType, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import { LINK_TYPES, linkText, refusalText } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '370px';
  const status = document.createElement('p');
  status.textContent =
    'Hover a bar, then drag from a round handle onto another bar, or click the handle and then the bar. Click a link to remove it.';
  root.append(toolbar, chart, status);
  container.append(root);

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // A link was drawn: the caller's `Link` as written, and its id.
    onLinkCreate: (link, id) => {
      const record = gantt.getLink(id); // the link as the chart has it: its type is always set
      status.textContent = `Created ${linkText(record ?? link, nameOf)}.`;
    },
    // A link was removed, from the menu or by `removeLink`: the link as it was.
    onLinkDelete: (record) => {
      status.textContent = `Removed ${linkText(record, nameOf)}.`;
    },
    // A click on the arrow of a link, which selects it and opens its menu.
    onLinkClick: (record) => {
      const next = record.editable
        ? 'Choose "Remove dependency" in its menu.'
        : 'It has editable: false, so its menu has nothing to offer.';
      status.textContent = `Selected ${linkText(record, nameOf)}. ${next}`;
    },
    // A link that was not drawn: a task that cannot be linked, itself, a cycle, a duplicate.
    onEditRefused: (refusal) => {
      status.textContent = refusalText(refusal, nameOf);
    },
  });
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);

  // `editing: { links }` turns drawing and removing links on and off.
  const editable = document.createElement('input');
  editable.type = 'checkbox';
  editable.checked = true;
  editable.addEventListener(
    'change',
    () => {
      gantt.setOptions({ editing: { links: editable.checked } });
      status.textContent = editable.checked
        ? 'Links can be drawn and removed again.'
        : 'editing.links is false: no handles on the bars, and no menu on the links.';
    },
    { signal: controller.signal },
  );
  const editableLabel = document.createElement('label');
  editableLabel.append(editable, ' editing.links');

  // The type of the links drawn from now on (`scheduling.defaultLinkType`).
  const type = document.createElement('select');
  type.setAttribute('aria-label', 'Type of new links');
  for (const value of LINK_TYPES) {
    const option = document.createElement('option');
    option.textContent = value;
    type.append(option);
  }
  type.addEventListener(
    'change',
    () => {
      gantt.setOptions({ scheduling: { defaultLinkType: type.value as LinkType } });
      status.textContent = `New links are ${type.value} links.`;
    },
    { signal: controller.signal },
  );
  const typeLabel = document.createElement('label');
  typeLabel.append('New links are ', type);

  toolbar.append(editableLabel, typeLabel);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

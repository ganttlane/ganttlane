import '@ganttlane/dom/styles.css';

import { type ChangeSet, createGantt } from '@ganttlane/dom';

import { links, tasks } from './data';
import { options } from './options';

/** What the list shows of a change set: the reason and the tasks it moved. */
const line = (changeSet: ChangeSet): string =>
  `${changeSet.reason}: ${changeSet.changes.map((change) => String(change.id)).join(', ')}`;

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const chart = document.createElement('div');
  chart.style.height = '300px';
  const heading = document.createElement('p');
  heading.textContent = 'onTasksChange received:';
  const list = document.createElement('ol');
  root.append(chart, heading, list);
  container.append(root);

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // Every arrow key press that changed something, like a drag, arrives here once.
    onTasksChange: (changeSet) => {
      const item = document.createElement('li');
      item.textContent = line(changeSet);
      list.prepend(item);
    },
  });

  return () => {
    gantt.destroy();
    root.remove();
  };
}

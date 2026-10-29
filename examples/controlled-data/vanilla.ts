import '@ganttlane/dom/styles.css';

import { patchTasks } from '@ganttlane/core';
import { createGantt, type Gantt, type Link, type Task } from '@ganttlane/dom';

import { links as initialLinks, tasks as initialTasks } from './data';
import { linkId, saveTasks } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const refuse = document.createElement('input');
  refuse.type = 'checkbox';
  const refuseLabel = document.createElement('label');
  refuseLabel.append(refuse, ' The server refuses the save');
  toolbar.append(refuseLabel);
  const chart = document.createElement('div');
  chart.style.height = '380px';
  const status = document.createElement('p');
  status.textContent = 'Drag a bar: the change is saved, or refused if you tick the box.';
  root.append(toolbar, chart, status);
  container.append(root);

  // Your own state: two variables here, a store in an application.
  let tasks: Task[] = initialTasks;
  let links: Link[] = initialLinks;

  // The handlers read `gantt`, which they are passed to: give them a return type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,

    onTasksChange: (changeSet): void => {
      // `model` is the one the change set was computed on: the chart's current one.
      const next = patchTasks(tasks, changeSet, gantt.core.getSnapshot().state.derived.model);
      status.textContent = 'Saving…';
      // The bars show the change as a draft until the answer comes.
      void saveTasks(refuse.checked).then(
        () => {
          tasks = next;
          gantt.setTasks(tasks); // accepted: the draft becomes your data
          status.textContent = 'Saved.';
        },
        () => {
          gantt.setTasks(tasks); // refused: your old tasks, and the bars go back
          status.textContent = 'The server refused the change: the bars went back.';
        },
      );
    },

    // Links are yours the same way: the chart reports the one drawn or removed, you keep the list.
    onLinkCreate: (link): void => {
      links = [...links, link];
      gantt.setLinks(links);
    },
    onLinkDelete: (record): void => {
      links = links.filter((link) => linkId(link) !== record.id);
      gantt.setLinks(links);
    },
  });

  return () => {
    gantt.destroy();
    root.remove();
  };
}

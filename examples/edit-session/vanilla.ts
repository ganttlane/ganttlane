import '@ganttlane/dom/styles.css';

import { patchTasks } from '@ganttlane/core';
import { type ChangeSet, createGantt, type Gantt, type Link, type Task } from '@ganttlane/dom';

import { links as initialLinks, tasks as initialTasks } from './data';
import { linkId, restoreLinks, savePlan } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '360px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  const addButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal: controller.signal });
    toolbar.append(button);
    return button;
  };
  const edit = addButton('Edit', () => {
    gantt.edit.begin(); // starts a session: the chart remembers the data it has now
    showEditing(true);
    status.textContent = 'Drag the bars, then Save or Cancel.';
  });
  const save = addButton('Save', () => void saveSession());
  const cancel = addButton('Cancel', () => {
    gantt.edit.rollback(); // `onEditRollback` puts your data back
    showEditing(false);
    status.textContent = 'Cancelled: the plan is as it was.';
  });
  const refuse = document.createElement('input');
  refuse.type = 'checkbox';
  const refuseLabel = document.createElement('label');
  refuseLabel.append(refuse, ' The server refuses the save');
  toolbar.append(refuseLabel);

  // Your own state: what the server has, and what you hold now.
  let saved = { tasks: initialTasks, links: initialLinks };
  let tasks: Task[] = saved.tasks;
  let links: Link[] = saved.links;

  // Write a change set (a drag, or the inverse of a cancelled session) into your own tasks.
  // `patchTasks` keeps the shape of every task: ISO strings stay ISO strings, durations stay durations.
  const apply = (changes: ChangeSet): void => {
    const { model } = gantt.core.getSnapshot().state.derived;
    tasks = patchTasks(tasks, changes, model);
    gantt.setTasks(tasks);
  };

  // The handlers read `gantt`, which they are passed to: give them a return type.
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    onTasksChange: apply,
    // Links are yours the same way: the chart reports the one drawn or removed.
    onLinkCreate: (link): void => {
      links = [...links, link];
      gantt.setLinks(links);
    },
    onLinkDelete: (record): void => {
      links = links.filter((link) => linkId(link) !== record.id);
      gantt.setLinks(links);
    },
    // A cancelled session: what to undo, which you write the way you wrote the drags.
    onEditRollback: (changes): void => {
      apply(changes);
      links = restoreLinks(links, changes.links);
      gantt.setLinks(links);
    },
    // Save is only useful when the session has changes.
    onDirtyChange: ({ isDirty }): void => {
      save.disabled = !isDirty;
    },
  });

  /** Edit mode on or off: the buttons, and whether the chart can be edited from the UI. */
  function showEditing(editing: boolean): void {
    gantt.setOptions({ editing });
    edit.hidden = editing;
    save.hidden = !editing;
    cancel.hidden = !editing;
    save.disabled = !gantt.edit.isDirty;
  }

  async function saveSession(): Promise<void> {
    // Closes the session. Anything but 'committed' ('no-session', 'busy') committed nothing.
    if (gantt.edit.commit().status !== 'committed') return;
    status.textContent = 'Saving…';
    save.disabled = true;
    cancel.disabled = true;
    try {
      await savePlan(refuse.checked);
      saved = { tasks, links };
      status.textContent = 'Saved.';
    } catch {
      // The save failed: show the last saved plan.
      tasks = saved.tasks;
      links = saved.links;
      gantt.setTasks(tasks);
      gantt.setLinks(links);
      status.textContent = 'The server refused the plan: the last saved one is back.';
    }
    cancel.disabled = false;
    showEditing(false);
  }

  showEditing(false);
  status.textContent = 'Press Edit, drag the bars, then Save or Cancel.';

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

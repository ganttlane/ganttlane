import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt, type TaskId } from '@ganttlane/dom';

import { links, tasks } from './data';
import { changeText, historyText, isTyping, LIMITS, shortcutOf, undoAll } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '340px';
  const status = document.createElement('p');
  root.append(toolbar, chart, status);
  container.append(root);

  // The status: the last thing a button or a key did, the last change, and the last history event.
  const lines = { call: '', change: 'Drag bars, draw a link, then undo.', history: '' };
  const show = (): void => {
    status.textContent = [lines.call, lines.change, lines.history].filter(Boolean).join(' ');
  };
  // Whether a button or a key is making a call just now: its events belong to it, and the line
  // of the last call is no news for the ones that come from a drag.
  let calling = false;
  const note = (change: string): void => {
    if (!calling) lines.call = '';
    lines.change = change;
    show();
  };

  // ---- the buttons: `undo()` and `redo()` act, `canUndo` and `canRedo` say whether they can ----
  const addButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
    return button;
  };
  const call = (make: () => string): void => {
    lines.change = '';
    calling = true;
    try {
      lines.call = make();
    } finally {
      calling = false;
    }
    show();
  };
  // The result says what happened: 'undone' or 'redone', or 'empty' when there was nothing.
  const run = (action: 'undo' | 'redo'): void => {
    call(() => `${action}(): ${gantt[action]().status}.`);
  };
  const undo = addButton('Undo', 'Undo (Ctrl or Cmd + Z)', () => {
    run('undo');
  });
  const redo = addButton('Redo', 'Redo (Shift + Ctrl or Cmd + Z)', () => {
    run('redo');
  });
  const undoAllButton = addButton('Undo all', 'Undo until nothing is left', () => {
    call(() => `Undid ${undoAll(gantt)} actions.`);
  });
  // The history keeps the last `limit` actions: a smaller limit drops the oldest ones at once.
  const limit = document.createElement('select');
  limit.setAttribute('aria-label', 'Actions the history keeps');
  for (const value of LIMITS) {
    const option = document.createElement('option');
    option.textContent = String(value);
    limit.append(option);
  }
  limit.value = String(options.history.limit);
  limit.addEventListener(
    'change',
    () => {
      gantt.setOptions({ history: { limit: Number(limit.value) } });
    },
    { signal },
  );
  const limitLabel = document.createElement('label');
  limitLabel.append('Keep the last ', limit, ' actions');
  toolbar.append(limitLabel);

  // The library has no hotkeys, so the page makes its own: Ctrl or Cmd + Z, with Shift to redo.
  // They work while the focus is in this example (after a click on the chart, for one).
  root.addEventListener(
    'keydown',
    (event) => {
      const action = shortcutOf(event);
      if (action === undefined || isTyping(event.target)) return;
      event.preventDefault();
      run(action);
    },
    { signal },
  );

  // The handlers read `gantt`, which they are passed to: give it a type.
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);
  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options, // `history: { limit: 5 }`: without it `undo()` has nothing to undo
    onTasksChange: (changeSet) => {
      note(changeText(changeSet, nameOf));
    },
    onLinkCreate: (link) => {
      note(`onLinkCreate: ${nameOf(link.source)} → ${nameOf(link.target)}.`);
    },
    onLinkDelete: (link) => {
      note(`onLinkDelete: ${nameOf(link.source)} → ${nameOf(link.target)}.`);
    },
    // `canUndo` or `canRedo` changed: the buttons follow it.
    onHistoryChange: (payload) => {
      undo.disabled = undoAllButton.disabled = !payload.canUndo;
      redo.disabled = !payload.canRedo;
      lines.history = historyText(payload);
      show();
    },
  });
  undo.disabled = undoAllButton.disabled = !gantt.canUndo;
  redo.disabled = !gantt.canRedo;
  show();

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

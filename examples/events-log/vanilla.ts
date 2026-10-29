import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Gantt, type Unsubscribe } from '@ganttlane/dom';

import { broken, links, tasks } from './data';
import { append, type Entry, type GroupId, GROUPS, lineText, loggingHandlers } from './helpers';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'] as const;

/** A line of the log. */
function item(entry: Entry): HTMLElement {
  const element = document.createElement('li');
  element.dataset.group = entry.group;
  const time = document.createElement('span');
  time.textContent = entry.time;
  const name = document.createElement('code');
  name.textContent = entry.name;
  const text = document.createElement('span');
  text.textContent = lineText(entry);
  element.append(time, name, text);
  return element;
}

export function mount(container: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.createElement('div');
  const actions = document.createElement('div');
  actions.setAttribute('role', 'toolbar');
  actions.setAttribute('aria-label', 'Make events happen');
  const session = document.createElement('div');
  session.setAttribute('role', 'toolbar');
  session.setAttribute('aria-label', 'Edit session, data and listeners');
  const filters = document.createElement('div');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show these events');
  filters.className = 'events-filters';
  const chart = document.createElement('div');
  chart.style.height = '330px';
  const list = document.createElement('ol');
  list.className = 'events-log';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', 'Events');
  list.tabIndex = 0;
  const status = document.createElement('p');
  root.append(actions, session, filters, chart, list, status);
  container.append(root);

  // ---- the log: every event of the chart ends in `log`, and the filter decides what is shown ----
  let entries: Entry[] = [];
  const shown = new Set<GroupId>(GROUPS.filter((group) => group.hidden !== true).map((g) => g.id));
  let frame: number | undefined;
  const render = (): void => {
    frame = undefined;
    const visible = entries.filter((entry) => shown.has(entry.group));
    list.replaceChildren(...visible.map(item));
    status.textContent = `Showing ${visible.length} of ${entries.length} events.`;
  };
  // Scrolling and hovering make many events: draw the log once per frame.
  const schedule = (): void => {
    frame ??= requestAnimationFrame(render);
  };

  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // One handler for each event of the chart: see helpers.ts.
    ...loggingHandlers((group, name, text) => {
      entries = append(entries, group, name, text);
      schedule();
    }),
  });

  // ---- the filter ----
  for (const { id, label } of GROUPS) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = shown.has(id);
    input.addEventListener(
      'change',
      () => {
        if (input.checked) shown.add(id);
        else shown.delete(id);
        render();
      },
      { signal },
    );
    const wrapper = document.createElement('label');
    wrapper.append(input, ` ${label}`);
    filters.append(wrapper);
  }

  // ---- what makes the events happen ----
  const addButton = (
    toolbar: HTMLElement,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
    return button;
  };

  // `viewModeChange`, `rangeChange`, and a `scroll` that comes with them.
  const viewMode = document.createElement('select');
  viewMode.setAttribute('aria-label', 'View mode');
  for (const id of VIEW_MODES) {
    const option = document.createElement('option');
    option.textContent = id;
    viewMode.append(option);
  }
  viewMode.value = options.viewMode;
  viewMode.addEventListener(
    'change',
    () => {
      gantt.setViewMode(viewMode.value);
    },
    { signal },
  );
  const viewModeLabel = document.createElement('label');
  viewModeLabel.append('View mode ', viewMode);
  actions.append(viewModeLabel);

  addButton(actions, 'Select Build', () => {
    gantt.select(['build']); // selectionChange
  });
  addButton(actions, 'Clear selection', () => {
    gantt.clearSelection();
  });
  addButton(actions, 'Collapse', () => {
    gantt.collapseAll(); // expandedChange
  });
  addButton(actions, 'Expand', () => {
    gantt.expandAll();
  });
  addButton(actions, 'Undo', () => {
    gantt.undo(); // tasksChange (reason 'undo') and historyChange
  });
  addButton(actions, 'Redo', () => {
    gantt.redo();
  });

  // An edit session: `dirtyChange` when the first change is made and when it ends, and
  // `editRollback` when it is rolled back.
  addButton(session, 'Begin edit', () => {
    gantt.edit.begin();
  });
  addButton(session, 'Commit', () => {
    gantt.edit.commit();
  });
  addButton(session, 'Rollback', () => {
    gantt.edit.rollback();
  });

  // `issues`: data with a problem in it, and the same data with the problem gone.
  const breakData = addButton(session, 'Break data', () => {
    const current = gantt.core.getSnapshot().state.tasks;
    const without = current.filter((task) => task.id !== broken.id);
    const adding = breakData.textContent === 'Break data';
    gantt.setTasks(adding ? [...without, broken] : without);
    breakData.textContent = adding ? 'Fix data' : 'Break data';
  });

  // `error`: a listener that throws. `onError` catches what it threw, and the log shows it;
  // select something to make it throw.
  let failing: Unsubscribe | undefined;
  const failButton = addButton(session, 'Add a failing listener', () => {
    if (failing === undefined) {
      failing = gantt.on('selectionChange', () => {
        throw new Error('This listener always throws');
      });
    } else {
      failing();
      failing = undefined;
    }
    failButton.textContent = failing === undefined ? 'Add a failing listener' : 'Remove it';
  });

  addButton(session, 'Clear the log', () => {
    entries = [];
    render();
  });

  render();

  return () => {
    controller.abort();
    if (frame !== undefined) cancelAnimationFrame(frame);
    gantt.destroy();
    root.remove();
  };
}

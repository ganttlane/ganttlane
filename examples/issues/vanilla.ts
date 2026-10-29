import '@ganttlane/dom/styles.css';
import './styles.css';

import { createGantt, type Issue } from '@ganttlane/dom';

import { fixedLinks, fixedTasks, links, tasks } from './data';
import { detailOf, type Found, locationOf } from './helpers';
import { options } from './options';

/** One issue as a list item: its code, its place, its text, and what was given and used. */
function issueItem(issue: Issue): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.severity = issue.severity;
  const code = document.createElement('strong');
  code.textContent = issue.code;
  const where = document.createElement('code');
  where.textContent = ` ${locationOf(issue)}`;
  // `message` is for people: the development build spells it out, the production build keeps the
  // short form. Never parse it: `code`, `path`, `value` and `suggested` say the same.
  const message = document.createElement('small');
  message.textContent = issue.message;
  const detail = document.createElement('small');
  detail.textContent = detailOf(issue);
  item.append(code, where, message, detail);
  return item;
}

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  root.className = 'issues-demo';
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const body = document.createElement('div');
  body.className = 'issues-demo__body';
  // The chart fills its container and scrolls inside it, so the container needs a height.
  const chart = document.createElement('div');
  chart.style.height = '420px';
  const panel = document.createElement('aside');
  panel.className = 'issues-demo__panel';
  panel.setAttribute('aria-label', 'Issues');
  body.append(chart, panel);
  const status = document.createElement('p');
  root.append(toolbar, body, status);
  container.append(root);

  // The list is drawn from the two lists of `getIssues()`, and again each time `onIssues` says one
  // of them changed. Nodes are built with the DOM API: issue texts are data, never markup.
  const found: Found = { data: [], options: [] };
  const render = (): void => {
    const sections = (['data', 'options'] as const).map((source) => {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = `${source === 'data' ? 'Data' : 'Options'} (${String(found[source].length)})`;
      section.append(title);
      if (found[source].length === 0) {
        const none = document.createElement('p');
        none.className = 'issues-demo__empty';
        none.textContent = 'No issues.';
        section.append(none);
      } else {
        const list = document.createElement('ul');
        list.append(...found[source].map(issueItem));
        section.append(list);
      }
      return section;
    });
    panel.replaceChildren(...sections);
  };

  const gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    // Called when the list of issues of the data (`'data'`) or of the options (`'options'`)
    // changes, also while the chart is created. It carries the whole list, not a difference.
    onIssues: ({ source, issues }): void => {
      if (source === 'change-set') return; // a change set that was committed with issues
      found[source] = issues;
      status.textContent = `onIssues: ${source}, ${String(issues.length)} issues.`;
      render();
    },
  });
  // The same lists, asked for at any time.
  Object.assign(found, gantt.getIssues());
  render();

  const controller = new AbortController();
  const { signal } = controller;

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick, { signal });
    toolbar.append(button);
  };

  addButton('Fix the input', () => {
    gantt.setTasks(fixedTasks);
    gantt.setLinks(fixedLinks);
    // `undefined` puts an option back to its default.
    gantt.setOptions({ scheduling: { propagation: undefined }, display: { gridLines: undefined } });
  });
  addButton('Break it again', () => {
    gantt.setTasks(tasks);
    gantt.setLinks(links);
    gantt.setOptions({ scheduling: options.scheduling, display: options.display });
  });

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

import '@ganttlane/dom/styles.css';

import { createGantt, type Gantt, type LinkMenuContext } from '@ganttlane/dom';

import { links, tasks } from './data';
import { actionsFor, lagText, type MenuAction, TYPE_NAMES } from './helpers';
import { options } from './options';

export function mount(container: HTMLElement): () => void {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  const chart = document.createElement('div');
  chart.style.height = '360px';
  const status = document.createElement('p');
  status.textContent = 'Click an arrow to open its menu.';
  root.append(toolbar, chart, status);
  container.append(root);

  // Run an action of the menu, and say what happened. The menu has closed by the time it runs.
  const act = (action: MenuAction): void => {
    void action.run(gantt).then((message) => {
      status.textContent = message;
    });
  };

  const gantt: Gantt = createGantt(chart, {
    tasks,
    links,
    ...options,
    linkMenu: {
      // The content of the menu: text sections, and one button for each action. Returning `null`
      // would open no menu.
      render: (context: LinkMenuContext) => {
        const { link, source, target, canRemove } = context;
        const title = `${source?.name ?? String(link.source)} → ${target?.name ?? String(link.target)}`;
        const subtitle = `${TYPE_NAMES[link.type]} · ${lagText(link)}`;
        // `canRemove` is false when links are not editable (`editing.links`) or this one is fixed
        // (`link.editable: false`): then the menu only tells.
        if (!canRemove) {
          return { title, subtitle, details: 'This dependency cannot be edited.' };
        }
        return {
          title,
          subtitle,
          actions: [
            ...actionsFor(link).map((action) => ({
              label: action.label,
              onSelect: () => act(action),
            })),
            // `remove()` is `linkMenu.onRemove`, below, on the link as it is now.
            { label: 'Remove dependency', onSelect: () => context.remove() },
          ],
        };
      },
      // What the remove action calls. The default is the chart's own `removeLink`; this one also
      // says so, and it is where you would confirm, or remove the link from your own data.
      onRemove: (link) => {
        const names = `${gantt.getTask(link.source)?.name ?? String(link.source)} → ${gantt.getTask(link.target)?.name ?? String(link.target)}`;
        void gantt.removeLink(link.id).then((result) => {
          status.textContent =
            result.status === 'deleted'
              ? `Removed ${names}. Reset brings it back.`
              : `${names} stayed (${result.status}).`;
        });
      },
    },
  });

  const controller = new AbortController();
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener(
    'click',
    () => {
      gantt.setTasks(tasks);
      gantt.setLinks(links);
      status.textContent = 'The plan is back as it was.';
    },
    { signal: controller.signal },
  );
  const label = document.createElement('label');
  const editable = document.createElement('input');
  editable.type = 'checkbox';
  editable.checked = true;
  editable.addEventListener(
    'change',
    () => {
      // `editing` is taken whole by `setOptions`. With links off, `canRemove` is false.
      gantt.setOptions({ editing: { links: editable.checked } });
      status.textContent = editable.checked
        ? 'Links can be edited: the menu has its actions.'
        : 'Links cannot be edited: the menu only tells.';
    },
    { signal: controller.signal },
  );
  label.append(editable, ' Links can be edited');
  toolbar.append(reset, label);

  return () => {
    controller.abort();
    gantt.destroy();
    root.remove();
  };
}

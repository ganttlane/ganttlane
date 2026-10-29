import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle, type LinkMenuContext } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { actionsFor, lagText, type MenuAction, TYPE_NAMES } from './helpers';
import { options } from './options';

// The menu is a component: it sees your context providers and your state, and may use hooks.
// Keep the logic here and return `<LinkMenu … />` from `renderLinkMenu`.
function LinkMenu({
  context,
  onAction,
}: {
  context: LinkMenuContext;
  onAction: (action: MenuAction) => void;
}) {
  const { link, source, target, canRemove, api } = context;
  return (
    <div className="link-menu">
      <div className="link-menu__title">
        {source?.name ?? String(link.source)} → {target?.name ?? String(link.target)}
      </div>
      <div className="link-menu__details">
        {TYPE_NAMES[link.type]} · {lagText(link)}
      </div>
      {/* `canRemove` is false when links are not editable (`editing.links`) or this one is fixed
          (`link.editable: false`): then the menu only tells. */}
      {canRemove ? (
        <div className="link-menu__actions">
          {actionsFor(link).map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="link-menu__action"
              onClick={() => {
                api.hide(); // a button of your own does not close the menu; `api.hide()` does
                onAction(action);
              }}
            >
              {action.label}
            </button>
          ))}
          {/* `remove()` is `linkMenu.onRemove`, below, on the link as it is now. */}
          <button
            type="button"
            role="menuitem"
            className="link-menu__action"
            onClick={() => {
              context.remove();
            }}
          >
            Remove dependency
          </button>
        </div>
      ) : (
        <div className="link-menu__details">This dependency cannot be edited.</div>
      )}
    </div>
  );
}

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [status, setStatus] = useState('Click an arrow to open its menu.');
  const [editable, setEditable] = useState(true);
  const { viewMode, ...rest } = options;

  // Run an action of the menu, and say what happened. The menu has closed by the time it runs.
  const act = (action: MenuAction): void => {
    const handle = chart.current;
    if (handle) void action.run(handle).then(setStatus);
  };

  return (
    <>
      <div role="toolbar">
        <button
          type="button"
          onClick={() => {
            chart.current?.setTasks(tasks);
            chart.current?.setLinks(links);
            setStatus('The plan is back as it was.');
          }}
        >
          Reset
        </button>
        <label>
          <input
            type="checkbox"
            checked={editable}
            onChange={(event) => {
              setEditable(event.target.checked);
              setStatus(
                event.target.checked
                  ? 'Links can be edited: the menu has its actions.'
                  : 'Links cannot be edited: the menu only tells.',
              );
            }}
          />{' '}
          Links can be edited
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 360 }}
        // In React `tasks`, `links` and `viewMode` are controlled props, and `defaultTasks`,
        // `defaultLinks` and `defaultViewMode` are where an uncontrolled chart starts (there is
        // no `dataMode` prop).
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        // With links off, `canRemove` is false.
        editing={{ links: editable }}
        // The content of the menu, as a ReactNode (`linkMenu.render` for React).
        renderLinkMenu={(context) => <LinkMenu context={context} onAction={act} />}
        linkMenu={{
          // What the remove action calls. The default is the chart's own `removeLink`; this one
          // also says so, and it is where you would confirm, or remove the link from your data.
          onRemove: (link) => {
            const names = `${chart.current?.getTask(link.source)?.name ?? String(link.source)} → ${chart.current?.getTask(link.target)?.name ?? String(link.target)}`;
            void chart.current?.removeLink(link.id).then((result) => {
              setStatus(
                result.status === 'deleted'
                  ? `Removed ${names}. Reset brings it back.`
                  : `${names} stayed (${result.status}).`,
              );
            });
          },
        }}
      />
      <p>{status}</p>
    </>
  );
}

import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type TaskId } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { LINK_TYPES, linkText, refusalText } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [editable, setEditable] = useState(true);
  const [type, setType] = useState<(typeof LINK_TYPES)[number]>('FS');
  const [status, setStatus] = useState(
    'Hover a bar, then drag from a round handle onto another bar, or click the handle and then the bar. Click a link to remove it.',
  );
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it. `tasks` and `links` are controlled too: `defaultTasks` and
  // `defaultLinks` are where the chart starts, and the user's links are then the chart's own.
  const { viewMode, ...rest } = options;
  const nameOf = (id: TaskId): string => chart.current?.getTask(id)?.name ?? String(id);

  return (
    <>
      <div role="toolbar">
        <label>
          <input
            type="checkbox"
            checked={editable}
            onChange={(event) => {
              setEditable(event.target.checked);
              setStatus(
                event.target.checked
                  ? 'Links can be drawn and removed again.'
                  : 'editing.links is false: no handles on the bars, and no menu on the links.',
              );
            }}
          />{' '}
          editing.links
        </label>
        <label>
          New links are{' '}
          <select
            aria-label="Type of new links"
            value={type}
            onChange={(event) => {
              setType(event.target.value as (typeof LINK_TYPES)[number]);
              setStatus(`New links are ${event.target.value} links.`);
            }}
          >
            {LINK_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 370 }}
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        defaultViewMode={viewMode}
        // `editing.links` and the default type of the links the user draws come from state.
        editing={{ links: editable }}
        scheduling={{ ...options.scheduling, defaultLinkType: type }}
        // A link was drawn: the caller's `Link` as written, and its id.
        onLinkCreate={(link, id) => {
          const record = chart.current?.getLink(id); // the link as the chart has it
          setStatus(`Created ${linkText(record ?? link, nameOf)}.`);
        }}
        // A link was removed, from the menu or by `removeLink`: the link as it was.
        onLinkDelete={(record) => {
          setStatus(`Removed ${linkText(record, nameOf)}.`);
        }}
        // A click on the arrow of a link, which selects it and opens its menu.
        onLinkClick={(record) => {
          const next = record.editable
            ? 'Choose "Remove dependency" in its menu.'
            : 'It has editable: false, so its menu has nothing to offer.';
          setStatus(`Selected ${linkText(record, nameOf)}. ${next}`);
        }}
        // A link that was not drawn: a task that cannot be linked, itself, a cycle, a duplicate.
        onEditRefused={(refusal) => {
          setStatus(refusalText(refusal, nameOf));
        }}
      />
      <p>{status}</p>
    </>
  );
}

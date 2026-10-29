import '@ganttlane/react/styles.css';
import './styles.css';

import {
  type GanttInstance,
  type TaskId,
  type TaskRecord,
  useGantt,
  useGanttState,
} from '@ganttlane/react';
import { Fragment, useState } from 'react';

import { links, tasks } from './data';
import {
  addsToSelection,
  afterClick,
  type Field,
  linkFields,
  selectionText,
  taskFields,
} from './helpers';
import { options } from './options';

/** A card of the side panel: a title and a list of labels and values. */
function Card({ title, fields }: { title: string; fields: readonly Field[] }) {
  return (
    <div className="selection-card">
      <h4>{title}</h4>
      <dl>
        {fields.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** Two lists of records are the same when each record is the same object (a record is frozen). */
const sameRecords = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((record, index) => record === b[index]);

export default function Example() {
  // What `onSelectionChange` reported last (the chart starts with Backend selected).
  const [status, setStatus] = useState(selectionText(['backend'], undefined));
  // `viewMode` is a controlled prop in React: `defaultViewMode` is where the chart starts, and
  // then the chart owns it. The selection has a pair of its own, `selectedKeys` (controlled) and
  // `defaultSelectedKeys`; here the chart owns it, and `select()` and the events are the same as
  // in the vanilla code.
  const { viewMode, ...rest } = options;

  // The handlers read `gantt`, which they are passed to: give it a type.
  const gantt: GanttInstance = useGantt({
    ...rest,
    defaultViewMode: viewMode,
    // `tasks` and `links` are controlled props: these are where the chart starts.
    defaultTasks: tasks,
    defaultLinks: links,
    defaultSelectedKeys: ['backend'],
    // A click on a bar does not select it: that is up to you. Here it selects the task, and
    // with Shift, Ctrl or Cmd held it adds the task to the selection (or takes it out).
    onTaskClick: (record, event) => {
      gantt.select(
        afterClick(gantt.core.getSnapshot().selection.tasks, record.id, addsToSelection(event)),
      );
    },
    // `select`, `selectLink`, `clearSelection` and a click on a link all end here.
    onSelectionChange: (keys, link) => {
      setStatus(selectionText(keys, link));
    },
  });
  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;

  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);
  // The records of the selected tasks and the selected link, read from the chart's snapshot: the
  // component renders again when the selection changes and when a dragged bar changes a record.
  const records = useGanttState(
    gantt,
    (snapshot) =>
      snapshot.selection.tasks.flatMap((id): TaskRecord[] => {
        const record = gantt.getTask(id);
        return record ? [record] : [];
      }),
    sameRecords,
  );
  const selectedLink = useGanttState(gantt, (snapshot) => snapshot.selection.link);
  const link = selectedLink === undefined ? undefined : gantt.getLink(selectedLink);

  return (
    <>
      <div role="toolbar">
        <button type="button" onClick={() => gantt.select(['backend', 'frontend'])}>
          Select Backend and Frontend
        </button>
        <button type="button" onClick={() => gantt.select(tasks.map((task) => task.id))}>
          Select all
        </button>
        <button type="button" onClick={() => gantt.selectLink('design:FS:build')}>
          Select Design → Build
        </button>
        <button type="button" onClick={() => gantt.clearSelection()}>
          Clear selection
        </button>
      </div>
      {/* `useGantt` is <Gantt> without the `div`: you render the container, and the slots next to it. */}
      <div ref={setContainer} style={{ height: 370 }} />
      {slots}
      <div className="selection-panel" aria-live="polite">
        {records.map((record) => (
          <Card key={record.id} title={record.name} fields={taskFields(record, nameOf)} />
        ))}
        {link && (
          <Card
            title={`${nameOf(link.source)} → ${nameOf(link.target)}`}
            fields={linkFields(link)}
          />
        )}
        {records.length === 0 && !link && (
          <div className="selection-empty">
            Nothing is selected. Click a bar (hold Shift, Ctrl or Cmd to add one) or the arrow of a
            link.
          </div>
        )}
      </div>
      <p>{status}</p>
    </>
  );
}

import '@ganttlane/react/styles.css';

import { type GanttInstance, useGantt, useGanttState } from '@ganttlane/react';

import { links, tasks } from './data';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'];
const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });

type Range = ReturnType<GanttInstance['getVisibleRange']>;

/** Two visible ranges are the same when both edges are the same moment. */
const sameRange = (a: Range, b: Range): boolean =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

/**
 * A toolbar that lives outside the chart. It gets the instance `useGantt` returned (the same
 * object for the life of the component), reads the state it shows with `useGanttState`, and calls
 * the methods on it. It renders again only when one of these slices changes: not while the chart
 * scrolls or a bar is dragged, and not when the selection changes.
 */
function Toolbar({ gantt }: { gantt: GanttInstance }) {
  // A selector gets the chart's snapshot: here its view mode.
  const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);
  // History and the edit session are read from the instance. They change together with the
  // snapshot, and the selector runs again whenever the snapshot does.
  const canUndo = useGanttState(gantt, () => gantt.canUndo);
  const canRedo = useGanttState(gantt, () => gantt.canRedo);
  const editing = useGanttState(gantt, () => gantt.edit.isOpen);
  const dirty = useGanttState(gantt, () => gantt.edit.isDirty);

  return (
    <div role="toolbar" aria-label="Chart controls">
      <label>
        View{' '}
        <select
          value={mode}
          onChange={(event) => {
            gantt.setViewMode(event.target.value);
          }}
        >
          {VIEW_MODES.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => {
          gantt.undo();
        }}
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={() => {
          gantt.redo();
        }}
      >
        Redo
      </button>
      <button
        type="button"
        disabled={editing}
        onClick={() => {
          gantt.edit.begin();
        }}
      >
        Edit
      </button>
      <button
        type="button"
        disabled={!dirty}
        onClick={() => {
          gantt.edit.commit();
        }}
      >
        Save
      </button>
      <button
        type="button"
        disabled={!editing}
        onClick={() => {
          gantt.edit.rollback();
        }}
      >
        Discard
      </button>
      <span>{dirty ? 'Unsaved changes' : editing ? 'Editing' : 'Viewing'}</span>
    </div>
  );
}

/** What the chart shows right now, under it: the dates in view, and the selected tasks. */
function Readout({ gantt }: { gantt: GanttInstance }) {
  // `getVisibleRange()` makes a new object on every call: `isEqual` says when two are the same.
  const range = useGanttState(gantt, () => gantt.getVisibleRange(), sameRange);
  // Parts of the snapshot keep their identity until they change, so the default `Object.is` does.
  const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks);
  const names = selected.map((id) => gantt.getTask(id)?.name ?? String(id));

  return (
    <p>
      In view: {day.format(range.start)} to {day.format(range.end)}. Selected:{' '}
      {names.length > 0 ? names.join(', ') : 'none'}.
    </p>
  );
}

export default function Example() {
  // `viewMode` is a controlled prop in React: the chart would show the one your state holds. The
  // toolbar changes it through the instance, so the chart starts from `defaultViewMode` and owns
  // the mode; `defaultTasks` and `defaultLinks` are where it starts with the data.
  const { viewMode, ...rest } = options;

  const gantt = useGantt({
    ...rest,
    defaultViewMode: viewMode,
    defaultTasks: tasks,
    defaultLinks: links,
    // A tooltip as React. It is drawn through portals that `slots` holds (below).
    renderTooltip: ({ task }) => (
      <span>
        {task.name}: {Math.round(task.progress)}%
      </span>
    ),
  });

  // `useGantt` is `<Gantt>` without the `div`: the element the chart fills is yours, and so is
  // the place of the slots. Destructured, which keeps the `react-hooks/refs` rule quiet about the
  // ref callback.
  const { setContainer, slots } = gantt;

  return (
    <>
      <Toolbar gantt={gantt} />
      <div ref={setContainer} style={{ height: 400 }} />
      {slots}
      <Readout gantt={gantt} />
    </>
  );
}

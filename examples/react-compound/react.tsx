import '@ganttlane/react/styles.css';
import './styles.css';

import {
  GanttChart,
  GanttRoot,
  TaskList,
  useGanttBar,
  useGanttContext,
  useGanttState,
} from '@ganttlane/react';

import { links, tasks } from './data';
import { options } from './options';

const VIEW_MODES = ['day', 'week', 'month'];
const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });

/**
 * A toolbar. It has no props: the chart comes from the root through `useGanttContext`, and what
 * it shows from `useGanttState(selector)`, which also reads the root's chart.
 */
function Toolbar() {
  const gantt = useGanttContext();
  const mode = useGanttState((snapshot) => snapshot.viewMode.id);
  // History is read from the instance; it changes together with the snapshot.
  const canUndo = useGanttState(() => gantt.canUndo);
  const canRedo = useGanttState(() => gantt.canRedo);

  return (
    <div className="compound-toolbar" role="toolbar" aria-label="Chart controls">
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
    </div>
  );
}

/**
 * A panel that follows the selected task. `useGanttBar` gives the task, its draft (the dates and
 * progress the chart shows while the bar is dragged), and `box`: where the bar is drawn, in px
 * from the corner of the chart's element. The panel goes under the bar, and is hidden when the
 * bar is scrolled out of view.
 */
function TaskPanel() {
  const id = useGanttState((snapshot) => snapshot.selection.tasks[0]);
  const bar = useGanttBar(id);
  const width = useGanttState((snapshot) => snapshot.timeline.viewportWidth);
  const height = useGanttState((snapshot) => snapshot.viewportHeight);

  if (bar?.box === undefined) return null;
  const { task, draft, box, isDragging } = bar;
  const inView =
    box.left + box.width > 0 && box.left < width && box.top + box.height > 0 && box.top < height;
  if (!inView) return null;

  const start = draft?.start ?? task.start;
  const end = draft?.end ?? task.end;
  const progress = draft?.progress ?? task.progress;
  return (
    <aside
      className="compound-panel gantt-scope"
      data-dragging={isDragging ? '' : undefined}
      style={{ left: Math.max(box.left, 0), top: box.top + box.height + 6 }}
    >
      <strong>{task.name}</strong>
      {start && end ? `${day.format(start)} to ${day.format(end)}` : 'No dates'}
      <br />
      {Math.round(progress)}% done{isDragging ? ', being dragged' : ''}
    </aside>
  );
}

export default function Example() {
  // `viewMode` is a controlled prop in React: the toolbar changes it through the chart, so the
  // chart starts from `defaultViewMode` and owns the mode.
  const { viewMode, ...rest } = options;

  return (
    <GanttRoot {...rest} defaultViewMode={viewMode} defaultTasks={tasks} defaultLinks={links}>
      <Toolbar />
      <div className="compound-split">
        <TaskList />
        <div className="compound-chart">
          <GanttChart className="compound-chart__gantt" />
          <TaskPanel />
        </div>
      </div>
    </GanttRoot>
  );
}

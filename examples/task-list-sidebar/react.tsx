import '@ganttlane/react/styles.css';
import './styles.css';

import { type GanttInstance, type TaskId, useGantt, useGanttState } from '@ganttlane/react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { links, tasks } from './data';
import {
  BAR_MARGIN,
  describeChange,
  describeExpanded,
  hoveredId,
  keepRowAt,
  listRows,
  ROW_HEIGHTS,
  type Theme,
  THEMES,
  treeAction,
  VIEW_MODES,
} from './helpers';
import { options } from './options';

interface ListProps {
  gantt: GanttInstance;
  /** The task whose row is lit: the pointer is on its name, or on its row in the chart. */
  hovered: TaskId | undefined;
  onPointer: (id: TaskId | undefined) => void;
}

/**
 * The list. It reads the chart's snapshot with `useGanttState`, and renders again only when the
 * slice it reads changes: not while the chart scrolls.
 */
function TaskList({ gantt, hovered, onPointer }: ListProps) {
  // The rows change with what is collapsed and with the data (a name, a date): then
  // `state.derived` is a new object. It keeps its identity while the chart scrolls, hovers and
  // selects, so the list is built again only when it changes.
  const derived = useGanttState(gantt, (snapshot) => snapshot.state.derived);
  const rows = useMemo(() => listRows(derived, gantt.getTask), [gantt, derived]);
  // The sizes are the chart's: the list never has a number of its own.
  const rowHeight = useGanttState(gantt, (snapshot) => snapshot.layout.rows.rowHeight);
  const headerHeight = useGanttState(gantt, (snapshot) => snapshot.layout.rows.headerHeight);
  const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks);

  // The tab stop of the tree (roving tabindex): the row that last had the focus, or was selected.
  const [focused, setFocused] = useState<TaskId | undefined>();
  const [followed, setFollowed] = useState(selected);
  const nodes = useRef(new Map<TaskId, HTMLElement>());
  // The tab stop follows the selection, wherever it was made (a bar, the list, `select`). Set
  // while rendering, which React allows for state of the same component.
  if (followed !== selected) {
    setFollowed(selected);
    setFocused(selected.at(-1));
  }
  const active = rows.some((row) => row.id === focused) ? focused : rows[0]?.id;

  /** A click on a name, or Enter on a row: select the task and scroll the chart to its bar. */
  const choose = (id: TaskId): void => {
    setFocused(id);
    gantt.select([id]);
    // `scrollToTask` scrolls both ways; `keepRowAt` makes the vertical one stay where it is.
    gantt.scrollToTask(id, {
      align: 'center',
      alignY: keepRowAt(gantt.getSnapshot(), id),
      behavior: 'smooth',
    });
  };

  const onClick = (event: MouseEvent, id: TaskId, isGroup: boolean, isExpanded: boolean): void => {
    // The chevron opens and shuts a group; the rest of the row selects the task.
    if (isGroup && event.target instanceof Element && event.target.closest('[data-toggle]')) {
      setFocused(id);
      if (isExpanded) gantt.collapse(id);
      else gantt.expand(id);
    } else {
      choose(id);
    }
  };

  const onKeyDown = (event: KeyboardEvent, id: TaskId): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = treeAction(event.key, rows, id);
    if (!action) return;
    // The arrows and Space would scroll the box otherwise.
    event.preventDefault();
    switch (action.type) {
      case 'focus':
        // Focusing a row scrolls the box to it, and the chart with it.
        nodes.current.get(action.id)?.focus();
        break;
      case 'expand':
        gantt.expand(action.id);
        break;
      case 'collapse':
        gantt.collapse(action.id);
        break;
      case 'activate':
        choose(action.id);
        break;
    }
  };

  return (
    <div
      className="task-list"
      style={
        {
          '--task-list-row-height': `${String(rowHeight)}px`,
          '--task-list-header-height': `${String(headerHeight)}px`,
        } as CSSProperties
      }
    >
      <div className="task-list__header" aria-hidden="true">
        <span className="task-list__header-name">Task</span>
        <span className="task-list__header-dates">Dates</span>
      </div>
      <div role="tree" aria-label="Tasks" className="task-list__tree">
        {rows.map((row) => (
          <div
            key={row.id}
            ref={(node) => {
              if (node) nodes.current.set(row.id, node);
              else nodes.current.delete(row.id);
            }}
            role="treeitem"
            className="task-list__row"
            data-task-id={row.id}
            data-group={row.isGroup ? '' : undefined}
            data-stripe={row.stripe}
            data-hovered={row.id === hovered ? '' : undefined}
            style={{ '--depth': row.depth } as CSSProperties}
            tabIndex={row.id === active ? 0 : -1}
            aria-level={row.depth + 1}
            aria-setsize={row.setSize}
            aria-posinset={row.position}
            // `aria-expanded` is for groups only: a leaf has no state to report.
            aria-expanded={row.isGroup ? row.isExpanded : undefined}
            aria-selected={selected.includes(row.id)}
            onClick={(event) => onClick(event, row.id, row.isGroup, row.isExpanded)}
            onKeyDown={(event) => onKeyDown(event, row.id)}
            onFocus={() => setFocused(row.id)}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') onPointer(row.id);
            }}
            onPointerLeave={() => onPointer(undefined)}
          >
            <span className="task-list__toggle" data-toggle="" aria-hidden="true" />
            <span className="task-list__name" title={row.name}>
              {row.name}
            </span>
            <span className="task-list__dates">{row.dates}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The row of the chart that is lit: where `getRowMetrics` says the hovered task's row lies. */
function Band({ gantt, hovered }: { gantt: GanttInstance; hovered: TaskId | undefined }) {
  const headerHeight = useGanttState(gantt, (snapshot) => snapshot.layout.rows.headerHeight);
  // Read from the snapshot's layout: the row moves with the rows of the chart.
  const y = useGanttState(gantt, (snapshot) =>
    hovered === undefined ? undefined : snapshot.layout.getRowMetrics(hovered)?.y,
  );
  const rowHeight = useGanttState(gantt, (snapshot) => snapshot.layout.rows.rowHeight);
  return (
    <div
      className="task-list__band"
      hidden={y === undefined}
      style={
        {
          '--task-list-row-height': `${String(rowHeight)}px`,
          '--task-list-band-y': `${String(headerHeight + (y ?? 0))}px`,
        } as CSSProperties
      }
    />
  );
}

export default function Example() {
  const [rowHeight, setRowHeight] = useState<number>(options.layout.rowHeight);
  const [theme, setTheme] = useState<Theme>('auto');
  const [pointerOn, setPointerOn] = useState<TaskId | undefined>();
  const [status, setStatus] = useState(
    'Click a name to scroll to its bar, or a bar to select its row. Drag a bar and the Dates follow.',
  );
  const nameOf = (id: TaskId): string => gantt.getTask(id)?.name ?? String(id);

  // `viewMode` is a controlled prop in React: the chart would show the one your state holds. The
  // select changes it through the instance, so the chart starts from `defaultViewMode` and owns it.
  const { viewMode, layout, ...rest } = options;

  const gantt = useGantt({
    ...rest,
    defaultViewMode: viewMode,
    defaultTasks: tasks,
    defaultLinks: links,
    // In React the props are the truth: the row height and the theme are state, passed from here.
    layout: { ...layout, rowHeight, barHeight: rowHeight - BAR_MARGIN },
    theme,
    // A click on a bar does not select it: that is up to you. Here it selects its task, and the
    // list shows it.
    onTaskClick: (record) => gantt.select([record.id]),
    onTasksChange: (changeSet) => setStatus(describeChange(changeSet, nameOf)),
    onExpandedChange: (keys) => setStatus(describeExpanded(keys, nameOf)),
  });
  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;
  const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);
  // The row the pointer is on in the chart, over a bar or over empty space in its row.
  const inChart = useGanttState(gantt, (snapshot) => hoveredId(snapshot.feedback.hover));
  const hovered = pointerOn ?? inChart;

  return (
    <div className="task-list-demo">
      <div role="toolbar">
        <button type="button" onClick={() => gantt.expandAll()}>
          Expand all
        </button>
        <button type="button" onClick={() => gantt.collapseAll()}>
          Collapse all
        </button>
        <label>
          View{' '}
          <select value={mode} onChange={(event) => gantt.setViewMode(event.target.value)}>
            {VIEW_MODES.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          Row height{' '}
          <select value={rowHeight} onChange={(event) => setRowHeight(Number(event.target.value))}>
            {ROW_HEIGHTS.map((height) => (
              <option key={height}>{height}</option>
            ))}
          </select>
        </label>
        <label>
          Theme{' '}
          <select
            value={theme}
            onChange={(event) => setTheme(THEMES.find((id) => id === event.target.value) ?? 'auto')}
          >
            {THEMES.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="task-list-scroller">
        <div className="task-list-content">
          <TaskList gantt={gantt} hovered={hovered} onPointer={setPointerOn} />
          <div className="task-list-chart">
            <div ref={setContainer} />
            {slots}
            <Band gantt={gantt} hovered={hovered} />
          </div>
        </div>
      </div>
      <p>{status}</p>
    </div>
  );
}

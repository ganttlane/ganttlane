import '@ganttlane/react/styles.css';
import './styles.css';

import { TaskList, useGantt, useGanttState } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import {
  CHART_HEIGHT,
  columns,
  type HeightMode,
  HEIGHTS,
  type Theme,
  THEMES,
  VIEW_MODES,
} from './helpers';
import { options } from './options';

export default function Example() {
  const [theme, setTheme] = useState<Theme>('auto');
  const [height, setHeight] = useState<HeightMode>('fixed');
  const [status, setStatus] = useState(
    'Click a name or a bar. Drag a bar, and the Dates column follows.',
  );

  // `viewMode` is a controlled prop in React: the select changes it through the instance, so the
  // chart starts from `defaultViewMode` and owns it.
  const { viewMode, layout, ...rest } = options;

  const gantt = useGantt({
    ...rest,
    defaultViewMode: viewMode,
    defaultTasks: tasks,
    defaultLinks: links,
    // In React the props are the truth: the height and the theme are state, passed from here.
    layout: { ...layout, height: height === 'auto' ? 'auto' : CHART_HEIGHT },
    theme,
    onSelectionChange: ([id]) => {
      setStatus(id === undefined ? 'Nothing selected.' : `Selected: ${String(id)}.`);
    },
  });
  // Destructured, which keeps `react-hooks/refs` quiet about the ref callback.
  const { setContainer, slots } = gantt;
  const mode = useGanttState(gantt, (snapshot) => snapshot.viewMode.id);

  return (
    <div>
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
        <label>
          Height{' '}
          <select
            value={height}
            onChange={(event) =>
              setHeight(HEIGHTS.find((id) => id === event.target.value) ?? 'fixed')
            }
          >
            {HEIGHTS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="plan" data-height={height}>
        {/* Everything is kept in sync by the list: rows, sizes, selection, hover, focus, scrolling. */}
        <TaskList gantt={gantt} columns={columns} />
        <div ref={setContainer} className="plan__chart" />
        {slots}
      </div>
      <p>{status}</p>
    </div>
  );
}

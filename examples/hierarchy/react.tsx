import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle, type TaskId } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { CHILD_ANCHORS, describe, describeExpanded, MOVE_CHILDREN } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [moveChildren, setMoveChildren] = useState<string>(options.hierarchy.moveChildren);
  const [childAnchor, setChildAnchor] = useState<string>(options.hierarchy.childAnchor);
  const [status, setStatus] = useState('Drag Build, then change Move children and drag it again.');
  const nameOf = (id: TaskId): string => chart.current?.getTask(id)?.name ?? String(id);

  // The open phases are a prop of their own in React (`defaultExpandedKeys`: the chart owns them
  // from then on, so the buttons below can change them), not a field of `hierarchy`.
  const { hierarchy, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        {/* The ref is the chart's methods. */}
        <button type="button" onClick={() => chart.current?.expandAll()}>
          Expand all
        </button>
        <button type="button" onClick={() => chart.current?.collapseAll()}>
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => {
            if (chart.current?.getTask('build')?.isExpanded) chart.current.collapse('build');
            else chart.current?.expand('build');
          }}
        >
          Toggle Build
        </button>
        <label>
          Move children{' '}
          <select value={moveChildren} onChange={(event) => setMoveChildren(event.target.value)}>
            {MOVE_CHILDREN.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Child anchor{' '}
          <select value={childAnchor} onChange={(event) => setChildAnchor(event.target.value)}>
            {CHILD_ANCHORS.map((entry) => (
              <option key={entry.label}>{entry.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            chart.current?.setTasks(tasks);
            setStatus('Back to the start.');
          }}
        >
          Reset
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 420 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        // In React the props are the truth: the two selects change `hierarchy` through state, not
        // through `setOptions` on the ref, which the next render would overwrite.
        hierarchy={{
          moveChildren: MOVE_CHILDREN.find((value) => value === moveChildren),
          childAnchor: CHILD_ANCHORS.find((entry) => entry.label === childAnchor)?.anchor,
        }}
        defaultExpandedKeys={hierarchy.expandedKeys}
        onTasksChange={(changeSet) => setStatus(describe(changeSet, nameOf))}
        onExpandedChange={(keys) => setStatus(describeExpanded(keys, nameOf))}
      />
      <p>{status}</p>
    </>
  );
}

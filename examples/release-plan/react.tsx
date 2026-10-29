import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef } from 'react';

import { links, type Meta, tasks } from './data';
import { options } from './options';

export default function Example() {
  // `Meta` is the type of `task.data`: the handle's methods and every render function know it.
  const chart = useRef<GanttHandle<Meta>>(null);
  // The expanded parents are a prop of their own in React (`defaultExpandedKeys`: the chart owns
  // them from then on, so the buttons below can change them).
  const { hierarchy, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        <button type="button" onClick={() => chart.current?.expandAll()}>
          Expand all
        </button>
        <button type="button" onClick={() => chart.current?.collapseAll()}>
          Collapse all
        </button>
      </div>
      <Gantt<Meta>
        ref={chart}
        style={{ height: 420 }}
        defaultTasks={tasks}
        defaultLinks={links}
        {...rest}
        hierarchy={{ moveChildren: hierarchy.moveChildren }}
        defaultExpandedKeys={hierarchy.expandedKeys}
      />
    </>
  );
}

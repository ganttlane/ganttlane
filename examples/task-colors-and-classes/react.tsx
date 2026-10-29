import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { coloured, links, type Meta, tasks } from './data';
import { options } from './options';

const STATUSES = ['done', 'active', 'late', 'blocked', 'review'];
const STRIPES = ['group', 'row', 'off'] as const;
type Stripes = (typeof STRIPES)[number];

export default function Example() {
  const chart = useRef<GanttHandle<Meta>>(null);
  const [byColour, setByColour] = useState(false);
  const [stripes, setStripes] = useState<Stripes>('group');

  // In React `tasks`, `links` and `viewMode` are controlled props, and `defaultTasks`,
  // `defaultLinks` and `defaultViewMode` are where an uncontrolled chart starts (there is no
  // `dataMode` prop). `display` and `layout` are plain props, merged field by field.
  const { viewMode, ...rest } = options;

  return (
    // `.statuses` holds the palette of `styles.css` and keeps its rules to this chart.
    <div className="statuses">
      <div role="toolbar">
        <label>
          Style from{' '}
          <select
            value={byColour ? 'colours' : 'classes'}
            onChange={(event) => {
              const next = event.target.value === 'colours';
              setByColour(next);
              // The tasks are the only thing that changes: the same plan, styled the other way.
              chart.current?.setTasks(next ? coloured : tasks);
            }}
          >
            <option value="classes">classes (a stylesheet)</option>
            <option value="colours">colours in the data</option>
          </select>
        </label>
        <label>
          Row stripes{' '}
          <select
            value={stripes}
            onChange={(event) => {
              const next = STRIPES.find((id) => id === event.target.value);
              if (next) setStripes(next);
            }}
          >
            <option value="group">&apos;group&apos;</option>
            <option value="row">&apos;row&apos;</option>
            <option value="off">false</option>
          </select>
        </label>
      </div>
      <ul className="legend">
        {STATUSES.map((id) => (
          <li key={id} data-status={id}>
            {id}
          </li>
        ))}
      </ul>
      <Gantt<Meta>
        ref={chart}
        style={{ height: 420 }}
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        display={{ rowStripes: stripes === 'off' ? false : stripes }}
      />
      <p>
        {byColour
          ? 'Styled from the data: every task has a color and a progressColor. No class, so no row tint.'
          : 'Styled by classes: className colours the bar, rowClassName tints the row (see styles.css).'}
      </p>
    </div>
  );
}

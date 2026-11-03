import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle, type TaskTooltipContext } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { datesText, type GapRow, gapRows, PROPAGATION } from './helpers';
import { options } from './options';

function GapCard({ context, rows }: { context: TaskTooltipContext; rows: readonly GapRow[] }) {
  const { task, preview, isDragging, locale } = context;
  // While a bar is dragged, `preview` says where it would land.
  const start = preview?.start ?? task.start;
  const end = preview?.end ?? task.end;
  if (!start || !end) return null; // an empty tooltip is not shown
  return (
    <div className="gap-card">
      <strong>{task.name}</strong>
      <div className="gap-card-note">
        {datesText(start, end, locale)}
        {isDragging ? ' (moving)' : null}
      </div>
      {rows.length === 0 ? (
        <div className="gap-card-note">No predecessors</div>
      ) : (
        <ul className="gap-card-rows">
          {rows.map(({ id, name, gap, type }) => (
            <li key={id}>
              <span className="gap-card-name">{name}:</span>
              <span>{gap}</span>
              <span className="gap-card-type">{type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [propagation, setPropagation] = useState<(typeof PROPAGATION)[number]>(
    options.scheduling.propagation,
  );

  return (
    <>
      <div role="toolbar">
        <label>
          Propagation{' '}
          <select
            value={propagation}
            onChange={(event) => setPropagation(event.target.value as typeof propagation)}
          >
            {PROPAGATION.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 390 }}
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        scheduling={{ propagation }}
        // The rows are measured from the chart's core: the context says which links there are, and
        // the core where their bars are now.
        renderTooltip={(context) => (
          <GapCard
            context={context}
            rows={
              chart.current
                ? gapRows(context.task.id, context.predecessors, chart.current.core)
                : []
            }
          />
        )}
      />
      <p>Hover Build, then drag it: the rows follow the bar.</p>
    </>
  );
}

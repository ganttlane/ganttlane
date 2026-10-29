import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { COUNTS, DEFAULT_COUNT, generate, links, tasks } from './data';
import { describe, onFirstPaint } from './helpers';
import { options } from './options';

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const host = useRef<HTMLDivElement>(null);
  // The size of the plan, and when it was asked for.
  const [run, setRun] = useState(() => ({ size: DEFAULT_COUNT, asked: performance.now() }));
  const [milliseconds, setMilliseconds] = useState<number | undefined>();
  const { size, asked } = run;
  const plan = useMemo(() => (size === DEFAULT_COUNT ? { tasks, links } : generate(size)), [size]);
  // In React `viewMode` is a controlled prop, and `defaultViewMode` is its uncontrolled twin: here
  // nothing changes the view mode, so the chart owns it and starts from the option.
  const { viewMode, ...rest } = options;

  // The time to the first bars: from the moment the plan was asked for, to the first frame.
  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    return onFirstPaint(element, asked, setMilliseconds);
  }, [asked]);

  return (
    <>
      <div role="toolbar">
        <label>
          Tasks{' '}
          <select
            value={size}
            onChange={(event) => {
              setMilliseconds(undefined);
              setRun({ size: Number(event.target.value), asked: performance.now() });
            }}
          >
            {COUNTS.map((count) => (
              <option key={count} value={count}>
                {count.toLocaleString('en')}
              </option>
            ))}
          </select>
        </label>
        {/* Only the rows in view are drawn, so a jump to the last row of the plan costs no more
            than the first screen did. */}
        <button
          type="button"
          onClick={() => chart.current?.scrollToTask('t1', { behavior: 'instant' })}
        >
          First task
        </button>
        <button
          type="button"
          onClick={() => chart.current?.scrollToTask(`t${String(size)}`, { behavior: 'instant' })}
        >
          Last task
        </button>
      </div>
      <div ref={host}>
        <Gantt
          // A new plan is a new chart: the `key` makes React take the old one away.
          key={size}
          ref={chart}
          // The chart fills its container and scrolls inside it, so the container needs a height.
          style={{ height: 400 }}
          // The chart owns the data (uncontrolled): these are where it starts.
          defaultTasks={plan.tasks}
          defaultLinks={plan.links}
          defaultViewMode={viewMode}
          {...rest}
        />
      </div>
      <p>{describe(plan.tasks.length, plan.links.length, milliseconds)}</p>
    </>
  );
}

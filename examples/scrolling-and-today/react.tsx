import '@ganttlane/react/styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { describe } from './helpers';
import {
  type Align,
  ALIGNS,
  type Behavior,
  BEHAVIORS,
  type Initial,
  INITIALS,
  options,
} from './options';

/** A labelled select of the values it is given. */
function Select<T extends string>(props: {
  name: string;
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { name, values, value, onChange } = props;
  return (
    <label>
      {name}{' '}
      <select
        value={value}
        onChange={(event) => {
          const next = values.find((candidate) => candidate === event.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {values.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [initial, setInitial] = useState<Initial>(options.scroll.initial);
  const [align, setAlign] = useState<Align>(options.scroll.align);
  const [behavior, setBehavior] = useState<Behavior>(options.scroll.behavior);
  const [today, setToday] = useState<boolean>(options.display.today);
  const [status, setStatus] = useState('Scroll the chart, or press a button.');
  // In React `viewMode` is a controlled prop, and `defaultViewMode` is its uncontrolled twin: here
  // nothing changes the view mode, so the chart owns it and starts from the option.
  const { viewMode, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        <Select name="Opens at" values={INITIALS} value={initial} onChange={setInitial} />
        <Select name="Align" values={ALIGNS} value={align} onChange={setAlign} />
        <Select name="Behavior" values={BEHAVIORS} value={behavior} onChange={setBehavior} />
        <label>
          <input
            type="checkbox"
            checked={today}
            onChange={(event) => {
              setToday(event.target.checked);
            }}
          />{' '}
          Today marker
        </label>
      </div>
      <div role="toolbar">
        {/* The three ways to scroll from code. They use `scroll.align` and `scroll.behavior`. */}
        <button type="button" onClick={() => chart.current?.scrollToToday()}>
          Today
        </button>
        <button type="button" onClick={() => chart.current?.scrollToDate('2026-06-01')}>
          1 June
        </button>
        <button type="button" onClick={() => chart.current?.scrollToTask('review')}>
          Review
        </button>
        <button type="button" onClick={() => chart.current?.scrollToTask('retro')}>
          Retrospective
        </button>
      </div>
      <Gantt
        // `scroll.initial` is read when a chart is created, so a new `key` makes a new chart.
        key={initial}
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 400 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        scroll={{ initial, align, behavior }}
        display={{ today }}
        // The chart scrolled, by the user or by a call: where it is, as numbers and as a date.
        onScroll={({ x, y }) => {
          const gantt = chart.current;
          if (gantt) setStatus(describe(gantt.getVisibleRange(), x, y));
        }}
      />
      <p>{status}</p>
    </>
  );
}

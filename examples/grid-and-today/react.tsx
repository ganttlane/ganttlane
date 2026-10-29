import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, tasks } from './data';
import { noLines, options, sprintLines } from './options';

const GRID_LINES = ['both', 'vertical', 'horizontal', 'none'] as const;
const DAYS_OFF = { fill: 'fill', stripes: 'stripes', off: false } as const;
const VIEW_MODES = ['day', 'week', 'month'];
const MAJOR_LINES = { preset: undefined, sprint: sprintLines, none: noLines } as const;
type DaysOff = keyof typeof DAYS_OFF;
type MajorLines = keyof typeof MAJOR_LINES;

function Select<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label>
      {label}{' '}
      <select
        value={value}
        onChange={(event) => {
          const next = choices.find((choice) => choice === event.target.value);
          if (next) onChange(next);
        }}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Example() {
  const chart = useRef<GanttHandle>(null);
  const [gridLines, setGridLines] = useState<(typeof GRID_LINES)[number]>(
    options.display.gridLines,
  );
  const [daysOff, setDaysOff] = useState<DaysOff>('fill');
  const [today, setToday] = useState<boolean>(options.display.today);
  const [headerRange, setHeaderRange] = useState<boolean>(options.display.headerRangeHighlight);
  const [major, setMajor] = useState<MajorLines>('preset');
  // `viewMode` is controlled by its prop: the chart shows the one your state holds.
  const [viewMode, setViewMode] = useState<string>(options.viewMode);
  const [look, setLook] = useState('library');

  return (
    <>
      <div role="toolbar">
        <Select label="Grid lines" value={gridLines} choices={GRID_LINES} onChange={setGridLines} />
        <Select
          label="Days off"
          value={daysOff}
          choices={['fill', 'stripes', 'off']}
          onChange={setDaysOff}
        />
        <Select label="View" value={viewMode} choices={VIEW_MODES} onChange={setViewMode} />
        <Select
          label="Major lines"
          value={major}
          choices={['preset', 'sprint', 'none']}
          onChange={setMajor}
        />
        <Select label="Look" value={look} choices={['library', 'violet']} onChange={setLook} />
        <label>
          <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} />{' '}
          Today
        </label>
        <label>
          <input
            type="checkbox"
            checked={headerRange}
            onChange={(e) => setHeaderRange(e.target.checked)}
          />{' '}
          Header range
        </label>
      </div>
      <Gantt
        ref={chart}
        style={{ height: 320 }}
        // The look is an attribute of the container; `styles.css` selects `[data-look] .gantt`.
        data-look={look}
        // In React `tasks`, `links` and `viewMode` are controlled props, and `defaultTasks` and
        // `defaultLinks` are where an uncontrolled chart starts (there is no `dataMode` prop).
        defaultTasks={tasks}
        defaultLinks={links}
        {...options}
        viewMode={viewMode}
        display={{
          gridLines,
          nonWorkingDays: DAYS_OFF[daysOff],
          today,
          headerRangeHighlight: headerRange,
        }}
        viewModes={MAJOR_LINES[major]}
        // Clicking a bar only reports it; selecting it is the application's call.
        onTaskClick={(record) => chart.current?.select([record.id])}
      />
      <p>
        gridLines: {gridLines} · nonWorkingDays: {String(DAYS_OFF[daysOff])} · today:{' '}
        {String(today)} · major lines: {major}. Click a bar to select it.
      </p>
    </>
  );
}

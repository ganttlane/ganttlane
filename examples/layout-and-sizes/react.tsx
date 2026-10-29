import '@ganttlane/react/styles.css';

import { Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { describe, FIXED_HEIGHT, type HeightKind, HEIGHTS, type Sizes, SLIDERS } from './helpers';
import { options } from './options';

export default function Example() {
  const [sizes, setSizes] = useState<Sizes>({
    rowHeight: options.layout.rowHeight,
    barHeight: options.layout.barHeight,
    barRadius: options.layout.barRadius,
    headerRowHeight: options.layout.headerRowHeight,
  });
  const [height, setHeight] = useState<HeightKind>('fixed');
  // In React `viewMode` is a controlled prop, and `defaultViewMode` is its uncontrolled twin: here
  // nothing changes the view mode, so the chart owns it and starts from the option.
  const { viewMode, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        {SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key}>
            {label}{' '}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={sizes[key]}
              style={{ width: '5.5rem' }}
              onChange={(event) => {
                setSizes({ ...sizes, [key]: Number(event.target.value) });
              }}
            />{' '}
            <output>{sizes[key]}</output>
          </label>
        ))}
        <label>
          Height{' '}
          <select
            value={height}
            onChange={(event) => {
              const kind = HEIGHTS.find((candidate) => candidate === event.target.value);
              if (kind) setHeight(kind);
            }}
          >
            {HEIGHTS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === 'auto' ? "'auto'" : FIXED_HEIGHT}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* The page: a box with a height of its own, which scrolls, as a page does. A chart with
          `layout.height: 'auto'` is as tall as its rows and the page scrolls it. */}
      <div style={{ height: 360, overflow: 'auto', border: '1px dashed currentColor' }}>
        <Gantt
          // This container has no height: the chart is given one by `layout.height`.
          // The chart owns the data (uncontrolled): these are where it starts.
          defaultTasks={tasks}
          defaultLinks={links}
          defaultViewMode={viewMode}
          {...rest}
          // `layout` is an ordinary prop: a changed field is applied with `setOptions`.
          layout={{ ...sizes, height: height === 'auto' ? 'auto' : FIXED_HEIGHT }}
        />
      </div>
      <p>{describe(sizes, height)}</p>
    </>
  );
}

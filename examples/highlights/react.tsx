import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt } from '@ganttlane/react';
import { useState } from 'react';

import { links, tasks } from './data';
import { describe } from './helpers';
import { FRIDAYS, HIGHLIGHTS, NON_WORKING_DAYS, options } from './options';

export default function Example() {
  const [nonWorking, setNonWorking] = useState(0);
  const [highlights, setHighlights] = useState<boolean>(options.display.highlights);
  const [fridays, setFridays] = useState(true);
  const [followCursor, setFollowCursor] = useState<boolean>(options.highlightTooltip.followCursor);
  const nonWorkingDays = NON_WORKING_DAYS[nonWorking]?.value ?? options.display.nonWorkingDays;
  // In React `viewMode` is a controlled prop, and `defaultViewMode` is its uncontrolled twin: here
  // nothing changes the view mode, so the chart owns it and starts from the option.
  const { viewMode, ...rest } = options;

  return (
    <>
      <div role="toolbar">
        <label>
          Non-working days{' '}
          <select
            value={nonWorking}
            onChange={(event) => {
              setNonWorking(Number(event.target.value));
            }}
          >
            {NON_WORKING_DAYS.map(({ label }, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={highlights}
            onChange={(event) => {
              setHighlights(event.target.checked);
            }}
          />{' '}
          Highlights
        </label>
        <label>
          <input
            type="checkbox"
            checked={fridays}
            onChange={(event) => {
              setFridays(event.target.checked);
            }}
          />{' '}
          Fridays
        </label>
        <label>
          <input
            type="checkbox"
            checked={followCursor}
            onChange={(event) => {
              setFollowCursor(event.target.checked);
            }}
          />{' '}
          Label follows the cursor
        </label>
      </div>
      <Gantt
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 340 }}
        // The chart owns the data (uncontrolled): these are where it starts.
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        // The same options as props: a new list or a changed field is applied with `setOptions`.
        highlights={fridays ? [...HIGHLIGHTS, FRIDAYS] : HIGHLIGHTS}
        display={{ nonWorkingDays, highlights }}
        highlightTooltip={{ followCursor }}
      />
      <p>{describe({ nonWorkingDays, highlights, fridays, followCursor })}</p>
    </>
  );
}

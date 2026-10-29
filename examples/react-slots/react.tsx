import '@ganttlane/react/styles.css';
import './styles.css';

import { Gantt, type GanttHandle } from '@ganttlane/react';
import { useRef, useState } from 'react';

import { links, type Meta, tasks } from './data';
import { DirectoryContext, TEAMS } from './directory';
import { options } from './options';
import { BarLabel, BrokenTooltip, CompactTooltip, FullTooltip, HandoffMenu } from './slots';

// Which function fills the tooltip slot. Each one has its own `slotKey` (see `slots.tsx`).
const TOOLTIPS = { full: FullTooltip, compact: CompactTooltip, throws: BrokenTooltip };

export default function Example() {
  // `Meta` is the type of `task.data`: the handle and every slot know it.
  const chart = useRef<GanttHandle<Meta>>(null);
  const [team, setTeam] = useState<keyof typeof TEAMS>('a');
  const [tooltip, setTooltip] = useState<keyof typeof TOOLTIPS>('full');
  const [status, setStatus] = useState('Click a bar for its tooltip, an arrow for its menu.');

  // `viewMode` is a controlled prop in React (the chart shows the one your state holds), and
  // nothing here changes it, so the chart starts from `defaultViewMode` and owns the mode;
  // `defaultTasks` and `defaultLinks` are where it starts with the data.
  const { viewMode, ...rest } = options;

  return (
    // The provider is above `<Gantt>`: the slots are drawn in its tree, so they read it.
    <DirectoryContext.Provider value={TEAMS[team]}>
      <div role="toolbar" aria-label="Slot options">
        <label>
          Team{' '}
          <select
            value={team}
            onChange={(event) => {
              setTeam(event.target.value === 'b' ? 'b' : 'a');
            }}
          >
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </label>
        <label>
          Tooltip{' '}
          <select
            value={tooltip}
            onChange={(event) => {
              const next = event.target.value;
              setTooltip(next === 'compact' || next === 'throws' ? next : 'full');
            }}
          >
            <option value="full">full</option>
            <option value="compact">compact</option>
            <option value="throws">throws</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            // Links that were removed from the menu: the handle puts the list back.
            chart.current?.setLinks(links);
            setStatus('The links are back.');
          }}
        >
          Restore links
        </button>
      </div>
      <Gantt
        ref={chart}
        // The chart fills its container and scrolls inside it, so the container needs a height.
        style={{ height: 380 }}
        defaultTasks={tasks}
        defaultLinks={links}
        defaultViewMode={viewMode}
        {...rest}
        // The slots: each returns a `ReactNode`, drawn through a portal into the tooltip, the menu
        // and the bars. They replace `tooltip.render`, `linkMenu.render` and `display.renderBarLabel`.
        renderTooltip={TOOLTIPS[tooltip]}
        renderLinkMenu={(context) => <HandoffMenu context={context} />}
        renderBarLabel={(context) => <BarLabel context={context} />}
        // What a slot throws while React renders it is reported here, with the name of the prop.
        onError={({ error, name }) => {
          setStatus(`onError (${name}): ${String(error)}`);
        }}
        // `remove()` in the menu goes through the chart, and the chart says so.
        onLinkDelete={(link) => {
          setStatus(`onLinkDelete: ${String(link.source)} to ${String(link.target)} removed.`);
        }}
      />
      <p>{status}</p>
    </DirectoryContext.Provider>
  );
}

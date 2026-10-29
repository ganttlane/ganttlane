import type { BarLabelContext, LinkMenuContext, TaskTooltipContext } from '@ganttlane/react';
import { useContext, useState } from 'react';

import type { Meta } from './data';
import { DirectoryContext } from './directory';

/** The person who owns a task: `data` is typed (`Meta`), the people come from the context. */
function useOwner(data: Meta | undefined) {
  const directory = useContext(DirectoryContext);
  return data && directory[data.owner];
}

// ---- The tooltip: three functions, one of which is picked at a time ----
//
// A function given as `renderTooltip` is called as the body of a component, once for the tooltip
// the chart is showing. So it may call hooks (`useContext`, `useState`), and they keep their
// state while the chart makes the tooltip again for the same task (a drag preview, a new
// progress). The chart is not told when the function is replaced.
//
// These three have different hooks, so each one says it is a component of its own (`slotKey`):
// switching from one to another starts the new one anew, and React has nothing to complain about.

/** Hooks: the context, and a state of its own (the watch button). */
export function FullTooltip(context: TaskTooltipContext<Meta>) {
  const { task, preview, isDragging, predecessors, api } = context;
  const owner = useOwner(task.task.data);
  const [watching, setWatching] = useState(false);
  const day = new Intl.DateTimeFormat(context.locale, { day: 'numeric', month: 'short' });
  // While a bar is dragged, `preview` says where it would land.
  const start = preview?.start ?? task.start;
  const end = preview?.end ?? task.end;
  const after = predecessors.flatMap((link) => api.getTask(link.source)?.name ?? []).join(', ');

  return (
    <div className="slots-card">
      <strong>{task.name}</strong>
      <span>{owner ? `${owner.name}, ${owner.role}` : 'Unassigned'}</span>
      {start && end ? (
        <span>
          {day.format(start)} to {day.format(end)}
          {isDragging ? ' (moving)' : ''}
        </span>
      ) : null}
      {after ? <span>After {after}</span> : null}
      <span className="slots-card__actions">
        <button
          type="button"
          aria-pressed={watching}
          onClick={() => {
            setWatching(!watching);
          }}
        >
          {watching ? 'Watching' : 'Watch'}
        </button>
        <button
          type="button"
          onClick={() => {
            api.hide();
          }}
        >
          Close
        </button>
      </span>
    </div>
  );
}
FullTooltip.slotKey = 'full';

/** Hooks: the context only. */
export function CompactTooltip(context: TaskTooltipContext<Meta>) {
  const owner = useOwner(context.task.task.data);
  return (
    <span>
      {context.task.name} ({owner?.initials ?? '?'})
    </span>
  );
}
CompactTooltip.slotKey = 'compact';

/** A tooltip that throws: the chart stays, the tooltip is hidden, and `onError` hears of it. */
export function BrokenTooltip(context: TaskTooltipContext<Meta>): never {
  throw new Error(`The tooltip of ${context.task.name} failed on purpose.`);
}
BrokenTooltip.slotKey = 'throws';

// ---- The link menu and the bar label: components, called with the context ----
//
// The other way to write a slot: the function only returns an element, and the logic is in a
// component, which may use hooks as any component does.

/** The menu a click on an arrow opens: who hands over to whom, and the remove button. */
export function HandoffMenu({ context }: { context: LinkMenuContext<Meta> }) {
  const { source, target, canRemove, api } = context;
  const from = useOwner(source?.task.data);
  const to = useOwner(target?.task.data);

  return (
    <div className="slots-card">
      <strong>
        {source?.name} to {target?.name}
      </strong>
      <span>
        {from?.name} hands over to {to?.name}
      </span>
      <span className="slots-card__actions">
        <button
          type="button"
          disabled={!canRemove}
          onClick={() => {
            context.remove();
          }}
        >
          Remove dependency
        </button>
        <button
          type="button"
          onClick={() => {
            api.hide();
          }}
        >
          Close
        </button>
      </span>
    </div>
  );
}

/** The label of a bar: the owner's initials, then the name. */
export function BarLabel({ context }: { context: BarLabelContext<Meta> }) {
  const owner = useOwner(context.task.data);
  return (
    <span className="slots-label">
      <span className="slots-label__owner">{owner?.initials ?? '?'}</span>
      {context.name}
    </span>
  );
}

import type { GanttOptions } from '@ganttlane/dom';

// The freeze: no task may end after Friday 3 April 2026. Dates inside a `ChangeSet` are floating
// wall-clock milliseconds (the time of the plan as if it were UTC), so this is the end of that
// day, exclusive.
const FREEZE = Date.parse('2026-04-04T00:00:00Z');

export const options = {
  // Runs for every change that is about to be committed: a drag, and `updateTask` (it sees
  // `reason: 'api'`). `false` cancels the change, and `updateTask` then resolves `cancelled`.
  onBeforeTaskChange: ({ changeSet }) => {
    return changeSet.changes.every((change) => change.after.endExclusive <= FREEZE);
  },
  viewMode: 'week',
  scroll: { initial: 'first-task' },
  // Smaller rows, so that every task is in view.
  layout: { rowHeight: 36, barHeight: 24 },
} satisfies Partial<GanttOptions>;

import type { Change, ChangeSet, Conflict, TaskId, TaskRecord } from '@ganttlane/core';

/** The values of `scheduling.propagation` that are available. */
export const PROPAGATION = ['preserve-lag', 'none'] as const;
export type Propagation = (typeof PROPAGATION)[number];

const DAY = 24 * 60 * 60 * 1000;

/** A length of time in days with its sign: `+2d`, `-1d`. */
function signedDays(ms: number): string {
  const days = ms / DAY;
  return `${days > 0 ? '+' : ''}${String(days)}d`;
}

/** How far a change moved a task: one number for a move, the edges that moved for a resize. */
function shift(change: Change): string {
  const start = change.after.start - change.before.start;
  const end = change.after.endExclusive - change.before.endExclusive;
  if (start === end) return signedDays(start);
  const edges = [];
  if (start !== 0) edges.push(`start ${signedDays(start)}`);
  if (end !== 0) edges.push(`end ${signedDays(end)}`);
  return edges.join(', ');
}

/**
 * The start of a task moved by some days, for `updateTask`: a `Date` with the same wall-clock time.
 *
 * @param record - The task, from `getTask`.
 * @param days - How many days to move it; negative is earlier.
 * @returns The new start, or `undefined` for a task without a bar.
 */
export function startMoved(record: TaskRecord | undefined, days: number): Date | undefined {
  const start = record?.start;
  if (!start) return undefined;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + days,
    start.getHours(),
    start.getMinutes(),
  );
}

/** The conflicts that say a link's gap is below its lag. */
export function brokenLinks(conflicts: readonly Conflict[]): readonly Conflict[] {
  return conflicts.filter((conflict) => conflict.type === 'link-violated');
}

/**
 * Says what a drag changed: the dragged task, the tasks the links moved with it, and the
 * conflicts of the result, each with the task it is drawn on.
 *
 * @param changeSet - What `onTasksChange` reports. Its dates are in core's floating milliseconds.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence for the status line.
 */
export function describe(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const [dragged, ...followers] = changeSet.changes;
  if (!dragged) return 'Nothing changed.';
  let text = `${changeSet.reason}: ${nameOf(dragged.id)} (${shift(dragged)}).`;
  text +=
    followers.length === 0
      ? ' No other task moved.'
      : ` Followed: ${followers.map((change) => `${nameOf(change.id)} (${shift(change)})`).join(', ')}.`;
  for (const conflict of changeSet.conflicts) {
    text += ` Conflict on ${nameOf(conflict.id)}: ${conflict.message}.`;
  }
  return text;
}

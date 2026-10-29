import type { Change, ChangeSet, TaskId } from '@ganttlane/core';

/** The four link types, and the corner radii (px) the example offers. */
export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const RADII = [0, 5, 10, 20];

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
 * Says what a drag changed: the dragged task, the tasks its links moved with it (grouped by how
 * far they moved), and the conflicts the result has (a link whose gap is below its lag).
 *
 * @param changeSet - What `onTasksChange` reports. Its dates are in core's floating milliseconds.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence for the status line.
 */
export function describe(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const [dragged, ...followers] = changeSet.changes;
  if (!dragged) return 'Nothing changed.';
  let text = `${changeSet.reason}: ${nameOf(dragged.id)} (${shift(dragged)}).`;
  // The tasks that followed, by how far each moved.
  const groups = new Map<string, string[]>();
  for (const change of followers) {
    const names = groups.get(shift(change)) ?? [];
    names.push(nameOf(change.id));
    groups.set(shift(change), names);
  }
  for (const [how, names] of groups) {
    text +=
      names.length > 3
        ? ` ${String(names.length)} followed (${how}).`
        : ` ${names.join(', ')} (${how}).`;
  }
  if (changeSet.conflicts.length > 0) {
    text += ` Conflict: ${changeSet.conflicts.map((conflict) => conflict.message).join('; ')}.`;
  }
  return text;
}

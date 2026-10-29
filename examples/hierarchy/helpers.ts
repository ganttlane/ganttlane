import type { Change, ChangeSet, TaskId } from '@ganttlane/core';

/** The values of `hierarchy.moveChildren`. */
export const MOVE_CHILDREN = ['all', 'following', 'none'] as const;
export type MoveChildren = (typeof MOVE_CHILDREN)[number];

/** The pins the second select offers: its label, and the value of `hierarchy.childAnchor` it sets. */
export const CHILD_ANCHORS = [
  { label: 'SS', anchor: 'SS' },
  { label: 'FF', anchor: 'FF' },
  { label: 'SS + FF', anchor: ['SS', 'FF'] },
] as const;

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
 * Says what a drag changed: the dragged task, the children that moved with it (grouped by how
 * far they moved), and the conflicts the result has (a child outside its phase).
 *
 * @param changeSet - What `onTasksChange` reports. Its dates are in core's floating milliseconds.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence for the status line.
 */
export function describe(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const [dragged, ...others] = changeSet.changes;
  if (!dragged) return 'Nothing changed.';
  let text = `${changeSet.reason}: ${nameOf(dragged.id)} (${shift(dragged)}).`;
  const groups = new Map<string, string[]>();
  for (const change of others) {
    const names = groups.get(shift(change)) ?? [];
    names.push(nameOf(change.id));
    groups.set(shift(change), names);
  }
  for (const [how, names] of groups) text += ` Followed: ${names.join(', ')} (${how}).`;
  if (others.length === 0 && dragged.cause === 'direct') text += ' No other task moved.';
  for (const conflict of changeSet.conflicts) {
    text += ` Conflict: ${nameOf(conflict.id)} ${conflict.message}.`;
  }
  return text;
}

/**
 * Says which phases are open.
 *
 * @param keys - What `onExpandedChange` reports: `'all'` or the ids of the open phases.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence for the status line.
 */
export function describeExpanded(
  keys: 'all' | readonly TaskId[],
  nameOf: (id: TaskId) => string,
): string {
  if (keys === 'all') return 'Open: every phase.';
  return keys.length === 0 ? 'Open: none.' : `Open: ${keys.map(nameOf).join(', ')}.`;
}

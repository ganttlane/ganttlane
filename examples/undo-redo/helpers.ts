import type { ChangeSet, Gantt, HistoryChangePayload, TaskId } from '@ganttlane/dom';

/** The limits of the select: the most actions the history keeps (100 is the default). */
export const LIMITS = [3, 5, 100] as const;

/**
 * Undoes until there is nothing left to undo.
 *
 * @param chart - The chart.
 * @returns How many actions it undid.
 */
export function undoAll(chart: Pick<Gantt, 'undo'>): number {
  let count = 0;
  while (chart.undo().status === 'undone') count += 1;
  return count;
}

/** A line for the status: what `onTasksChange` reported (its `reason` is `'undo'` or `'redo'` too). */
export function changeText({ reason, changes }: ChangeSet, nameOf: (id: TaskId) => string): string {
  return `onTasksChange (${reason}): ${changes.map((change) => nameOf(change.id)).join(', ')}.`;
}

/** A line for the status: what `onHistoryChange` reported. */
export function historyText({ canUndo, canRedo }: HistoryChangePayload): string {
  return `onHistoryChange: canUndo ${String(canUndo)}, canRedo ${String(canRedo)}.`;
}

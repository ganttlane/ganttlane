import type { ChangeSet, Gantt, HistoryChangePayload, TaskId } from '@ganttlane/dom';

/** The limits of the select: the most actions the history keeps (100 is the default). */
export const LIMITS = [3, 5, 100] as const;

/**
 * Which of undo and redo a key press asks for. The library has no hotkeys: a page decides what
 * its keys do, and calls `undo()` and `redo()`. Ctrl or Cmd with Z undoes, with Shift redoes.
 *
 * @param event - A `keydown` event.
 * @returns The action, or `undefined` for any other key.
 */
export function shortcutOf(event: KeyboardEvent): 'undo' | 'redo' | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') {
    return undefined;
  }
  return event.shiftKey ? 'redo' : 'undo';
}

/** Whether a key press comes from a field where Ctrl+Z belongs to the browser (a select, a text box). */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select') !== null;
}

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

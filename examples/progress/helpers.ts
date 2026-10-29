import type { TaskRecord } from '@ganttlane/core';

const day = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Says what a change did to the progress of a task, from what `onTaskProgressChange` reports: the
 * new percentage, and the date the done part reaches (`progressDate`, from the computed record).
 *
 * @param record - The task, as `onTaskProgressChange` gives it.
 * @param progress - Its new progress in percent (not rounded: `100 / 3` stays as it is).
 * @param reason - What the change was: `'progress'` (the handle), `'resize-start'`, `'resize-end'`.
 * @returns A sentence for the status line.
 */
export function describe(record: TaskRecord, progress: number, reason: string): string {
  const date = record.progressDate ? `, up to ${day.format(record.progressDate)}` : '';
  return `${reason}: ${record.name} is ${String(Math.round(progress))}% done${date}.`;
}

/**
 * Says what a change that did not touch the progress was: a move keeps the percentage.
 *
 * @param reason - What the change was.
 * @returns A sentence for the status line.
 */
export function describeUnchanged(reason: string): string {
  return `${reason}: the progress is as it was.`;
}

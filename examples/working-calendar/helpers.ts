import type { ChangeReason, TaskRecord } from '@ganttlane/core';

/** The values of `scheduling.durationMode`. */
export const DURATION_MODES = ['working', 'calendar'] as const;
export type DurationMode = (typeof DURATION_MODES)[number];

/** The three switches of `scheduling.skipNonWorkingDays`. */
export interface Skip {
  move: boolean;
  resize: boolean;
  progress: boolean;
}

const day = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Says where a task is after an edit, from its computed record: its first and last day, how long
 * it is in working and in calendar days, how much is done, and the conflicts it has (an edge on a
 * day off).
 *
 * @param record - The edited task, from `getTask`.
 * @param reason - What the edit was: `'move'`, `'resize-start'`, `'resize-end'`, `'progress'`, …
 * @returns A sentence for the status line.
 */
export function describe(record: TaskRecord | undefined, reason: ChangeReason): string {
  if (!record?.start || !record.end || !record.duration) return '';
  const { workingDays, calendarDays } = record.duration;
  let text = `${reason}: ${record.name}, ${day.format(record.start)} to ${day.format(record.end)}`;
  text += ` (${String(workingDays)} working days, ${String(calendarDays)} calendar days).`;
  if (reason === 'progress' && record.progressDate) {
    text += ` ${String(Math.round(record.progress))}% done, up to ${day.format(record.progressDate)}.`;
  }
  for (const conflict of record.conflicts) text += ` Conflict: ${conflict.message}.`;
  return text;
}

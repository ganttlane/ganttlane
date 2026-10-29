import type { ChangeSet, Task, TaskId, TaskRecord } from '@ganttlane/core';

import { tasks as original } from './data';

const DAY = 24 * 60 * 60 * 1000;

const day = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' });

/** What Hiring becomes when the button schedules it: a task of five days. */
const SCHEDULED: Task = {
  id: 'hiring',
  name: 'Hiring',
  parentId: 'backlog',
  start: '2026-03-20',
  duration: 5,
};

/**
 * Schedules Hiring (a placeholder row becomes a bar), or puts it back as it is in `data.ts`.
 * The tasks you pass are not changed: the result is a new array, to give to `setTasks`.
 *
 * @param list - The tasks you keep.
 * @returns The new list.
 */
export function toggleHiring(list: readonly Task[]): Task[] {
  const placeholder = original.find((task) => task.id === 'hiring');
  const now = list.find((task) => task.id === 'hiring');
  const replacement = now?.type === 'placeholder' ? SCHEDULED : placeholder;
  return replacement ? list.map((task) => (task.id === 'hiring' ? replacement : task)) : [...list];
}

/**
 * Says what a click found: the kind of the row, and where it is.
 *
 * @param record - The task that was clicked, from `onTaskClick`.
 * @returns A sentence for the status line.
 */
export function describeTask(record: TaskRecord): string {
  if (!record.start || !record.duration) return `${record.name}: a ${record.type} row, no bar.`;
  if (record.type === 'milestone') {
    return `${record.name}: a milestone on ${day.format(record.start)}, no length.`;
  }
  return `${record.name}: a task from ${day.format(record.start)}, ${String(record.duration.calendarDays)} days.`;
}

/**
 * Says what a drag changed: the dragged task and the tasks the links moved with it.
 *
 * @param changeSet - What `onTasksChange` reports. Its dates are in core's floating milliseconds.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence for the status line.
 */
export function describe(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const [dragged, ...followers] = changeSet.changes;
  if (!dragged) return 'Nothing changed.';
  const shift = (dragged.after.start - dragged.before.start) / DAY;
  let text = `${changeSet.reason}: ${nameOf(dragged.id)} (${shift > 0 ? '+' : ''}${String(shift)}d).`;
  if (followers.length > 0) {
    text += ` Followed: ${followers.map((change) => nameOf(change.id)).join(', ')}.`;
  }
  return text;
}

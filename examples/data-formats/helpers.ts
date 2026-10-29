import type { Link, Task, TaskRecord } from '@ganttlane/dom';

const day = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' });
const moment = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A value written the way the data file writes it: `'2026-03-16'`, `new Date(2026, 2, 16)`, `3`. */
function literal(value: unknown): string {
  if (value instanceof Date) {
    const parts = [value.getFullYear(), value.getMonth(), value.getDate()];
    if (value.getHours() !== 0 || value.getMinutes() !== 0) {
      parts.push(value.getHours(), value.getMinutes());
    }
    return `new Date(${parts.join(', ')})`;
  }
  if (typeof value === 'string') return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value).map(([key, item]) => `${key}: ${literal(item)}`);
    return `{ ${fields.join(', ')} }`;
  }
  return String(value);
}

/**
 * How a task was written, as the data file has it: its dates, its duration and precision, its
 * `dependencies`, and the entry of `links` that ends at it. `record.task` is the task you gave,
 * never changed by the chart.
 *
 * @param task - A task as given.
 * @param links - The links as given.
 * @returns The task's input, as source text.
 */
export function inputOf(task: Task, links: readonly Link[]): string {
  const written: string[] = [];
  for (const key of ['start', 'end', 'duration', 'precision', 'dependencies'] as const) {
    if (task[key] !== undefined) written.push(`${key}: ${literal(task[key])}`);
  }
  for (const link of links) {
    if (link.target === task.id) written.push(`links[]: ${literal(link)}`);
  }
  return written.join(', ');
}

/**
 * How the chart read a task, from its computed record: the precision, and the days or the
 * moments the task covers (`endExclusive` is the end of the half-open interval, whichever way
 * `end` was written).
 *
 * @param record - A task of the chart, or `undefined`.
 * @returns A sentence.
 */
export function describe(record: TaskRecord | undefined): string {
  if (!record?.start || !record.endExclusive || !record.duration) return '';
  if (record.precision === 'time') {
    const hours = Math.round(record.duration.calendarDays * 24);
    return `a timed task: ${moment.format(record.start)} to ${moment.format(record.endExclusive)} (${String(hours)} h)`;
  }
  const { endExclusive } = record;
  const last = new Date(
    endExclusive.getFullYear(),
    endExclusive.getMonth(),
    endExclusive.getDate() - 1,
  );
  const days = Math.round(record.duration.calendarDays);
  return `whole days: ${day.format(record.start)} to ${day.format(last)} (${String(days)} ${days === 1 ? 'day' : 'days'})`;
}

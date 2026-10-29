import type { TaskRecord } from '@ganttlane/dom';

const when = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Says where a task is, from its computed record: `Date`s with the wall-clock time the data says,
 * and the length counted in working days.
 *
 * @param record - A task of the chart, or `undefined`.
 * @returns A sentence.
 */
export function describe(record: TaskRecord | undefined): string {
  if (!record?.start || !record.endExclusive) return '';
  const days = record.duration?.workingDays;
  return `${record.name}: ${when.format(record.start)} to ${when.format(record.endExclusive)} (${String(days)} working days)`;
}

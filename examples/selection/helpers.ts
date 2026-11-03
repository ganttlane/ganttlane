import type { LinkRecord, TaskId, TaskRecord } from '@ganttlane/dom';

/** A label and a value of the side panel. */
export type Field = readonly [label: string, value: string];

/** A date as `2026-03-16` (the dates of a record are `Date`s with the task's own wall clock). */
const day = (date: Date | undefined): string =>
  date === undefined ? '–' : date.toLocaleDateString('en-CA');

/**
 * What the side panel shows of a task: the record `getTask(id)` returns, as lines of text.
 *
 * @param record - The record of a task.
 * @param nameOf - The name of a task from its id.
 * @returns A label and a value for each line.
 */
export function taskFields(record: TaskRecord, nameOf: (id: TaskId) => string): Field[] {
  return [
    ['Dates', `${day(record.start)} to ${day(record.end)}`],
    ['Length', `${record.duration?.workingDays ?? 0} working days`],
    ['Progress', `${record.progress}%`],
    ['Parent', record.parentId === undefined ? '–' : nameOf(record.parentId)],
    ['Children', record.childIds.length === 0 ? '–' : record.childIds.map(nameOf).join(', ')],
    ['Conflicts', String(record.conflicts.length)],
  ];
}

/**
 * What the side panel shows of a selected link: the record `getLink(id)` returns.
 *
 * @param record - The record of a link.
 * @returns A label and a value for each line.
 */
export function linkFields(record: LinkRecord): Field[] {
  return [
    ['Type', record.type],
    ['Gap', `${record.lag?.days ?? 0} days${record.lag?.derived === true ? ' (as it is)' : ''}`],
    ['Removable', record.editable ? 'yes' : 'no (editable: false)'],
  ];
}

/** A line for the status: what `onSelectionChange` reported. */
export function selectionText(keys: readonly TaskId[], link: string | undefined): string {
  return `selectedKeys: [${keys.join(', ')}]; selectedLink: ${link ?? 'none'}`;
}

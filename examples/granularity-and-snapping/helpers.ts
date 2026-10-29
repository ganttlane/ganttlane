import type { ChangeReason, Issue, SnapRule, TaskId, TaskRecord } from '@ganttlane/core';

/** The view modes the buttons switch to. */
export const VIEW_MODES = ['hour', 'quarter-day', 'day'] as const;

/** The data steps the first select offers. */
export const GRANULARITIES = ['15min', '30min', '1h'] as const;

/** The values of `scheduling.alignInput`. */
export const ALIGN_INPUTS = ['expand', 'nearest', 'reject'] as const;
export type AlignInput = (typeof ALIGN_INPUTS)[number];

/** What the snap select offers: its label, and the `scheduling.snap` it sets (`undefined`: the view mode's). */
export const SNAPS = [
  { label: "view mode's", snap: undefined },
  { label: '15min', snap: '15min' },
  { label: '30min', snap: '30min' },
  { label: '1h', snap: '1h' },
  { label: '1d', snap: '1d' },
  { label: 'off', snap: false },
] as const;

const when = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The time of day of a floating ISO string (`'2026-03-09T10:10'`), or `'?'` for anything else. */
function timeOf(value: unknown): string {
  return typeof value === 'string' && value.includes('T') ? value.slice(11, 16) : '?';
}

/**
 * Names a snap step: `15min`, `1h`, `1d`, or `off`.
 *
 * @param rule - A resolved step, from the snapshot: `state.derived.snap.snap.move`.
 * @returns A short name.
 */
export function stepName(rule: SnapRule): string {
  if (rule === false) return 'off';
  if (rule.kind === 'calendar') return `${String(rule.count)} ${rule.unit}`;
  const minutes = rule.ms / 60_000;
  if (minutes % 1440 === 0) return `${String(minutes / 1440)}d`;
  return minutes % 60 === 0 ? `${String(minutes / 60)}h` : `${String(minutes)}min`;
}

/**
 * Says what the issues of the data are: the code, the task, the edge, the value it had and the one
 * it was aligned to (`suggested`; with `'reject'` it is only a suggestion).
 *
 * @param issues - `getIssues().data`, or what the `issues` event reports for `'data'`.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence, or `'No issues.'`.
 */
export function describeIssues(issues: readonly Issue[], nameOf: (id: TaskId) => string): string {
  if (issues.length === 0) return 'No issues.';
  const items = issues.slice(0, 3).map((issue) => {
    const edge = issue.path?.split('.').at(-1) ?? '';
    const name = issue.taskId === undefined ? '' : `${nameOf(issue.taskId)} `;
    const text = `${issue.code}, ${name}${edge} ${timeOf(issue.value)} → ${timeOf(issue.suggested)}`;
    return issue.severity === 'error' ? `${text} (rejected)` : text;
  });
  const more = issues.length > 3 ? `; and ${String(issues.length - 3)} more` : '';
  return `${String(issues.length)} issues: ${items.join('; ')}${more}.`;
}

/**
 * Says where a task is after an edit, from its computed record.
 *
 * @param record - The edited task, from `getTask`.
 * @param reason - What the edit was: `'move'`, `'resize-start'`, `'resize-end'`, …
 * @returns A sentence.
 */
export function describeEdit(record: TaskRecord | undefined, reason: ChangeReason): string {
  if (!record?.start || !record.endExclusive) return '';
  return `${reason}: ${record.name}, ${when.format(record.start)} to ${when.format(record.endExclusive)}.`;
}

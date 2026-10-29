import type { Issue } from '@ganttlane/core';

/** The two lists of `getIssues()`, and of the `issues` event that carries their name as `source`. */
export type Found = Record<'data' | 'options', readonly Issue[]>;

/** The ids a cycle names: `taskIds` and `linkIds` are fields of that one kind of issue. */
function idsOf(issue: Issue, key: 'taskIds' | 'linkIds'): string[] {
  const ids: unknown = Reflect.get(issue, key);
  return Array.isArray(ids) ? ids.map(String) : [];
}

/** A value for a sentence: a string in quotes, anything else as it is written. */
function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Says where an issue is: its `path` (`tasks[2].end`, `links[1]`, `scheduling.propagation`) and
 * the task or link it belongs to. A cycle has no path but names the tasks that are in it.
 *
 * @param issue - One of `getIssues().data` or `.options`.
 * @returns A short text.
 */
export function locationOf(issue: Issue): string {
  const where = issue.path ?? `tasks ${idsOf(issue, 'taskIds').join(', ')}`;
  if (issue.taskId !== undefined) return `${where} (task ${String(issue.taskId)})`;
  return issue.linkId === undefined ? where : `${where} (link ${issue.linkId})`;
}

/**
 * Says what the chart found in the value, and what it did about it: `value` is what you gave, and
 * `suggested` what it used or would use instead.
 *
 * @param issue - One of `getIssues().data` or `.options`.
 * @returns A short text; empty when the issue carries no value.
 */
export function detailOf(issue: Issue): string {
  if (!('value' in issue)) return '';
  const given = `you gave ${show(issue.value)}`;
  return 'suggested' in issue ? `${given}, instead: ${show(issue.suggested)}` : given;
}

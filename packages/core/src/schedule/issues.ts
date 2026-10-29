import type { TaskId } from '../model';
import { DEV, type Issue, type IssueSeverity, shortMessage } from '../shared';

/**
 * Issue codes produced by the dependency graph (FR-LINK-7, FR-DATA-4).
 *
 * - `'unknown-link-task'` (error): the source or target matches no task; the link is dropped;
 * - `'self-link'` (error): source and target are the same task; the link is dropped;
 * - `'duplicate-link'` (error): another link has the same source, target and type; the later
 *   one is dropped;
 * - `'inactive-link'` (warning): the source or target has no bar (a placeholder or an invalid
 *   task); the link is kept but neither drawn nor propagated;
 * - `'cycle'` (error): links form a cycle; they are kept and drawn, but scheduling ignores them.
 */
export type ScheduleIssueCode =
  'unknown-link-task' | 'self-link' | 'duplicate-link' | 'inactive-link' | 'cycle';

/** An {@link Issue} raised by the `schedule` module. */
export interface ScheduleIssue extends Issue<ScheduleIssueCode> {
  /** For `'cycle'`: the tasks of the cycle, in model order. */
  readonly taskIds?: readonly TaskId[];
  /** For `'cycle'`: the links between those tasks, in model order. */
  readonly linkIds?: readonly string[];
}

/** Optional fields of a {@link ScheduleIssue}. */
interface IssueExtras {
  readonly path?: string | undefined;
  readonly taskId?: TaskId | undefined;
  readonly linkId?: string | undefined;
  readonly value?: unknown;
  readonly taskIds?: readonly TaskId[];
  readonly linkIds?: readonly string[];
}

/**
 * Builds a frozen schedule issue whose message starts with the path when there is one, leaving
 * out the extras that are `undefined`. `message` is the development text (pass
 * `DEV ? text : ''`); production keeps the short form.
 *
 * @internal
 */
export function scheduleIssue(
  code: ScheduleIssueCode,
  severity: IssueSeverity,
  message: string,
  extras: IssueExtras,
): ScheduleIssue {
  const { path, taskId, linkId, taskIds, linkIds } = extras;
  const issue: { -readonly [K in keyof ScheduleIssue]: ScheduleIssue[K] } = {
    code,
    severity,
    message: !DEV ? shortMessage(code, path) : path === undefined ? message : `${path}: ${message}`,
  };
  if (path !== undefined) issue.path = path;
  if (taskId !== undefined) issue.taskId = taskId;
  if (linkId !== undefined) issue.linkId = linkId;
  if ('value' in extras) issue.value = extras.value;
  if (taskIds !== undefined) issue.taskIds = Object.freeze(taskIds);
  if (linkIds !== undefined) issue.linkIds = Object.freeze(linkIds);
  return Object.freeze(issue);
}

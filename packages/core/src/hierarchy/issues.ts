import type { TaskId } from '../model';
import { DEV, type Issue, type IssueSeverity, shortMessage } from '../shared';

/**
 * Issue codes produced by `buildHierarchy` (FR-ROW-1, FR-DATA-4):
 * - `'unknown-parent'` (warning): `parentId` matches no task; the task is shown as a root;
 * - `'parent-cycle'` (error): parent links form a loop (`a → b → a`, or a task that is its own
 *   parent). `value` lists the members; the member that comes first in the input becomes a
 *   root, the others keep their parents;
 * - `'invalid-parent-anchor'` (warning): `parentAnchor` (or the `childAnchor` option, with the
 *   option's path `'hierarchy.childAnchor'`) is not a link type, is empty, or pins one child
 *   edge twice (`['SS', 'FS']`). Such entries are ignored; when none is left, the default is
 *   used. `suggested` is the applied anchor.
 */
export type HierarchyIssueCode = 'unknown-parent' | 'parent-cycle' | 'invalid-parent-anchor';

/** An {@link Issue} raised by the `hierarchy` module. */
export type HierarchyIssue = Issue<HierarchyIssueCode>;

/**
 * Builds a frozen hierarchy issue. `path` is the field of the task (`'parentId'`) or the
 * option's path (`'hierarchy.childAnchor'`); the message starts with the owner. `message` is the
 * development text (pass `DEV ? text : ''`); production keeps the short form.
 *
 * @internal
 */
export function hierarchyIssue(
  code: HierarchyIssueCode,
  severity: IssueSeverity,
  path: string,
  taskId: TaskId | undefined,
  message: string,
  value: unknown,
  suggested?: unknown,
): HierarchyIssue {
  const issue: { -readonly [K in keyof HierarchyIssue]: HierarchyIssue[K] } = {
    code,
    severity,
    message: !DEV
      ? shortMessage(code, path)
      : taskId === undefined
        ? `${path}: ${message}`
        : `task ${show(taskId)}: ${message}`,
    path,
    value,
  };
  if (taskId !== undefined) issue.taskId = taskId;
  if (suggested !== undefined) issue.suggested = suggested;
  return Object.freeze(issue);
}

/**
 * A value for a message: strings quoted, objects and functions by kind, the rest as `String()`.
 *
 * @internal
 */
export function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return 'a function';
  return typeof value === 'object' && value !== null ? 'an object' : String(value);
}

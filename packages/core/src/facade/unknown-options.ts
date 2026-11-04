/**
 * The warning about an option the core does not know, for the development build only (the
 * facade calls it under `DEV`, so the production bundle holds neither this code nor the table
 * of old names it reads). The hints are about frappe-gantt: its option names are the ones people
 * bring along.
 */

import { removedFrappeReason, renamedFrappeName } from '../migration';
import type { Issue } from '../shared';

/**
 * The warning for an option key that is not an option of the core: `'unknown-option'`, severity
 * `'warning'`, with a hint when the key is a name from frappe-gantt.
 *
 * @param key - The key as given.
 * @param value - Its value.
 * @returns The issue.
 * @internal
 */
export function unknownOption(key: string, value: unknown): Issue<'unknown-option'> {
  const renamed = renamedFrappeName(key);
  const removed = removedFrappeReason(key);
  const hint =
    renamed !== undefined
      ? `is an option of frappe-gantt; here it is ${renamed}. fromFrappeGanttOptions of "@ganttlane/core/migrate" converts a whole object`
      : removed !== undefined
        ? `is an option of frappe-gantt that ganttlane does not have: ${removed}`
        : 'is not an option of the core, it is ignored (display, tooltip and the other options of the renderer are for createGantt)';
  return Object.freeze({
    code: 'unknown-option',
    severity: 'warning',
    message: `${key}: ${hint}`,
    path: key,
    value,
  });
}

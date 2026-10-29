/**
 * Framework-free text of an edit session (`gantt.edit`), shared by the vanilla and React pages:
 * what Save, Cancel and the changes panel say.
 */

import type { SessionChanges } from '@ganttlane/core';

/** Floating wall-clock milliseconds as `YYYY-MM-DD HH:mm`. */
const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The changes of an edit session in words: one line per task, then the links.
 *
 * @param changes - `edit.getChanges()`, or what `edit.commit()` / `edit.rollback()` returned.
 * @returns The lines, or `no changes`.
 */
export function describeChanges(changes: SessionChanges): string {
  const lines = changes.changes.map(({ id, before, after }) => {
    const span = (patch: typeof before): string =>
      `${stamp(patch.start)} – ${stamp(patch.endExclusive)} ${String(patch.progress)}%`;
    return `${String(id)}: ${span(before)} → ${span(after)}`;
  });
  const { added, removed } = changes.links;
  if (added.length > 0) lines.push(`links added: ${String(added.length)}`);
  if (removed.length > 0) lines.push(`links removed: ${String(removed.length)}`);
  return lines.length > 0 ? lines.join('\n') : 'no changes';
}

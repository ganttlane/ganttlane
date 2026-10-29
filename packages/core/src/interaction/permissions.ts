/**
 * The editing permission matrix: the global `editing` option, the per-task
 * `editable` override, `locked`, `fixedDuration`, `linkable` and the task kind, resolved into
 * what the UI may do with one task.
 */

import type { EditingFlags, TaskModel } from '../model';
import { isObject } from '../shared';
import type { EditingOption, ResolvedEditing } from './types';

/** What the UI may do with one task (see {@link resolvePermissions}). Frozen. */
export interface TaskPermissions {
  /** Drag the whole bar. */
  readonly move: boolean;
  /** Drag either edge. */
  readonly resize: boolean;
  /** Drag the progress handle. */
  readonly progress: boolean;
  /** Draw links from and to the task (both ends of a new link need it). */
  readonly link: boolean;
}

/** What {@link resolvePermissions} reads from a task: `TaskModel` fits. */
export type PermissionSource = Pick<TaskModel, 'type' | 'span' | 'task'>;

const NONE: TaskPermissions = /* @__PURE__ */ Object.freeze({
  move: false,
  resize: false,
  progress: false,
  link: false,
});

/**
 * The global `editing` option with every flag spelled out: `false` turns every flag
 * off, `true` or `undefined` on, an object per flag (omitted ones are on, only `false` turns one
 * off). Pure; the result is frozen and accepted wherever an `EditingOption` is.
 *
 * @param editing - The `editing` option; default `true`.
 * @returns The four flags.
 *
 * @example
 * ```ts
 * resolveEditing({ resize: false }); // → { move: true, resize: false, progress: true, links: true }
 * ```
 */
export function resolveEditing(editing?: EditingOption): ResolvedEditing {
  const flag = (key: keyof EditingFlags): boolean =>
    isObject(editing) ? editing[key] !== false : editing !== false;
  return Object.freeze({
    move: flag('move'),
    resize: flag('resize'),
    progress: flag('progress'),
    links: flag('links'),
  });
}

/**
 * Resolves the editing permissions of a task. Pure; never throws, also on malformed
 * input fields (only `true` and `false` count).
 *
 * 1. **Flags.** The global `editing`: `false` turns everything off, `true` or `undefined` on, an
 *    object per flag (`move`, `resize`, `progress`, `links`; omitted ones are on). The task's
 *    `editable` **overrides** it: `false` turns everything off, `true` everything on, an object
 *    per given flag (so `editable: { move: true }` allows moving in a read-only chart).
 * 2. **The task.** Without a bar (placeholder, invalid, unknown) nothing is allowed. `locked`
 *    forbids move, resize and progress, but not links. `fixedDuration` and milestones cannot be
 *    resized; milestones have no progress handle. `linkable: false` forbids links.
 *
 * @param task - The task's model; `undefined` for an unknown task.
 * @param editing - The global `editing` option; default `true`.
 * @returns The frozen permissions.
 *
 * @example
 * ```ts
 * resolvePermissions(model.taskById.get('design'), { resize: false });
 * // → { move: true, resize: false, progress: true, link: true }
 * ```
 */
export function resolvePermissions(
  task: PermissionSource | undefined,
  editing?: EditingOption,
): TaskPermissions {
  if (task?.span === undefined || task.type === 'placeholder') return NONE;
  const input = task.task;
  const own: unknown = input.editable;
  const flags = (key: keyof EditingFlags): boolean => {
    if (typeof own === 'boolean') return own;
    const local = isObject(own) ? own[key] : undefined;
    if (typeof local === 'boolean') return local;
    return isObject(editing) ? editing[key] !== false : editing !== false;
  };
  const editable = input.locked !== true;
  const milestone = task.type === 'milestone';
  return Object.freeze({
    move: editable && flags('move'),
    resize: editable && !milestone && input.fixedDuration !== true && flags('resize'),
    progress: editable && !milestone && flags('progress'),
    link: input.linkable !== false && flags('links'),
  });
}

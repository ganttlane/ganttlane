/**
 * The keyboard's edit: an edge moved by one snap step, with the rules of the same drag.
 */

import type { TaskId } from '../model';
import { effectiveSnapRule } from '../scale';
import type { ChangeSet } from '../schedule';
import type { DateTimeMs } from '../time';
import { type DatedTask, editChangeSet, snapEdit } from './edit';
import { refusalOf } from './machine';
import type { InteractionContext, RefusalReason } from './types';

/** What a nudge changes: the whole task, or one of its edges. */
export type NudgeGesture = 'move' | 'resize-start' | 'resize-end';

/**
 * The change set of a nudge, `undefined` when nothing would change (a resize at its minimum
 * length), or why the nudge is not allowed.
 */
export type NudgeOutcome =
  { readonly refused: RefusalReason } | { readonly changeSet: ChangeSet | undefined };

/**
 * Moves an edge to the next snap boundary in `direction`, what dragging it a step would do: the
 * same snapping, skipped non-working days, minimum length and propagation, the same permissions.
 * A position half a step beyond the edge snaps to the boundary next to it, from a boundary and
 * from between two.
 *
 * @param gesture - Which edge moves; `'move'` moves both.
 * @param id - The task.
 * @param direction - `-1` earlier, `1` later.
 * @param context - What a gesture reads.
 * @returns The change set, or the refusal.
 */
export function nudge(
  gesture: NudgeGesture,
  id: TaskId,
  direction: -1 | 1,
  context: InteractionContext,
): NudgeOutcome {
  // Not one of the three, or not one step: nothing to do (a `progress` or a link would be a gesture).
  // The types say it cannot happen; a caller without them can.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const known = gesture === 'move' || gesture === 'resize-start' || gesture === 'resize-end';
  if (!known || direction ** 2 !== 1) return { changeSet: undefined };
  const refused = refusalOf(context, gesture, id);
  if (refused !== undefined) return { refused };
  const task = context.model.taskById.get(id) as DatedTask;
  const origin = gesture === 'resize-end' ? task.span.endExclusive : task.span.start;
  const { snap, adapter } = context;
  const step = effectiveSnapRule(snap[gesture === 'move' ? 'move' : 'resize'], {
    ...snap,
    precision: task.precision,
  });
  const length =
    step.kind === 'fixed'
      ? step.ms
      : direction * (adapter.add(origin, direction * step.count, step.unit) - origin);
  const raw = (origin + direction * (length / 2 + 1)) as DateTimeMs;
  const value = snapEdit(gesture, task, origin, raw, context, false);
  return { changeSet: value === origin ? undefined : editChangeSet(gesture, task, value, context) };
}

/**
 * The keyboard's edit: an edge moved by one snap step, with the rules of the same drag.
 */

import type { TaskId } from '../model';
import { effectiveSnapRule } from '../scale';
import type { ChangeSet } from '../schedule';
import { asDateTimeMs, type DateTimeMs } from '../time';
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
  const refused = refusalOf(context, gesture, id);
  if (refused !== undefined) return { refused };
  const task = context.model.taskById.get(id) as DatedTask;
  const origin = gesture === 'resize-end' ? task.span.endExclusive : task.span.start;
  const { snap, adapter } = context;
  const step = effectiveSnapRule(snap[gesture === 'move' ? 'move' : 'resize'], {
    precision: task.precision,
    granularity: snap.granularity,
    keepDayPrecision: snap.keepDayPrecision,
  });
  const length =
    step.kind === 'fixed'
      ? step.ms
      : Math.abs(adapter.add(origin, direction * step.count, step.unit) - origin);
  const raw: DateTimeMs = asDateTimeMs(origin + direction * (length / 2 + 1));
  const value = snapEdit(gesture, task, origin, raw, context, false);
  return { changeSet: value === origin ? undefined : editChangeSet(gesture, task, value, context) };
}

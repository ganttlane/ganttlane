/**
 * What a date gesture (move, resize, progress) does to the model for a dragged edge: snapping
 * per gesture, the minimum length of a resize, the progress handle with skipped
 * non-working days, and the live propagation preview.
 */

import type { TaskModel, TaskSpan } from '../model';
import { progressFromDate } from '../progress';
import {
  clampResize,
  effectiveSnapRule,
  type SnapContext,
  type SnapDirection,
  type SnapEdge,
  type SnapInteraction,
  snapTime,
} from '../scale';
import { type ChangeSet, type Conflict, propagate, type TaskPatch } from '../schedule';
import type { DateTimeMs } from '../time';
import type { InteractionContext } from './types';

/** A gesture that changes a task's dates or progress. */
export type DateGesture = 'move' | 'resize-start' | 'resize-end' | 'progress';

/** A task with a bar. */
export type DatedTask = TaskModel & { readonly span: TaskSpan };

const NO_CONFLICTS: readonly Conflict[] = /* @__PURE__ */ Object.freeze([]);

/**
 * The value a date gesture puts the task at when its edge is dragged to `raw`: the snapped start
 * (`'move'`, `'resize-start'`), exclusive end (`'resize-end'`) or the progress in percent.
 *
 * The step is the gesture's rule of `context.snap` (`false`, the data step, with `alt`) raised for
 * day-precision tasks unless `keepDayPrecision` is off (`snapTime`); `'relative'` snapping counts
 * from the edge at the start of the drag (`origin`). The direction (ties, skipped days) is the side
 * of `raw` relative to `origin`, so the result depends on the pointer position only, not on its
 * history. Moves skip non-working days by default and resizes do not, in the direction of the drag.
 *
 * A resize keeps one step at least: the edge is snapped (and rolled), then clamped to
 * the minimum. When skipping put the edge past the minimum and the clamp leaves it on non-working
 * time, it is rolled back onto the last working position short of the minimum (away from the
 * fixed edge, keeping the time of day); when that would carry it back past `origin`
 * against the drag, the edge stays at `origin` (no change).
 *
 * Progress snaps to its rule, then `progressFromDate` clamps it to the bar and, unless
 * `skipNonWorkingDays.progress` is `false`, leaves non-working stretches in the drag direction.
 * A progress date equal to `origin` (the task's `progressDate`) keeps the task's
 * own progress, so a drag back onto the handle changes nothing even when the progress is not on
 * an aligned date.
 */
export function snapEdit(
  gesture: DateGesture,
  task: DatedTask,
  origin: DateTimeMs,
  raw: DateTimeMs,
  context: InteractionContext,
  alt: boolean,
): number {
  const { snap, adapter, model } = context;
  const { span } = task;
  const { calendar } = model.options;
  const skip = context.propagation?.skipNonWorkingDays;
  const interaction: SnapInteraction =
    gesture === 'move' || gesture === 'progress' ? gesture : 'resize';
  const rule = alt ? false : snap[interaction];
  const direction = Math.sign(raw - origin) as SnapDirection;
  const base: SnapContext = {
    rule,
    mode: snap.mode,
    origin,
    direction,
    adapter,
    calendar,
    precision: task.precision,
    granularity: snap.granularity,
    keepDayPrecision: snap.keepDayPrecision,
    skipNonWorking: interaction === 'move' ? skip?.move !== false : skip?.resize === true,
  };
  const minStep = (): ReturnType<typeof effectiveSnapRule> => effectiveSnapRule(rule, base);
  /** A clamped resize edge settled onto working time short of the minimum (see above). */
  const settle = (snapped: DateTimeMs, clamped: DateTimeMs, edge: SnapEdge): DateTimeMs => {
    if (clamped === snapped || base.skipNonWorking !== true) return clamped;
    // Away from the fixed edge: back for a start, forward for an end.
    const away = edge === 'start' ? -1 : 1;
    const rolled = calendar.rollToWorking(clamped, away, { edge, keepTimeOfDay: true });
    if (rolled === undefined) return clamped;
    const past = (rolled - origin) * away > 0 && (clamped - origin) * away <= 0;
    return past ? origin : rolled;
  };
  switch (gesture) {
    case 'move':
      return snapTime(raw, base);
    case 'resize-start': {
      const start = snapTime(raw, base);
      const edges = { start, end: span.endExclusive, edge: 'start', adapter } as const;
      return settle(start, clampResize({ ...edges, minStep: minStep() }).start, 'start');
    }
    case 'resize-end': {
      const end = snapTime(raw, { ...base, edge: 'end' });
      const edges = { start: span.start, end, edge: 'end', adapter } as const;
      return settle(end, clampResize({ ...edges, minStep: minStep() }).end, 'end');
    }
    case 'progress': {
      const boundary = progressFromDate({
        start: span.start,
        endExclusive: span.endExclusive,
        mode: task.durationMode,
        calendar,
        t: snapTime(raw, { ...base, skipNonWorking: false }),
        granularity: model.options.granularity,
        direction,
        skipNonWorking: skip?.progress !== false,
      });
      // Back on the handle: the task's own progress, which may lie between aligned dates.
      return boundary.progressDate === origin ? task.progress : boundary.progress;
    }
  }
}

/**
 * The change set of a date gesture at `value` (from {@link snapEdit}): `propagate` with
 * `conflicts: false` for move and resize (successors and children move in the preview), a
 * single direct change for progress. Empty when nothing changes. `propagate` gets the snap's
 * `keepDayPrecision`, so a day-precision task dragged to a time of day without it becomes a
 * timed task (`after.precision: 'time'`).
 */
export function editChangeSet(
  gesture: DateGesture,
  task: DatedTask,
  value: number,
  context: InteractionContext,
): ChangeSet {
  const { id } = task;
  if (gesture === 'progress') {
    const before = patchOf(task);
    const changes =
      value === task.progress
        ? []
        : [
            Object.freeze({
              id,
              before,
              after: Object.freeze({ ...before, progress: value }),
              cause: 'direct' as const,
            }),
          ];
    return Object.freeze({
      reason: 'progress',
      changes: Object.freeze(changes),
      conflicts: NO_CONFLICTS,
    });
  }
  const at = value as DateTimeMs;
  const command =
    gesture === 'resize-end'
      ? { kind: gesture, id, endExclusive: at }
      : { kind: gesture, id, start: at };
  return propagate(command, {
    model: context.model,
    hierarchy: context.hierarchy,
    graph: context.graph,
    options: {
      ...context.propagation,
      keepDayPrecision: context.snap.keepDayPrecision,
      conflicts: false,
    },
  });
}

/** The task's committed values, frozen. */
export function patchOf(task: DatedTask): TaskPatch {
  const { start, endExclusive } = task.span;
  return Object.freeze({ start, endExclusive, progress: task.progress });
}

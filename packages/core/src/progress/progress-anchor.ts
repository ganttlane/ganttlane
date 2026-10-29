/**
 * Progress anchoring: what happens to a task's progress when it is resized or moved.
 * The schedule calls {@link rebaseProgress} with the old and the new span of every changed task.
 */

import type { WorkCalendar } from '../calendar';
import type { Granularity } from '../time';
import {
  clampProgress,
  type ProgressBoundary,
  type ProgressBounds,
  type ProgressSpan,
  progressToDate,
} from './progress-date';

/**
 * Which part of the work a resize keeps (`task.progressAnchor`):
 * `'start'` keeps the completed amount, `'end'` keeps the unfinished remainder.
 */
export type ProgressAnchor = 'start' | 'end';

/** Input of {@link rebaseProgress}. */
export interface RebaseProgressInput {
  /** Progress in percent on the old span; clamped to `0` … `100`, `NaN` counts as `0`. */
  readonly progress: number;
  /** The span before the change. */
  readonly from: ProgressBounds;
  /** The span after the change; the result is measured along it. */
  readonly to: ProgressBounds;
  /** What stays constant, default `'start'` (the completed amount). */
  readonly anchor?: ProgressAnchor | undefined;
  /** The task's `durationMode`: amounts are calendar or working time (see {@link ProgressSpan}). */
  readonly mode: ProgressSpan['mode'];
  /** The work calendar, used in `'working'` mode. */
  readonly calendar: WorkCalendar;
  /** The data step the new progress date is aligned down to. */
  readonly granularity: Granularity;
}

/**
 * The progress of a task after its span changed from `from` to `to`, with the
 * progress date on the new span.
 *
 * Amounts are measured like {@link ProgressSpan}: in working time in `'working'` mode, in calendar
 * time otherwise. When either span has no working time, both are measured in calendar time.
 *
 * - `anchor: 'start'` (default) keeps the **completed amount**:
 *   `progress × from / to`. The boundary stays the same distance of work after the start, so it
 *   moves with a resized start and stays put when the end is resized.
 * - `anchor: 'end'` keeps the **unfinished remainder**:
 *   `100 − (100 − progress) × from / to`. The boundary stays the same distance of work before the
 *   end, so it moves with a resized end and stays put when the start is resized; a span stretched
 *   past its plan shows the overrun as done work.
 * - A span with the same measured length, such as a pure move (the end follows the start in the
 *   task's mode), keeps the percentage exactly; identical spans are the identity.
 * - The result is clamped to `0` … `100`: shrinking below the completed amount (`'start'`) gives
 *   `100`, below the remainder (`'end'`) gives `0`. `100 %` stays `100 %` with `'end'` and `0 %`
 *   stays `0 %` with `'start'`.
 * - The percentage is **not** quantized (the data keeps its exact value), so repeated
 *   resizes do not drift; only `progressDate` is aligned down to `granularity`.
 *
 * Zero-length spans (milestones) hold no amount of work. From a zero-length span the percentage
 * is kept (clamped). To a zero-length span from a longer one, progress becomes binary for both
 * anchors: `100` when the task was complete, `0` otherwise.
 *
 * @param input - Progress, old and new span, anchor, mode, calendar and data step.
 * @returns The new progress and its date on `to`.
 *
 * @example
 * ```ts
 * // Calendar mode, 5 days at 40 % (2 days done, 3 left), the end resized to 7 days:
 * rebaseProgress({ progress: 40, from: mon_sat, to: mon_mon, mode: 'calendar', calendar, granularity });
 * // → { progress: 28.571…, progressDate: wed }   still 2 days done
 * rebaseProgress({ progress: 40, from: mon_sat, to: mon_mon, anchor: 'end', mode: 'calendar', calendar, granularity });
 * // → { progress: 57.142…, progressDate: fri }   still 3 days left
 * ```
 */
export function rebaseProgress(input: RebaseProgressInput): ProgressBoundary {
  const { to, mode, calendar, granularity } = input;
  const { start, endExclusive } = to;
  const progress = rebasedPercent(clampProgress(input.progress), input);
  return {
    progress,
    progressDate: progressToDate({ start, endExclusive, mode, calendar, progress, granularity }),
  };
}

function rebasedPercent(progress: number, input: RebaseProgressInput): number {
  const { from, to, calendar } = input;
  let before = length(from);
  let after = length(to);
  if (after <= 0) return before <= 0 ? progress : progress >= 100 ? 100 : 0;
  if (before <= 0) return progress;
  if (input.mode === 'working') {
    const workingBefore = calendar.countWorkingTime(from.start, from.endExclusive);
    const workingAfter = calendar.countWorkingTime(to.start, to.endExclusive);
    if (workingBefore > 0 && workingAfter > 0) {
      before = workingBefore;
      after = workingAfter;
    }
  }
  if (before === after) return progress;
  const rebased =
    input.anchor === 'end'
      ? 100 - ((100 - progress) * before) / after
      : (progress * before) / after;
  return clampProgress(rebased);
}

/** Calendar length of a span; `0` for empty or reversed spans. */
function length(bounds: ProgressBounds): number {
  const ms = bounds.endExclusive - bounds.start;
  return ms > 0 ? ms : 0;
}

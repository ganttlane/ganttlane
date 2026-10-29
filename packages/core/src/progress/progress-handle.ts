/**
 * The progress handle (FR-PROG-3, FR-SCH-4, FR-SNAP-15): turns the date under a dragged progress
 * handle into a percentage and the date the boundary is drawn at. Snapping to `snap.progress`
 * happens before, in the interaction layer through `scale/`; this module only clamps, aligns to
 * the data step and skips non-working days.
 */

import { alignFloor, type DateTimeMs, type Granularity } from '../time';
import {
  clamp,
  dateToProgress,
  type ProgressBoundary,
  type ProgressSpan,
  progressToDate,
} from './progress-date';

/** Input of {@link progressFromDate}. */
export interface ProgressFromDateInput extends ProgressSpan {
  /** Candidate date of the handle, already snapped to `snap.progress` (`snapTime`). */
  readonly t: DateTimeMs;
  /** The data step the date is aligned down to (FR-SNAP-15). */
  readonly granularity: Granularity;
  /**
   * Direction of the drag: `1` forward, `-1` backward, `0` (default) unknown, treated as forward.
   * Picks the edge a skipped non-working stretch is left at.
   */
  readonly direction?: -1 | 0 | 1 | undefined;
  /**
   * `scheduling.skipNonWorkingDays.progress` (FR-SCH-4, FR-PROG-3), default `true` like that
   * option: a boundary inside a non-working stretch jumps to the edge of the stretch in the drag
   * direction. `false` lets it rest inside the stretch.
   */
  readonly skipNonWorking?: boolean | undefined;
}

/**
 * The progress for a dragged handle (FR-PROG-3): the date `t` becomes a percentage of the span
 * and the date the boundary is drawn at. In order:
 *
 * 1. **Clamp.** `t <= start` is `0 %` at exactly `start`, `t >= endExclusive` is `100 %` at exactly
 *    `endExclusive`; `NaN` counts as `start`.
 * 2. **Align** `t` down to `granularity` (FR-SNAP-15).
 * 3. **Skip** (`skipNonWorking`, default `true`, FR-SCH-4): a boundary **inside** a non-working stretch (weekend,
 *    holiday, …) jumps to the edge of that stretch in the drag direction: forward (`1` or `0`) to
 *    midnight of the next working day, backward (`-1`) to midnight of the stretch's first
 *    non-working day; the result is clamped to the span again. The edges themselves are not
 *    inside: Saturday 00:00 (the end of Friday) and Monday 00:00 never move. They are midnights,
 *    so they stay aligned to any granularity.
 * 4. **Percentage**: {@link dateToProgress} of that date, not rounded.
 * 5. **Date**: {@link progressToDate} of that percentage, so the result is exactly what a record
 *    with this `progress` shows (no jump on commit). In calendar mode this is the date of step 3.
 *    In working mode every date inside a non-working stretch, and the midnight that ends it, hold
 *    the same amount of work, so the date is the canonical one, the start of the stretch (Friday
 *    24:00). The handle never rests inside a non-working stretch in working mode, with or without
 *    skipping: `skipNonWorking` and `direction` change only calendar-mode results.
 *
 * A zero-length span (a milestone) has no duration to measure, so its progress is binary: `0` when
 * `t` lies before its date and `100` from it on (as {@link dateToProgress}); the date is always
 * `start`.
 *
 * @param input - The span, the candidate date, the data step and the skip settings.
 * @returns The progress and its date.
 *
 * @example
 * ```ts
 * // Calendar mode, Monday 03-02 → Monday 03-16 (14 days), Saturday and Sunday off, step 1 day.
 * progressFromDate({ ...span, t: sun0308, direction: 1, granularity });
 * // → { progress: 50, progressDate: mon0309 }         7 of 14 days, the weekend counts as done
 * progressFromDate({ ...span, t: sun0308, direction: -1, granularity });
 * // → { progress: 35.714…, progressDate: sat0307 }    5 of 14 days
 * progressFromDate({ ...span, t: sun0308, skipNonWorking: false, granularity });
 * // → { progress: 42.857…, progressDate: sun0308 }    6 of 14 days, no skipping
 * ```
 */
export function progressFromDate(input: ProgressFromDateInput): ProgressBoundary {
  const { start, endExclusive, mode, calendar, granularity } = input;
  const span: ProgressSpan = { start, endExclusive, mode, calendar };
  const t = Number.isNaN(input.t) ? start : input.t;
  if (endExclusive <= start) {
    return { progress: dateToProgress({ ...span, date: t }), progressDate: start };
  }

  let date: DateTimeMs;
  if (t <= start) date = start;
  else if (t >= endExclusive) date = endExclusive;
  else {
    date = clamp(alignFloor(t, granularity), start, endExclusive);
    if (input.skipNonWorking !== false && date > start && date < endExclusive) {
      date = clamp(leaveNonWorking(date, (input.direction ?? 0) >= 0, span), start, endExclusive);
    }
  }

  const progress = dateToProgress({ ...span, date });
  return { progress, progressDate: progressToDate({ ...span, progress, granularity }) };
}

/**
 * `t` itself, or the edge of the non-working stretch `t` lies inside: midnight of the next working
 * day (`forward`) or midnight of the stretch's first day (`WorkCalendar.rollToWorking` of a
 * `'boundary'`). A midnight right after a working day is that day's end, not inside the stretch.
 * Without a working day in that direction, the span's edge.
 */
function leaveNonWorking(t: DateTimeMs, forward: boolean, span: ProgressSpan): DateTimeMs {
  const rolled = span.calendar.rollToWorking(t, forward ? 1 : -1, { edge: 'boundary' });
  return rolled ?? (forward ? span.endExclusive : span.start);
}

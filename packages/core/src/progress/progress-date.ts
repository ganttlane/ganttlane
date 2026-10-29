/**
 * Progress percentage ↔ progress date: pure functions over a time span and
 * the work calendar. They know nothing about tasks, so `model/` can
 * use them for `progressDate` and the progress handle (`progress-handle.ts`) and anchoring
 * (`progress-anchor.ts`) build on them.
 */

import type { WorkCalendar } from '../calendar';
import { alignFloor, asDateTimeMs, type DateTimeMs, type Granularity } from '../time';

/** Start and exclusive end of a span, without the way it is measured. */
export interface ProgressBounds {
  /** Start of the span (0 %). */
  readonly start: DateTimeMs;
  /** End of the span, exclusive (100 %). */
  readonly endExclusive: DateTimeMs;
}

/** A time span that progress is measured along. */
export interface ProgressSpan extends ProgressBounds {
  /**
   * What progress measures, the task's `durationMode`: all time (`'calendar'`) or only working
   * time (`'working'`): with the weekend off, 50 % of Monday–Sunday is Wednesday 12:00 (before
   * alignment), not Thursday 12:00. A span without working time falls back to calendar time.
   */
  readonly mode: 'calendar' | 'working';
  /** The work calendar, used in `'working'` mode. */
  readonly calendar: WorkCalendar;
}

/** Input of {@link progressToDate}. */
export interface ProgressToDateInput extends ProgressSpan {
  /** Progress in percent; values outside `0` … `100` are clamped, `NaN` counts as `0`. */
  readonly progress: number;
  /** The data step the date is aligned down to. */
  readonly granularity: Granularity;
}

/** Input of {@link dateToProgress}. */
export interface DateToProgressInput extends ProgressSpan {
  /** The progress boundary; dates outside the span are clamped to it. */
  readonly date: DateTimeMs;
}

/**
 * Progress as a percentage together with the date it is drawn at, the result of
 * `progressFromDate` and `rebaseProgress`. Always consistent:
 * `progressDate === progressToDate({ ...span, progress, granularity })`, so a record built from
 * `progress` shows the boundary exactly at `progressDate`.
 */
export interface ProgressBoundary {
  /** Progress in percent, `0` … `100`, not rounded (fractions such as `100 / 3` are kept). */
  readonly progress: number;
  /** The progress date: inside the span and aligned down to the granularity. */
  readonly progressDate: DateTimeMs;
}

/**
 * The progress boundary of a span: the date at `progress` % of its calendar or working time,
 * aligned **down** to `granularity` (the percentage itself is never
 * changed, only the drawn boundary is) and clamped to `[start, endExclusive]`.
 *
 * `0 %` is always `start` and `100 %` always `endExclusive`, also in working
 * mode when the span ends with non-working days. In working mode the boundary is the first
 * instant at which the share of working time is reached, so it never lies in the middle of a
 * non-working stretch; it may sit at its start (Friday 24:00).
 *
 * The amount of time is rounded to whole milliseconds before alignment, so a percentage computed
 * by {@link dateToProgress} maps back to its date despite floating-point error: `100 / 3` % of
 * three days is exactly one day, not a hair less (which would align down to the start).
 *
 * @param input - The span, the percentage and the data step.
 * @returns The progress date.
 *
 * @example
 * ```ts
 * // Monday 00:00 → Saturday 00:00, 60 % of 5 days: Thursday 00:00.
 * progressToDate({ start: mon, endExclusive: sat, progress: 60, mode: 'calendar', calendar, granularity });
 * ```
 */
export function progressToDate(input: ProgressToDateInput): DateTimeMs {
  const { start, endExclusive, progress } = input;
  if (!(progress > 0) || endExclusive <= start) return start;
  if (progress >= 100) return endExclusive;
  const fraction = progress / 100;
  const working = workingTotal(input);
  const date =
    working > 0
      ? (input.calendar.addWorkingTime(start, Math.round(working * fraction)) ?? endExclusive)
      : start + Math.round((endExclusive - start) * fraction);
  return clamp(alignFloor(asDateTimeMs(date), input.granularity), start, endExclusive);
}

/**
 * The inverse of {@link progressToDate}: the share of the span's calendar or working time that
 * lies before `date`, in percent (`0` … `100`, not rounded). A zero-length span is `0` before its
 * date and `100` from it on.
 *
 * @param input - The span and the progress boundary.
 * @returns Progress in percent.
 */
export function dateToProgress(input: DateToProgressInput): number {
  const { start, endExclusive } = input;
  if (endExclusive <= start) return input.date < start ? 0 : 100;
  const date = clamp(input.date, start, endExclusive);
  const working = workingTotal(input);
  const ratio =
    working > 0
      ? input.calendar.countWorkingTime(start, date) / working
      : (date - start) / (endExclusive - start);
  return ratio * 100;
}

/**
 * Working milliseconds of the span in `'working'` mode; `0` in `'calendar'` mode or when the
 * calendar cannot count the span.
 *
 * @internal
 */
export function workingTotal(span: ProgressSpan): number {
  if (span.mode !== 'working') return 0;
  const working = span.calendar.countWorkingTime(span.start, span.endExclusive);
  return working > 0 ? working : 0;
}

/** @internal */
export function clamp(t: DateTimeMs, min: DateTimeMs, max: DateTimeMs): DateTimeMs {
  if (t < min) return min;
  return t > max ? max : t;
}

/**
 * A percentage clamped to `0` … `100`; `NaN` counts as `0`.
 *
 * @internal
 */
export function clampProgress(progress: number): number {
  if (!(progress > 0)) return 0;
  return progress > 100 ? 100 : progress;
}

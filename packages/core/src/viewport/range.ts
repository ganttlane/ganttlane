/**
 * The timeline range (FR-TL-1): from the tasks plus padding (and today), or explicit, snapped
 * outward to whole columns.
 */

import type { TimeRange } from '../scale';
import { asDateTimeMs, type DateAdapter, type DateTimeMs, DAY, type Duration } from '../time';
import { type ColumnGrid, snapRange } from './columns';
import { checkRange, shiftBy } from './state';

/** What {@link resolveRange} reads from a task: `TaskSpan` (`TaskModel.span`) fits as is. */
export interface RangeSpan {
  /** First moment of the task. */
  readonly start: DateTimeMs;
  /** End of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: DateTimeMs;
}

/**
 * Padding around the data, parsed (`resolveTimelineOptions`): one duration for both sides or
 * `[before, after]`.
 */
export type TimelinePadding = Duration | readonly [before: Duration, after: Duration];

/** Input of {@link resolveRange}. */
export interface RangeInput {
  /** The tasks' spans in any order; `undefined` (a row without a bar) is skipped. */
  readonly spans: Iterable<RangeSpan | undefined>;
  /** "Today" in floating time (the `now` option). */
  readonly now: DateTimeMs;
  /**
   * An explicit range (`timeline.range`): used as is, without padding and today, only snapped
   * outward to the columns. `end > start`.
   */
  readonly explicit?: TimeRange | undefined;
  /** Padding around the data: the `timeline.padding` option or the view mode's. Default none. */
  readonly padding?: TimelinePadding | undefined;
  /** Whether the range always contains today (`timeline.includeToday`). Default `false`. */
  readonly includeToday?: boolean | undefined;
  /** Column boundaries of the view mode (`columnGrid`) to snap to; without it, no snapping. */
  readonly columns?: ColumnGrid | undefined;
  /** Calendar math for padding with months; default the built-in floating arithmetic. */
  readonly adapter?: DateAdapter | undefined;
}

const NO_PADDING: Duration = /* @__PURE__ */ Object.freeze({ months: 0, ms: 0 });
/** Padding of an empty chart when the configured padding is empty: a week on each side. */
const EMPTY_CHART_PADDING: Duration = /* @__PURE__ */ Object.freeze({ months: 0, ms: 7 * DAY });

/**
 * The timeline range (FR-TL-1). Pure; the result is frozen and never empty.
 *
 * - **Explicit**: `explicit` as is (no padding, no today).
 * - **Auto**: from the earliest `start` to the latest `endExclusive` of the spans; a zero-length
 *   span (a milestone) counts as its first millisecond, so its column is in the range. With
 *   `includeToday`, `now` is included the same way. Then `padding` is added before and after
 *   (calendar-aware: `'1mo'` is a month).
 * - **No data** (no span): a window around `now` with the padding, or a week on each side when
 *   the padding is empty.
 * - **Columns**: the start moves back and the end forward to column boundaries, so the first
 *   and last header cells of the column row are whole (a week range starts on the week start,
 *   a decade range on a year ending in 0).
 *
 * Use the start as the origin of the time scale (`createTimeScale({ origin: range.start, … })`),
 * so content x runs from `0` to `scale.durationToPx(range.end - range.start)`.
 *
 * @param input - Spans, today, the range options and the column grid.
 * @returns The frozen range `[start, end)`.
 * @throws RangeError for an explicit range with `end <= start` or non-finite bounds, a
 * non-finite `now` or span date, or a negative padding.
 *
 * @example
 * ```ts
 * const range = resolveRange({
 *   spans: model.tasks.map((task) => task.span),
 *   now,
 *   padding: timeline.padding,
 *   columns: columnGrid(viewMode, adapter),
 * });
 * const scale = createTimeScale({ origin: range.start, pxPerDay: viewMode.pxPerDay });
 * ```
 */
export function resolveRange(input: RangeInput): TimeRange {
  const { explicit, columns } = input;
  if (explicit !== undefined) {
    checkRange(explicit, 'explicit');
    return snapRange(explicit, columns);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const span of input.spans) {
    if (span === undefined) continue;
    lo = Math.min(lo, span.start);
    hi = Math.max(hi, span.endExclusive, span.start + 1);
  }
  const empty = lo > hi;
  const { now } = input;
  if (empty || input.includeToday === true) {
    lo = Math.min(lo, now);
    hi = Math.max(hi, now + 1);
  }
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) {
    throw new RangeError(`Span dates and now must be finite, got ${lo} … ${hi}.`);
  }
  let [before, after] = paddingSides(input.padding);
  if (empty && isEmpty(before) && isEmpty(after)) {
    before = EMPTY_CHART_PADDING;
    after = EMPTY_CHART_PADDING;
  }
  const start = shiftBy(asDateTimeMs(lo), before, -1, input.adapter);
  const end = shiftBy(asDateTimeMs(hi), after, 1, input.adapter);
  return snapRange({ start, end }, columns);
}

function paddingSides(padding: TimelinePadding | undefined): readonly [Duration, Duration] {
  if (padding === undefined) return [NO_PADDING, NO_PADDING];
  const sides: readonly [Duration, Duration] = isPair(padding) ? padding : [padding, padding];
  for (const side of sides) {
    if (!(side.months >= 0 && side.ms >= 0)) {
      throw new RangeError(
        `padding must not be negative, got ${side.months} months ${side.ms} ms.`,
      );
    }
  }
  return sides;
}

function isPair(padding: TimelinePadding): padding is readonly [Duration, Duration] {
  return Array.isArray(padding);
}

function isEmpty(duration: Duration): boolean {
  return duration.months === 0 && duration.ms === 0;
}

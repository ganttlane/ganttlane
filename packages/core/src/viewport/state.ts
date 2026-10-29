/**
 * The horizontal state of the timeline: the range, the time scale
 * placed on it and the scroll position, plus the checks and small helpers every viewport
 * function shares.
 */

import type { TimeRange, TimeScale } from '../scale';
import { addDuration, type DateAdapter, type DateTimeMs, type Duration } from '../time';

/**
 * The timeline as the viewport math sees it (glossary: Range, Viewport).
 *
 * Coordinates follow one convention: the scale's origin is `range.start`, so the scrolled content
 * spans `x ∈ [0, scale.durationToPx(range.end - range.start)]` and `scrollLeft` is the content x
 * at the left edge of the viewport (the renderer keeps scale `x = 0` at the left edge of the
 * scrolled content, as `visibleWindow` assumes).
 */
export interface TimelineState {
  /** The rendered range `[start, end)`; `end > start`. */
  readonly range: TimeRange;
  /** The time scale; its `origin` must be `range.start`. */
  readonly scale: TimeScale;
  /** Horizontal scroll offset of the scroller, in CSS pixels. */
  readonly scrollLeft: number;
  /** Client width of the scroller, `0` or more. */
  readonly viewportWidth: number;
}

/**
 * Throws for a range, scale or viewport width that breaks the {@link TimelineState} contract
 * (programming errors: these come from code, not from caller options).
 *
 * @internal
 */
export function checkGeometry(range: TimeRange, scale: TimeScale, viewportWidth: number): void {
  checkRange(range, 'range');
  if (scale.origin !== range.start) {
    throw new RangeError(
      `The scale origin (${scale.origin}) must be range.start (${range.start}): build the scale from the range.`,
    );
  }
  if (!(Number.isFinite(viewportWidth) && viewportWidth >= 0)) {
    throw new RangeError(`viewportWidth must be a finite number, 0 or more, got ${viewportWidth}.`);
  }
}

/**
 * {@link checkGeometry} plus a finite `scrollLeft`.
 *
 * @internal
 */
export function checkState(state: TimelineState): void {
  checkGeometry(state.range, state.scale, state.viewportWidth);
  checkFinite(state.scrollLeft, 'scrollLeft');
}

/**
 * Throws unless `range` has finite bounds with `end > start` (`allowEmpty`: `end >= start`).
 *
 * @internal
 */
export function checkRange(range: TimeRange, what: string, allowEmpty = false): void {
  const { start, end } = range;
  const ordered = allowEmpty ? end >= start : end > start;
  if (!(Number.isFinite(start) && Number.isFinite(end) && ordered)) {
    const order = allowEmpty ? 'end >= start' : 'end > start';
    throw new RangeError(`${what} must have finite bounds with ${order}, got ${start} … ${end}.`);
  }
}

/**
 * Throws unless `value` is a finite number.
 *
 * @internal
 */
export function checkFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be finite, got ${value}.`);
}

/**
 * Throws unless a duration is positive: both parts `0` or more and not both `0`.
 *
 * @internal
 */
export function checkPositive(duration: Duration, what: string): void {
  const { months, ms } = duration;
  if (!(Number.isFinite(months) && Number.isFinite(ms) && months >= 0 && ms >= 0)) {
    throw new RangeError(`${what} must not be negative, got ${months} months ${ms} ms.`);
  }
  if (months === 0 && ms === 0) throw new RangeError(`${what} must not be empty.`);
}

/**
 * Width of the scrolled content: the range on the scale.
 *
 * @internal
 */
export function contentWidth(range: TimeRange, scale: TimeScale): number {
  return scale.durationToPx(range.end - range.start);
}

/**
 * Largest scroll offset: content width minus viewport width, `0` for narrow content.
 *
 * @internal
 */
export function maxScrollLeft(range: TimeRange, scale: TimeScale, viewportWidth: number): number {
  return Math.max(contentWidth(range, scale) - viewportWidth, 0);
}

/**
 * `value` clamped to `[min, max]` (`max` wins when `min > max`), never `-0`.
 *
 * @internal
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max) + 0;
}

/**
 * `t` shifted by a duration through the adapter, or the built-in floating arithmetic.
 *
 * @internal
 */
export function shiftBy(
  t: DateTimeMs,
  duration: Duration,
  sign: 1 | -1,
  adapter: DateAdapter | undefined,
): DateTimeMs {
  return adapter === undefined
    ? addDuration(t, duration, sign)
    : adapter.addDuration(t, duration, sign);
}

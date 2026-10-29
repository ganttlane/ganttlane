/**
 * `TimeScale`: the linear date ↔ x mapping.
 *
 * `x = (t - origin) * pxPerDay / DAY`. One floating day is always 24 h, so months and years get
 * their real length on screen and the same scale works for every view mode: only `pxPerDay`
 * changes.
 */

import { asDateTimeMs, type DateTimeMs, DAY } from '../time';

/**
 * Writing direction of the timeline.
 *
 * `'rtl'` is accepted and stored so options can already carry it, but mirroring is not
 * available yet: until it lands, a `'rtl'` scale maps dates exactly like `'ltr'` (time grows to
 * the right).
 */
export type ScaleDirection = 'ltr' | 'rtl';

/** Options of {@link createTimeScale}. */
export interface TimeScaleOptions {
  /** The date at `x = 0`. Finite; usually the start of the rendered range. */
  readonly origin: DateTimeMs;
  /** Zoom level: pixels per floating day (24 h). Finite and greater than `0`. */
  readonly pxPerDay: number;
  /**
   * Writing direction, default `'ltr'`. `'rtl'` is stored only: mirroring is not available yet.
   */
  readonly direction?: ScaleDirection;
}

/** The point that stays in place when zooming, in scale pixels (e.g. the cursor or the center). */
export interface ZoomAnchor {
  /** Horizontal position in pixels, relative to the scale's `x = 0`. Finite. */
  readonly x: number;
}

/**
 * An immutable linear time scale. Pixel values are unrounded floats: rounding to
 * device pixels is the renderer's job. Dates and durations coming back from pixels are rounded
 * to whole milliseconds; snapping to a step is a separate concern (`scale/snap`).
 *
 * Members are plain functions (no `this`), so they can be passed around unbound. The object is
 * frozen: zooming returns a new scale.
 */
export interface TimeScale {
  /**
   * The date at `x = 0`. {@link TimeScale.zoom} keeps it a whole number of milliseconds (it
   * rounds the shifted origin), so it is an integer whenever the created scale's origin is.
   */
  readonly origin: DateTimeMs;
  /** Pixels per floating day (24 h). */
  readonly pxPerDay: number;
  /** Writing direction as configured. `'rtl'` currently behaves like `'ltr'`. */
  readonly direction: ScaleDirection;
  /** Horizontal position of a date: `(t - origin) * pxPerDay / DAY`, may be negative. */
  readonly dateToX: (t: DateTimeMs) => number;
  /** The date at a horizontal position, rounded to the nearest millisecond. */
  readonly xToDate: (x: number) => DateTimeMs;
  /** Width in pixels of a fixed duration in milliseconds (sign preserved). */
  readonly durationToPx: (ms: number) => number;
  /** Fixed duration in milliseconds covered by a pixel width, rounded to the nearest ms. */
  readonly pxToDuration: (px: number) => number;
  /**
   * A scale with another `pxPerDay` where the date under `anchor.x` stays at `anchor.x`
   * (the origin moves). The new origin is rounded to a whole millisecond, so the anchor date
   * stays within half a millisecond of `anchor.x`: a sub-pixel shift at any realistic zoom
   * (under 0.06 px at 10 000 px per day). Direction is kept.
   *
   * @throws RangeError for a non-positive or non-finite `pxPerDay` or a non-finite `anchor.x`.
   */
  readonly zoom: (pxPerDay: number, anchor: ZoomAnchor) => TimeScale;
}

/**
 * Creates an immutable linear time scale.
 *
 * The arguments come from validated options (view modes are checked by `resolveViewModes`) or
 * from code, so invalid values are programming errors and throw, like `createFloatingAdapter`.
 *
 * Round trips are exact for realistic ranges (±100 years around the origin, `pxPerDay` from
 * `0.01` to `10 000`): `xToDate(dateToX(t)) === t` for whole-millisecond `t`, and
 * `dateToX(xToDate(x))` is within a tiny fraction of a pixel of `x`.
 *
 * @param options - `origin` (date at `x = 0`), `pxPerDay` and optional `direction`.
 * @returns A frozen {@link TimeScale}.
 * @throws RangeError if `origin` is not finite, `pxPerDay` is not a finite number greater than
 * `0`, or `direction` is neither `'ltr'` nor `'rtl'`.
 *
 * @example
 * ```ts
 * const scale = createTimeScale({ origin: start, pxPerDay: 40 });
 * scale.dateToX(addDays(start, 2));            // 80
 * const zoomed = scale.zoom(80, { x: 400 });   // the date at x = 400 stays at x = 400
 * ```
 */
export function createTimeScale(options: TimeScaleOptions): TimeScale {
  const origin: unknown = options.origin;
  if (typeof origin !== 'number' || !Number.isFinite(origin)) {
    throw new RangeError(`origin must be a finite floating date-time, got ${String(origin)}.`);
  }
  const direction: unknown = options.direction ?? 'ltr';
  if (direction !== 'ltr' && direction !== 'rtl') {
    throw new RangeError(`direction must be 'ltr' or 'rtl', got ${String(direction)}.`);
  }
  return buildScale(asDateTimeMs(origin), checkPxPerDay(options.pxPerDay), direction);
}

function buildScale(origin: DateTimeMs, pxPerDay: number, direction: ScaleDirection): TimeScale {
  const pxPerMs = pxPerDay / DAY;
  return Object.freeze({
    origin,
    pxPerDay,
    direction,
    dateToX: (t: DateTimeMs): number => (t - origin) * pxPerMs,
    xToDate: (x: number): DateTimeMs => asDateTimeMs(wholeMs(origin + x / pxPerMs)),
    durationToPx: (ms: number): number => ms * pxPerMs,
    pxToDuration: (px: number): number => wholeMs(px / pxPerMs),
    zoom: (nextPxPerDay: number, anchor: ZoomAnchor): TimeScale => {
      const next = checkPxPerDay(nextPxPerDay);
      const x: unknown = anchor.x;
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        throw new RangeError(`zoom anchor x must be a finite number, got ${String(x)}.`);
      }
      // Keep the date the caller sees under the anchor (whole ms) under it; the origin stays a
      // whole ms, which moves the anchor by at most half a millisecond.
      const anchorDate = wholeMs(origin + x / pxPerMs);
      return buildScale(asDateTimeMs(wholeMs(anchorDate - x / (next / DAY))), next, direction);
    },
  });
}

function checkPxPerDay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`pxPerDay must be a finite number greater than 0, got ${String(value)}.`);
  }
  return value;
}

/** Nearest whole millisecond, never `-0`. */
function wholeMs(ms: number): number {
  return Math.round(ms) + 0;
}

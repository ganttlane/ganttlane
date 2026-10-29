/**
 * Per-day classification cache with prefix sums of working days.
 *
 * The index covers one contiguous window of day keys `[lo, hi)`. It grows on demand (at least
 * doubling, so filling it costs amortized O(1) per day) and is never invalidated: a calendar is
 * immutable, so a different calendar means a new index. Inside the window, the number of working
 * days in any range is `prefix[b] - prefix[a]`, O(1); searches are a binary search, O(log n).
 *
 * The window is capped (`maxDays`); queries that would need a larger window are answered by
 * walking day by day without caching, which is correct but O(span).
 */

import { asDayKey, dayOfWeek, fromDayKey, type Weekday } from '../time';

/** Day codes stored in the index; see `DayReason` for their meaning. */
export const DAY_WORKING = 0;
/** A weekend day (`weekends`). */
export const DAY_WEEKEND = 1;
/** A holiday. */
export const DAY_HOLIDAY = 2;
/** The custom rule returned `true`. */
export const DAY_CUSTOM_WORKING = 3;
/** The custom rule returned `false`. */
export const DAY_CUSTOM_OFF = 4;
/** A `workingDays` exception. */
export const DAY_EXCEPTION = 5;

/** Classification of one day. */
export type DayCode =
  | typeof DAY_WORKING
  | typeof DAY_WEEKEND
  | typeof DAY_HOLIDAY
  | typeof DAY_CUSTOM_WORKING
  | typeof DAY_CUSTOM_OFF
  | typeof DAY_EXCEPTION;

/** Classifies a day; `weekday` is passed in because the index tracks it incrementally. */
export type DayClassifier = (day: number, weekday: Weekday) => DayCode;

/**
 * Smallest supported day key: `-100 000 000` days from 1970-01-01, the first day a `Date` can
 * represent. Keys outside `[MIN_DAY_KEY, MAX_DAY_KEY]` are outside the calendar.
 */
export const MIN_DAY_KEY = -100_000_000;
/** Largest supported day key, the last day a `Date` can represent (see {@link MIN_DAY_KEY}). */
export const MAX_DAY_KEY = 100_000_000;

/**
 * Searches always cross a run of non-working days shorter than this (100 years); a calendar that
 * has no working day for this long in the search direction is treated as having none there.
 */
export const MAX_NON_WORKING_RUN = 36_525;

/** Default cap of the cached window: 2^21 days ≈ 5 700 years, at most ≈ 10.5 MB. */
export const MAX_INDEX_DAYS: number = 1 << 21;

/** Minimum number of days the window grows by, so that nearby queries do not regrow it. */
const MIN_GROWTH = 512;
/** First window a search scans. */
const MIN_SEARCH_SPAN = 64;

/** Whether a day code is a working day. */
export function isWorkingCode(code: DayCode): boolean {
  return code === DAY_WORKING || code === DAY_CUSTOM_WORKING || code === DAY_EXCEPTION;
}

/** Cached classification and working-day prefix sums over a growing window of days. */
export class DayIndex {
  private lo = 0;
  private hi = 0;
  /** `codes[i]` is the code of day `lo + i`. */
  private codes = new Uint8Array(0);
  /** `prefix[i]` is the number of working days in `[lo, lo + i)`. */
  private prefix = new Int32Array(1);
  private readonly classify: DayClassifier;
  private readonly maxDays: number;

  /**
   * @param classify - Classifies a day (called at most once per day while it stays cached).
   * @param maxDays - Largest window the index may cache.
   */
  constructor(classify: DayClassifier, maxDays: number = MAX_INDEX_DAYS) {
    this.classify = classify;
    this.maxDays = maxDays;
  }

  /** Number of cached days (for tests). */
  get size(): number {
    return this.hi - this.lo;
  }

  /**
   * Code of a day, caching it when the window may grow to include it.
   *
   * @param day - A day key within `[MIN_DAY_KEY, MAX_DAY_KEY]`.
   */
  codeAt(day: number): DayCode {
    if ((day >= this.lo && day < this.hi) || this.cover(day, day + 1)) {
      return this.codes[day - this.lo] as DayCode;
    }
    return this.peek(day);
  }

  /**
   * Number of working days in `[start, end)`; `start <= end`, both within
   * `[MIN_DAY_KEY, MAX_DAY_KEY + 1]`.
   */
  count(start: number, end: number): number {
    if (start === end) return 0;
    if (this.cover(start, end)) return this.prefixAt(end) - this.prefixAt(start);
    let working = 0;
    for (let day = start; day < end; day++) if (isWorkingCode(this.peek(day))) working++;
    return working;
  }

  /**
   * The `n`-th working day strictly after `day` (`n >= 1`), or `undefined` when there is none
   * (see {@link MAX_NON_WORKING_RUN}) or it would lie after {@link MAX_DAY_KEY}.
   */
  nthAfter(day: number, n: number): number | undefined {
    if (n > MAX_DAY_KEY - day) return undefined;
    const from = day + 1;
    let span = Math.max(MIN_SEARCH_SPAN, 2 * n);
    for (;;) {
      const end = Math.min(from + span, MAX_DAY_KEY + 1);
      if (!this.cover(from, end)) return this.scanAfter(day, n);
      const target = this.prefixAt(from) + n;
      if (this.prefixAt(end) >= target) return this.findForward(target, from, end);
      if (end > MAX_DAY_KEY) return undefined;
      if (
        end - from >= MAX_NON_WORKING_RUN &&
        this.prefixAt(end) === this.prefixAt(end - MAX_NON_WORKING_RUN)
      ) {
        return undefined;
      }
      // Grow geometrically, but check for a long gap at least every MAX_NON_WORKING_RUN days.
      span += Math.min(span, MAX_NON_WORKING_RUN);
    }
  }

  /**
   * The `n`-th working day strictly before `day` (`n >= 1`), or `undefined` when there is none
   * (see {@link MAX_NON_WORKING_RUN}) or it would lie before {@link MIN_DAY_KEY}.
   */
  nthBefore(day: number, n: number): number | undefined {
    if (n > day - MIN_DAY_KEY) return undefined;
    let span = Math.max(MIN_SEARCH_SPAN, 2 * n);
    for (;;) {
      const start = Math.max(day - span, MIN_DAY_KEY);
      if (!this.cover(start, day)) return this.scanBefore(day, n);
      const target = this.prefixAt(day) - n;
      if (this.prefixAt(start) <= target) return this.findBackward(target, start, day);
      if (start === MIN_DAY_KEY) return undefined;
      if (
        day - start >= MAX_NON_WORKING_RUN &&
        this.prefixAt(start) === this.prefixAt(start + MAX_NON_WORKING_RUN)
      ) {
        return undefined;
      }
      span += Math.min(span, MAX_NON_WORKING_RUN);
    }
  }

  /**
   * Makes the window include `[start, end)` (`start < end`), growing it with padding.
   *
   * @returns `false` when that would exceed `maxDays` (the window is left unchanged).
   */
  cover(start: number, end: number): boolean {
    const { lo, hi } = this;
    if (start >= lo && end <= hi) return true;
    const empty = lo === hi;
    const unionLo = empty ? start : Math.min(start, lo);
    const unionHi = empty ? end : Math.max(end, hi);
    if (unionHi - unionLo > this.maxDays) return false;

    const pad = Math.max(MIN_GROWTH, hi - lo);
    let newLo = empty || unionLo < lo ? Math.max(unionLo - pad, MIN_DAY_KEY) : lo;
    let newHi = empty || unionHi > hi ? Math.min(unionHi + pad, MAX_DAY_KEY + 1) : hi;
    if (newHi - newLo > this.maxDays) {
      newLo = unionLo;
      newHi = unionHi;
    }
    this.rebuild(newLo, newHi);
    return true;
  }

  private rebuild(newLo: number, newHi: number): void {
    const { lo, hi } = this;
    const size = newHi - newLo;
    const codes = new Uint8Array(size);
    if (lo < hi) {
      codes.set(this.codes, lo - newLo);
      this.fill(codes, newLo, newLo, lo);
      this.fill(codes, newLo, hi, newHi);
    } else {
      this.fill(codes, newLo, newLo, newHi);
    }
    const prefix = new Int32Array(size + 1);
    let working = 0;
    for (let i = 0; i < size; i++) {
      if (isWorkingCode(codes[i] as DayCode)) working++;
      prefix[i + 1] = working;
    }
    // Assign last: if the classifier throws, the index stays as it was.
    this.codes = codes;
    this.prefix = prefix;
    this.lo = newLo;
    this.hi = newHi;
  }

  /** Classifies days `[from, to)` into `codes` (whose first element is day `base`). */
  private fill(codes: Uint8Array, base: number, from: number, to: number): void {
    if (from >= to) return;
    let weekday = dayOfWeek(fromDayKey(asDayKey(from)));
    for (let day = from; day < to; day++) {
      codes[day - base] = this.classify(day, weekday);
      weekday = weekday === 6 ? 0 : ((weekday + 1) as Weekday);
    }
  }

  /** Code of a day without growing the window. */
  private peek(day: number): DayCode {
    if (day >= this.lo && day < this.hi) return this.codes[day - this.lo] as DayCode;
    return this.classify(day, dayOfWeek(fromDayKey(asDayKey(day))));
  }

  /** Working days in `[lo, day)`; `day` must be within the window bounds. */
  private prefixAt(day: number): number {
    return this.prefix[day - this.lo] ?? 0;
  }

  /** Smallest day in `[from, end)` with `prefixAt(day + 1) >= target` (it exists). */
  private findForward(target: number, from: number, end: number): number {
    let low = from - this.lo + 1;
    let high = end - this.lo;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.prefix[mid] ?? 0) >= target) high = mid;
      else low = mid + 1;
    }
    return this.lo + low - 1;
  }

  /** Largest day in `[start, end)` with `prefixAt(day) <= target` (it exists). */
  private findBackward(target: number, start: number, end: number): number {
    let low = start - this.lo;
    let high = end - this.lo - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if ((this.prefix[mid] ?? 0) <= target) low = mid;
      else high = mid - 1;
    }
    return this.lo + low;
  }

  /** `nthAfter` without the window: walks day by day. */
  private scanAfter(day: number, n: number): number | undefined {
    let found = 0;
    let run = 0;
    for (let next = day + 1; next <= MAX_DAY_KEY; next++) {
      if (isWorkingCode(this.peek(next))) {
        found++;
        if (found === n) return next;
        run = 0;
      } else if (++run >= MAX_NON_WORKING_RUN) {
        return undefined;
      }
    }
    return undefined;
  }

  /** `nthBefore` without the window: walks day by day. */
  private scanBefore(day: number, n: number): number | undefined {
    let found = 0;
    let run = 0;
    for (let prev = day - 1; prev >= MIN_DAY_KEY; prev--) {
      if (isWorkingCode(this.peek(prev))) {
        found++;
        if (found === n) return prev;
        run = 0;
      } else if (++run >= MAX_NON_WORKING_RUN) {
        return undefined;
      }
    }
    return undefined;
  }
}

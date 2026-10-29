/**
 * Runtime type checks shared by the data and option boundaries of every module (plan step 3.9:
 * one copy instead of one per resolver). Plain predicates, no issues: callers report.
 */

/**
 * Whether a value is a non-null object, arrays included (`typeof value === 'object'`).
 *
 * @internal
 */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether a value is a non-null object that is not an array: an options bag or a record.
 *
 * @internal
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return isObject(value) && !Array.isArray(value);
}

/**
 * Whether a value is a finite number (not `NaN`, not `±Infinity`).
 *
 * @internal
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value is a size in px: a finite number, `0` or more.
 *
 * @internal
 */
export function isSize(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

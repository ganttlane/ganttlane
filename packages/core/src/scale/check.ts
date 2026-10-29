/**
 * Small validation helpers shared by the `scale` option checks (view modes, snap input).
 * Internal to the module: not re-exported from `scale/index.ts`.
 */

import { DEV, isRecord, type IssueSeverity } from '../shared';
import { type DurationInput, isZeroDuration, parseDuration } from '../time';

/**
 * Collects one validation problem: where it is (`path`), what is wrong (English, with the
 * offending value and a hint; `''` in production, see `DEV`), the value itself and how serious
 * it is (default `'error'`).
 *
 * @internal
 */
export type Report = (
  path: string,
  message: string,
  value: unknown,
  severity?: IssueSeverity,
) => void;

/**
 * Appends a field name (`a.b`) or an array index (`a[2]`) to a path; an empty base yields the
 * key alone.
 *
 * @internal
 */
export function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base === '' ? key : `${base}.${key}`;
}

/**
 * Deeply frozen copy of validated plain data (durations, `Intl` options, snap settings):
 * arrays and records are copied (record fields set to `undefined` are left out), anything else
 * (primitives, functions) is kept as is. The input is never frozen or otherwise touched.
 *
 * @internal
 */
export function freezeCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return Object.freeze(items.map((item) => freezeCopy(item))) as T;
  }
  if (isRecord(value)) {
    // `fromEntries` defines own properties, so even a `__proto__` key stays plain data.
    const entries = Object.entries(value).filter(([, field]) => field !== undefined);
    return Object.freeze(
      Object.fromEntries(entries.map(([key, field]) => [key, freezeCopy(field)])),
    ) as T;
  }
  return value;
}

/**
 * Short description of a value for issue messages (`"abc"`, `42`, `null`, `an object`).
 *
 * @internal
 */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * Checks the syntax of a duration with `parseDuration` and reports its issue message.
 *
 * @param allowZero - Whether `'0d'` and the like are acceptable (padding) or not (line and
 * snap steps, where an empty step makes no sense).
 * @returns `true` when the value is a valid duration.
 * @internal
 */
export function checkDuration(
  value: unknown,
  path: string,
  report: Report,
  allowZero: boolean,
): boolean {
  const parsed = parseDuration(value as DurationInput);
  if (!parsed.ok) {
    report(path, parsed.issue.message, value);
    return false;
  }
  if (!allowZero && isZeroDuration(parsed.value)) {
    report(
      path,
      DEV ? `The duration ${describeValue(value)} is empty: use a positive step.` : '',
      value,
    );
    return false;
  }
  return true;
}

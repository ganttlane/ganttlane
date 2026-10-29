import type { Issue } from './issue';

/**
 * Outcome of an operation that can fail on bad input without throwing: either the computed
 * `value` or the `issue` that explains why there is none. Narrow on `ok`.
 *
 * @typeParam T - Type of the value on success.
 * @typeParam E - Type of the failure payload, an {@link Issue} by default.
 *
 * @example
 * ```ts
 * const parsed = parseDateInput('2026-03-08');
 * if (parsed.ok) use(parsed.value);
 * else report(parsed.issue);
 * ```
 */
export type Result<T, E = Issue> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: E };

/**
 * Wraps a successful value.
 *
 * @param value - The computed value.
 * @returns A successful {@link Result}.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Wraps a failure.
 *
 * @param issue - Why the operation failed.
 * @returns A failed {@link Result}.
 */
export function err<E>(issue: E): Result<never, E> {
  return { ok: false, issue };
}

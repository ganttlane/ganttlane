/**
 * Recursively freezes plain objects and arrays and returns the same value.
 *
 * Shared fixtures are frozen so that any code that mutates its input (FR-DATA-1) throws in strict
 * mode instead of silently corrupting the fixture for the next test. `Date` instances are left
 * alone: freezing does not protect their internal slot anyway.
 *
 * @param value - Value to freeze in place.
 * @returns The same value.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

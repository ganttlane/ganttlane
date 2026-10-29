import { DEV, err, type Issue, type Result, shortMessage } from '../shared';

/**
 * Issue codes produced by the `time` module:
 * - `'invalid-date'`: not a real date or not in a supported format;
 * - `'unsupported-offset'`: an ISO string with `Z` or a UTC offset (zoned dates are not
 *   supported yet; convert them to floating wall-clock strings first);
 * - `'invalid-duration'`: a malformed or ambiguous duration such as `'5m'`;
 * - `'invalid-granularity'`: a valid duration that cannot be the data step (`'7min'`, `'5h'`,
 *   `'2d'`, `'1mo'`): it must divide 24 h exactly or be `'1d'` (FR-SNAP-12).
 */
export type TimeIssueCode =
  'invalid-date' | 'unsupported-offset' | 'invalid-duration' | 'invalid-granularity';

/** An {@link Issue} raised by the `time` module. */
export type TimeIssue = Issue<TimeIssueCode>;

/** Options shared by the `time` parsers. */
export interface ParseOptions {
  /** Location of the value, copied into the issue's `path` (e.g. `'start'`, `'duration'`). */
  readonly path?: string;
}

/**
 * Builds an error-severity time issue. `message` is the development text (pass
 * `DEV ? text : ''`); production keeps the code only.
 *
 * @internal
 */
export function timeIssue(code: TimeIssueCode, value: unknown, message: string): TimeIssue {
  return { code, severity: 'error', message: DEV ? message : code, value };
}

/**
 * Adds `options.path` to the issue of a failed result.
 *
 * @internal
 */
export function withPath<T>(
  result: Result<T, TimeIssue>,
  options: ParseOptions | undefined,
): Result<T, TimeIssue> {
  const path = options?.path;
  if (result.ok || path === undefined) return result;
  const { issue } = result;
  return err({ ...issue, path, message: DEV ? issue.message : shortMessage(issue.code, path) });
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
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : `Date(${value.toISOString()})`;
  }
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

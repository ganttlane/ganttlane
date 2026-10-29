/**
 * How serious an {@link Issue} is: `'error'` makes the affected item (task, link, value) invalid,
 * `'warning'` reports something that was accepted or corrected.
 */
export type IssueSeverity = 'error' | 'warning';

/**
 * A problem found in caller input (data, durations, options). Core never throws for bad input:
 * it returns or collects `Issue`s instead (`docs/api.md` §4).
 *
 * The set of codes is open: every core module declares its own string-literal union
 * (for example `TimeIssueCode` in `time/`) and returns `Issue<ThatUnion>`, so adding a code never
 * means editing a central list. Code that aggregates issues from several modules uses the union
 * of their code types; plain `Issue` accepts any code.
 *
 * @typeParam Code - The string-literal union of codes this issue can carry.
 */
export interface Issue<Code extends string = string> {
  /** Machine-readable kind, e.g. `'invalid-date'`. Stable across releases. */
  readonly code: Code;
  /** Whether the input was rejected (`'error'`) or accepted with a remark (`'warning'`). */
  readonly severity: IssueSeverity;
  /**
   * Human-readable English explanation. The development build (export condition
   * `development`) spells it out with the offending value and a hint; the production build keeps
   * only the short form `'<path>: <code>'` (`'<code>'` without a path). Never parse it: `code`,
   * `path`, `value` and `suggested` carry the same facts in both builds.
   */
  readonly message: string;
  /** Location of the value inside its owner, e.g. `'start'` or `'calendar.holidays[2]'`. */
  readonly path?: string;
  /** Id of the task the issue belongs to, if any. */
  readonly taskId?: string | number;
  /** Id of the link the issue belongs to, if any. */
  readonly linkId?: string;
  /** The offending input value, as received. */
  readonly value?: unknown;
  /** A corrected value core suggests or applied instead, e.g. an aligned date. */
  readonly suggested?: unknown;
}

/**
 * The production `message` of an issue: `'<path>: <code>'`, or the code alone when there is no
 * path. The development build keeps the full English text instead (see `DEV`).
 *
 * @internal
 */
export function shortMessage(code: string, path?: string): string {
  return path === undefined || path === '' ? code : `${path}: ${code}`;
}

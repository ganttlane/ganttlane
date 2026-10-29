import { DEV, type Issue, type IssueSeverity, shortMessage } from '../shared';

/**
 * Issue codes produced by `createWorkCalendar` while it reads its options:
 * - `'invalid-weekend'`: `weekends` is not an array (the default `[0, 6]` is used), or an entry
 *   is not an integer `0` … `6` (the entry is ignored);
 * - `'invalid-holiday'`: `holidays` is not an array, or an entry is neither a valid date nor
 *   `{ date, name }` (error, ignored); or a `name` is not a string (warning, the name is ignored);
 * - `'invalid-working-day'`: `workingDays` is not an array, or an entry is not a valid date
 *   (ignored);
 * - `'invalid-rule'`: `isWorkingDay` is given but is not a function (ignored);
 * - `'time-ignored'`: a holiday or working-day date has a time of day other than midnight, so
 *   only its calendar day is used (warning: often a sign of a time zone shift upstream);
 * - `'no-working-days'`: `weekends` covers the whole week and there is neither a `workingDays`
 *   exception nor an `isWorkingDay` rule, so the calendar has no working day at all (warning).
 */
export type CalendarIssueCode =
  | 'invalid-weekend'
  | 'invalid-holiday'
  | 'invalid-working-day'
  | 'invalid-rule'
  | 'time-ignored'
  | 'no-working-days';

/** An {@link Issue} raised by the `calendar` module. */
export type CalendarIssue = Issue<CalendarIssueCode>;

/**
 * Builds a calendar issue. `message` is the development text (pass `DEV ? text : ''`);
 * production keeps the short form.
 *
 * @internal
 */
export function calendarIssue(
  code: CalendarIssueCode,
  severity: IssueSeverity,
  path: string,
  value: unknown,
  message: string,
): CalendarIssue {
  return { code, severity, message: DEV ? message : shortMessage(code, path), path, value };
}

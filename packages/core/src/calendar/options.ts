/**
 * Options of the work calendar (`calendar`) and their validation into the
 * normalized rule set the day index evaluates.
 */

import { DEV } from '../shared';
import {
  type DateInput,
  type DateTimeMs,
  type DayKey,
  fromDayKey,
  parseDateInput,
  toDayKey,
  toISODate,
  toISODateTime,
  type Weekday,
} from '../time';
import { type CalendarIssue, calendarIssue, type CalendarIssueCode } from './issues';

/** A holiday with an optional name, shown as the label of the day. */
export interface HolidayEntry {
  /** The day; a time of day is ignored (with a `'time-ignored'` warning unless it is midnight). */
  readonly date: DateInput;
  /** Name of the holiday, returned as `label` by `WorkCalendar.explain`. */
  readonly name?: string | undefined;
}

/** A holiday as callers pass it: a bare date or a {@link HolidayEntry}. */
export type HolidayInput = DateInput | HolidayEntry;

/** The day a custom {@link WorkingDayRule} is asked about. */
export interface CalendarDay {
  /** The day as a day key. */
  readonly dayKey: DayKey;
  /** Midnight of the day (floating time). */
  readonly date: DateTimeMs;
  /** Day of the week, `0` = Sunday … `6` = Saturday. */
  readonly weekday: Weekday;
  /** Full year. */
  readonly year: number;
  /** Month, `1` = January … `12` = December. */
  readonly month: number;
  /** Day of the month, `1` … `31`. */
  readonly day: number;
}

/**
 * A custom working-day rule: `true` makes the day a working day, `false` a non-working
 * day, and `undefined` (or any other value) leaves the decision to `weekends`.
 *
 * It must be **pure**: the calendar caches the answer for its whole life and calls the rule once
 * per cached day (a query spanning more than about 5 700 years is answered without caching and may
 * ask again), so a rule that reads changing state gives stale results. It must not call the
 * calendar it belongs to. An exception thrown by the rule propagates to the calendar method that
 * needed the day.
 */
export type WorkingDayRule = (day: CalendarDay) => boolean | undefined;

/**
 * Options of `createWorkCalendar` (`calendar`). Which rule decides a day,
 * from the strongest: `workingDays` exception > `holidays` > `isWorkingDay` rule >
 * `weekends`.
 *
 * The calendar copies what it needs: changing these objects afterwards has no effect, and they are
 * never mutated.
 */
export interface WorkCalendarOptions {
  /**
   * Days of the week that are not working days, `0` = Sunday … `6` = Saturday.
   * Default `[0, 6]` (Saturday and Sunday); `[]` makes every day of the week a working day.
   */
  readonly weekends?: readonly number[] | undefined;
  /** Non-working days, optionally named. Invalid entries are reported and skipped. */
  readonly holidays?: readonly HolidayInput[] | undefined;
  /**
   * Exceptions that make a day a working day whatever the other rules say, e.g. a working
   * Saturday or a holiday that is worked anyway.
   */
  readonly workingDays?: readonly DateInput[] | undefined;
  /** Custom rule between holidays and weekends; see {@link WorkingDayRule}. */
  readonly isWorkingDay?: WorkingDayRule | undefined;
}

/**
 * The validated rule set of a calendar.
 *
 * @internal
 */
export interface CalendarRules {
  /** Bit `w` is set when weekday `w` is a weekend day. */
  readonly weekendMask: number;
  /** Holiday day keys with their optional names. */
  readonly holidays: ReadonlyMap<number, string | undefined>;
  /** Day keys of `workingDays` exceptions. */
  readonly exceptions: ReadonlySet<number>;
  /** The custom rule, if any. */
  readonly rule: WorkingDayRule | undefined;
}

/** Saturday and Sunday. */
const DEFAULT_WEEKEND_MASK = (1 << 0) | (1 << 6);
/** Every day of the week. */
export const FULL_WEEK_MASK = 0b111_1111;

/**
 * Validates calendar options. Never throws: invalid parts become issues and are skipped.
 *
 * @internal
 */
export function readCalendarOptions(options: WorkCalendarOptions | undefined): {
  rules: CalendarRules;
  issues: CalendarIssue[];
} {
  const issues: CalendarIssue[] = [];
  const weekendMask = readWeekends(options?.weekends, issues);

  const holidays = new Map<number, string | undefined>();
  forEachEntry(options?.holidays, 'calendar.holidays', 'invalid-holiday', issues, (entry, path) => {
    readHoliday(entry, path, holidays, issues);
  });

  const exceptions = new Set<number>();
  forEachEntry(
    options?.workingDays,
    'calendar.workingDays',
    'invalid-working-day',
    issues,
    (entry, path) => {
      const day = readDay(entry, path, 'invalid-working-day', 'Working day', issues);
      if (day !== undefined) exceptions.add(day);
    },
  );

  const rawRule: unknown = options?.isWorkingDay;
  let rule: WorkingDayRule | undefined;
  if (typeof rawRule === 'function') rule = rawRule as WorkingDayRule;
  else if (rawRule !== undefined) {
    issues.push(
      calendarIssue(
        'invalid-rule',
        'error',
        'calendar.isWorkingDay',
        rawRule,
        DEV
          ? 'Ignored calendar.isWorkingDay: expected a function (day) => boolean | undefined.'
          : '',
      ),
    );
  }

  if (weekendMask === FULL_WEEK_MASK && exceptions.size === 0 && rule === undefined) {
    issues.push(
      calendarIssue(
        'no-working-days',
        'warning',
        'calendar.weekends',
        options?.weekends,
        DEV
          ? 'The calendar has no working days: weekends cover the whole week and there are no ' +
              'workingDays exceptions or isWorkingDay rule. Working-day arithmetic returns undefined.'
          : '',
      ),
    );
  }

  return { rules: { weekendMask, holidays, exceptions, rule }, issues };
}

function readWeekends(raw: unknown, issues: CalendarIssue[]): number {
  if (raw === undefined) return DEFAULT_WEEKEND_MASK;
  if (!Array.isArray(raw)) {
    issues.push(
      calendarIssue(
        'invalid-weekend',
        'error',
        'calendar.weekends',
        raw,
        DEV
          ? 'Ignored calendar.weekends: expected an array of weekdays (0 = Sunday … 6 = Saturday). ' +
              'The default [0, 6] is used.'
          : '',
      ),
    );
    return DEFAULT_WEEKEND_MASK;
  }
  let mask = 0;
  raw.forEach((value: unknown, index) => {
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6) {
      mask |= 1 << (value as number);
      return;
    }
    const path = `calendar.weekends[${index}]`;
    issues.push(
      calendarIssue(
        'invalid-weekend',
        'error',
        path,
        value,
        DEV ? `Ignored ${path}: expected an integer weekday 0 (Sunday) … 6 (Saturday).` : '',
      ),
    );
  });
  return mask;
}

function forEachEntry(
  raw: unknown,
  path: string,
  code: CalendarIssueCode,
  issues: CalendarIssue[],
  read: (entry: unknown, path: string) => void,
): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    issues.push(
      calendarIssue(code, 'error', path, raw, DEV ? `Ignored ${path}: expected an array.` : ''),
    );
    return;
  }
  raw.forEach((entry: unknown, index) => {
    read(entry, `${path}[${index}]`);
  });
}

function readHoliday(
  entry: unknown,
  path: string,
  holidays: Map<number, string | undefined>,
  issues: CalendarIssue[],
): void {
  let date: unknown = entry;
  let name: unknown;
  let datePath = path;
  if (typeof entry === 'object' && entry !== null && !(entry instanceof Date)) {
    if (!('date' in entry)) {
      issues.push(
        calendarIssue(
          'invalid-holiday',
          'error',
          path,
          entry,
          DEV ? `Ignored ${path}: expected a date or { date, name }.` : '',
        ),
      );
      return;
    }
    date = entry.date;
    name = 'name' in entry ? entry.name : undefined;
    datePath = `${path}.date`;
  }

  const day = readDay(date, datePath, 'invalid-holiday', 'Holiday', issues);
  if (day === undefined) return;

  let label: string | undefined;
  if (typeof name === 'string') {
    if (name !== '') label = name;
  } else if (name !== undefined) {
    issues.push(
      calendarIssue(
        'invalid-holiday',
        'warning',
        `${path}.name`,
        name,
        DEV ? `Ignored the name of ${path}: expected a string. The day is still a holiday.` : '',
      ),
    );
  }
  // A day listed twice keeps the first name it was given.
  if (holidays.get(day) === undefined) holidays.set(day, label);
}

/** Parses a date entry into its day key, or reports why it is skipped. */
function readDay(
  value: unknown,
  path: string,
  code: CalendarIssueCode,
  what: string,
  issues: CalendarIssue[],
): number | undefined {
  const parsed = parseDateInput(value as DateInput, { path });
  if (!parsed.ok) {
    issues.push(
      calendarIssue(
        code,
        'error',
        path,
        value,
        DEV ? `Ignored ${path}: ${parsed.issue.message}` : '',
      ),
    );
    return undefined;
  }
  const t = parsed.value.value;
  const day = toDayKey(t);
  if (t !== fromDayKey(day)) {
    issues.push(
      calendarIssue(
        'time-ignored',
        'warning',
        path,
        value,
        DEV
          ? `${what} ${path} has a time of day (${toISODateTime(t)}); only its date ` +
              `${toISODate(t)} is used. If another day was meant, check the time zone of the source.`
          : '',
      ),
    );
  }
  return day;
}

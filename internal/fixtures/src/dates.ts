/**
 * Tiny floating-date helpers for building and checking fixtures. Everything goes through
 * `Date.UTC` / `getUTC*`, so results never depend on the host time zone.
 *
 * Not a calendar implementation: core has its own (`WorkCalendar`). These exist so the fixture
 * package can format generated dates and sanity-check its own hand-written data in tests.
 */

import type { FixtureCalendar } from './types';

const MS_PER_MINUTE = 60_000;
/** Minutes in a (floating) day. */
export const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * Parses a strict `'YYYY-MM-DD'` string into a day number (days since 1970-01-01).
 *
 * @param iso - Date-only string.
 * @returns Day number.
 * @throws If the string is not a real calendar date.
 */
export function toDayNumber(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Not a calendar date: ${iso}`);
  }
  return ms / MS_PER_DAY;
}

/**
 * Parses a strict `'YYYY-MM-DDTHH:mm'` string into minutes since 1970-01-01T00:00.
 *
 * @param iso - Date-time string (floating, no offset).
 * @returns Minutes since the epoch.
 * @throws If the string is malformed.
 */
export function toMinuteNumber(iso: string): number {
  const match = ISO_DATE_TIME.exec(iso);
  if (!match) throw new Error(`Not a YYYY-MM-DDTHH:mm date-time: ${iso}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  return toDayNumber(`${pad(y, 4)}-${pad(mo)}-${pad(d)}`) * MINUTES_PER_DAY + h * 60 + mi;
}

/**
 * Formats a day number as `'YYYY-MM-DD'`.
 *
 * @param day - Days since 1970-01-01.
 * @returns Date-only string.
 */
export function formatDay(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Formats minutes since the epoch as `'YYYY-MM-DDTHH:mm'`.
 *
 * @param minutes - Minutes since 1970-01-01T00:00.
 * @returns Floating date-time string.
 */
export function formatMinute(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY);
  const rest = minutes - day * MINUTES_PER_DAY;
  return `${formatDay(day)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
}

/**
 * Adds whole days to a date-only string.
 *
 * @param iso - `'YYYY-MM-DD'`.
 * @param days - Days to add (may be negative).
 * @returns Shifted `'YYYY-MM-DD'`.
 */
export function addDays(iso: string, days: number): string {
  return formatDay(toDayNumber(iso) + days);
}

/**
 * Day of the week of a date-only string.
 *
 * @param iso - `'YYYY-MM-DD'`.
 * @returns `0` = Sunday … `6` = Saturday.
 */
export function weekday(iso: string): number {
  // 1970-01-01 was a Thursday (4).
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7;
}

/** Date-only holidays of a calendar (fixtures only use `'YYYY-MM-DD'` strings). */
function holidayKeys(calendar: FixtureCalendar): Set<string> {
  const keys = new Set<string>();
  for (const holiday of calendar.holidays ?? []) {
    const date = typeof holiday === 'object' && !(holiday instanceof Date) ? holiday.date : holiday;
    if (typeof date === 'string') keys.add(date);
  }
  return keys;
}

/**
 * Whether a day is worked under a fixture calendar (weekends, holidays, working-day exceptions).
 *
 * @param iso - `'YYYY-MM-DD'`.
 * @param calendar - Fixture calendar.
 * @returns `true` for a working day.
 */
export function isWorkingDay(iso: string, calendar: FixtureCalendar): boolean {
  if (calendar.workingDays?.includes(iso)) return true;
  if (calendar.weekends?.includes(weekday(iso))) return false;
  return !holidayKeys(calendar).has(iso);
}

/**
 * Counts days in an inclusive date-only range.
 *
 * @param start - First day, `'YYYY-MM-DD'`.
 * @param end - Last day (inclusive), `'YYYY-MM-DD'`.
 * @returns Calendar days, `0` if `end` is before `start`.
 */
export function countCalendarDays(start: string, end: string): number {
  return Math.max(0, toDayNumber(end) - toDayNumber(start) + 1);
}

/**
 * Counts working days in an inclusive date-only range.
 *
 * @param start - First day, `'YYYY-MM-DD'`.
 * @param end - Last day (inclusive), `'YYYY-MM-DD'`.
 * @param calendar - Fixture calendar.
 * @returns Working days, `0` if `end` is before `start`.
 */
export function countWorkingDays(start: string, end: string, calendar: FixtureCalendar): number {
  let count = 0;
  for (let day = toDayNumber(start), last = toDayNumber(end); day <= last; day++) {
    if (isWorkingDay(formatDay(day), calendar)) count++;
  }
  return count;
}

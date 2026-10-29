/**
 * Work calendar (FR-CAL): weekends, holidays, exceptions and a custom rule, with O(1) day counts
 * and working-time arithmetic. Depends only on `time` and `shared` (`docs/architecture.md` §3.1).
 *
 * Other core modules import the calendar only through this file.
 *
 * @module
 */

export type { CalendarIssue, CalendarIssueCode } from './issues';
export type {
  CalendarDay,
  HolidayEntry,
  HolidayInput,
  WorkCalendarOptions,
  WorkingDayRule,
} from './options';
export type {
  DayCounts,
  DayExplanation,
  DayReason,
  RollEdge,
  RollToWorkingOptions,
  WorkCalendar,
  WorkCalendarResult,
  WorkingDaySearchOptions,
} from './work-calendar';
export { createWorkCalendar } from './work-calendar';

/**
 * Help for people moving from the public frappe-gantt library: the table of its option names and
 * `fromFrappeGanttOptions`. The facade reads the table for the hints of the development build;
 * the adapter is published as `@ganttlane/core/migrate`. Depends on nothing but `shared`.
 *
 * Other core modules import the migration module only through this file.
 *
 * @module
 */

export type {
  FrappeConversionNote,
  FrappeGanttConversion,
  FrappeGanttOptions,
  FrappeUnmappedOption,
  FrappeUnmappedReason,
  MigratedOptions,
} from './frappe';
export { fromFrappeGanttOptions } from './frappe';
export { removedFrappeReason, renamedFrappeName } from './frappe-names';

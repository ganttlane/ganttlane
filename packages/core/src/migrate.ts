/**
 * Entry point `@ganttlane/core/migrate`: `fromFrappeGanttOptions`, which turns the options of the
 * public frappe-gantt library into options of ganttlane and reports what it could not turn.
 *
 * @packageDocumentation
 */

export type {
  FrappeConversionNote,
  FrappeGanttConversion,
  FrappeGanttOptions,
  FrappeUnmappedOption,
  FrappeUnmappedReason,
  MigratedOptions,
} from './migration';
export { fromFrappeGanttOptions } from './migration';

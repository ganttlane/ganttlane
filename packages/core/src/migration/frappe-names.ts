/**
 * The names of the options of the public frappe-gantt library (`defaults.js`, `index.js` and
 * `bar.js` of its source) and where each lives in ganttlane. One table for the development hints
 * of unknown options (`facade/unknown-options.ts`) and for `fromFrappeGanttOptions`, so that the
 * two never disagree.
 *
 * Only the names of the public library are listed.
 */

/**
 * Options and events of frappe-gantt that have a place in ganttlane, by their old name: the new
 * place as text for a hint. Paths under `display`, `toolbar`, `tooltip` and `highlights` are
 * options of `createGantt` (`@ganttlane/dom`), not of `createGanttCore`.
 */
const RENAMED: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  view_mode: 'viewMode (an id in lower case: "day", "quarter-day")',
  view_modes: 'viewModes',
  column_width: 'viewModes.<id>.pxPerDay (pixels per day, not per column)',
  snap_at: 'scheduling.snap',
  language: 'locale',
  bar_height: 'layout.barHeight',
  padding: 'layout.rowHeight (the whole row: barHeight + padding)',
  bar_corner_radius: 'layout.barRadius',
  upper_header_height: 'layout.headerRowHeight: [upper, lower]',
  lower_header_height: 'layout.headerRowHeight: [upper, lower]',
  container_height: 'layout.height',
  arrow_curve: 'display.linkCurveRadius',
  lines: 'display.gridLines',
  auto_move_label: 'display.stickyBarLabels',
  show_expected_progress: 'display.expectedProgress',
  today_button: 'toolbar.todayButton',
  view_mode_select: 'toolbar.viewModeSelect',
  ignore: 'calendar.weekends, calendar.holidays and calendar.isWorkingDay',
  is_weekend: 'calendar.weekends',
  holidays: 'highlights',
  readonly: 'editing: false',
  readonly_dates: 'editing: { move: false, resize: false }',
  readonly_progress: 'editing: { progress: false }',
  fixed_duration: 'editing: { resize: false }, or task.fixedDuration',
  move_dependencies: 'scheduling.propagation',
  popup: 'tooltip.render',
  popup_on: 'tooltip.trigger',
  scroll_to: 'scroll.initial',
  infinite_padding: 'timeline.infinite',
  on_click: 'onTaskClick',
  on_double_click: 'onTaskDoubleClick',
  on_hover: 'onTaskHoverChange',
  on_date_change: 'onTasksChange, or onTaskDatesChange for one task',
  on_progress_change: 'onTaskProgressChange',
  on_view_change: 'onViewModeChange',
});

/** Options and events of frappe-gantt that ganttlane does not have, by name: why. */
const REMOVED: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  date_format: 'dates follow `locale`, and the header labels are `viewModes[].headers`',
  hover_on_date: 'a highlighted day shows its `label` (see `highlights`)',
  on_date_click: 'there is no date-click event',
});

/**
 * Where an option of frappe-gantt lives in ganttlane.
 *
 * @param name - The old name, e.g. `'bar_height'`.
 * @returns The new place as text (`'layout.barHeight'`), or `undefined` for a name that is not an
 * option of frappe-gantt or that ganttlane does not have (see {@link removedFrappeReason}).
 * @internal
 */
export function renamedFrappeName(name: string): string | undefined {
  return Object.hasOwn(RENAMED, name) ? RENAMED[name] : undefined;
}

/**
 * Why an option of frappe-gantt has no place in ganttlane.
 *
 * @param name - The old name, e.g. `'date_format'`.
 * @returns The reason as text, or `undefined` when the option has a place or is not one.
 * @internal
 */
export function removedFrappeReason(name: string): string | undefined {
  return Object.hasOwn(REMOVED, name) ? REMOVED[name] : undefined;
}

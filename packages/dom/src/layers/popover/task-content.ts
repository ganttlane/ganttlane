import type { GanttStrings } from '../types';
import type { TaskTooltipContext, TooltipSections } from './types';

const DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * The tooltip a task gets when `tooltip.render` is not set (FR-TIP-1): its name, its dates
 * formatted for the chart's locale (`Intl`; with the time of day for a task with `precision:
 * 'time'`), and its progress and working days. While the task is dragged the dates, progress and
 * working days are the previewed ones (FR-EDIT-8). A row without dates shows its name only, and
 * a milestone one date and no length. The words around the numbers come from `strings`
 * (FR-I18N-2); the numbers and the dates, from the locale (FR-I18N-1).
 *
 * @param context - The tooltip context.
 * @param strings - The chart's strings.
 * @returns The structured content, no actions.
 */
export function defaultTaskContent(
  context: TaskTooltipContext,
  strings: GanttStrings,
): TooltipSections {
  const { task, preview, locale } = context;
  const shown = preview ?? task;
  const { start, end } = shown;
  if (start === undefined || end === undefined) return { title: task.name };
  const options = task.precision === 'time' ? DATE_TIME : DATE;
  // English where the runtime does not have the locale: `Intl` would use its own for 'xx'.
  const from = start.toLocaleString([locale, 'en'], options);
  const to = end.toLocaleString([locale, 'en'], options);
  const days = preview ? preview.workingDays : (task.duration?.workingDays ?? 0);
  const milestone = task.type === 'milestone';
  return {
    title: task.name,
    subtitle: milestone || from === to ? from : strings.dateRange(from, to, locale),
    details: milestone
      ? undefined
      : `${strings.progress(Math.round(shown.progress), locale)} · ${strings.workingDays(Math.round(days * 10) / 10, locale)}`,
  };
}

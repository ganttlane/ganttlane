import { taskTexts } from '../../shared';
import type { GanttStrings } from '../types';
import type { TaskTooltipContext, TooltipSections } from './types';

/**
 * The tooltip a task gets when `tooltip.render` is not set: its name, its dates
 * formatted for the chart's locale (`Intl`; with the time of day for a task with `precision:
 * 'time'`), and its progress and working days. While the task is dragged the dates, progress and
 * working days are the previewed ones. A row without dates shows its name only, and
 * a milestone one date and no length. The words around the numbers come from `strings`;
 * the numbers and the dates, from the locale.
 *
 * @param context - The tooltip context.
 * @param strings - The chart's strings.
 * @returns The structured content, no actions.
 */
export function defaultTaskContent(
  context: TaskTooltipContext,
  strings: GanttStrings,
): TooltipSections {
  return taskTexts(context.task, context.preview, context.locale, strings);
}

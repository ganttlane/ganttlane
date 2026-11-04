import {
  type DateTimeMs,
  type GanttSnapshot,
  type TaskPatch,
  type TaskRecord,
  toDate,
} from '@ganttlane/core';

const DAY = 86_400_000;
const DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/** The strings a task's description is made of. */
export interface SummaryStrings {
  /** The progress line, `percent` a whole number. */
  readonly progress: (percent: number, locale: string) => string;
  /** The length line, in working days. */
  readonly workingDays: (days: number, locale: string) => string;
  /** The dates line of a task that spans more than one moment. */
  readonly dateRange: (from: string, to: string, locale: string) => string;
}

/** What a task shows while it is dragged: the previewed dates, progress and length. */
export interface SummaryPreview {
  /** New first moment. */
  readonly start: Date;
  /** New end in the semantics of the input (the last day for a day-precision task). */
  readonly end: Date;
  /** New end of the half-open interval. */
  readonly endExclusive: Date;
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
  /** Working days of that span through the work calendar, so they follow the move. */
  readonly workingDays: number;
}

/**
 * The dates, lengths and progress a task would have with a patch: the preview of a drag, and the
 * values a change set gives.
 *
 * @param snap - The snapshot, for the calendar and the end semantics.
 * @param task - The task's record.
 * @param patch - The values the task gets.
 * @returns The preview.
 */
export function previewOf(snap: GanttSnapshot, task: TaskRecord, patch: TaskPatch): SummaryPreview {
  const { calendar, endInclusive } = snap.state.derived.model.options;
  const ms = patch.endExclusive - patch.start;
  const inclusive = (patch.precision ?? task.precision) === 'day' && endInclusive && ms > 0;
  return {
    start: toDate(patch.start),
    end: toDate((patch.endExclusive - (inclusive ? DAY : 0)) as DateTimeMs),
    endExclusive: toDate(patch.endExclusive),
    progress: patch.progress,
    workingDays: calendar.countWorkingTime(patch.start, patch.endExclusive) / DAY,
  };
}

/** The three lines a task is described with. */
export interface TaskTexts {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly details?: string | undefined;
}

/**
 * The words a task is described with, in the chart's locale: its name, its dates (with the time
 * of day for a task with `precision: 'time'`), and its progress and working days. A row without
 * dates has its name only, a milestone one date and no length. The words around the numbers come
 * from `strings`; the numbers and the dates, from the locale. The tooltip shows them, and a bar
 * that takes the focus is named by them.
 *
 * @param task - The task's record.
 * @param preview - The previewed values while the task is dragged.
 * @param locale - The chart's locale.
 * @param strings - The chart's strings.
 * @returns The three lines.
 */
export function taskTexts(
  task: TaskRecord,
  preview: SummaryPreview | undefined,
  locale: string,
  strings: SummaryStrings,
): TaskTexts {
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

/**
 * A task described in one line: the name, the dates, the progress and the length, which is what a
 * screen reader reads for its bar.
 *
 * @param task - The task's record.
 * @param locale - The chart's locale.
 * @param strings - The chart's strings.
 * @param progress - The progress to show, if not the record's.
 * @param preview - The values to show, if not the record's.
 * @returns The line; the id when the task has no name.
 */
export function taskSummary(
  task: TaskRecord,
  locale: string,
  strings: SummaryStrings,
  progress: number = task.progress,
  preview?: SummaryPreview,
): string {
  const { title, subtitle, details } = taskTexts(
    progress === task.progress ? task : { ...task, progress },
    preview,
    locale,
    strings,
  );
  return [title === '' ? String(task.id) : title, subtitle, details]
    .filter((line) => line !== undefined && line !== '')
    .join(', ');
}

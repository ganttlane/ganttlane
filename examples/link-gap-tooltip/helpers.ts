import {
  type ActiveLinkRecord,
  anchorTime,
  type DurationMode,
  type GanttCore,
  linkAnchors,
  type LinkType,
  measureLag,
  selectTaskPatch,
  type TaskId,
} from '@ganttlane/core';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The two policies of `scheduling.propagation`, for the select above the chart. */
export const PROPAGATION = ['preserve-lag', 'none'] as const;

/** One row of the tooltip: a link into the task, and how far the task sits from its source. */
export interface GapRow {
  /** The id of the link, a key for a list. */
  readonly id: string;
  /** The name of the predecessor. */
  readonly name: string;
  /** The distance in words: `3 days after`, `1 working day before`, `no gap`. */
  readonly gap: string;
  /** The type of the link, which says which edges of the two bars the distance is between. */
  readonly type: LinkType;
}

/**
 * A distance in words. It is a multiple of the granularity: whole days in this plan, hours in a
 * plan with a finer one.
 *
 * @param ms - The distance, negative when the task lies before the predecessor.
 * @param mode - How it was counted: the `durationMode` of the task.
 * @returns For example `'3 days after'`, `'1 working day before'`, `'no gap'`.
 */
function gapText(ms: number, mode: DurationMode): string {
  const working = mode === 'working';
  if (ms === 0) return working ? 'no working days between' : 'no gap';
  const size = Math.abs(ms);
  const [count, unit] = size % DAY === 0 ? [size / DAY, 'day'] : [size / HOUR, 'hour'];
  const plural = count === 1 ? '' : 's';
  return `${String(count)} ${working ? 'working ' : ''}${unit}${plural} ${ms > 0 ? 'after' : 'before'}`;
}

/**
 * Measures the links into a task between the bars as they are drawn now. `lag` on a link record
 * cannot say that: the record is the committed one, so it stays where it was during a drag, and an
 * explicit `Link.lag` is what the link asks for, whether the bars keep to it or not.
 *
 * `selectTaskPatch` reads a task's dates with the drag in progress over the committed data, and the
 * rest is what the chart measures with: the anchors of the link's type, the `durationMode` of the
 * task, the chart's calendar and granularity.
 *
 * @param id - The task.
 * @param predecessors - The links into it (`context.predecessors`).
 * @param core - The chart's core (`gantt.core`, or `core` on the ref of `<Gantt>`).
 * @returns One row per link, in the order of the links.
 */
export function gapRows(
  id: TaskId,
  predecessors: readonly ActiveLinkRecord[],
  core: GanttCore,
): GapRow[] {
  const { state } = core.getSnapshot();
  const task = selectTaskPatch(state, id);
  if (task === undefined) return [];
  return predecessors.flatMap((link) => {
    const source = selectTaskPatch(state, link.source);
    if (source === undefined) return [];
    const anchors = linkAnchors(link.type);
    const ms = measureLag(
      anchorTime(source, anchors.source),
      anchorTime(task, anchors.target),
      link.lag.mode,
      state.derived.model.options,
    );
    return [
      {
        id: link.id,
        name: core.getTask(link.source)?.name ?? String(link.source),
        gap: gapText(ms, link.lag.mode),
        type: link.type,
      },
    ];
  });
}

/** The dates of a task in words: `Mar 10, 2026 to Mar 12, 2026`. */
export function datesText(start: Date, end: Date, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return `${day.format(start)} to ${day.format(end)}`;
}

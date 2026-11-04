import { toDate } from '@ganttlane/core';
import type { DateTimeMs, GanttSnapshot, TaskId, TaskPatch, TaskRecord } from '@ganttlane/dom';
import { useState, useSyncExternalStore } from 'react';

import { useChartOr } from './context';
import type { GanttInstance } from './types';

/**
 * Where a bar is drawn, in px from the top left corner of the chart's container: the header is
 * above `top: headerHeight`, and the scroll offsets are taken off, so a panel placed at
 * `left` / `top` in the container's coordinates follows the bar while the chart scrolls and
 * while the bar is dragged. It is outside `0 … width` / `0 … height` of the container when the bar
 * is scrolled out of view.
 */
export interface GanttBarBox {
  /** Distance from the container's left edge; negative when the bar is scrolled off to the left. */
  readonly left: number;
  /** Distance from the container's top edge, the header included. */
  readonly top: number;
  /** The bar's width, `0` for a zero-length task; a milestone's diamond is `height` wide. */
  readonly width: number;
  /** The bar's height. */
  readonly height: number;
}

/**
 * The values the chart shows for a task in place of its own, as `Date`s, with the meaning the
 * fields of a `TaskRecord` have.
 */
export interface GanttBarDraft {
  /** First moment. */
  readonly start: Date;
  /** End in the semantics of the input, as `TaskRecord.end`. */
  readonly end: Date;
  /** End of the half-open interval `[start, endExclusive)`. */
  readonly endExclusive: Date;
  /** Progress in percent, `0` … `100`. */
  readonly progress: number;
}

/**
 * What {@link useGanttBar} tells about one task.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface GanttBar<TData = unknown> {
  /** The task as a record, with the committed values (the draft is not applied to it). */
  readonly task: TaskRecord<TData>;
  /**
   * The values the chart shows instead of the task's own: the previewed dates and progress while
   * its bar is dragged, or a change of controlled data that the owner has not applied yet.
   * `undefined` when the chart shows the task as it is.
   */
  readonly draft: GanttBarDraft | undefined;
  /** Its bar is being dragged, resized or its progress moved (the gesture is past the threshold). */
  readonly isDragging: boolean;
  /** The task is selected. */
  readonly isSelected: boolean;
  /** The keyboard focus is on the task's bar or row (`focusTask`, `keyboard.barFocus`). */
  readonly isFocused: boolean;
  /**
   * Where the bar is drawn, draft included. `undefined` when the task has no bar on the screen: a
   * placeholder, a row under a collapsed parent, a task without dates, or a chart that has not
   * been measured yet (on a server, before the first layout).
   */
  readonly box: GanttBarBox | undefined;
}

/** One day, the step back from an exclusive end to the last day (`dates.endInclusive`). */
const DAY = 86_400_000;

/** The draft of a task as dates: what `TaskRecord` would say if the chart's values were its own. */
function draftOf<TData>(
  snapshot: GanttSnapshot<TData>,
  id: TaskId,
  patch: TaskPatch | undefined,
): GanttBarDraft | undefined {
  if (patch === undefined) return undefined;
  const { model } = snapshot.state.derived;
  const precision = patch.precision ?? model.taskById.get(id)?.precision;
  const inclusive =
    precision === 'day' && model.options.endInclusive && patch.endExclusive > patch.start;
  return {
    start: toDate(patch.start),
    end: toDate(inclusive ? ((patch.endExclusive - DAY) as DateTimeMs) : patch.endExclusive),
    endExclusive: toDate(patch.endExclusive),
    progress: patch.progress,
  };
}

/** Whether two drafts are the same values. */
function sameDraft(a: GanttBarDraft | undefined, b: GanttBarDraft | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start.getTime() === b.start.getTime() &&
    a.endExclusive.getTime() === b.endExclusive.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    a.progress === b.progress
  );
}

/** Whether two boxes are the same place. */
function sameBox(a: GanttBarBox | undefined, b: GanttBarBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Whether two bars tell the same. */
function sameBar<TData>(a: GanttBar<TData>, b: GanttBar<TData>): boolean {
  return (
    a.task === b.task &&
    sameDraft(a.draft, b.draft) &&
    a.isDragging === b.isDragging &&
    a.isSelected === b.isSelected &&
    a.isFocused === b.isFocused &&
    sameBox(a.box, b.box)
  );
}

/**
 * The last {@link GanttBar} one `useGanttBar` made, and the snapshot and task it was made for: what
 * `useSyncExternalStore` needs to be handed the same object while nothing a component can see has
 * changed. Like `Selection` of `useGanttState`, the bookkeeping is kept out of the component.
 */
class BarSelection<TData> {
  private snapshot: GanttSnapshot<TData> | undefined;
  private id: TaskId | undefined;
  private bar: GanttBar<TData> | undefined;

  read(gantt: GanttInstance<TData>, snapshot: GanttSnapshot<TData>, id: TaskId | undefined) {
    if (this.snapshot === snapshot && this.id === id) return this.bar;
    const next = id === undefined ? undefined : barOf(gantt, snapshot, id);
    const last = this.bar;
    const same = next === last || (next !== undefined && last !== undefined && sameBar(next, last));
    if (!same) this.bar = next;
    this.snapshot = snapshot;
    this.id = id;
    return this.bar;
  }
}

function barOf<TData>(
  gantt: GanttInstance<TData>,
  snapshot: GanttSnapshot<TData>,
  id: TaskId,
): GanttBar<TData> | undefined {
  const task = gantt.getTask(id);
  if (task === undefined) return undefined;
  const rect = snapshot.layout.getBarRect(id);
  const measured = rect !== undefined && snapshot.timeline.viewportWidth > 0;
  const { feedback } = snapshot;
  return {
    task,
    draft: draftOf(snapshot, id, snapshot.state.draft?.patches.get(id)),
    isDragging: feedback.phase === 'dragging' && feedback.id === id,
    isSelected: snapshot.selection.tasks.includes(id),
    isFocused: snapshot.focusedTask === id,
    box: measured
      ? {
          left: rect.x - snapshot.timeline.scrollLeft,
          top: rect.y - snapshot.scrollTop + snapshot.layout.rows.headerHeight,
          width: rect.width,
          height: rect.height,
        }
      : undefined,
  };
}

/**
 * Follows one task: its record, the draft values of its bar (a drag preview, a change the owner
 * of controlled data has not applied yet), whether it is dragged, selected or focused, and where
 * its bar is drawn. For a panel, a popover or an editor that belongs to one task and goes with its
 * bar. It renders again only when one of these changes, and `box` changes while the chart
 * scrolls and the bar is dragged, so a component that uses it follows frame by frame: read the
 * selection alone with `useGanttState`.
 *
 * The chart is the one of the nearest {@link GanttRoot}, or the one you pass (a `useGantt`
 * instance). `TData` cannot be known from a context: name it, `useGanttBar<MyData>(id)`; it is
 * inferred from an instance.
 *
 * @typeParam TData - Type of `task.data`.
 * @param id - The task; `undefined` for none (a panel that is closed), which gives `undefined`.
 * @param gantt - A chart from `useGantt`, instead of the context.
 * @returns The task's state, or `undefined` without an id or for an id the chart does not have.
 * @throws Without a `GanttRoot` and a chart.
 *
 * @example
 * ```tsx
 * function TaskPanel() {
 *   const selected = useGanttState<unknown, TaskId | undefined>((s) => s.selection.tasks[0]);
 *   const bar = useGanttBar(selected);
 *   if (bar?.box === undefined) return null;
 *   const { task, draft, box } = bar;
 *   return (
 *     <aside style={{ position: 'absolute', left: box.left, top: box.top + box.height }}>
 *       {task.name}: {draft?.progress ?? task.progress}%
 *     </aside>
 *   );
 * }
 * ```
 */
export function useGanttBar<TData = unknown>(
  id: TaskId | undefined,
  gantt?: GanttInstance<TData>,
): GanttBar<TData> | undefined {
  const chart = useChartOr<GanttInstance<TData>>(gantt, 'useGanttBar');
  const [memo] = useState(() => new BarSelection<TData>());
  const read = (): GanttBar<TData> | undefined => memo.read(chart, chart.getSnapshot(), id);
  return useSyncExternalStore(chart.subscribe, read, read);
}

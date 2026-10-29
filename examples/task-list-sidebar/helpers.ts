import type {
  ChangeSet,
  GanttSnapshot,
  HitTarget,
  ScrollAlign,
  StoreDerived,
  TaskId,
  TaskRecord,
} from '@ganttlane/dom';

/** The view modes the toolbar offers. */
export const VIEW_MODES = ['day', 'week', 'month'] as const;

/** The row heights the toolbar offers, in px. */
export const ROW_HEIGHTS = [28, 36, 44] as const;

/** The themes the toolbar offers (`theme` option). */
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** A bar is this much shorter than its row, so that the bars of two rows never touch. */
export const BAR_MARGIN = 14;

/** What the list shows of one row of the chart: plain values, so two of them can be compared. */
export interface ListRow {
  readonly id: TaskId;
  readonly name: string;
  /** Nesting level, `0` for a root: `Row.depth`. */
  readonly depth: number;
  /** Whether the task has children, so that the row has a toggle: `Row.hasChildren`. */
  readonly isGroup: boolean;
  /** Whether its children are shown: `Row.isExpanded`. */
  readonly isExpanded: boolean;
  /** The zebra stripe the chart draws under this row (`display.rowStripes: 'group'`). */
  readonly stripe: 0 | 1;
  /** The secondary column: the dates, or the date of a milestone. */
  readonly dates: string;
  /** For `aria-setsize` and `aria-posinset`: how many siblings the row has, and its place. */
  readonly setSize: number;
  readonly position: number;
}

// Day first, as `9–17 Mar` is: `en-GB` writes a date as `23 Mar`.
const monthDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const month = new Intl.DateTimeFormat('en-GB', { month: 'short' });

/**
 * The dates of a task as a short range: `9–17 Mar` within a month, `28 Mar – 2 Apr` across two.
 * The dates of a record are `Date`s with the task's own wall clock, so they are read as local.
 *
 * @param record - The record of a task.
 * @returns The text for the dates column; empty for a row without a bar.
 */
export function rangeText(record: TaskRecord): string {
  const { start, end } = record;
  if (start === undefined || end === undefined) return '';
  if (record.type === 'milestone') return monthDay.format(start);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return start.getDate() === end.getDate()
      ? monthDay.format(start)
      : `${String(start.getDate())}–${String(end.getDate())} ${month.format(start)}`;
  }
  return `${monthDay.format(start)} – ${monthDay.format(end)}`;
}

/**
 * The rows of the list: the rows the chart shows, in its order, with what each one needs.
 *
 * `derived.rows` is what the chart draws: the visible tasks in pre-order with their depth and
 * whether they have children, so the list never works out the tree or what is collapsed itself.
 * The name and the dates are the record's (`getTask`). Build the list again only when
 * `snapshot.state.derived` is another object than last time: it keeps its identity through
 * scrolling, hovering and selecting, and is new when a group opens or shuts, and when the data
 * changes.
 *
 * @param derived - `snapshot.state.derived`.
 * @param getTask - The chart's `getTask`.
 * @returns One entry per row of the chart, in the same order.
 */
export function listRows(
  derived: StoreDerived,
  getTask: (id: TaskId) => TaskRecord | undefined,
): ListRow[] {
  const { rows } = derived;
  const roots = rows.filter((row) => row.depth === 0).map((row) => row.id);
  return rows.map((row) => {
    const record = getTask(row.id);
    const siblings = record?.parentId === undefined ? roots : getTask(record.parentId)?.childIds;
    return {
      id: row.id,
      name: record?.name ?? String(row.id),
      depth: row.depth,
      isGroup: row.hasChildren,
      isExpanded: row.isExpanded,
      stripe: row.groupStripe,
      dates: record ? rangeText(record) : '',
      setSize: siblings?.length ?? 1,
      position: (siblings?.indexOf(row.id) ?? 0) + 1,
    };
  });
}

/**
 * The task whose row the pointer is on in the chart: over its bar, or over its row where there is
 * no bar (`snapshot.feedback.hover`, which the chart keeps for its own hover and cursor).
 *
 * @param hover - `snapshot.feedback.hover`.
 * @returns The task, or `undefined` when the pointer is off the rows or on a link.
 */
export function hoveredId(hover: HitTarget): TaskId | undefined {
  if (hover.kind === 'task') return hover.id;
  return hover.kind === 'empty' ? hover.rowId : undefined;
}

/**
 * The `alignY` that lets `scrollToTask` scroll sideways only. It scrolls both ways, and has no
 * "nearest" or "none" for the vertical one, so for a row that is in view this is the fraction of
 * the visible rows that it is already at: the vertical offset it asks for is the one the page
 * has. A row that is not in view is centred.
 *
 * @param snapshot - The chart's snapshot.
 * @param id - The task to scroll to.
 * @returns A value for `alignY`.
 */
export function keepRowAt(snapshot: GanttSnapshot, id: TaskId): ScrollAlign {
  const row = snapshot.layout.getRowMetrics(id);
  if (row === undefined) return 'center';
  // The rows in view: what the viewport shows below the header.
  const room = snapshot.viewportHeight - snapshot.layout.rows.headerHeight - row.height;
  const at = row.y - snapshot.scrollTop;
  return room > 0 && at >= 0 && at <= room ? at / room : 'center';
}

/** What a key does in the list, by the pattern of an ARIA tree. */
export type TreeAction =
  | { readonly type: 'focus'; readonly id: TaskId }
  | { readonly type: 'expand'; readonly id: TaskId }
  | { readonly type: 'collapse'; readonly id: TaskId }
  | { readonly type: 'activate'; readonly id: TaskId };

/**
 * What a key does to the row that has the focus: Up and Down move, Home and End go to the ends,
 * Right opens a group (or steps into it once it is open), Left shuts one (or steps out to the
 * group it is in), Enter and Space select the task and scroll to it.
 *
 * @param key - `KeyboardEvent.key`.
 * @param rows - The rows of the list.
 * @param current - The row that has the focus.
 * @returns The action, or `undefined` when the key means nothing here.
 */
export function treeAction(
  key: string,
  rows: readonly ListRow[],
  current: TaskId,
): TreeAction | undefined {
  const index = rows.findIndex((row) => row.id === current);
  const row = rows[index];
  if (row === undefined) return undefined;
  const focusAt = (to: number): TreeAction | undefined => {
    const target = rows[Math.min(Math.max(to, 0), rows.length - 1)];
    return target === undefined ? undefined : { type: 'focus', id: target.id };
  };
  switch (key) {
    case 'ArrowDown':
      return focusAt(index + 1);
    case 'ArrowUp':
      return focusAt(index - 1);
    case 'Home':
      return focusAt(0);
    case 'End':
      return focusAt(rows.length - 1);
    case 'ArrowRight':
      if (!row.isGroup) return undefined;
      return row.isExpanded ? focusAt(index + 1) : { type: 'expand', id: row.id };
    case 'ArrowLeft': {
      if (row.isGroup && row.isExpanded) return { type: 'collapse', id: row.id };
      // The group a row is in is the nearest row above it that is less deep.
      const parent = rows.slice(0, index).findLast((above) => above.depth < row.depth);
      return parent === undefined ? undefined : { type: 'focus', id: parent.id };
    }
    case 'Enter':
    case ' ':
      return { type: 'activate', id: row.id };
    default:
      return undefined;
  }
}

/** A length of time in days with its sign: `+2d`, `-1d`. */
function signedDays(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days > 0 ? '+' : ''}${String(days)}d`;
}

/**
 * Says what a drag changed, for the status line.
 *
 * @param changeSet - What `onTasksChange` reports. Its dates are in core's floating milliseconds.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence.
 */
export function describeChange(changeSet: ChangeSet, nameOf: (id: TaskId) => string): string {
  const [first, ...others] = changeSet.changes;
  if (first === undefined) return 'Nothing changed.';
  const start = first.after.start - first.before.start;
  const end = first.after.endExclusive - first.before.endExclusive;
  const how =
    start === end ? signedDays(start) : `start ${signedDays(start)}, end ${signedDays(end)}`;
  const also = others.length === 0 ? '' : ` ${String(others.length)} more moved with it.`;
  return `${nameOf(first.id)}: ${how}.${also} The Dates column follows.`;
}

/**
 * Says which groups are open, for the status line.
 *
 * @param keys - What `onExpandedChange` reports: `'all'` or the ids of the open groups.
 * @param nameOf - The name of a task, from the chart.
 * @returns A sentence.
 */
export function describeExpanded(
  keys: 'all' | readonly TaskId[],
  nameOf: (id: TaskId) => string,
): string {
  if (keys === 'all') return 'Open: every group.';
  return keys.length === 0 ? 'Open: none.' : `Open: ${keys.map(nameOf).join(', ')}.`;
}

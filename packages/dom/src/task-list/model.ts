import type { GanttRow, GanttSnapshot, RowWindow, TaskId, TaskRecord } from '@ganttlane/core';

import type { Gantt } from '../create-gantt';
import { withClass } from '../shared/class-name';
import type { ThemeOption } from '../skeleton';

/**
 * What a task list needs from a chart: every method is public API, so a `Gantt` from `createGantt`
 * and a `GanttInstance` from `useGantt` both are one.
 *
 * @typeParam TData - Type of `task.data`.
 */
export type TaskListHost<TData = unknown> = Pick<
  Gantt<TData>,
  | 'core'
  | 'getAppearance'
  | 'getLayoutMetrics'
  | 'getRowMetrics'
  | 'getRows'
  | 'getRowWindow'
  | 'focusTask'
  | 'on'
  | 'scrollTo'
  | 'scrollToTask'
  | 'select'
  | 'setHoveredRow'
  | 'setOptions'
  | 'toggle'
>;

/**
 * A column of a task list; the renderers add what its cells draw with (`render`).
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskListColumnBase<TData = unknown> {
  /** The identity of the column; `data-column` of its cells. */
  readonly id: string;
  /** The text of its header. */
  readonly header?: string | undefined;
  /**
   * Its width in px, or `'fill'` to share what the other columns leave. Default: `'fill'` for the
   * tree column, `96` for the others.
   */
  readonly width?: number | 'fill' | undefined;
  /** How its cells are aligned; default `'start'`. */
  readonly align?: 'start' | 'center' | 'end' | undefined;
  /**
   * Whether this is the tree column, with the indent and the expand toggle. Default: the first
   * column; if several say so, the first of them.
   */
  readonly tree?: boolean | undefined;
  /**
   * The text of a cell. Default: the task's name in the tree column, nothing in the others. It is
   * called again when the row changes (`GanttRow` keeps its identity until then).
   */
  readonly value?: ((row: GanttRow<TData>) => string) | undefined;
}

/** The text a task list writes on its own, in your language or your words. */
export interface TaskListStrings {
  /** The accessible name of the list. Default `'Tasks'`. */
  readonly label: string;
  /** The header of the default column. Default `'Task'`. */
  readonly name: string;
  /** The accessible name of the splitter. Default `'Resize the task list'`. */
  readonly resize: string;
}

/** The options a task list has in both renderers. */
export interface TaskListSharedOptions {
  /** Its smallest width in px, for the splitter and `width`; default `120`. */
  readonly minWidth?: number | undefined;
  /** Its largest width in px; default `640`. */
  readonly maxWidth?: number | undefined;
  /** Whether it has a splitter on its end edge; default `true`. */
  readonly splitter?: boolean | undefined;
  /** How far each level of the tree is indented, in px; default `16`. */
  readonly indent?: number | undefined;
  /**
   * Whether the keys walk the cells as well as the rows; default `false`. With it on, Right on a
   * row steps into its first cell, the arrows, Home, End, Page Up and Page Down go on from cell to
   * cell (Up and Down keep the column; Ctrl or Cmd with Home or End goes to the first or last row
   * of the column), Left from the first cell steps back to the row, and Enter and Space on a cell
   * activate its row. In the column of the tree, Left shuts a group and Right opens one before
   * they move. A cell can be focused by script and by key, not by Tab: the row stays the one tab
   * stop. Each cell and header gets an `aria-colindex`.
   */
  readonly cellNavigation?: boolean | undefined;
  /** Its `data-theme`; default the theme of the chart, which it follows. */
  readonly theme?: ThemeOption | undefined;
  /** Any of the text it writes on its own. */
  readonly strings?: Partial<TaskListStrings> | undefined;
}

/** What a task list starts with. */
export const TASK_LIST_DEFAULTS: {
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly indent: number;
  readonly columnWidth: number;
  readonly strings: TaskListStrings;
} = /* @__PURE__ */ Object.freeze({
  width: 280,
  minWidth: 120,
  maxWidth: 640,
  indent: 16,
  columnWidth: 96,
  strings: /* @__PURE__ */ Object.freeze({
    label: 'Tasks',
    name: 'Task',
    resize: 'Resize the task list',
  }),
});

/** How many rows are drawn while the chart has no viewport yet: on a server, and before a mount. */
const ROWS_WITHOUT_VIEWPORT = 50;

/**
 * The width a list takes: `width` kept between its limits, the default for one that is no number.
 *
 * @param width - The width asked for.
 * @param options - The limits.
 * @returns The width in px.
 */
export function taskListWidth(width: unknown, options: TaskListSharedOptions): number {
  const wanted =
    typeof width === 'number' && Number.isFinite(width) ? width : TASK_LIST_DEFAULTS.width;
  const min = options.minWidth ?? TASK_LIST_DEFAULTS.minWidth;
  return Math.max(Math.min(wanted, options.maxWidth ?? TASK_LIST_DEFAULTS.maxWidth), min);
}

/**
 * The index of the tree column.
 *
 * @param columns - The columns.
 * @returns The first that says so, else the first.
 */
export function treeColumnOf<TData>(columns: readonly TaskListColumnBase<TData>[]): number {
  return Math.max(
    columns.findIndex((column) => column.tree === true),
    0,
  );
}

/**
 * The `grid-template-columns` of a list's rows: `--gantt-task-list-columns`.
 *
 * @param columns - The columns.
 * @returns The tracks.
 */
export function columnTracks<TData>(columns: readonly TaskListColumnBase<TData>[]): string {
  const tree = treeColumnOf(columns);
  return columns
    .map(({ width }, index) => {
      const given = width ?? (index === tree ? 'fill' : TASK_LIST_DEFAULTS.columnWidth);
      return given === 'fill' ? 'minmax(0, 1fr)' : `${String(given)}px`;
    })
    .join(' ');
}

/**
 * The text of a cell, when it is drawn from text.
 *
 * @param column - The column.
 * @param row - The row.
 * @param isTree - Whether it is the tree column.
 * @returns The text.
 */
export function cellText<TData>(
  column: TaskListColumnBase<TData>,
  row: GanttRow<TData>,
  isTree: boolean,
): string {
  return column.value?.(row) ?? (isTree ? row.name : '');
}

/**
 * Makes a tracker of the row that is a list's tab stop (one row of a tree can be tabbed to, a
 * roving tabindex): the row that has the focus, else the one that last had it or was last selected,
 * else the first. It remembers, so a list keeps one for as long as it lives.
 *
 * @returns The tracker: from a snapshot, the task of the tab stop.
 */
export function createTabStop(): <TData>(snapshot: GanttSnapshot<TData>) => TaskId | undefined {
  let last: TaskId | undefined;
  let followed: readonly TaskId[] | undefined;
  return <TData>(snapshot: GanttSnapshot<TData>): TaskId | undefined => {
    const { selection, focusedTask, layout } = snapshot;
    if (selection.tasks !== followed) {
      followed = selection.tasks;
      last = selection.tasks.at(-1) ?? last;
    }
    if (focusedTask !== undefined) last = focusedTask;
    const { rows } = layout;
    return last !== undefined && rows.rowOf(last) !== undefined ? last : rows.rows[0]?.id;
  };
}

/**
 * The rows a list draws: those of the chart's window, and the tab stop wherever it is (the browser
 * would lose the focus of a row that leaves the document, and a Tab has to find it), in row order.
 * While the chart has no viewport (a server, before it is mounted) the first rows instead, so that
 * the first paint has names, and a server and a browser draw the same.
 *
 * @param rows - `getRows()`.
 * @param window - `getRowWindow()`.
 * @param viewportHeight - `getLayoutMetrics().viewportHeight`.
 * @param tabStop - The task of the tab stop.
 * @returns The rows, in order.
 */
export function rowsToDraw<TData>(
  rows: readonly GanttRow<TData>[],
  window: RowWindow,
  viewportHeight: number,
  tabStop: TaskId | undefined,
): readonly GanttRow<TData>[] {
  if (viewportHeight === 0) return rows.slice(0, ROWS_WITHOUT_VIEWPORT);
  const drawn = rows.slice(Math.max(window.firstRow, 0), window.lastRow + 1);
  if (tabStop === undefined || drawn.some((row) => row.id === tabStop)) return drawn;
  const stop = rows.find((row) => row.id === tabStop);
  if (stop === undefined) return drawn;
  return stop.index < (drawn[0]?.index ?? 0) ? [stop, ...drawn] : [...drawn, stop];
}

/** What a list's row says about itself. */
export interface TaskListRowState {
  /** Whether the task is selected. */
  readonly selected: boolean;
  /** Whether the row is lit (`snapshot.hoveredRow`). */
  readonly hovered: boolean;
  /** Whether the task is invalid, as the chart's row says with `data-invalid`. */
  readonly invalid: boolean;
  /** The chart's `display.rowStripes`. */
  readonly stripes: false | 'row' | 'group';
}

/**
 * The attributes of a list's row, the same in both renderers: they are the contract of the styles.
 * A flag that is off is `undefined`, which neither renderer writes.
 *
 * @param row - The row.
 * @param state - What it says.
 * @returns The attributes by name.
 */
export function rowAttributes<TData>(
  row: GanttRow<TData>,
  state: TaskListRowState,
): Readonly<Record<string, string | number | undefined>> {
  const { record } = row;
  const on = (flag: boolean): '' | undefined => (flag ? '' : undefined);
  const stripe = state.stripes === 'row' ? row.rowStripe : state.stripes && row.groupStripe;
  return {
    role: 'row',
    'aria-level': row.depth + 1,
    'aria-setsize': row.setSize,
    'aria-posinset': row.position,
    // After the header, which is row 1.
    'aria-rowindex': row.index + 2,
    // For a group only: a task without children has no state to report.
    'aria-expanded': row.hasChildren ? String(row.isExpanded) : undefined,
    'aria-selected': String(state.selected),
    'data-row': row.index,
    'data-task-id': String(row.id),
    'data-group': on(row.hasChildren),
    'data-stripe': on(stripe === 1),
    'data-hovered': on(state.hovered),
    'data-placeholder': on(record.type === 'placeholder'),
    'data-invalid': on(state.invalid),
  };
}

/**
 * The class of a list's row: its own, and the task's `rowClassName`, as on the chart's row.
 *
 * @param record - The task's record.
 * @returns The class attribute.
 */
export function rowClass<TData>(record: TaskRecord<TData>): string {
  return withClass('gantt-task-list__row', record.task.rowClassName);
}

/**
 * The attributes of a cell, or of the header of a column, the same in both renderers: with
 * `cellNavigation` its place in the row. (Its `tabindex` is the renderer's own, since React spells
 * it `tabIndex`: -1 on a cell of a row, which script and keys can focus and Tab cannot.)
 *
 * @param index - The index of the column.
 * @param on - The `cellNavigation` option.
 * @returns The attributes by name.
 */
export function cellAttributes(
  index: number,
  on: boolean,
): Readonly<Record<string, number | undefined>> {
  return { 'aria-colindex': on ? index + 1 : undefined };
}

/** What a key does in a list, by the pattern of an ARIA tree. */
export type TreeAction =
  | {
      readonly type: 'focus';
      readonly id: TaskId;
      /** The cell of the row to focus, by the index of its column; the row itself when left out. */
      readonly column?: number | undefined;
    }
  | { readonly type: 'toggle'; readonly id: TaskId }
  | { readonly type: 'activate'; readonly id: TaskId };

/** The row `to` (kept among the rows) as a place for the focus, with one of its cells if asked. */
const focusAt = <TData>(
  rows: readonly GanttRow<TData>[],
  to: number,
  column?: number,
): TreeAction | undefined => {
  const target = rows[Math.min(Math.max(to, 0), rows.length - 1)];
  return target && { type: 'focus', id: target.id, column };
};

/**
 * What a key does to the row that has the focus: Up, Down, Page Up, Page Down, Home and End move;
 * Right opens a group, and steps into it once it is open; Left shuts one, and steps out to the
 * group a row is in; Enter and Space activate it.
 *
 * @param key - `KeyboardEvent.key`.
 * @param rows - The rows.
 * @param current - The task of the row that has the focus.
 * @param page - How many rows Page Up and Page Down move.
 * @returns The action, or `undefined` when the key means nothing here.
 */
export function treeAction<TData>(
  key: string,
  rows: readonly GanttRow<TData>[],
  current: TaskId,
  page: number,
): TreeAction | undefined {
  const index = rows.findIndex((row) => row.id === current);
  const row = rows[index];
  if (row === undefined) return undefined;
  switch (key) {
    case 'ArrowDown':
      return focusAt(rows, index + 1);
    case 'ArrowUp':
      return focusAt(rows, index - 1);
    case 'PageDown':
      return focusAt(rows, index + page);
    case 'PageUp':
      return focusAt(rows, index - page);
    case 'Home':
      return focusAt(rows, 0);
    case 'End':
      return focusAt(rows, rows.length - 1);
    case 'ArrowRight':
      if (!row.hasChildren) return undefined;
      return row.isExpanded ? focusAt(rows, index + 1) : { type: 'toggle', id: row.id };
    case 'ArrowLeft': {
      if (row.isExpanded) return { type: 'toggle', id: row.id };
      const parent = row.record.parentId;
      return parent === undefined ? undefined : { type: 'focus', id: parent };
    }
    case 'Enter':
    case ' ':
      return { type: 'activate', id: row.id };
    default:
      return undefined;
  }
}

/** Where the focus is in a list that walks its cells, and how the cells of a row lie. */
export interface CellPlace {
  /** The column of the cell that has the focus; `undefined` when the row itself has it. */
  readonly column: number | undefined;
  /** How many columns a row has. */
  readonly columns: number;
  /** The index of the tree column. */
  readonly tree: number;
}

/**
 * What a key does when a list walks its cells (`cellNavigation`), by the pattern of an ARIA
 * treegrid. From a row, Right steps into its first cell unless the row is a shut group, which
 * {@link treeAction} opens first. From a cell: Right and Left move along the row, and stay at its
 * ends, but in the tree column they open and shut the group first, and Left from the first cell
 * steps back to the row; Up, Down, Page Up and Page Down keep the column; Home and End go to the
 * first and last cell, with `ctrl` to the first and last row of the column. Enter and Space, and
 * every key that means nothing here, are left to {@link treeAction} (the result is `undefined`).
 *
 * @param key - `KeyboardEvent.key`.
 * @param ctrl - Whether Ctrl or Cmd is held.
 * @param rows - The rows.
 * @param current - The task of the row that has the focus, or whose cell has it.
 * @param place - Where the focus is in the row, and the cells.
 * @param page - How many rows Page Up and Page Down move.
 * @returns The action, or `undefined`.
 */
export function cellAction<TData>(
  key: string,
  ctrl: boolean,
  rows: readonly GanttRow<TData>[],
  current: TaskId,
  place: CellPlace,
  page: number,
): TreeAction | undefined {
  const index = rows.findIndex((row) => row.id === current);
  const row = rows[index];
  const { column, columns, tree } = place;
  if (row === undefined) return undefined;
  const shut = row.hasChildren && !row.isExpanded;
  if (column === undefined) {
    return key === 'ArrowRight' && !shut ? { type: 'focus', id: row.id, column: 0 } : undefined;
  }
  const along = (to: number): TreeAction | undefined =>
    focusAt(rows, index, Math.min(Math.max(to, 0), columns - 1));
  switch (key) {
    case 'ArrowDown':
      return focusAt(rows, index + 1, column);
    case 'ArrowUp':
      return focusAt(rows, index - 1, column);
    case 'PageDown':
      return focusAt(rows, index + page, column);
    case 'PageUp':
      return focusAt(rows, index - page, column);
    case 'Home':
      return ctrl ? focusAt(rows, 0, column) : along(0);
    case 'End':
      return ctrl ? focusAt(rows, rows.length - 1, column) : along(columns - 1);
    case 'ArrowRight':
      return column === tree && shut ? { type: 'toggle', id: row.id } : along(column + 1);
    case 'ArrowLeft':
      if (column === tree && row.isExpanded) return { type: 'toggle', id: row.id };
      return column === 0 ? { type: 'focus', id: row.id } : along(column - 1);
    default:
      return undefined;
  }
}

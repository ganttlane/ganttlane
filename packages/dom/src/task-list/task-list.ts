import type { GanttRow, TaskId } from '@ganttlane/core';

import { assertContainer } from '../container';
import { createDisposables } from '../dom-utils';
import { createHtml, createReconciler, px, setAttrs, setCssVar } from '../shared';
import { mediateTaskList, type TaskListRowHandlers } from './mediator';
import {
  cellText,
  columnTracks,
  createTabStop,
  rowAttributes,
  rowClass,
  rowsToDraw,
  TASK_LIST_DEFAULTS,
  type TaskListColumnBase,
  type TaskListHost,
  type TaskListSharedOptions,
  type TaskListStrings,
  taskListWidth,
  treeColumnOf,
} from './model';

/**
 * A column of {@link createTaskList}: what a cell shows is `render`'s node or text, else `value`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskListColumn<TData = unknown> extends TaskListColumnBase<TData> {
  /**
   * What a cell draws: a node, or a string as text (never parsed). `null` or `undefined` falls back
   * to `value`. Called again when the row changes, and the node of the last call is replaced.
   */
  readonly render?: ((row: GanttRow<TData>) => Node | string | null | undefined) | undefined;
}

/**
 * The options of {@link createTaskList}.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskListOptions<TData = unknown>
  extends TaskListSharedOptions, TaskListRowHandlers<TData> {
  /** The columns; default one, the task's name. */
  readonly columns?: readonly TaskListColumn<TData>[] | undefined;
  /** Its width in px to begin with, between `minWidth` and `maxWidth`; default `280`. */
  readonly width?: number | undefined;
  /** The user moved the splitter, or `setWidth` was called. */
  readonly onWidthChange?: ((width: number) => void) | undefined;
}

/**
 * A list made by {@link createTaskList}.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskList<TData = unknown> {
  /** Its root, `div.gantt-task-list`. */
  readonly element: HTMLElement;
  /** Changes options; a key left out keeps its value, one given as `undefined` its default. */
  readonly setOptions: (patch: TaskListOptions<TData>) => void;
  /** Its width in px. */
  readonly getWidth: () => number;
  /** Sets its width in px, kept between its limits. */
  readonly setWidth: (width: number) => void;
  /** Removes what it added, and leaves the chart as it found it. Safe to call twice. */
  readonly destroy: () => void;
}

/** A row as drawn. */
interface RowItem<TData> {
  readonly row: GanttRow<TData>;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly invalid: boolean;
  readonly tabStop: boolean;
}

/** What a row's view keeps: its node and what its cells were last drawn from. */
interface RowView<TData> {
  readonly node: HTMLDivElement;
  row?: GanttRow<TData>;
  columns?: readonly TaskListColumn<TData>[];
}

const DEFAULT_COLUMN = 'name';

/**
 * Draws a list of the tasks beside a chart, in `container`: a header as tall as the chart's, a row
 * for every row of the chart at the same height and place, indented by depth, with a toggle on the
 * groups, the columns you choose and a splitter on its end edge. The two are kept in sync: what is
 * expanded, what is selected, the row under the pointer or with the keyboard focus, the vertical
 * position, the theme and the sizes. It draws only the rows the chart draws.
 *
 * Put the container next to the chart's, tops aligned; the list is as wide as its `width` and the
 * chart takes what is left (`flex: none` on the list, `flex: 1; min-width: 0` on the chart). See
 * {@link mediateTaskList} for how each height of the chart scrolls. The stylesheet of the chart
 * (`@ganttlane/dom/styles.css`) styles it. A list turns on the chart's `display.rowHover`.
 *
 * Destroy it before the chart it belongs to, or after: it does not outlive it in any way that
 * matters, since a chart that is gone publishes nothing.
 *
 * @typeParam TData - Type of `task.data`.
 * @param container - Element to draw into.
 * @param gantt - The chart, from `createGantt`.
 * @param options - Columns, sizes and handlers.
 * @returns The list.
 * @throws {TypeError} When `container` is not an element.
 *
 * @example
 * ```ts
 * import '@ganttlane/dom/styles.css';
 * import { createGantt } from '@ganttlane/dom';
 * import { createTaskList } from '@ganttlane/dom/task-list';
 *
 * const gantt = createGantt(chart, { tasks, selection: { onClick: true } });
 * const list = createTaskList(side, gantt, {
 *   columns: [
 *     { id: 'name', header: 'Task' },
 *     { id: 'progress', header: '%', width: 48, align: 'end', value: (row) => `${row.record.progress}` },
 *   ],
 * });
 * ```
 */
export function createTaskList<TData = unknown>(
  container: HTMLElement,
  gantt: TaskListHost<TData>,
  options: TaskListOptions<TData> = {},
): TaskList<TData> {
  assertContainer(container, 'createTaskList');
  const document = container.ownerDocument;
  const disposables = createDisposables();
  let current: TaskListOptions<TData> = options;
  let width = taskListWidth(options.width, options);
  let destroyed = false;
  const stringsOf = (): TaskListStrings => ({
    ...TASK_LIST_DEFAULTS.strings,
    ...current.strings,
  });
  const resolveColumns = (): readonly TaskListColumn<TData>[] =>
    current.columns !== undefined && current.columns.length > 0
      ? current.columns
      : [{ id: DEFAULT_COLUMN, header: stringsOf().name }];
  let columns = resolveColumns();

  // ---- the markup ----

  const header = createHtml(document, 'div', {
    class: 'gantt-task-list__header-row',
    role: 'row',
    'aria-rowindex': 1,
  });
  const headerGroup = createHtml(
    document,
    'div',
    { class: 'gantt-task-list__header', role: 'rowgroup' },
    header,
  );
  const rowsBox = createHtml(document, 'div', {
    class: 'gantt-task-list__rows',
    role: 'presentation',
  });
  const body = createHtml(
    document,
    'div',
    { class: 'gantt-task-list__body', role: 'rowgroup' },
    rowsBox,
  );
  const grid = createHtml(
    document,
    'div',
    { class: 'gantt-task-list__grid', role: 'treegrid' },
    headerGroup,
    body,
  );
  const splitter = createHtml(document, 'div', {
    class: 'gantt-task-list__splitter',
    role: 'separator',
    'aria-orientation': 'vertical',
    tabindex: 0,
  });
  const root = createHtml(
    document,
    'div',
    { class: 'gantt-task-list gantt-scope' },
    grid,
    splitter,
  );
  container.append(root);
  disposables.add(() => {
    root.remove();
  });

  /** Draws the cells of a row, from what its view was last drawn from. */
  const drawCells = (view: RowView<TData>, row: GanttRow<TData>): void => {
    if (view.row === row && view.columns === columns) return;
    view.row = row;
    const tree = treeColumnOf(columns);
    const fresh = view.columns !== columns;
    view.columns = columns;
    if (fresh) {
      view.node.replaceChildren(
        ...columns.map((column, index) => {
          const cell = createHtml(document, 'div', {
            class: 'gantt-task-list__cell',
            role: 'gridcell',
            'data-column': column.id,
            'data-align': column.align,
            'data-tree': index === tree,
          });
          if (index === tree) {
            cell.append(
              createHtml(document, 'span', {
                class: 'gantt-task-list__toggle',
                'data-toggle': true,
                'aria-hidden': 'true',
              }),
              createHtml(document, 'span', { class: 'gantt-task-list__text' }),
            );
          }
          return cell;
        }),
      );
    }
    columns.forEach((column, index) => {
      const cell = view.node.children[index];
      const target = index === tree ? cell?.lastElementChild : cell;
      if (target === null || target === undefined) return;
      const content = column.render?.(row) ?? cellText(column, row, index === tree);
      if (typeof content === 'string') {
        if (target.textContent !== content) target.textContent = content;
        if (index === tree) setAttrs(target, { title: content });
      } else {
        target.replaceChildren(content);
      }
    });
    setCssVar(view.node, '--gantt-task-list-depth', String(row.depth));
  };

  const reconciler = createReconciler<RowItem<TData>, TaskId, RowView<TData>>(rowsBox, {
    key: (item) => item.row.id,
    create: () => ({ node: createHtml(document, 'div') }),
    update: (view, { row, selected, hovered, invalid, tabStop }) => {
      const { rowHeight } = gantt.getLayoutMetrics();
      setAttrs(view.node, {
        class: rowClass(row.record),
        tabindex: tabStop ? 0 : -1,
        ...rowAttributes(row, {
          selected,
          hovered,
          invalid,
          stripes: gantt.getAppearance().rowStripes,
        }),
      });
      setCssVar(view.node, '--gantt-task-list-y', px(row.index * rowHeight));
      drawCells(view, row);
    },
    node: (view) => view.node,
  });

  // ---- keeping up with the chart ----

  const tabStopOf = createTabStop();
  let drawnFrom: readonly unknown[] = [];
  const sync = (): void => {
    if (destroyed) return;
    const snapshot = gantt.core.getSnapshot();
    const metrics = gantt.getLayoutMetrics();
    const appearance = gantt.getAppearance();
    const strings = stringsOf();
    const { headerHeight, rowHeight, bodyHeight, viewportHeight } = metrics;
    setAttrs(root, {
      'data-theme': current.theme ?? appearance.theme,
      'data-height': appearance.height === 'auto' ? 'auto' : undefined,
    });
    setAttrs(grid, {
      'aria-label': strings.label,
      'aria-colcount': columns.length,
      'aria-rowcount': gantt.getRows().length + 1,
      'aria-multiselectable': appearance.multiSelect && 'true',
    });
    setAttrs(splitter, {
      'aria-label': strings.resize,
      'aria-valuenow': Math.round(width),
      'aria-valuemin': current.minWidth ?? TASK_LIST_DEFAULTS.minWidth,
      'aria-valuemax': current.maxWidth ?? TASK_LIST_DEFAULTS.maxWidth,
      hidden: current.splitter === false,
    });
    setCssVar(root, '--gantt-task-list-width', px(width));
    setCssVar(root, '--gantt-task-list-header-height', px(headerHeight));
    setCssVar(root, '--gantt-task-list-row-height', px(rowHeight));
    setCssVar(root, '--gantt-task-list-rows-height', px(bodyHeight));
    setCssVar(
      root,
      '--gantt-task-list-view-height',
      viewportHeight > 0 ? px(Math.max(viewportHeight - headerHeight, 0)) : undefined,
    );
    setCssVar(root, '--gantt-task-list-columns', columnTracks(columns));
    setCssVar(root, '--gantt-task-list-indent', px(current.indent ?? TASK_LIST_DEFAULTS.indent));
    drawHeader();

    const tabStop = tabStopOf(snapshot);
    const { tasks } = snapshot.selection;
    const { taskById } = snapshot.state.derived.model;
    const rows = gantt.getRows();
    const window = gantt.getRowWindow();
    const inputs = [
      rows,
      window,
      metrics,
      appearance,
      tasks,
      snapshot.hoveredRow,
      tabStop,
      columns,
    ];
    // Most changes of the snapshot are a scroll frame or a drag preview, and none of these changed.
    if (inputs.some((input, index) => input !== drawnFrom[index])) {
      drawnFrom = inputs;
      reconciler.sync(
        rowsToDraw(rows, window, viewportHeight, tabStop).map((row) => ({
          row,
          selected: tasks.includes(row.id),
          hovered: row.id === snapshot.hoveredRow,
          invalid: taskById.get(row.id)?.valid === false,
          tabStop: row.id === tabStop,
        })),
      );
    }
    mediator.afterDraw();
  };

  /** Draws the header's cells when the columns changed. */
  let headerOf: readonly TaskListColumn<TData>[] | undefined;
  const drawHeader = (): void => {
    if (headerOf === columns) return;
    headerOf = columns;
    header.replaceChildren(
      ...columns.map((column) =>
        createHtml(
          document,
          'div',
          {
            class: 'gantt-task-list__cell',
            role: 'columnheader',
            'data-column': column.id,
            'data-align': column.align,
          },
          column.header ?? '',
        ),
      ),
    );
  };

  const setWidth = (next: number): void => {
    const fitted = taskListWidth(next, current);
    if (fitted === width) return;
    width = fitted;
    sync();
    current.onWidthChange?.(width);
  };
  const mediator = mediateTaskList({
    gantt,
    body,
    splitter,
    handlers: () => current,
    width: () => ({
      width,
      min: current.minWidth ?? TASK_LIST_DEFAULTS.minWidth,
      max: current.maxWidth ?? TASK_LIST_DEFAULTS.maxWidth,
    }),
    resize: setWidth,
  });
  disposables.add(() => {
    mediator.destroy();
  });
  disposables.add(gantt.core.subscribe(sync));
  disposables.add(gantt.on('appearanceChange', sync));
  sync();

  return {
    element: root,
    setOptions(patch): void {
      if (destroyed) return;
      current = { ...current, ...patch };
      if ('columns' in patch || 'strings' in patch) columns = resolveColumns();
      width = taskListWidth('width' in patch ? patch.width : width, current);
      sync();
    },
    getWidth: () => width,
    setWidth(next): void {
      if (!destroyed) setWidth(next);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      disposables.dispose();
    },
  };
}

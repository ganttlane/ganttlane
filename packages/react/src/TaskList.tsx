import type { GanttRow } from '@ganttlane/dom';
import {
  cellText,
  columnTracks,
  createTabStop,
  mediateTaskList,
  rowAttributes,
  rowClass,
  rowsToDraw,
  TASK_LIST_DEFAULTS,
  type TaskListColumnBase,
  type TaskListMediator,
  type TaskListRowHandlers,
  type TaskListRowState,
  type TaskListSharedOptions,
  taskListWidth,
  treeColumnOf,
} from '@ganttlane/dom/task-list';
import {
  type CSSProperties,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { GanttInstance } from './types';
import { useIsomorphicLayoutEffect } from './use-gantt';
import { useGanttState } from './use-gantt-state';

/**
 * A column of {@link TaskList}: what a cell shows is `render`'s node, else `value`.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskListColumn<TData = unknown> extends TaskListColumnBase<TData> {
  /**
   * What a cell draws. `null` or `undefined` falls back to `value`. It is called while its row
   * renders, which is when the row changes or when you give new `columns`: memoize them if your
   * component renders often, and return a component of yours for a cell that uses hooks.
   */
  readonly render?: ((row: GanttRow<TData>) => ReactNode) | undefined;
}

/**
 * The props of {@link TaskList}.
 *
 * @typeParam TData - Type of `task.data`.
 */
export interface TaskListProps<TData = unknown>
  extends TaskListSharedOptions, TaskListRowHandlers<TData> {
  /** The chart, from `useGantt`. */
  readonly gantt: GanttInstance<TData>;
  /** The columns; default one, the task's name. */
  readonly columns?: readonly TaskListColumn<TData>[] | undefined;
  /**
   * Its width in px, controlled: it changes when your state does. Kept between `minWidth` and
   * `maxWidth`.
   */
  readonly width?: number | undefined;
  /** Its width in px to begin with, which it then owns; default `280`. */
  readonly defaultWidth?: number | undefined;
  /** The user moved the splitter. */
  readonly onWidthChange?: ((width: number) => void) | undefined;
  /** The `id` of its root. */
  readonly id?: string | undefined;
  /** More classes on its root. */
  readonly className?: string | undefined;
  /** More style on its root. */
  readonly style?: CSSProperties | undefined;
}

/** The props of a row: what makes it draw again. */
interface RowProps<TData> extends TaskListRowState {
  readonly row: GanttRow<TData>;
  readonly columns: readonly TaskListColumn<TData>[];
  readonly tree: number;
  readonly tabStop: boolean;
  readonly rowHeight: number;
}

/** A custom property in a `style`, which `CSSProperties` does not name. */
const vars = (values: Readonly<Record<string, string | number | undefined>>): CSSProperties =>
  values;

function RowOf<TData>({ row, columns, tree, tabStop, rowHeight, ...state }: RowProps<TData>) {
  return (
    <div
      {...rowAttributes(row, state)}
      role="row"
      className={rowClass(row.record)}
      tabIndex={tabStop ? 0 : -1}
      style={vars({
        '--gantt-task-list-y': `${String(row.index * rowHeight)}px`,
        '--gantt-task-list-depth': row.depth,
      })}
    >
      {columns.map((column, index) => {
        const isTree = index === tree;
        const content = column.render?.(row) ?? cellText(column, row, isTree);
        return (
          <div
            key={column.id}
            role="gridcell"
            className="gantt-task-list__cell"
            data-column={column.id}
            data-align={column.align}
            data-tree={isTree ? '' : undefined}
          >
            {isTree ? (
              <>
                <span className="gantt-task-list__toggle" data-toggle="" aria-hidden="true" />
                <span
                  className="gantt-task-list__text"
                  title={typeof content === 'string' ? content : undefined}
                >
                  {content}
                </span>
              </>
            ) : (
              content
            )}
          </div>
        );
      })}
    </div>
  );
}

const Row = memo(RowOf) as typeof RowOf;

/**
 * The list of the tasks beside a chart (for `@ganttlane/dom` it is `createTaskList`): a header as
 * tall as the chart's, a row for every row of the chart at the same height and place, indented by
 * depth, with a toggle on the groups, the columns you choose and a splitter on its end edge. The
 * two are kept in sync: what is expanded, what is selected, the row under the pointer or with the
 * keyboard focus, the vertical position, the theme and the sizes. It draws only the rows the chart
 * draws, and renders on a server.
 *
 * It takes the chart from `useGantt`, which exists while the component renders (a `ref` would be
 * `null` until the commit, and the first render of the list would be empty). Put it next to the
 * chart's container, tops aligned: it is as wide as its `width`, and `flex: 1; min-width: 0` gives
 * the chart what is left. With a fixed or filling height each has its own scroller and the list
 * can be a frame behind during a fast fling; with `layout.height: 'auto'`, in one box that scrolls,
 * they cannot differ. A list turns on the chart's `display.rowHover`.
 *
 * @typeParam TData - Type of `task.data`.
 * @param props - The chart, the columns, the width and the handlers.
 * @returns The list.
 *
 * @example
 * ```tsx
 * const columns = [
 *   { id: 'name', header: 'Task' },
 *   { id: 'progress', header: '%', width: 48, align: 'end', value: (row) => `${row.record.progress}` },
 * ];
 *
 * function Plan() {
 *   const gantt = useGantt({ defaultTasks: tasks, selection: { onClick: true } });
 *   const { setContainer, slots } = gantt;
 *   return (
 *     <div style={{ display: 'flex', height: 480 }}>
 *       <TaskList gantt={gantt} columns={columns} />
 *       <div ref={setContainer} style={{ flex: 1, minWidth: 0 }} />
 *       {slots}
 *     </div>
 *   );
 * }
 * ```
 */
export function TaskList<TData = unknown>(props: TaskListProps<TData>): ReactElement {
  const { gantt, width: controlled, defaultWidth, onWidthChange, id, className, style } = props;
  const { splitter, indent, theme, minWidth, maxWidth } = props;
  const strings = { ...TASK_LIST_DEFAULTS.strings, ...props.strings };
  const given = props.columns;
  const columns = useMemo<readonly TaskListColumn<TData>[]>(
    () =>
      given !== undefined && given.length > 0 ? given : [{ id: 'name', header: strings.name }],
    [given, strings.name],
  );

  const rows = useGanttState(gantt, () => gantt.getRows());
  const metrics = useGanttState(gantt, () => gantt.getLayoutMetrics());
  const rowWindow = useGanttState(gantt, () => gantt.getRowWindow());
  const selected = useGanttState(gantt, (snapshot) => snapshot.selection.tasks);
  const hovered = useGanttState(gantt, (snapshot) => snapshot.hoveredRow);
  const taskById = useGanttState(gantt, (snapshot) => snapshot.state.derived.model.taskById);
  const [tabStopOf] = useState(createTabStop);
  const tabStop = useGanttState(gantt, tabStopOf);
  const listenTo = useCallback(
    (listener: () => void) => {
      // A chart that replaced an earlier one (a hidden `<Activity>`) publishes a snapshot.
      const offAppearance = gantt.on('appearanceChange', listener);
      const offSnapshot = gantt.subscribe(listener);
      return () => {
        offAppearance();
        offSnapshot();
      };
    },
    [gantt],
  );
  const appearance = useSyncExternalStore(listenTo, gantt.getAppearance, gantt.getAppearance);

  // ---- the width, and what the mediator reads: always the latest ----

  const [own, setOwn] = useState(defaultWidth);
  const limits = { minWidth, maxWidth };
  const width = taskListWidth(controlled ?? own, limits);
  const resize = (next: number): void => {
    const fitted = taskListWidth(next, limits);
    if (fitted === width) return;
    if (controlled === undefined) setOwn(fitted);
    onWidthChange?.(fitted);
  };
  const min = minWidth ?? TASK_LIST_DEFAULTS.minWidth;
  const max = maxWidth ?? TASK_LIST_DEFAULTS.maxWidth;
  const latest = useRef({ props, width, min, max, resize });
  useIsomorphicLayoutEffect(() => {
    latest.current = { props, width, min, max, resize };
  });

  // ---- the mediator: what both renderers share ----

  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const mediator = useRef<TaskListMediator | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (body.current === null || handle.current === null) return undefined;
    const made = mediateTaskList<TData>({
      gantt,
      body: body.current,
      splitter: handle.current,
      handlers: () => latest.current.props,
      width: () => latest.current,
      resize: (next) => {
        latest.current.resize(next);
      },
    });
    mediator.current = made;
    return () => {
      mediator.current = null;
      made.destroy();
    };
  }, [gantt]);
  useIsomorphicLayoutEffect(() => {
    mediator.current?.afterDraw();
  });

  const { headerHeight, rowHeight, bodyHeight, viewportHeight } = metrics;
  const tree = treeColumnOf(columns);
  const drawn = rowsToDraw(rows, rowWindow, viewportHeight, tabStop);

  return (
    <div
      id={id}
      className={`gantt-task-list gantt-scope${className === undefined ? '' : ` ${className}`}`}
      data-theme={theme ?? appearance.theme}
      data-height={appearance.height === 'auto' ? 'auto' : undefined}
      style={{
        ...vars({
          '--gantt-task-list-width': `${String(width)}px`,
          '--gantt-task-list-header-height': `${String(headerHeight)}px`,
          '--gantt-task-list-row-height': `${String(rowHeight)}px`,
          '--gantt-task-list-rows-height': `${String(bodyHeight)}px`,
          '--gantt-task-list-view-height':
            viewportHeight > 0
              ? `${String(Math.max(viewportHeight - headerHeight, 0))}px`
              : undefined,
          '--gantt-task-list-columns': columnTracks(columns),
          '--gantt-task-list-indent': `${String(indent ?? TASK_LIST_DEFAULTS.indent)}px`,
        }),
        ...style,
      }}
    >
      <div
        className="gantt-task-list__grid"
        role="treegrid"
        aria-label={strings.label}
        aria-colcount={columns.length}
        aria-rowcount={rows.length + 1}
      >
        <div className="gantt-task-list__header" role="rowgroup">
          <div className="gantt-task-list__header-row" role="row" aria-rowindex={1}>
            {columns.map((column) => (
              <div
                key={column.id}
                className="gantt-task-list__cell"
                role="columnheader"
                data-column={column.id}
                data-align={column.align}
              >
                {column.header}
              </div>
            ))}
          </div>
        </div>
        <div ref={body} className="gantt-task-list__body" role="rowgroup">
          <div className="gantt-task-list__rows" role="presentation">
            {drawn.map((row) => (
              <Row
                key={row.id}
                row={row}
                columns={columns}
                tree={tree}
                tabStop={row.id === tabStop}
                rowHeight={rowHeight}
                selected={selected.includes(row.id)}
                hovered={row.id === hovered}
                invalid={taskById.get(row.id)?.valid === false}
                stripes={appearance.rowStripes}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        ref={handle}
        className="gantt-task-list__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label={strings.resize}
        aria-valuenow={Math.round(width)}
        aria-valuemin={min}
        aria-valuemax={max}
        // A separator that can be moved is a widget, by ARIA: the keys move it.
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
        tabIndex={0}
        hidden={splitter === false}
      />
    </div>
  );
}

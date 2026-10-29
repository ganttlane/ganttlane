import type { GanttSnapshot, Row, RowMetrics, TaskId, TaskModel } from '@ganttlane/core';

import { createReconciler, createSvg, setAttrs, withClass } from '../../shared';
import type { RowStripesOption } from '../types';

/** One row background to draw. */
interface RowItem {
  readonly metrics: RowMetrics;
  readonly stripe: boolean;
  readonly task: TaskModel | undefined;
}

/** The row backgrounds of the visible rows (`g.gantt__rows`). */
export interface RowsSection {
  /**
   * Draws the rows of the snapshot's window.
   *
   * @param snapshot - The snapshot.
   * @param stripes - Which zebra stripes to mark.
   */
  sync(snapshot: GanttSnapshot, stripes: RowStripesOption): void;
  /** Removes every row. */
  clear(): void;
}

/**
 * Creates the row backgrounds' section: `rect.gantt__row[data-row][data-task-id][data-stripe?]
 * [data-invalid?][data-placeholder?]` per row of the window, keyed by task id, with the task's
 * `rowClassName` added to the class (FR-ROW-3, FR-ROW-4).
 *
 * @param document - Document that owns the nodes.
 * @param container - The group the rects go into; the section owns it.
 * @returns The section.
 */
export function createRowsSection(document: Document, container: SVGGElement): RowsSection {
  let width = 0;
  const rows = createReconciler<RowItem, TaskId, SVGRectElement>(container, {
    key: (item) => item.metrics.id,
    create: () => createSvg(document, 'rect', { class: 'gantt__row' }),
    update: (rect, { metrics, stripe, task }) => {
      setAttrs(rect, {
        class: withClass('gantt__row', task?.task.rowClassName),
        'data-row': metrics.index,
        'data-task-id': String(metrics.id),
        'data-stripe': stripe,
        'data-invalid': task !== undefined && !task.valid,
        'data-placeholder': task?.type === 'placeholder',
        x: 0,
        y: metrics.y,
        width,
        height: metrics.height,
      });
    },
    node: (rect) => rect,
  });

  return {
    sync(snapshot, stripes): void {
      const { rows: metrics } = snapshot.layout.rows;
      const { rows: derived, model } = snapshot.state.derived;
      const first = Math.max(snapshot.window.firstRow, 0);
      const last = Math.min(snapshot.window.lastRow, metrics.length - 1);
      const items: RowItem[] = [];
      for (let index = first; index <= last; index++) {
        const row = metrics[index];
        if (row === undefined) continue;
        items.push({
          metrics: row,
          stripe: striped(derived[index], stripes),
          task: model.taskById.get(row.id),
        });
      }
      width = snapshot.contentWidth;
      rows.sync(items);
    },
    clear(): void {
      rows.clear();
    },
  };
}

/** Whether a row is on the odd stripe of the zebra (FR-ROW-4). */
function striped(row: Row | undefined, mode: RowStripesOption): boolean {
  if (row === undefined) return false;
  if (mode === 'row') return row.rowStripe === 1;
  return mode === 'group' && row.groupStripe === 1;
}

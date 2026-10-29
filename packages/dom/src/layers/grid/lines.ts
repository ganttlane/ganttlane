import type {
  DateTimeMs,
  GanttSnapshot,
  HeaderContext,
  RowMetrics,
  TimeRange,
  ViewMode,
} from '@ganttlane/core';
import { gridLines } from '@ganttlane/core';

import { createReconciler, createSvg, setAttrs } from '../../shared';
import type { GridLinesOption } from '../types';

/** One grid line to draw. */
export interface LineItem {
  readonly key: string;
  readonly orientation: 'vertical' | 'horizontal';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** A major line of the view mode (FR-SCALE-5). */
  readonly major: boolean;
  /** A minor line of the view mode (FR-SNAP-9). */
  readonly minor: boolean;
}

/** The grid lines (`g.gantt__gridlines`): vertical ones by time, horizontal ones by row. */
export interface LinesSection {
  /**
   * Replaces the vertical and / or the horizontal lines (`undefined` keeps them) and draws.
   *
   * @param update - The new lists.
   */
  set(update: {
    readonly vertical?: readonly LineItem[] | undefined;
    readonly horizontal?: readonly LineItem[] | undefined;
  }): void;
  /** Removes every line. */
  clear(): void;
}

/**
 * Creates the grid lines' section: `line.gantt__gridline[data-orientation][data-major?]
 * [data-minor?]`, keyed by position (vertical) or row index (horizontal) in one group
 * (FR-SCALE-5, FR-UI-4).
 *
 * @param document - Document that owns the nodes.
 * @param container - The group the lines go into; the section owns it.
 * @returns The section.
 */
export function createLinesSection(document: Document, container: SVGGElement): LinesSection {
  let vertical: readonly LineItem[] = [];
  let horizontal: readonly LineItem[] = [];
  const lines = createReconciler<LineItem, string, SVGLineElement>(container, {
    key: (item) => item.key,
    create: () => createSvg(document, 'line', { class: 'gantt__gridline' }),
    update: (line, item) => {
      setAttrs(line, {
        x1: item.x1,
        y1: item.y1,
        x2: item.x2,
        y2: item.y2,
        'data-orientation': item.orientation,
        'data-major': item.major,
        'data-minor': item.minor,
      });
    },
    node: (line) => line,
  });
  return {
    set(update): void {
      vertical = update.vertical ?? vertical;
      horizontal = update.horizontal ?? horizontal;
      lines.sync([...vertical, ...horizontal]);
    },
    clear(): void {
      lines.clear();
      vertical = [];
      horizontal = [];
    },
  };
}

/**
 * Whether the option draws vertical lines.
 *
 * @param option - `display.gridLines`.
 * @returns `true` for `'vertical'` and `'both'`.
 */
export function hasVerticalLines(option: GridLinesOption): boolean {
  return option === 'vertical' || option === 'both';
}

/**
 * Whether the option draws horizontal lines.
 *
 * @param option - `display.gridLines`.
 * @returns `true` for `'horizontal'` and `'both'`.
 */
export function hasHorizontalLines(option: GridLinesOption): boolean {
  return option === 'horizontal' || option === 'both';
}

/**
 * The vertical lines of a view mode in a time: column, major and minor lines from core's
 * `gridLines`, each as tall as the body.
 *
 * @param viewMode - The view mode (its column, major and minor rules).
 * @param time - The time to cover; `undefined` for none.
 * @param header - Scale and adapter.
 * @param height - Body height.
 * @returns The lines, left to right.
 */
export function verticalLines(
  viewMode: ViewMode,
  time: TimeRange | undefined,
  header: HeaderContext,
  height: number,
): readonly LineItem[] {
  if (time === undefined) return [];
  const items: LineItem[] = [];
  for (const line of gridLines(viewMode, time, header)) {
    items.push({
      key: `v${line.t}`,
      orientation: 'vertical',
      x1: line.x,
      y1: 0,
      x2: line.x,
      y2: height,
      major: line.kind === 'major',
      minor: line.kind === 'minor',
    });
  }
  return items;
}

/**
 * The horizontal lines of the rows in a window: one at the bottom edge of each row.
 *
 * @param snapshot - The snapshot whose rows and window to use.
 * @returns The lines, top to bottom.
 */
export function horizontalLines(snapshot: GanttSnapshot): readonly LineItem[] {
  const { rows } = snapshot.layout.rows;
  const first = Math.max(snapshot.window.firstRow, 0);
  const last = Math.min(snapshot.window.lastRow, rows.length - 1);
  const items: LineItem[] = [];
  for (let index = first; index <= last; index++) {
    const row: RowMetrics | undefined = rows[index];
    if (row === undefined) continue;
    const y = row.y + row.height;
    items.push({
      key: `h${index}`,
      orientation: 'horizontal',
      x1: 0,
      y1: y,
      x2: snapshot.contentWidth,
      y2: y,
      major: false,
      minor: false,
    });
  }
  return items;
}

/** The "today" line (`line.gantt__today`, FR-UI-1). */
export interface TodayLine {
  /**
   * Shows the line at `now`, or removes it for `undefined` and for a time outside the content.
   *
   * @param snapshot - The snapshot (scale, content width, body height).
   * @param now - The minute to draw at, `undefined` for no line.
   */
  set(snapshot: GanttSnapshot, now: DateTimeMs | undefined): void;
  /** Removes the line. */
  clear(): void;
}

/**
 * Creates the today line. It is appended to `container` when it first shows, so it is drawn
 * above the groups before it.
 *
 * @param document - Document that owns the node.
 * @param container - The group the line goes into (`g.gantt__grid`).
 * @returns The handle.
 */
export function createTodayLine(document: Document, container: SVGGElement): TodayLine {
  let line: SVGLineElement | undefined;
  const clear = (): void => {
    line?.remove();
    line = undefined;
  };
  return {
    set(snapshot, now): void {
      const x = now === undefined ? undefined : snapshot.header.scale.dateToX(now);
      if (x === undefined || x < 0 || x > snapshot.contentWidth) {
        clear();
        return;
      }
      if (line === undefined) {
        line = createSvg(document, 'line', { class: 'gantt__today' });
        container.append(line);
      }
      setAttrs(line, { x1: x, y1: 0, x2: x, y2: snapshot.layout.rows.bodyHeight });
    },
    clear,
  };
}

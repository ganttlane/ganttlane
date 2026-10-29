import type { GanttSnapshot, HeaderContext, ViewMode } from '@ganttlane/core';

import { throwCollected } from '../../dom-utils/errors';
import { covers, createSvg, type DrawnSpan, same, spanOf, visibleTime } from '../../shared';
import type { LayerContext, LayerSlots, RendererLayer } from '../types';
import { createHighlightsSection, createNonWorkingSection, type NonWorkingInput } from './days';
import {
  createLinesSection,
  createTodayLine,
  hasHorizontalLines,
  hasVerticalLines,
  horizontalLines,
  type LineItem,
  verticalLines,
} from './lines';
import { createRowsSection } from './rows';

/** What the row backgrounds and the horizontal lines were computed from. */
interface RowInputs {
  readonly rows: GanttSnapshot['layout']['rows'];
  readonly derivedRows: GanttSnapshot['state']['derived']['rows'];
  readonly model: GanttSnapshot['state']['derived']['model'];
  readonly firstRow: number;
  readonly lastRow: number;
  readonly contentWidth: number;
  readonly stripes: LayerContext['display']['rowStripes'];
  readonly horizontal: boolean;
}

/**
 * What the days and the vertical lines were computed from: everything but the scroll position.
 * The visible time is a function of these and of the scroll position, see `covers`.
 */
interface TimeInputs {
  readonly header: HeaderContext;
  readonly viewMode: ViewMode;
  readonly calendar: NonWorkingInput['calendar'];
  readonly height: number;
  readonly contentWidth: number;
  readonly nonWorkingDays: LayerContext['display']['nonWorkingDays'];
  readonly highlights: LayerContext['display']['highlights'];
  readonly highlightDays: LayerContext['display']['highlightDays'];
  readonly vertical: boolean;
}

/**
 * The grid layer: row backgrounds with zebra stripes, non-working days, highlights, grid lines
 * and the "today" line (at `snapshot.now`), drawn into `g.gantt__grid`.
 *
 * ```
 * g.gantt__grid
 *   g.gantt__rows
 *     rect.gantt__row[data-row][data-task-id][data-stripe?][data-invalid?][data-placeholder?]
 *   g.gantt__nonworking[data-mode="fill|stripes"]
 *     rect.gantt__nonworking-day[data-day][data-reason]
 *     defs > pattern#<instance>-stripes.gantt__stripes > line.gantt__stripes-line   (stripes)
 *   g.gantt__highlights
 *     rect.gantt__highlight[data-highlight][data-day]
 *   g.gantt__gridlines
 *     line.gantt__gridline[data-orientation][data-major?][data-minor?]
 *   line.gantt__today?
 * ```
 *
 * Geometry is set as SVG attributes; the look comes from the theme through classes, `data-*`
 * and `--gantt-*` properties (a highlight's `color` is `--gantt-highlight-color` on its rect).
 * In stripes mode the rects carry `fill="url(#<instance>-stripes)"`, a reference and not a
 * colour: the theme must leave the `fill` of `[data-mode="stripes"]` rects alone and give
 * `.gantt__stripes-line` a `stroke`.
 *
 * **What is drawn.** Rows: those of the window (`snapshot.window.firstRow … lastRow`). Time:
 * the window clipped to the content, one rect per day for non-working days and highlights
 * (days narrower than 2 px are skipped) and core's `gridLines` for the vertical lines.
 * Horizontal lines are the bottom edges of the window's rows.
 *
 * **Work per update.** Each part is redrawn only when its inputs changed: the rows when the
 * row layout, the model, the window's rows, the content width or the stripes option changed;
 * the time parts when the view mode, scale, calendar, body height, content width or their
 * display options changed or when the viewport has come within half an overscan of the edge
 * of what is drawn. A scroll inside the drawn window touches no node. Items are reconciled by
 * key (task id, day, line position), so a redraw keeps the nodes that stay. No layout is read.
 *
 * **Errors.** A highlight's `match` is the caller's code, and one that throws stops nothing: the
 * whole grid is drawn first (rows, non-working days, the highlights' other days, lines, the
 * today line), the draw counts as the drawn state, and only then the errors are thrown, one per
 * highlight (a single one as it is, several as an `AggregateError`), as the bars layer does for
 * `renderBarLabel`. Because the draw is the drawn state, the same inputs, a repeated snapshot or
 * a scroll inside the drawn window neither ask the predicate again nor throw again; a new list,
 * other display options or a scroll past the drawn window draw (and report) again. Highlights
 * that are not objects, and fields of the wrong type (`dates` that is no array, a `range` without
 * two readable ends, a `match` that is no function), are skipped without an error: the facade
 * reports them as issues, the grid just must not crash on them.
 *
 * @returns A new layer, one per chart instance.
 */
export function createGridLayer(): RendererLayer<LayerSlots['grid']> {
  let instance: GridInstance | undefined;
  return {
    mount(context): void {
      instance = createInstance(context);
    },
    update(snapshot): void {
      instance?.update(snapshot);
    },
    destroy(): void {
      instance?.destroy();
      instance = undefined;
    },
  };
}

interface GridInstance {
  update(snapshot: GanttSnapshot): void;
  destroy(): void;
}

function createInstance(context: LayerContext<LayerSlots['grid']>): GridInstance {
  const { root, document } = context;
  const group = (name: string): SVGGElement => createSvg(document, 'g', { class: name });
  const groups = {
    rows: group('gantt__rows'),
    nonWorking: group('gantt__nonworking'),
    highlights: group('gantt__highlights'),
    lines: group('gantt__gridlines'),
  };
  root.append(groups.rows, groups.nonWorking, groups.highlights, groups.lines);

  const rows = createRowsSection(document, groups.rows);
  const nonWorking = createNonWorkingSection(context, groups.nonWorking);
  const highlights = createHighlightsSection(document, groups.highlights);
  const lines = createLinesSection(document, groups.lines);
  const today = createTodayLine(document, root);

  let rowInputs: RowInputs | undefined;
  let timeInputs: TimeInputs | undefined;
  let span: DrawnSpan | undefined;

  return {
    update(snapshot): void {
      const { display } = context;
      const { header, viewMode, layout, contentWidth, window: win } = snapshot;
      const { model, rows: derivedRows } = snapshot.state.derived;
      const height = layout.rows.bodyHeight;

      const wantedRows: RowInputs = {
        rows: layout.rows,
        derivedRows,
        model,
        firstRow: win.firstRow,
        lastRow: win.lastRow,
        contentWidth,
        stripes: display.rowStripes,
        horizontal: hasHorizontalLines(display.gridLines),
      };
      const redrawRows = rowInputs === undefined || !same(rowInputs, wantedRows);

      const wantedTime: TimeInputs = {
        header,
        viewMode,
        calendar: model.options.calendar,
        height,
        contentWidth,
        nonWorkingDays: display.nonWorkingDays,
        highlights: display.highlights,
        highlightDays: display.highlightDays,
        vertical: hasVerticalLines(display.gridLines),
      };
      const redrawTime =
        timeInputs === undefined || !same(timeInputs, wantedTime) || !covers(span, snapshot);

      let vertical: readonly LineItem[] | undefined;
      let horizontal: readonly LineItem[] | undefined;
      let errors: readonly unknown[] = [];
      if (redrawRows) {
        rows.sync(snapshot, wantedRows.stripes);
        horizontal = wantedRows.horizontal ? horizontalLines(snapshot) : [];
        rowInputs = wantedRows;
      }
      if (redrawTime) {
        const time = visibleTime(snapshot);
        nonWorking.sync({
          mode: wantedTime.nonWorkingDays,
          time,
          header,
          calendar: wantedTime.calendar,
          height,
        });
        errors = highlights.sync({
          enabled: wantedTime.highlights,
          highlights: wantedTime.highlightDays,
          time,
          header,
          height,
        });
        vertical = wantedTime.vertical ? verticalLines(viewMode, time, header, height) : [];
        timeInputs = wantedTime;
        span = spanOf(snapshot);
      }
      if (vertical !== undefined || horizontal !== undefined) lines.set({ vertical, horizontal });
      today.set(snapshot, display.today ? snapshot.now : undefined);
      throwCollected(errors, 'Several highlights failed to match days');
    },
    destroy(): void {
      rows.clear();
      nonWorking.clear();
      highlights.clear();
      lines.clear();
      today.clear();
      for (const node of Object.values(groups)) node.remove();
      rowInputs = undefined;
      timeInputs = undefined;
      span = undefined;
    },
  };
}

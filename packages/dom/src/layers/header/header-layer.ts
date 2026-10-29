import type {
  DateTimeMs,
  GanttSnapshot,
  HeaderContext,
  HeaderRowSpec,
  InteractionFeedback,
  TaskId,
  TimeRange,
  ViewMode,
} from '@ganttlane/core';
import { gridLines, headerRows } from '@ganttlane/core';

import type { DrawnSpan, Reconciler } from '../../shared';
import {
  covers,
  createHtml,
  createReconciler,
  px,
  same,
  setAttr,
  setAttrs,
  spanOf,
  visibleTime,
} from '../../shared';
import type { LayerContext, LayerSlots, RendererLayer, ResolvedDisplay } from '../types';

/** One header cell to draw: a core `HeaderCell` clipped to the content, plus its major flag. */
interface CellItem {
  /** The unit of the row the cell belongs to. */
  readonly unit: HeaderRowSpec['unit'];
  readonly start: DateTimeMs;
  readonly end: DateTimeMs;
  /** Left edge in content px, clipped to `0`. */
  readonly x: number;
  /** Width in px, clipped to the content. */
  readonly width: number;
  readonly label: string;
  /** Whether the cell begins on a major grid line. */
  readonly major: boolean;
}

/** The nodes of a drawn cell. */
interface CellView {
  readonly cell: HTMLDivElement;
  readonly label: HTMLSpanElement;
  readonly text: Text;
  /** The `left` and `width` last written, in px (`NaN` before the first write). */
  left: number;
  width: number;
}

/** One header row to draw. */
interface RowItem {
  readonly index: number;
  readonly spec: HeaderRowSpec;
  readonly height: number;
}

/** A drawn header row: its element, its cells and which of them carry the moving flags. */
interface RowView {
  readonly row: HTMLDivElement;
  readonly cells: Reconciler<CellItem, DateTimeMs, CellView>;
  /** The `height` last written, in px (`NaN` before the first write). */
  height: number;
  /** The cells drawn last, in order. */
  items: readonly CellItem[];
  /** The cell whose label has `data-sticky`. */
  sticky: CellView | undefined;
  /** The cell that has `data-current`. */
  current: CellView | undefined;
}

/** What the drawn cells were computed from (everything but the scroll position and the clock). */
interface CellInputs {
  readonly viewMode: ViewMode;
  readonly header: HeaderContext;
  readonly heights: readonly number[];
  readonly contentWidth: number;
}

/** What the sticky and current flags were last set for. */
interface FlagInputs {
  readonly scrollLeft: number;
  readonly now: DateTimeMs | undefined;
}

const NO_MAJORS: ReadonlySet<number> = new Set<number>();

/**
 * The header layer: the sticky rows of cells above the body, drawn into `div.gantt__header`.
 *
 * ```
 * div.gantt__header
 *   div.gantt__header-row[data-unit][data-row]
 *     div.gantt__header-cell[data-unit][data-major?][data-current?]
 *       span.gantt__header-label[data-sticky?]
 *   div.gantt__header-range?          the hovered or dragged bar's range
 *   div.gantt__today-marker?          today
 * ```
 *
 * The rows come from the view mode's `headers` through core's `headerRows`, one row per header
 * row of the view mode, top first, each cell as wide as its real interval on the time scale,
 * so a month over day columns is one cell. Labels are formatted by core (locale and adapter of
 * the snapshot). Only the cells of the virtualization window (`snapshot.window`: the visible
 * time plus overscan) exist, clipped to the content: nothing is drawn beyond the scrollable
 * width, which would extend the scroller.
 *
 * **Flags.** `data-current` is the cell that contains `snapshot.now` (with `display.today`; the
 * core's `now` option, the clock reading the renderer refreshes once a minute), `data-major`
 * a cell that begins on a major grid line of the view mode (the lines the grid layer draws),
 * and `data-sticky` is on the label of the cell under the left edge of the viewport, once per
 * row. The label of that cell is meant to stay in view (`position: sticky; left: 0`, which
 * the theme may apply to every label: it only has an effect on a cell that begins left of the
 * viewport).
 *
 * **Geometry.** HTML elements get their geometry through the CSSOM (`style.setProperty`: no
 * style attribute text, so a strict `style-src` is fine), in px, and only when it changed:
 *
 * | Element | Properties written |
 * |---|---|
 * | `.gantt__header-row` | `height` (its header row height) |
 * | `.gantt__header-cell` | `left`, `width` |
 * | `.gantt__header-range` | `left`, `width` |
 * | `.gantt__today-marker` | `left` |
 *
 * `left` is relative to the left edge of the header (= of the content), so cells, the range
 * and the marker are meant to be `position: absolute`; rows are in the flow. A label sticks to
 * the left edge of the viewport only if nothing between it and the scroller clips with
 * `overflow: hidden` (or `auto`, `scroll`): use `overflow: clip` on the cells and rows.
 *
 * **Work per update.** The cells are redrawn only when the view mode, the scale, the locale,
 * the row heights or the content width changed, or when the viewport has come within half an
 * overscan of the edge of what is drawn; a scroll inside it touches no node except `data-sticky`
 * when the left edge crosses a cell boundary. Cells are reconciled by their start date, so a
 * redraw keeps the nodes of the cells that stay. No layout is read.
 *
 * @returns A new layer, one per chart instance.
 */
export function createHeaderLayer(): RendererLayer<LayerSlots['header']> {
  let instance: HeaderInstance | undefined;
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

interface HeaderInstance {
  update(snapshot: GanttSnapshot): void;
  destroy(): void;
}

function createInstance(context: LayerContext<LayerSlots['header']>): HeaderInstance {
  const { root, document } = context;

  const rows = createReconciler<RowItem, number, RowView>(root, {
    key: (item) => item.index,
    create: () => {
      const row = createHtml(document, 'div', { class: 'gantt__header-row' });
      const cells = createReconciler<CellItem, DateTimeMs, CellView>(row, {
        key: (cell) => cell.start,
        create: (cell) => createCell(document, cell),
        update: (view, cell) => {
          updateCell(view, cell);
        },
        node: (view) => view.cell,
      });
      return { row, cells, height: Number.NaN, items: [], sticky: undefined, current: undefined };
    },
    update: (view, item) => {
      setAttrs(view.row, { 'data-unit': item.spec.unit, 'data-row': item.index });
      if (view.height !== item.height) {
        setLength(view.row, 'height', item.height);
        view.height = item.height;
      }
    },
    node: (view) => view.row,
    remove: (view) => {
      view.cells.clear();
    },
  });

  let range: HTMLDivElement | undefined;
  let marker: HTMLDivElement | undefined;
  // What the range and the marker were last given, in px.
  let rangeLeft = Number.NaN;
  let rangeWidth = Number.NaN;
  let markerLeft = Number.NaN;
  let inputs: CellInputs | undefined;
  let span: DrawnSpan | undefined;
  let flags: FlagInputs | undefined;

  const removeRange = (): void => {
    range?.remove();
    range = undefined;
  };
  const removeMarker = (): void => {
    marker?.remove();
    marker = undefined;
  };

  const drawCells = (snapshot: GanttSnapshot): void => {
    const { viewMode, header, contentWidth } = snapshot;
    const heights = snapshot.layoutOptions.headerRowHeights;
    rows.sync(
      viewMode.headers.map((spec, index) => ({ index, spec, height: heights[index] ?? 0 })),
    );
    const time = visibleTime(snapshot);
    if (time === undefined) {
      for (const view of rows.views.values()) {
        view.items = [];
        view.cells.sync([]);
      }
      return;
    }
    const majors = majorStarts(viewMode, time, header);
    headerRows(viewMode, time, header).forEach((cells, index) => {
      const view = rows.views.get(index);
      const unit = viewMode.headers[index]?.unit;
      if (view === undefined || unit === undefined) return;
      const items: CellItem[] = [];
      for (const cell of cells) {
        const x = Math.max(cell.x, 0);
        const width = Math.min(cell.x + cell.width, contentWidth) - x;
        if (width <= 0) continue;
        items.push({
          unit,
          start: cell.start,
          end: cell.end,
          x,
          width,
          label: cell.label,
          major: majors.has(cell.start),
        });
      }
      view.items = items;
      view.cells.sync(items);
    });
  };

  /** Moves `data-sticky` and `data-current` to the cells that have them now. */
  const drawFlags = (scrollLeft: number, now: DateTimeMs | undefined): void => {
    for (const view of rows.views.values()) {
      const { items, cells } = view;
      const stickyItem = stickyOf(items, scrollLeft);
      const sticky = stickyItem === undefined ? undefined : cells.views.get(stickyItem.start);
      if (sticky !== view.sticky) {
        if (view.sticky) setAttr(view.sticky.label, 'data-sticky', false);
        if (sticky) setAttr(sticky.label, 'data-sticky', true);
        view.sticky = sticky;
      }
      const currentItem = now === undefined ? undefined : currentOf(items, now);
      const current = currentItem === undefined ? undefined : cells.views.get(currentItem.start);
      if (current !== view.current) {
        if (view.current) setAttr(view.current.cell, 'data-current', false);
        if (current) setAttr(current.cell, 'data-current', true);
        view.current = current;
      }
    }
  };

  const drawMarker = (snapshot: GanttSnapshot, now: DateTimeMs | undefined): void => {
    const x = now === undefined ? undefined : snapshot.header.scale.dateToX(now);
    if (x === undefined || x < 0 || x > snapshot.contentWidth) {
      removeMarker();
      return;
    }
    if (marker === undefined) {
      marker = createHtml(document, 'div', { class: 'gantt__today-marker' });
      markerLeft = Number.NaN;
      root.append(marker);
    }
    if (markerLeft !== x) {
      setLength(marker, 'left', x);
      markerLeft = x;
    }
  };

  const drawRange = (snapshot: GanttSnapshot, display: ResolvedDisplay): void => {
    const id = display.headerRangeHighlight ? highlightedTask(snapshot.feedback) : undefined;
    const bar = id === undefined ? undefined : snapshot.layout.getBarRect(id);
    if (bar === undefined) {
      removeRange();
      return;
    }
    if (range === undefined) {
      range = createHtml(document, 'div', { class: 'gantt__header-range' });
      rangeLeft = Number.NaN;
      rangeWidth = Number.NaN;
      root.append(range);
    }
    if (rangeLeft !== bar.x) {
      setLength(range, 'left', bar.x);
      rangeLeft = bar.x;
    }
    if (rangeWidth !== bar.width) {
      setLength(range, 'width', bar.width);
      rangeWidth = bar.width;
    }
  };

  return {
    update(snapshot): void {
      const { display } = context;
      const now = display.today ? snapshot.now : undefined;
      const wanted: CellInputs = {
        viewMode: snapshot.viewMode,
        header: snapshot.header,
        heights: snapshot.layoutOptions.headerRowHeights,
        contentWidth: snapshot.contentWidth,
      };
      const redraw = inputs === undefined || !same(inputs, wanted) || !covers(span, snapshot);
      if (redraw) {
        drawCells(snapshot);
        inputs = wanted;
        span = spanOf(snapshot);
      }
      const { scrollLeft } = snapshot.timeline;
      if (redraw || flags?.scrollLeft !== scrollLeft || flags.now !== now) {
        drawFlags(scrollLeft, now);
        flags = { scrollLeft, now };
      }
      drawMarker(snapshot, now);
      drawRange(snapshot, display);
    },
    destroy(): void {
      rows.clear();
      removeRange();
      removeMarker();
      inputs = undefined;
      span = undefined;
      flags = undefined;
    },
  };
}

/** Builds a cell's nodes: structure only, `updateCell` writes the rest. */
function createCell(document: Document, item: CellItem): CellView {
  const text = document.createTextNode(item.label);
  const label = createHtml(document, 'span', { class: 'gantt__header-label' }, text);
  const cell = createHtml(document, 'div', { class: 'gantt__header-cell' }, label);
  return { cell, label, text, left: Number.NaN, width: Number.NaN };
}

function updateCell(view: CellView, item: CellItem): void {
  setAttrs(view.cell, { 'data-unit': item.unit, 'data-major': item.major });
  if (view.left !== item.x) {
    setLength(view.cell, 'left', item.x);
    view.left = item.x;
  }
  if (view.width !== item.width) {
    setLength(view.cell, 'width', item.width);
    view.width = item.width;
  }
  if (view.text.data !== item.label) view.text.data = item.label;
}

/** Writes one length in px through the CSSOM (`style.setProperty`: no style attribute text). */
function setLength(
  element: HTMLElement,
  property: 'left' | 'width' | 'height',
  value: number,
): void {
  element.style.setProperty(property, px(value));
}

/**
 * Starts of the major grid lines in `time`, for `data-major`; none when the view mode has no
 * major line. Minor lines are not needed, hence the infinite spacing.
 */
function majorStarts(
  viewMode: ViewMode,
  time: TimeRange,
  header: HeaderContext,
): ReadonlySet<number> {
  if (viewMode.majorLine === undefined || viewMode.majorLine === false) return NO_MAJORS;
  const starts = new Set<number>();
  for (const line of gridLines(viewMode, time, header, { minMinorSpacingPx: Infinity })) {
    if (line.kind === 'major') starts.add(line.t);
  }
  return starts;
}

/** The cell under the left edge: the last one that starts at or before it. */
function stickyOf(items: readonly CellItem[], scrollLeft: number): CellItem | undefined {
  let found = items[0];
  for (const item of items) {
    if (item.x > scrollLeft) break;
    found = item;
  }
  return found;
}

/** The cell that contains `now`. */
function currentOf(items: readonly CellItem[], now: DateTimeMs): CellItem | undefined {
  return items.find((item) => item.start <= now && now < item.end);
}

/** The task whose bar range the header highlights: the dragged one, else the hovered one. */
function highlightedTask(feedback: InteractionFeedback): TaskId | undefined {
  if (feedback.phase === 'dragging' && feedback.gesture !== 'link-create') return feedback.id;
  return feedback.hover.kind === 'task' ? feedback.hover.id : undefined;
}

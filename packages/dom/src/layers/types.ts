import type { GanttCore, GanttSnapshot, InteractionEvent, RendererEffect } from '@ganttlane/core';

import type { ResolvedDisplay } from '../display';
import type { LayerScheduler } from '../scheduler';
import type { GanttStrings } from '../strings';

/**
 * The root element each layer draws into, by layer name. The skeleton creates these elements
 * and hands each to its layer as {@link LayerContext.root}.
 */
export interface LayerSlots {
  /** `div.gantt__header`: sticky header rows (HTML). */
  readonly header: HTMLDivElement;
  /** `g.gantt__grid`: row backgrounds, non-working days, highlights, grid lines, today line. */
  readonly grid: SVGGElement;
  /** `g.gantt__links`: link arrows and their hit areas. */
  readonly links: SVGGElement;
  /** `g.gantt__bars`: task bars (rect, progress, label, handles). */
  readonly bars: SVGGElement;
  /**
   * `g.gantt__overlay`: the link preview. The today line belongs to the grid, and a bar's drag
   * preview needs no node: the layout already has the draft, so the bars layer draws it.
   */
  readonly overlay: SVGGElement;
  /** `div.gantt__layer`: popovers and tooltips (HTML, outside the scroller). */
  readonly popover: HTMLDivElement;
}

export type {
  BarLabelContext,
  BarLabelOption,
  BarLabelRenderer,
  GridLinesOption,
  HighlightInput,
  NonWorkingDaysOption,
  ResolvedDisplay,
  RowStripesOption,
} from '../display';
export type { GanttStrings, GanttStringsInput } from '../strings';

/** The name of a layer, which is also its slot. */
export type LayerName = keyof LayerSlots;

/**
 * Layer names in registration order: the order of `mount` and `update` calls, and, reversed, of
 * `destroy`. For the SVG layers it is also the stacking order (later is on top), so links draw
 * over the grid, bars over links, the overlay over bars.
 */
export const LAYER_ORDER: readonly LayerName[] = [
  'header',
  'grid',
  'links',
  'bars',
  'overlay',
  'popover',
];

/** What a layer is given when it is mounted. Everything in it belongs to one chart instance. */
export interface LayerContext<TRoot extends Element = Element> {
  /** The layer's own element in the skeleton. A layer adds nodes below it and nowhere else. */
  readonly root: TRoot;
  /** The document of the chart: create nodes with it (a chart may live in an iframe). */
  readonly document: Document;
  /**
   * The scroll container (`div.gantt__scroller`). Read-only by convention: the renderer owns
   * `scrollLeft` / `scrollTop` writes. Reading its geometry is for event handlers (pointer
   * down), never for `update` or scroll handlers.
   */
  readonly scroller: HTMLElement;
  /** Prefix of every element id of this instance, e.g. `gantt-2`. */
  readonly idPrefix: string;
  /** `${idPrefix}-${name}`: the only way a layer should make an element id. */
  id(name: string): string;
  /**
   * Aborted on destroy. Register every listener with it (`listen(target, type, fn, { signal })`
   * from `@ganttlane/dom/dom-utils`), so that nothing outlives the chart.
   */
  readonly signal: AbortSignal;
  /** Frame scheduler of the instance: `schedule(task)` runs `task` once in the next frame. */
  readonly scheduler: LayerScheduler;
  /**
   * The current display options (grid lines, today line, non-working days, highlights, row
   * stripes, bar labels, …), resolved and frozen. Read it in `update`: it is a new object exactly
   * when an option changed (`mountRenderer(...).setDisplay`), so a layer compares it by identity
   * with the one it drew last.
   */
  readonly display: ResolvedDisplay;
  /**
   * The text the chart writes on its own: the defaults with the `strings` option
   * over them, resolved and frozen. A layer takes every such text from here and hard-codes none.
   * Like `display` it is a new object exactly when a string changed (`MountedRenderer.setStrings`),
   * so compare it by identity with the one you drew with. The chart's locale is
   * `snapshot.header.locale`; the functions in here take it as an argument.
   */
  readonly strings: GanttStrings;
  /**
   * Sends an interaction event (pointer, key, timeline; content coordinates) to the core and
   * returns the effects left to the renderer (`core.send`).
   */
  send(event: InteractionEvent): readonly RendererEffect[];
  /**
   * Listens to a core event (`taskClick`, `linkClick`, `selectionChange`, `rangeChange`, …;
   * `GanttCore.on`) for the life of the chart: every subscription ends on destroy, and after
   * destroy nothing subscribes. The returned function ends it earlier; calling it twice is safe.
   */
  readonly on: GanttCore['on'];
  /** The public record of a task (`Date` values, `TaskRecord`), as `GanttCore.getTask`. */
  readonly getTask: GanttCore['getTask'];
  /** The public record of a link, as `GanttCore.getLink`. */
  readonly getLink: GanttCore['getLink'];
}

/**
 * One slice of the chart's DOM. The renderer creates the root element, calls `mount` once, then
 * `update` with every snapshot it renders, then `destroy` once.
 *
 * A layer owns its root's subtree: it creates nodes in `mount` or lazily in `update`, keeps
 * them in sync (keyed, attribute-level: see `createReconciler`) and removes everything in
 * `destroy`. It reads only what `@ganttlane/core` exposes (the snapshot, `ctx.send`) and never
 * imports another layer, which is enforced by `pnpm lint:deps`.
 *
 * @typeParam TRoot - Type of the layer's root element, see {@link LayerSlots}.
 */
export interface RendererLayer<TRoot extends Element = Element> {
  /** Called once, after the skeleton exists and before the first `update`. */
  mount(context: LayerContext<TRoot>): void;
  /**
   * Draws a snapshot. Called with every snapshot the renderer renders (at most once per frame),
   * the first one with `previous === undefined`. A snapshot keeps the identity of its unchanged
   * parts, so `snapshot.layout === previous?.layout` is a valid "nothing to do" check for the
   * snapshot. When only the display options changed, `update` is called again with
   * `snapshot === previous`: compare `context.display` with the display last drawn as well. Do
   * not read layout (`getBBox`, `getBoundingClientRect`) here.
   */
  update(snapshot: GanttSnapshot, previous: GanttSnapshot | undefined): void;
  /** Called once on destroy, in reverse registration order: remove every node the layer added. */
  destroy(): void;
}

/** A layer's factory: called once per chart instance, so a layer can keep state in a closure. */
export type LayerFactory<N extends LayerName = LayerName> = () => RendererLayer<LayerSlots[N]>;

/** Layer factories by name; a partial set replaces the built-in layers of the same names. */
export type LayerFactories = { readonly [N in LayerName]?: LayerFactory<N> };

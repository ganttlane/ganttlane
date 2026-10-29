import type { GanttSnapshot, LinkRoute, LinkType } from '@ganttlane/core';

import { createReconciler, createSvg, type Reconciler, setAttr, setAttrs } from '../../shared';
import type { LayerContext, LayerSlots, RendererLayer } from '../types';
import { createLinkIndex, type LinkEntry, routeOf } from './link-index';

/** The nodes of one link and what was last written to them, so that an update can skip. */
interface LinkView {
  readonly node: SVGGElement;
  readonly line: SVGPathElement;
  readonly arrow: SVGPathElement;
  readonly hit: SVGPathElement;
  /** The route whose `d` strings the paths carry. */
  route: LinkRoute | undefined;
  /** The type and flags `node` carries: `undefined` before the first write. */
  type: LinkType | undefined;
  flags: number;
}

const SELECTED = 1;
const CONFLICT = 2;
const CYCLE = 4;

/** What a drawn picture depends on: if none of it changed, `update` has nothing to do. */
interface Drawn {
  readonly layout: GanttSnapshot['layout'];
  readonly window: GanttSnapshot['window'];
  readonly graph: GanttSnapshot['state']['derived']['graph'];
  readonly conflicts: GanttSnapshot['state']['derived']['conflicts'];
  readonly selected: string | undefined;
  readonly radius: number;
}

/**
 * The links layer: one `g.gantt__link` per drawn link in `g.gantt__links`,
 * keyed by link id. Each group holds the visible route (`path.gantt__link-path`), the arrowhead
 * (`path.gantt__link-arrow`) and a copy of the route to hit (`path.gantt__link-hit`; the theme
 * strokes it wide and transparent, `--gantt-link-hit-width`).
 *
 * ```
 * g.gantt__link[data-link-id][data-type][data-selected?][data-conflict?][data-cycle?]
 *   path.gantt__link-path[d]
 *   path.gantt__link-arrow[d]
 *   path.gantt__link-hit[d][data-link-id]
 * ```
 *
 * - **What is drawn.** Active links whose box (`linkBBox`) touches `snapshot.window`: its rows
 *   and its time range, overscan included. A link to a task that is hidden by a collapsed
 *   parent is not drawn at all (it is not re-pointed at the parent's row: the core has no such
 *   rule, and a link into the parent's own bar would read as a different dependency). Links
 *   that touch a task without a bar are inactive in the core's graph and are not drawn either.
 * - **Routes** come from the core's `routeLink` (every type, either direction) with
 *   `display.linkCurveRadius`, over the bars of `snapshot.layout`, so the links of a bar that
 *   is being dragged follow the preview. A route is made again only when one of its two bars,
 *   its type or the radius changed.
 * - **States** are `data-selected` (`snapshot.selection.link`), `data-conflict` (a
 *   `link-violated` conflict of the committed data, `state.derived.conflicts`) and `data-cycle`
 *   (the link is on a cycle of the link graph).
 * - **Updates** are keyed and attribute-level: a scroll that leaves the same links in the window
 *   writes nothing, and one that changes the set adds and removes only the links that entered
 *   or left. No layout is read.
 *
 * Pointer input is not wired here: the renderer's pointer handling resolves `{ kind: 'link', id }`
 * from the event target through `data-link-id`, which sits on the group and on the hit path.
 *
 * @returns A new layer, one per chart instance.
 */
export function createLinksLayer(): RendererLayer<LayerSlots['links']> {
  const index = createLinkIndex();
  let context: LayerContext<LayerSlots['links']> | undefined;
  let links: Reconciler<LinkEntry, string, LinkView> | undefined;
  let drawn: Drawn | undefined;

  return {
    mount(ctx): void {
      context = ctx;
      const { document } = ctx;
      links = createReconciler<LinkEntry, string, LinkView>(ctx.root, {
        key: (entry) => entry.id,
        create(entry): LinkView {
          // The route is an open path: `fill="none"` keeps it (and its hit copy) from being
          // filled with the default black when there is no stylesheet.
          const line = createSvg(document, 'path', { class: 'gantt__link-path', fill: 'none' });
          const arrow = createSvg(document, 'path', { class: 'gantt__link-arrow' });
          const hit = createSvg(document, 'path', {
            class: 'gantt__link-hit',
            fill: 'none',
            'data-link-id': entry.id,
          });
          const node = createSvg(
            document,
            'g',
            { class: 'gantt__link', 'data-link-id': entry.id },
            line,
            arrow,
            hit,
          );
          return { node, line, arrow, hit, route: undefined, type: undefined, flags: -1 };
        },
        update(view, entry): void {
          const route = routeOf(entry);
          if (route !== undefined && view.route !== route) {
            setAttr(view.line, 'd', route.d);
            setAttr(view.hit, 'd', route.d);
            setAttr(view.arrow, 'd', route.arrow);
            view.route = route;
          }
          const flags =
            (entry.selected ? SELECTED : 0) |
            (entry.conflict ? CONFLICT : 0) |
            (entry.cycle ? CYCLE : 0);
          if (view.type !== entry.type || view.flags !== flags) {
            setAttrs(view.node, {
              'data-type': entry.type,
              'data-selected': (flags & SELECTED) !== 0,
              'data-conflict': (flags & CONFLICT) !== 0,
              'data-cycle': (flags & CYCLE) !== 0,
            });
            view.type = entry.type;
            view.flags = flags;
          }
        },
        node: (view) => view.node,
      });
    },

    update(snapshot): void {
      if (context === undefined || links === undefined) return;
      const radius = context.display.linkCurveRadius;
      const { derived } = snapshot.state;
      const selected = snapshot.selection.link;
      if (
        drawn?.layout === snapshot.layout &&
        drawn.window === snapshot.window &&
        drawn.graph === derived.graph &&
        drawn.conflicts === derived.conflicts &&
        drawn.selected === selected &&
        drawn.radius === radius
      ) {
        return;
      }
      links.sync(index.visible(snapshot, radius));
      drawn = {
        layout: snapshot.layout,
        window: snapshot.window,
        graph: derived.graph,
        conflicts: derived.conflicts,
        selected,
        radius,
      };
    },

    destroy(): void {
      drawn = undefined;
      context = undefined;
      index.clear();
      const mounted = links;
      links = undefined;
      mounted?.clear();
    },
  };
}

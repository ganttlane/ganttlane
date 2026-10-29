import type { LinkPreview } from '@ganttlane/core';

import { createSvg, setAttrs } from '../../shared';
import type { LayerSlots, RendererLayer } from '../types';

/**
 * The overlay layer: what floats over the bars inside the SVG body, drawn into
 * `g.gantt__overlay` (which takes no pointer events).
 *
 * - **Link preview (FR-LINK-4).** While a link is being created, by dragging from a link handle
 *   or by click-click, one `path.gantt__link-preview` runs from the centre of the handle to the
 *   pointer, or to the anchor of the target bar when the pointer is over one
 *   (`snapshot.feedback.link`, the same preview the core's `link-preview` effect carries; the
 *   snapshot also has it when the effect was swallowed by an API call). `data-valid` is present
 *   unless the core refuses the target under the pointer (itself, a cycle, a duplicate, a task
 *   that may not be linked: FR-LINK-6), so the theme shows free space and a valid target alike
 *   and a refusal differently. The node is made on the first preview of a gesture, kept while
 *   the gesture lasts and removed when it ends.
 *
 * The drag preview of a bar itself needs no node here: the snapshot's layout already has the
 * draft, so the bars layer draws the bar where the drag puts it, and the propagated tasks with it.
 *
 * @returns A new layer, one per chart instance.
 */
export function createOverlayLayer(): RendererLayer<LayerSlots['overlay']> {
  let context: Parameters<RendererLayer<LayerSlots['overlay']>['mount']>[0] | undefined;
  let line: SVGPathElement | undefined;
  let shown: LinkPreview | undefined;

  return {
    mount(next): void {
      context = next;
    },

    update(snapshot): void {
      const preview = snapshot.feedback.link;
      if (context === undefined || preview === shown) return;
      shown = preview;
      if (preview === undefined) {
        line?.remove();
        line = undefined;
        return;
      }
      if (line === undefined) {
        line = createSvg(context.document, 'path', { class: 'gantt__link-preview' });
        context.root.append(line);
      }
      const { from, to } = preview;
      setAttrs(line, {
        d: `M${from.x} ${from.y}L${to.x} ${to.y}`,
        'data-valid': preview.refusal === undefined,
      });
    },

    destroy(): void {
      line?.remove();
      line = undefined;
      shown = undefined;
      context = undefined;
    },
  };
}

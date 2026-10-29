import { type BarGeometry, barsInWindow, type GanttSnapshot, type TaskId } from '@ganttlane/core';

import { throwCollected } from '../../dom-utils/errors';
import { createReconciler, type Reconciler } from '../../shared';
import type { LayerContext, LayerSlots, RendererLayer } from '../types';
import {
  BAR_FLAGS,
  type BarEnv,
  type BarItem,
  type BarView,
  createBarView,
  releaseBarView,
  updateBarView,
} from './bar-view';
import { estimateTextWidth } from './label';

/** Options of {@link createBarsLayer}. */
export interface BarsLayerOptions {
  /**
   * Width in px of a label text, for `auto` placement. The default estimates from character
   * widths (`estimateTextWidth`) because `update` must not read layout (NFR-PERF-2); give a
   * measuring function (a canvas `measureText` with a cache, say) for an unusual font.
   */
  readonly measureText?: ((text: string) => number) | undefined;
  /** Font size in px the default estimate assumes; default 12, the default theme's size. */
  readonly fontSize?: number | undefined;
}

/** Everything the last sync was made from: a repeat of it draws nothing. */
interface Seen {
  readonly bars: readonly BarGeometry[];
  readonly model: GanttSnapshot['state']['derived']['model'];
  readonly conflicts: GanttSnapshot['state']['derived']['conflicts'];
  readonly draft: GanttSnapshot['state']['draft'];
  readonly selection: GanttSnapshot['selection'];
  readonly feedback: GanttSnapshot['feedback'];
  readonly epoch: number;
}

/** Whether two lists hold the same objects in the same order. */
function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * The bars layer (FR-BAR-1 … FR-BAR-5, FR-ROW-3): one view per bar of `snapshot.window`
 * (`barsInWindow`), keyed by task id, drawn into `g.gantt__bars`.
 *
 * - **Markup.** `g.gantt__bar[data-task-id][data-type]` with the task's `className`, `color`
 *   as `--gantt-bar-color` (and `progressColor` as `--gantt-bar-progress-color`) set through
 *   the CSSOM, and the state flags `data-selected`, `data-hovered`, `data-dragging`,
 *   `data-resizing`, `data-locked`, `data-readonly`, `data-movable`, `data-invalid`,
 *   `data-conflict` (each present or absent; `data-movable` is the task's `move` permission, so
 *   a bar that may only be resized or linked lacks it). Children: `rect.gantt__bar-track` and
 *   `rect.gantt__bar-progress`, or
 *   `polygon.gantt__bar-milestone`; the label `.gantt__bar-label[data-placement]` (a `text`, or
 *   a `foreignObject` for a custom node); and, only where the task's permissions allow the
 *   gesture, `rect.gantt__handle[data-handle="resize-start|resize-end|progress"]` and
 *   `circle.gantt__link-handle[data-side="start|end"]`.
 * - **Geometry** is core's, as it is: the layout already has the draft over the model, so a
 *   dragged bar is drawn at its preview position.
 * - **Handles** follow the snapshot: which of them a bar gets comes from `snapshot.editing` (the
 *   `editing` option) and the task's own permissions, and their sizes, which the core's hit test
 *   uses too, from `snapshot.handles` (`interaction.handles`): the circle's `r` is `link`, and
 *   nothing in the theme can change it. An outside label starts beyond the link handle
 *   (`linkOffset + link` of those sizes, then the label padding) on every bar, also on one that
 *   has no handle (a read-only chart, `linkable: false`): the gap belongs to the chart.
 * - **Labels with a lifetime.** A document fragment from `renderBarLabel` can be shown once (its
 *   children move into the label), and a `DisposableNode` is disposed when its label is hidden,
 *   when the label's inputs change (the new content is made first), when the bar leaves the
 *   window and when the chart is destroyed; either way the renderer is asked again when the
 *   label comes back.
 * - **Cost.** A view keeps its nodes and writes only the attributes that changed. A bar whose
 *   inputs are as before is not touched (a scroll that leaves the same bars in the window
 *   touches nothing); a bar that enters the window gets new nodes, and those of a bar that left
 *   are dropped (a pool of them was measured at under 0.1 ms per frame, step 4.5, and removed
 *   in step 5.3 to make room for the disposal contract). No layout is ever read: label widths
 *   are estimated (see {@link BarsLayerOptions.measureText}).
 *
 * @param options - See {@link BarsLayerOptions}.
 * @returns A new layer, one per chart instance.
 */
export function createBarsLayer(options: BarsLayerOptions = {}): RendererLayer<LayerSlots['bars']> {
  const fontSize = options.fontSize;
  const measure = options.measureText ?? ((text: string) => estimateTextWidth(text, fontSize));
  let context: LayerContext<LayerSlots['bars']> | undefined;
  let env: BarEnv | undefined;
  let views: Reconciler<BarItem, TaskId, BarView> | undefined;
  let seen: Seen | undefined;
  let selectedTasks: readonly TaskId[] | undefined;
  let selected: ReadonlySet<TaskId> = new Set();

  return {
    mount(next): void {
      context = next;
      const shared: BarEnv = {
        document: next.document,
        display: next.display,
        editing: undefined,
        handles: undefined,
        labelOptions: {},
        measure,
        epoch: 0,
        errors: [],
      };
      env = shared;
      views = createReconciler<BarItem, TaskId, BarView>(next.root, {
        key: (item) => item.bar.id,
        create: () => createBarView(shared.document),
        update: (view, item) => {
          updateBarView(view, item, shared);
        },
        node: (view) => view.node,
        remove: releaseBarView,
      });
    },

    update(snapshot): void {
      if (context === undefined || env === undefined || views === undefined) return;
      const { display } = context;
      const { editing, handles } = snapshot;
      if (env.display !== display || env.editing !== editing || env.handles !== handles) {
        if (env.handles !== handles) {
          env.labelOptions = { handleReach: handles.linkOffset + handles.link };
        }
        env.display = display;
        env.editing = editing;
        env.handles = handles;
        env.epoch++;
      }

      const { derived, draft } = snapshot.state;
      const { selection, feedback } = snapshot;
      const bars = barsInWindow(snapshot.window, snapshot.layout);
      const last = seen;
      if (
        last?.epoch === env.epoch &&
        last.model === derived.model &&
        last.conflicts === derived.conflicts &&
        last.draft === draft &&
        last.selection === selection &&
        last.feedback === feedback &&
        sameList(last.bars, bars)
      ) {
        return;
      }
      // Until the sync is done, a failure must not make the next update a no-op.
      seen = undefined;
      env.errors.length = 0;

      if (selection.tasks !== selectedTasks) {
        selectedTasks = selection.tasks;
        selected = new Set(selection.tasks);
      }
      const hovered = feedback.hover.kind === 'task' ? feedback.hover.id : undefined;
      // The bar being edited: moved or its progress dragged (`dragging`), or an edge (`resizing`).
      const gesture = feedback.phase === 'dragging' ? feedback.gesture : undefined;
      const resizing = gesture === 'resize-start' || gesture === 'resize-end';
      const active =
        resizing || gesture === 'move' || gesture === 'progress' ? feedback.id : undefined;
      const items: BarItem[] = [];
      for (const bar of bars) {
        const model = derived.model.taskById.get(bar.id);
        if (model === undefined) continue;
        let flags = 0;
        if (selected.has(bar.id)) flags |= BAR_FLAGS.selected;
        if (hovered === bar.id) flags |= BAR_FLAGS.hovered;
        if (active === bar.id) flags |= resizing ? BAR_FLAGS.resizing : BAR_FLAGS.dragging;
        if (derived.conflicts.has(bar.id)) flags |= BAR_FLAGS.conflict;
        items.push({
          bar,
          model,
          progress: draft?.patches.get(bar.id)?.progress ?? model.progress,
          flags,
        });
      }
      views.sync(items);
      seen = {
        bars,
        model: derived.model,
        conflicts: derived.conflicts,
        draft,
        selection,
        feedback,
        epoch: env.epoch,
      };
      throwCollected(env.errors.splice(0), 'Several bar labels failed to render');
    },

    destroy(): void {
      try {
        views?.clear();
      } finally {
        views = undefined;
        env = undefined;
        context = undefined;
        seen = undefined;
      }
    },
  };
}

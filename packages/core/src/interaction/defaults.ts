/**
 * Defaults of the interaction layer (`InteractionOptions`).
 */

/**
 * Default values of `InteractionOptions`:
 * - `dragThreshold` 3 px (mouse, pen) and `touchDragThreshold` 8 px: how far a press travels
 *   before it becomes a drag; shorter presses are clicks (FR-EDIT-3; the fork used 10 px);
 * - `doubleClickTime` 500 ms and `doubleClickDistance` 6 px: the second click of a double click
 *   (the common desktop default); clicks are never delayed or blocked;
 * - `handles`: resize zones 8 px wide inside the edges, a progress handle of ±6 px, link handles
 *   of radius 6 px centred 10 px outside the edges (`barHandles`).
 */
export const INTERACTION_DEFAULTS: {
  readonly dragThreshold: number;
  readonly touchDragThreshold: number;
  readonly doubleClickTime: number;
  readonly doubleClickDistance: number;
  readonly handles: {
    readonly resize: number;
    readonly progress: number;
    readonly link: number;
    readonly linkOffset: number;
  };
} = /* @__PURE__ */ Object.freeze({
  dragThreshold: 3,
  touchDragThreshold: 8,
  doubleClickTime: 500,
  doubleClickDistance: 6,
  handles: /* @__PURE__ */ Object.freeze({ resize: 8, progress: 6, link: 6, linkOffset: 10 }),
});

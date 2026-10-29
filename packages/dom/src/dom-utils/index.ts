/**
 * DOM utilities shared by `@ganttlane/dom` and `@ganttlane/react`: renderer-agnostic helpers for
 * listeners, disposal, element size, id prefixes, the Pointer Events adapter (DOM events to the
 * core's interaction input, targets from the unstyled contract), the drag autoscroll loop, popover
 * positioning and scrolling helpers (`scrollByInstant`, the page host of a chart with automatic
 * height), and the rule for markup that shows nothing (`showsNothing`). They know nothing about
 * the vanilla renderer's layers or the core.
 *
 * @packageDocumentation
 */

export type { AutoScroller, AutoScrollerOptions, FrameSource } from './autoscroll';
export { createAutoScroller } from './autoscroll';
export type { Disposables, Dispose } from './disposables';
export { createDisposables } from './disposables';
export { allocateIdPrefix, DEFAULT_ID_BASE, prefixedId } from './ids';
export type { ListenOptions } from './listen';
export { listen } from './listen';
export type { PointerFrame, PointerScroll } from './pointer';
export {
  hitTargetOf,
  keyInput,
  measureFrame,
  pointerInput,
  pointerOnScrollbar,
  pointerOutsideBody,
} from './pointer';
export type { Placement, PlacementInput, Rect, Side, Size } from './position';
export { CURSOR_SIZE, intersectRects, placePopover, pointRect, viewportRect } from './position';
export type { ElementSize, SizeObservation } from './resize';
export { measureSize, observeSize } from './resize';
export type { HostBox, ScrollDelta, ScrollHost } from './scroll';
export {
  forwardScroll,
  measureHost,
  observeHostSize,
  scrollByInstant,
  scrollHostOf,
} from './scroll';
export { showsNothing } from './visibility';

/**
 * CSS class of a gantt chart's root element. Both renderers use it, so the
 * default theme from `@ganttlane/dom/styles.css` applies to either.
 */
export const ROOT_CLASS = 'gantt';

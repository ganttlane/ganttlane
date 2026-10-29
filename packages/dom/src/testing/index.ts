/**
 * Test helpers of `@ganttlane/dom`: manual frames, listener tracking, a fake `ResizeObserver`,
 * fake and real cores, and the layer contract suite. Test files only: production code never
 * imports this folder (`.dependency-cruiser.ts`, rule `dom-testing-only-from-tests`), and no
 * entry point of the build reaches it.
 *
 * @module
 */

export type { FakeCore, FakeSnapshotParts, ObservedCore } from './core';
export {
  createFakeCore,
  createTestCore,
  fakeSnapshot,
  fakeViewportChange,
  observeCore,
} from './core';
export {
  countNodes,
  createContainer,
  FakeResizeObserver,
  installFakeResizeObserver,
  resizeObserved,
  stubScrollerSize,
} from './dom';
export type { ManualFrames } from './frames';
export { createManualFrames } from './frames';
export type { LayerHarness } from './layers';
export {
  createLayerHarness,
  createSnapshotPair,
  describeLayerContract,
  instrumentLayers,
} from './layers';
export type { ListenerTracker, TrackedListener } from './listeners';
export { trackListeners } from './listeners';
// The strings, for layer tests: a layer's folder may not import them from the renderer's side.
export { DEFAULT_STRINGS, resolveStrings } from '../strings';

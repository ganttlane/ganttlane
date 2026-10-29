import type {
  GanttEventMap,
  GanttEventName,
  GanttSnapshot,
  InteractionEvent,
} from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type DisplayOptions, type ResolvedDisplay, resolveDisplay } from '../display';
import { BUILT_IN_LAYERS } from '../layers/registry';
import type {
  LayerContext,
  LayerFactories,
  LayerFactory,
  LayerName,
  LayerSlots,
  RendererLayer,
} from '../layers/types';
import { LAYER_ORDER } from '../layers/types';
import type { FrameScheduler } from '../scheduler';
import { createFrameScheduler } from '../scheduler';
import { createSkeleton } from '../skeleton';
import { type GanttStrings, type GanttStringsInput, resolveStrings } from '../strings';
import { createTestCore } from './core';
import { countNodes } from './dom';
import type { ManualFrames } from './frames';
import { createManualFrames } from './frames';
import type { ListenerTracker } from './listeners';
import { trackListeners } from './listeners';

/** Everything a layer test needs around one layer: its root, a context, and the frame queue. */
export interface LayerHarness<N extends LayerName> {
  /** The layer's root element, inside a real skeleton. */
  readonly root: LayerSlots[N];
  /** The context to pass to `layer.mount`. */
  readonly context: LayerContext<LayerSlots[N]>;
  /** The manual frame queue behind `context.scheduler`. */
  readonly frames: ManualFrames;
  /** The scheduler behind `context.scheduler` (tests may `flush()` it). */
  readonly scheduler: FrameScheduler;
  /** Events the layer sent through `context.send`. */
  readonly sent: readonly InteractionEvent[];
  /** Aborts `context.signal`, as the renderer does on destroy. */
  abort(): void;
  /** Changes `context.display`, as `setDisplay` does (the layer sees it in its next `update`). */
  setDisplay(options: DisplayOptions): void;
  /** Changes `context.strings`, as `setStrings` does (the layer sees it in its next `update`). */
  setStrings(strings: GanttStringsInput): void;
  /** Calls the handlers the layer registered with `context.on` for `name`. */
  emit<K extends GanttEventName>(name: K, ...args: Parameters<GanttEventMap[K]>): void;
}

/**
 * Builds a context for one layer, the way the renderer would: the root comes from a real
 * skeleton, the signal and scheduler are the instance's own.
 *
 * @param name - Which layer's root to use.
 * @param display - Display options of the chart; default the defaults.
 * @param idPrefix - The instance's id prefix, `context.idPrefix` and the prefix of
 *   `context.id(…)`: give each harness of a test its own to mount several instances. Default
 *   `'test-1'`.
 * @param strings - The `strings` option of the chart; default the defaults.
 * @returns The harness.
 */
export function createLayerHarness<N extends LayerName>(
  name: N,
  display?: DisplayOptions,
  idPrefix = 'test-1',
  strings?: GanttStringsInput,
): LayerHarness<N> {
  let current: ResolvedDisplay = resolveDisplay(display);
  let currentStrings: GanttStrings = resolveStrings(strings);
  const skeleton = createSkeleton(document, { idPrefix, theme: 'auto' });
  document.body.append(skeleton.root);
  const frames = createManualFrames();
  const scheduler = createFrameScheduler(frames);
  const controller = new AbortController();
  const sent: InteractionEvent[] = [];
  const events = new Map<string, Set<(...args: never[]) => void>>();
  const context: LayerContext<LayerSlots[N]> = {
    root: skeleton[name],
    document,
    scroller: skeleton.scroller,
    idPrefix,
    id: (local) => `${idPrefix}-${local}`,
    signal: controller.signal,
    scheduler,
    get display() {
      return current;
    },
    get strings() {
      return currentStrings;
    },
    send: (event) => {
      sent.push(event);
      return [];
    },
    on: (name, handler) => {
      const set = events.get(name) ?? new Set();
      events.set(name, set);
      const fn = handler as (...args: never[]) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    getTask: () => undefined,
    getLink: () => undefined,
  };
  return {
    root: skeleton[name],
    context,
    frames,
    scheduler,
    sent,
    abort: () => {
      controller.abort();
    },
    setDisplay: (options) => {
      current = resolveDisplay(options, current);
    },
    setStrings: (patch) => {
      currentStrings = resolveStrings(patch, currentStrings);
    },
    emit: (name, ...args) => {
      for (const fn of [...(events.get(name) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    },
  };
}

/**
 * The built-in layers, each wrapped so that `onUpdate` hears of every `update` with the layer's
 * name and how long it took (milliseconds): for tests that count renders or time layers.
 *
 * @param onUpdate - Called after each `update` of each layer.
 * @returns Layer factories to pass as `RendererOptions.layers`.
 */
export function instrumentLayers(
  onUpdate: (name: LayerName, milliseconds: number) => void,
): LayerFactories {
  const wrap = (name: LayerName): RendererLayer => {
    // The built-in factories have one root type each; the wrapper only passes everything on.
    const layer = BUILT_IN_LAYERS[name]() as unknown as RendererLayer;
    return {
      mount: (context) => {
        layer.mount(context);
      },
      update: (snapshot, previous) => {
        const start = performance.now();
        try {
          layer.update(snapshot, previous);
        } finally {
          onUpdate(name, performance.now() - start);
        }
      },
      destroy: () => {
        layer.destroy();
      },
    };
  };
  return Object.fromEntries(LAYER_ORDER.map((name) => [name, () => wrap(name)]));
}

/**
 * Two real snapshots of a mounted core, the second after a data change, for driving `update`.
 *
 * @returns `[first, second]`.
 */
export function createSnapshotPair(): [GanttSnapshot, GanttSnapshot] {
  const core = createTestCore();
  core.setViewport({ width: 800, height: 400 });
  const first = core.getSnapshot();
  core.setTasks([{ id: 'only', name: 'Only', start: '2026-03-02', end: '2026-03-04' }]);
  const second = core.getSnapshot();
  core.destroy();
  return [first, second];
}

/**
 * The contract every layer keeps, as a test suite: call it from the layer's own test file,
 * `describeLayerContract('bars', createBarsLayer)`, and add tests of what the layer draws.
 *
 * - It mounts, updates with a first and a next snapshot, and destroys without errors.
 * - After `destroy()` its root holds what it held before `mount()`, no frame task is left
 *   pending, and no listener registered with `context.signal` is alive.
 *
 * @param name - The layer's name (selects its root element).
 * @param factory - The layer's factory.
 */
export function describeLayerContract<N extends LayerName>(
  name: N,
  factory: LayerFactory<N>,
): void {
  describe(`layer contract: ${name}`, () => {
    let tracker: ListenerTracker;
    beforeEach(() => {
      tracker = trackListeners();
    });
    afterEach(() => {
      tracker.restore();
      document.body.replaceChildren();
    });

    it('mounts, updates with successive snapshots and destroys', () => {
      const harness = createLayerHarness(name);
      const layer: RendererLayer<LayerSlots[N]> = factory();
      const [first, second] = createSnapshotPair();

      layer.mount(harness.context);
      layer.update(first, undefined);
      layer.update(second, first);
      layer.destroy();
    });

    it('destroy leaves the root as it was found, nothing pending and no listener alive', () => {
      const harness = createLayerHarness(name);
      const before = countNodes(harness.root);
      const layer = factory();
      const [first, second] = createSnapshotPair();

      layer.mount(harness.context);
      layer.update(first, undefined);
      layer.update(second, first);
      layer.destroy();
      harness.abort();

      expect(countNodes(harness.root)).toBe(before);
      expect(harness.scheduler.pending).toBe(false);
      expect(tracker.alive()).toEqual([]);
    });
  });
}

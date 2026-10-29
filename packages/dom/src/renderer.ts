import type { GanttCore, GanttSnapshot } from '@ganttlane/core';

import { assertContainer } from './container';
import { type DisplayOptions, type ResolvedDisplay, resolveDisplay } from './display';
import {
  allocateIdPrefix,
  createDisposables,
  type ElementSize,
  listen,
  measureSize,
  observeSize,
  prefixedId,
} from './dom-utils';
import { throwCollected } from './dom-utils/errors';
import { mountInput } from './input';
import type { PopoverLayer } from './layers/popover';
import { resolveLayerFactories } from './layers/registry';
import type {
  LayerContext,
  LayerFactories,
  LayerName,
  LayerSlots,
  RendererLayer,
} from './layers/types';
import { LAYER_ORDER } from './layers/types';
import { startMinuteClock } from './minute-clock';
import {
  createFrameScheduler,
  type FrameSource,
  frameSourceOf,
  type LayerScheduler,
} from './scheduler';
import { createScrollSync } from './scroll';
import { createSkeleton, type HeightOption, resolveHeight, type ThemeOption } from './skeleton';
import { type GanttStrings, type GanttStringsInput, resolveStrings } from './strings';

/**
 * What the renderer needs from a core: the snapshot and its subscription, the viewport and
 * scroll input, the interaction input and the clock (`refreshNow`, called once a minute). Every
 * `GanttCore` has it.
 */
export type RendererCore = Pick<
  GanttCore,
  | 'getSnapshot'
  | 'subscribe'
  | 'setViewport'
  | 'scroll'
  | 'send'
  | 'refreshNow'
  | 'on'
  | 'getTask'
  | 'getLink'
>;

/**
 * Options of {@link mountRenderer}: what the renderer itself reads. `createGantt` maps its
 * options onto them (`theme`, `strings`, `layout.height`, the display groups) and keeps
 * `idPrefix`, `layers` and `frames` for its `renderer` option.
 */
export interface RendererOptions {
  /**
   * Prefix of every element id of the chart (`gantt-3-header`, `gantt-3-body`, …); also the id
   * of the root. Default: allocated per document, `gantt-1`, `gantt-2`, … (see
   * `allocateIdPrefix` in `@ganttlane/dom/dom-utils` for what that guarantees). Pass your own
   * for ids that are stable across renders, e.g. React's `useId()`.
   */
  readonly idPrefix?: string | undefined;
  /**
   * Value of `data-theme` on the root: `'light'`, `'dark'`, or `'auto'` (default) to follow
   * `prefers-color-scheme`; any other value is `'auto'`. The theme itself is
   * `@ganttlane/dom/styles.css`. Change it with {@link MountedRenderer.setTheme}.
   */
  readonly theme?: ThemeOption | undefined;
  /**
   * The text the chart writes on its own, in your language or your words: any subset
   * of {@link GanttStrings}, merged over the English defaults. `chartLabel` is the accessible
   * name of the chart (the scroller is a focusable `role="region"`, so that the arrow keys
   * scroll it, and this is its `aria-label`; it replaces the `label` option of the first
   * drafts). Strings that put a number or a name into a sentence are functions of the value and
   * the chart's locale. Dates and numbers follow the core's `locale` option, not this one. Change
   * it with {@link MountedRenderer.setStrings}.
   */
  readonly strings?: GanttStringsInput | undefined;
  /**
   * The height of the chart (`layout.height`): a number of px, and the chart is
   * that tall and scrolls the rows inside itself, header sticky inside its scroller; `'auto'`,
   * and the chart is as tall as its rows, the page (or the nearest ancestor that scrolls)
   * scrolls it, the header sticks to that, and the scroller scrolls sideways only; left out, the
   * chart fills its container. With `'auto'` no ancestor between the chart and what scrolls may
   * clip (`overflow: hidden`): a header cannot stick inside a clipping ancestor. Change it with
   * {@link MountedRenderer.setHeight}.
   */
  readonly height?: HeightOption | undefined;
  /** Display options: grid lines, today line, non-working days, highlights, bar labels, … */
  readonly display?: DisplayOptions | undefined;
  /** Replaces built-in layers by name (advanced; tests and custom renderers). */
  readonly layers?: LayerFactories | undefined;
  /**
   * Where frames come from; default `requestAnimationFrame` of the container's window. Mainly
   * for tests (a manual frame queue).
   */
  readonly frames?: FrameSource | undefined;
}

/** A renderer mounted by {@link mountRenderer}. */
export interface MountedRenderer<TCore extends RendererCore = RendererCore> {
  /**
   * Tears the renderer down: removes every node it added to the container, aborts its
   * listeners, disconnects its observers, cancels the pending frame, unsubscribes from the core
   * and destroys its layers (in reverse order). The core is left alone: it belongs to whoever
   * created it. Idempotent.
   */
  destroy(): void;
  /**
   * Changes display options: the given fields merge over the current ones, and the chart is
   * redrawn in the next frame when something changed. The popover groups (`tooltip`,
   * `linkMenu`, `highlightTooltip`) are taken whole: a given group replaces the current one.
   * `createGantt`'s `setOptions` routes the display options here.
   *
   * @param options - Display options to change.
   */
  setDisplay(options: DisplayOptions): void;
  /**
   * Changes strings: the given keys merge over the current ones (`undefined` puts a
   * key's default back, a value of the wrong kind is ignored), and the chart's name and the open
   * popover are redrawn in the next frame, without a remount. `createGantt`'s `setOptions`
   * routes `strings` here. To change the locale, `setOptions({ locale })` on the core.
   *
   * @param strings - Strings to change.
   */
  setStrings(strings: GanttStringsInput): void;
  /**
   * Changes the chart's height (see {@link RendererOptions.height}): the DOM takes the shape of
   * the mode and the core is told the new viewport, in this call. `createGantt`'s `setOptions`
   * routes `layout.height` here.
   *
   * @param height - A number of px, `'auto'`, or `undefined` to fill the container.
   */
  setHeight(height: HeightOption | undefined): void;
  /**
   * Changes the theme (see {@link RendererOptions.theme}): `data-theme` on the root,
   * nothing else, and no render, since the stylesheet does the work. `createGantt`'s
   * `setOptions` routes `theme` here.
   *
   * @param theme - `'light'`, `'dark'` or `'auto'`; any other value is `'auto'`.
   */
  setTheme(theme: ThemeOption): void;
  /**
   * Closes the popover that is open (a task tooltip, the link menu or a day label), if any. A
   * tooltip the hover still asks for stays closed until the hover changes (as Escape does).
   * `createGantt`'s `hideTooltip()`.
   */
  hideTooltip(): void;
  /** The current display options, resolved. */
  readonly display: ResolvedDisplay;
  /** The current strings, resolved: the defaults with the `strings` option over them. */
  readonly strings: GanttStrings;
  /** The core the renderer draws, as passed in. */
  readonly core: TCore;
}

/**
 * Mounts the vanilla renderer for `core` into `container`: builds the DOM skeleton,
 * feeds the container's size to `core.setViewport`, reports
 * scrolling to `core.scroll`, and draws every snapshot through the layers, coalesced into one
 * render per frame. One low-frequency timer, aligned to the minute boundary, asks the core to
 * read its clock again (`core.refreshNow()`), so the today line follows `snapshot.now`; it is
 * cleared by `destroy()`.
 *
 * Use it for custom setups (a core you configure yourself, shared with other code);
 * `createGantt` is the one-call version that also creates the core, maps the chart's options
 * onto both and validates the renderer's.
 *
 * The container is not modified except for the one child it receives; it should be empty and
 * have a height (the chart fills it). Several renderers can share a page, each with its own
 * core, ids, observers and listeners. They can even share a core.
 *
 * Mounting is synchronous: when it returns, the chart has measured the container, told the core
 * and rendered the first snapshot.
 *
 * @param container - Element to render into.
 * @param core - The chart's core (`createGanttCore`).
 * @param options - See {@link RendererOptions}.
 * @returns The mounted renderer.
 * @throws {TypeError} When `container` is not an element (a selector string, `null`, another
 * kind of node). An element of another window or document is fine.
 */
export function mountRenderer<TCore extends RendererCore>(
  container: HTMLElement,
  core: TCore,
  options: RendererOptions = {},
): MountedRenderer<TCore> {
  assertContainer(container, 'mountRenderer');
  const document = container.ownerDocument;
  const idPrefix = options.idPrefix ?? allocateIdPrefix(document);
  const abort = new AbortController();
  const disposables = createDisposables();
  let destroyed = false;
  let display = resolveDisplay(options.display);
  let strings = resolveStrings(options.strings);
  let schedule = (): void => undefined;
  let setHeight = (_height: HeightOption | undefined): void => undefined;
  let setTheme = (_theme: ThemeOption): void => undefined;
  let hideTooltip = (): void => undefined;

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    // Listeners first, so that nothing reacts while the rest is torn down; then the bag, which
    // releases newest first: observer, core subscription, frame, layers, DOM.
    abort.abort();
    disposables.dispose();
  };

  try {
    const skeleton = createSkeleton(document, {
      idPrefix,
      theme: options.theme ?? 'auto',
      label: strings.chartLabel,
    });
    container.append(skeleton.root);
    disposables.add(() => {
      skeleton.root.remove();
    });

    // One source for the render loop and the drag autoscroll, so that both are paced alike.
    const frames = options.frames ?? frameSourceOf(document);
    const scheduler = createFrameScheduler(frames);
    disposables.add(() => {
      scheduler.dispose();
    });
    const layerScheduler: LayerScheduler = {
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      get pending() {
        return scheduler.pending;
      },
    };

    // A request already in the snapshot belongs to an earlier renderer of this core: not ours
    // to replay (the first render places the scroller where the core is instead).
    let appliedRequest = core.getSnapshot().scrollRequest?.id;
    const scrollSync = createScrollSync({
      core,
      scroller: skeleton.scroller,
      pin: skeleton.pin,
      setContentWidth: (width) => {
        skeleton.setExtent({ width });
      },
      flush: scheduler.flush,
      pending: () => {
        const id = core.getSnapshot().scrollRequest?.id;
        return id !== undefined && id !== appliedRequest;
      },
      signal: abort.signal,
      requestFrame: () => {
        schedule();
      },
      onDispose: (release) => {
        disposables.add(release);
      },
    });
    // The height before anything is drawn: the DOM takes its shape, the scroller its mode.
    const applyHeight = (height: HeightOption | undefined): void => {
      skeleton.setHeight(height);
      scrollSync.setPaged(resolveHeight(height) === 'auto');
    };
    applyHeight(options.height);

    // Core events for layers, ended with the chart (or earlier by the layer).
    const subscribe: GanttCore['on'] = (name, handler) => {
      if (destroyed) return () => undefined;
      let active = true;
      const off = core.on(name, handler);
      const stop = (): void => {
        if (!active) return;
        active = false;
        off();
      };
      disposables.add(stop);
      return stop;
    };

    // Layers, in registration order. One that fails to mount leaves its siblings mounted; they
    // are destroyed by the catch below, and its own nodes go with the skeleton.
    const factories = resolveLayerFactories(options.layers);
    const updaters: Pick<RendererLayer, 'update'>[] = [];
    // The type parameter ties a layer's root to its factory, which a loop over names cannot.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    const mountLayer = <N extends LayerName>(name: N): void => {
      const layer: RendererLayer<LayerSlots[N]> = factories[name]();
      // The popover layer can close its popover; a replacement layer may not.
      if (name === 'popover') {
        hideTooltip = () => {
          (layer as Partial<PopoverLayer>).hide?.();
        };
      }
      const context: LayerContext<LayerSlots[N]> = {
        root: skeleton[name],
        document,
        scroller: skeleton.scroller,
        idPrefix,
        id: (local) => prefixedId(idPrefix, local),
        signal: abort.signal,
        scheduler: layerScheduler,
        get display() {
          return display;
        },
        get strings() {
          return strings;
        },
        send: (event) => (destroyed ? [] : core.send(event)),
        on: subscribe,
        getTask: (id) => core.getTask(id),
        getLink: (id) => core.getLink(id),
      };
      layer.mount(context);
      updaters.push(layer);
      disposables.add(() => {
        layer.destroy();
      });
    };
    for (const name of LAYER_ORDER) mountLayer(name);

    let rendered: GanttSnapshot | undefined;
    let renderedDisplay: ResolvedDisplay | undefined;
    // The skeleton was made with these.
    let renderedStrings = strings;

    const render = (): void => {
      // Where the page is, for a chart of automatic height: read before anything is written.
      scrollSync.measure();
      const snapshot = core.getSnapshot();
      if (snapshot === rendered && display === renderedDisplay && strings === renderedStrings) {
        return;
      }
      const previous = rendered;
      rendered = snapshot;
      renderedDisplay = display;
      if (strings !== renderedStrings) skeleton.setLabel(strings.chartLabel);
      renderedStrings = strings;

      // Size first: a scroll position beyond the old content would be clamped.
      skeleton.setExtent({
        width: snapshot.contentWidth,
        headerHeight: snapshot.layout.rows.headerHeight,
        bodyHeight: snapshot.layout.rows.bodyHeight,
      });
      // What can scroll the chart depends on how tall it is (a chart of automatic height).
      if (snapshot.layout.rows.bodyHeight !== previous?.layout.rows.bodyHeight) {
        scrollSync.contentResized();
      }
      const request = snapshot.scrollRequest;
      if (request !== undefined && request.id !== appliedRequest) {
        appliedRequest = request.id;
        scrollSync.apply(request);
      } else if (previous === undefined) {
        scrollSync.place(snapshot);
      }

      const errors: unknown[] = [];
      for (const layer of updaters) {
        try {
          layer.update(snapshot, previous);
        } catch (error) {
          errors.push(error);
        }
      }
      throwCollected(errors, 'Several layers failed to update');
    };

    schedule = () => {
      scheduler.schedule(render);
    };
    disposables.add(core.subscribe(schedule));
    // Pointer and keyboard input: listeners on the scroller, the autoscroll loop.
    disposables.add(
      mountInput({
        core,
        root: skeleton.root,
        scroller: skeleton.scroller,
        signal: abort.signal,
        frames,
        // The step's outcome is drawn now: `report` flushes only after a compensation, and the
        // dragged bar must not trail the offset by a frame.
        report: () => {
          scrollSync.report();
          scheduler.flush();
        },
        onFrameMove: (listener) => scrollSync.onFrameMove(listener),
      }),
    );
    // The one timer of the instance: "now" is the core's (`snapshot.now`), and it has to be read
    // again once a minute or the today line goes stale overnight.
    disposables.add(
      startMinuteClock(() => {
        core.refreshNow();
      }),
    );

    // The viewport: sized now (so that the first render is synchronous and `scrollTo*` work
    // right after mounting), then by a ResizeObserver on the scroller, whose client box is
    // what the core wants. The render runs inside the observer callback, still before paint.
    const report = (size: ElementSize): void => {
      core.setViewport(scrollSync.viewport(size));
      scheduler.flush();
      // A stylesheet that arrived late resizes the scroller: the position it could not take is due.
      scrollSync.refresh();
    };
    const observation = observeSize(skeleton.scroller, report);
    disposables.add(() => {
      observation.disconnect();
    });
    if (!observation.supported && document.defaultView) {
      // No ResizeObserver: remeasure when the window resizes (container size changes that
      // do not resize the window go unnoticed).
      listen(
        document.defaultView,
        'resize',
        () => {
          report(measureSize(skeleton.scroller));
        },
        { signal: abort.signal },
      );
    }
    core.setViewport(scrollSync.viewport(measureSize(skeleton.scroller)));
    scheduler.schedule(render);
    scheduler.flush();
    // The chart has its height now: a chart of automatic height looks for its host again (the
    // render asked for that) and draws for it before it returns, not a frame later.
    scheduler.flush();

    setHeight = (height) => {
      applyHeight(height);
      report(measureSize(skeleton.scroller));
    };
    setTheme = (theme) => {
      skeleton.setTheme(theme);
    };
  } catch (error) {
    // Best effort: whatever failed to mount must not leave nodes or listeners behind, and the
    // mount error is the one worth reporting, not a follow-up from the cleanup.
    try {
      destroy();
    } catch {
      // ignored on purpose
    }
    throw error;
  }

  return {
    destroy,
    setHeight: (height) => {
      if (!destroyed) setHeight(height);
    },
    setTheme: (theme) => {
      if (!destroyed) setTheme(theme);
    },
    hideTooltip: () => {
      if (!destroyed) hideTooltip();
    },
    setDisplay: (patch) => {
      if (destroyed) return;
      const next = resolveDisplay(patch, display);
      if (next === display) return;
      display = next;
      schedule();
    },
    setStrings: (patch) => {
      if (destroyed) return;
      const next = resolveStrings(patch, strings);
      if (next === strings) return;
      strings = next;
      schedule();
    },
    get display() {
      return display;
    },
    get strings() {
      return strings;
    },
    core,
  };
}

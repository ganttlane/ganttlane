import { vi } from 'vitest';

/**
 * Appends a fresh container to `document.body`.
 *
 * @returns The container.
 */
export function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  return container;
}

/**
 * Counts the nodes below `root` (elements, text, comments), the container's "size" before and
 * after a chart is mounted and destroyed.
 *
 * @param root - Subtree root, not counted itself.
 * @returns The number of descendants.
 */
export function countNodes(root: Node): number {
  let count = 0;
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      count++;
      walk(child);
    }
  };
  walk(root);
  return count;
}

/** A settable size reported for every scroller (`.gantt__scroller`). */
export interface ClientSizeStub {
  /** Changes the size reported from now on. */
  set(width: number, height: number): void;
}

/**
 * happy-dom does no layout, so `clientWidth` / `clientHeight` are 0. This reports a size for
 * the chart's scroller (and 0 for everything else); undone by `vi.restoreAllMocks()`.
 *
 * @param width - Client width of scrollers.
 * @param height - Client height of scrollers.
 * @returns A handle to change the size.
 */
export function stubScrollerSize(width: number, height: number): ClientSizeStub {
  const size = { width, height };
  const isScroller = (element: Element): boolean => element.classList.contains('gantt__scroller');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? size.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) ? size.height : 0;
  });
  return {
    set(nextWidth, nextHeight): void {
      size.width = nextWidth;
      size.height = nextHeight;
    },
  };
}

/** A `ResizeObserver` the test drives by hand. */
export class FakeResizeObserver {
  /** Every instance created since {@link installFakeResizeObserver}. */
  static instances: FakeResizeObserver[] = [];

  /** Elements currently observed. */
  readonly observed: Set<Element> = new Set<Element>();
  /** Whether `disconnect()` was called. */
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }

  /** Delivers an entry for `element` if it is observed. */
  deliver(element: Element, width: number, height: number): void {
    if (!this.observed.has(element)) return;
    const contentRect = {
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    };
    this.callback([{ target: element, contentRect } as unknown as ResizeObserverEntry], this);
  }
}

/**
 * Replaces the global `ResizeObserver` (the window's, which is what the renderer reads) with
 * {@link FakeResizeObserver}. Undo with `vi.unstubAllGlobals()`.
 *
 * @returns The class, for `instances`.
 */
export function installFakeResizeObserver(): typeof FakeResizeObserver {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return FakeResizeObserver;
}

/**
 * Delivers a size to every observer that watches `element`.
 *
 * @param element - The observed element.
 * @param width - Content width.
 * @param height - Content height.
 */
export function resizeObserved(element: Element, width: number, height: number): void {
  for (const observer of FakeResizeObserver.instances) observer.deliver(element, width, height);
}

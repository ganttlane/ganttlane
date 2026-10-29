import {
  createGanttCore,
  type GanttCore,
  type GanttCoreOptions,
  type GanttEventMap,
  type GanttEventName,
  type GanttSnapshot,
  type Task,
  type ViewportChange,
} from '@ganttlane/core';
import { vi } from 'vitest';

import type { RendererCore } from '../renderer';

// 2026-03-02 is a Monday; the day mode draws 40 px per day.
const TASKS: readonly Task[] = [
  { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
  { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  { id: 'phase', name: 'Phase', start: '2026-04-06', end: '2026-04-17' },
  { id: 'child', name: 'Child', parentId: 'phase', start: '2026-04-13', end: '2026-04-17' },
];

/**
 * A real core over a small project, with a fixed "today".
 *
 * @param options - Overrides of the default options.
 * @returns The core (not yet given a viewport).
 */
export function createTestCore(options: Partial<GanttCoreOptions> = {}): GanttCore {
  return createGanttCore({
    tasks: TASKS,
    calendar: { weekends: [0, 6] },
    now: () => '2026-03-04',
    ...options,
  });
}

/** The parts of a snapshot the renderer itself reads. */
export interface FakeSnapshotParts {
  readonly contentWidth?: number;
  readonly headerHeight?: number;
  readonly bodyHeight?: number;
  readonly scrollLeft?: number;
  readonly scrollTop?: number;
  readonly scrollRequest?: GanttSnapshot['scrollRequest'];
}

/** The snapshot of a chart without tasks, made once: the real shape that fakes are built on. */
let emptySnapshot: GanttSnapshot | undefined;

function emptyChartSnapshot(): GanttSnapshot {
  if (emptySnapshot === undefined) {
    const core = createGanttCore({ tasks: [] });
    emptySnapshot = core.getSnapshot();
    core.destroy();
  }
  return emptySnapshot;
}

/**
 * A snapshot of an empty chart with the fields the renderer reads set to the given values, so
 * that real layers can draw it (they find every part of a snapshot in its real shape, and
 * nothing to draw). Every call returns a new object, like a core would after a change.
 *
 * @param parts - Values of the fields.
 * @returns The snapshot.
 */
export function fakeSnapshot(parts: FakeSnapshotParts = {}): GanttSnapshot {
  const base = emptyChartSnapshot();
  return {
    ...base,
    contentWidth: parts.contentWidth ?? 1000,
    layout: {
      ...base.layout,
      rows: {
        ...base.layout.rows,
        headerHeight: parts.headerHeight ?? 50,
        bodyHeight: parts.bodyHeight ?? 200,
      },
    },
    timeline: { ...base.timeline, scrollLeft: parts.scrollLeft ?? 0 },
    scrollTop: parts.scrollTop ?? 0,
    scrollRequest: parts.scrollRequest,
  };
}

/** A core stand-in that records its input and lets a test decide what it answers. */
export interface FakeCore extends RendererCore {
  /** Replaces the snapshot and notifies subscribers. */
  publish(snapshot: GanttSnapshot): void;
  /** Subscribers currently registered. */
  readonly listeners: ReadonlySet<() => void>;
  readonly setViewport: ReturnType<typeof vi.fn<RendererCore['setViewport']>>;
  readonly scroll: ReturnType<typeof vi.fn<RendererCore['scroll']>>;
  readonly send: ReturnType<typeof vi.fn<RendererCore['send']>>;
  readonly refreshNow: ReturnType<typeof vi.fn<RendererCore['refreshNow']>>;
  /** Calls the handlers registered with `on` for `name`. */
  emit<K extends GanttEventName>(name: K, ...args: Parameters<GanttEventMap[K]>): void;
  /** How many `on` subscriptions are active right now. */
  handlers(): number;
}

/**
 * A fake core for contract tests of the renderer: a mutable snapshot, spies for the input
 * methods, and `scroll` answering `undefined` unless the test says otherwise.
 *
 * @param initial - The first snapshot.
 * @returns The fake.
 */
export function createFakeCore(initial: GanttSnapshot = fakeSnapshot()): FakeCore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const events = new Map<string, Set<(...args: never[]) => void>>();
  return {
    listeners,
    on(name, handler) {
      const set = events.get(name) ?? new Set();
      events.set(name, set);
      const fn = handler as (...args: never[]) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    emit(name, ...args) {
      for (const fn of [...(events.get(name) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
    },
    handlers: () => [...events.values()].reduce((sum, set) => sum + set.size, 0),
    getTask: vi.fn<RendererCore['getTask']>(() => undefined),
    getLink: vi.fn<RendererCore['getLink']>(() => undefined),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setViewport: vi.fn<RendererCore['setViewport']>(() => undefined),
    scroll: vi.fn<RendererCore['scroll']>(() => undefined),
    send: vi.fn<RendererCore['send']>(() => []),
    refreshNow: vi.fn<RendererCore['refreshNow']>(() => undefined),
    publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * A minimal {@link ViewportChange} for tests that only need what the renderer reads of it.
 *
 * @param shift - Pixels every date moved.
 * @param width - New content width.
 * @param scrollLeft - The compensated scroll offset; default `shift`.
 * @returns The change.
 */
export function fakeViewportChange(
  shift: number,
  width: number,
  scrollLeft: number = shift,
): ViewportChange {
  return {
    shift,
    scrollLeft,
    range: { start: 0, end: 1 },
    scale: { durationToPx: () => width },
  } as unknown as ViewportChange;
}

/** A real core seen through spies on the methods the renderer uses. */
export interface ObservedCore extends RendererCore {
  /** The wrapped core. */
  readonly inner: GanttCore;
  /** How many subscriptions are active right now. */
  subscribers(): number;
  readonly setViewport: ReturnType<typeof vi.fn<RendererCore['setViewport']>>;
  readonly scroll: ReturnType<typeof vi.fn<RendererCore['scroll']>>;
  readonly send: ReturnType<typeof vi.fn<RendererCore['send']>>;
  readonly refreshNow: ReturnType<typeof vi.fn<RendererCore['refreshNow']>>;
}

/**
 * Wraps a real core so that a test can see what the renderer sends it and whether it is still
 * subscribed, while the core keeps doing the real work.
 *
 * @param inner - The core to wrap.
 * @returns A {@link RendererCore} that delegates to it.
 */
export function observeCore(inner: GanttCore): ObservedCore {
  let active = 0;
  return {
    inner,
    subscribers: () => active,
    getSnapshot: () => inner.getSnapshot(),
    subscribe(listener) {
      active++;
      const off = inner.subscribe(listener);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        active--;
        off();
      };
    },
    setViewport: vi.fn<RendererCore['setViewport']>((size) => inner.setViewport(size)),
    scroll: vi.fn<RendererCore['scroll']>((position) => inner.scroll(position)),
    send: vi.fn<RendererCore['send']>((event) => inner.send(event)),
    refreshNow: vi.fn<RendererCore['refreshNow']>(() => {
      inner.refreshNow();
    }),
    on: (name, handler) => inner.on(name, handler),
    getTask: (id) => inner.getTask(id),
    getLink: (id) => inner.getLink(id),
  };
}

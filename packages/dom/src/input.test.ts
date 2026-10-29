import {
  barHandles,
  type ChangeSet,
  type GanttCoreOptions,
  type InteractionEvent,
  type Task,
  type TaskId,
} from '@ganttlane/core';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { mountInput } from './input';
import { type MountedRenderer, mountRenderer } from './renderer';
import type { ListenerTracker, ManualFrames, ObservedCore } from './testing';
import {
  createContainer,
  createManualFrames,
  createTestCore,
  observeCore,
  stubScrollerSize,
  trackListeners,
} from './testing';

const DAY = 86_400_000;
/** The day mode draws 40 px per day. */
const DAY_PX = 40;

/** A frame of a 60 Hz display, in ms: the autoscroll's unit of time. */
const FRAME_MS = 16.67;

let tracker: ListenerTracker;
const mounted: MountedRenderer[] = [];
/** The clock the autoscroll loop reads (`performance.now`), moved by `Chart.frame`. */
const clock = { now: 1000 };

beforeEach(() => {
  tracker = trackListeners();
  stubScrollerSize(800, 400);
  clock.now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
  for (const renderer of mounted.splice(0)) renderer.destroy();
  tracker.restore();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A client position. */
interface Client {
  readonly clientX: number;
  readonly clientY: number;
}

interface Chart {
  readonly core: ObservedCore;
  readonly renderer: MountedRenderer<ObservedCore>;
  readonly container: HTMLElement;
  readonly scroller: HTMLElement;
  readonly root: HTMLElement;
  readonly frames: ManualFrames;
  /** Runs one frame of a display of `ms` (default one 60 Hz frame) after the clock moved by it. */
  frame(ms?: number): void;
  /** `setPointerCapture` of the scroller, which does nothing in happy-dom. */
  readonly capture: ReturnType<typeof vi.fn>;
  /** The committed change sets, in order. */
  readonly changes: ChangeSet[];
  /** Where a point of the body lies on the page (the happy-dom scroller is at 0, 0). */
  at(x: number, y: number): Client;
  /** The element of a bar, or of one of its parts. */
  part(id: TaskId, selector?: string): Element;
  /** The centre of a bar. */
  barCentre(id: TaskId): Client;
  /** The centre of one of a bar's handles. */
  handleCentre(id: TaskId, handle: 'resizeStart' | 'resizeEnd' | 'progress'): Client;
  /** The centre of a link handle. */
  linkHandle(id: TaskId, side: 'linkStart' | 'linkEnd'): Client;
  /** Dispatches a pointer event on an element, as the browser would. */
  fire(target: Element, type: string, at: Client, init?: PointerEventInit): PointerEvent;
  /** A captured gesture: the press on `part`, moves and the release land on the scroller. */
  press(part: Element, at: Client, init?: PointerEventInit): PointerEvent;
  move(at: Client, init?: PointerEventInit): PointerEvent;
  release(at: Client, init?: PointerEventInit): PointerEvent;
}

/**
 * What the bars layer does: `data-movable` on the bars of tasks that may be moved. The touch
 * handling and the stylesheet take it from there (`docs/architecture.md` §8).
 */
function markMovable(container: HTMLElement, core: ObservedCore): void {
  const { move } = core.getSnapshot().editing;
  for (const bar of container.querySelectorAll('.gantt__bar'))
    bar.toggleAttribute('data-movable', move);
}

function mountChart(options: Partial<GanttCoreOptions> = {}): Chart {
  const container = createContainer();
  const core = observeCore(createTestCore(options));
  const frames = createManualFrames();
  const renderer = mountRenderer(container, core, { frames });
  mounted.push(renderer);
  const scroller = container.querySelector<HTMLElement>('.gantt__scroller')!;
  const root = container.querySelector<HTMLElement>('.gantt')!;
  const capture = vi.fn();
  scroller.setPointerCapture = capture;
  const changes: ChangeSet[] = [];
  core.inner.on('tasksChange', (changeSet) => changes.push(changeSet));
  markMovable(container, core);
  // Scrolled so that the bars of the first rows are in view, handles and all (the chart opens on
  // today, which cuts the first bar off at the left): a pointer left of the chart has no target.
  core.inner.scroll({ left: 300, top: 0 });
  scroller.scrollLeft = 300;

  const at = (x: number, y: number): Client => {
    const snapshot = core.getSnapshot();
    return {
      clientX: x - snapshot.timeline.scrollLeft,
      clientY: y + snapshot.layout.rows.headerHeight - snapshot.scrollTop,
    };
  };
  const part = (id: TaskId, selector = '.gantt__bar-track'): Element => {
    const element = container.querySelector(
      `.gantt__bar[data-task-id="${String(id)}"] ${selector}`,
    );
    if (element === null) throw new Error(`no ${selector} in the bar of ${String(id)}`);
    return element;
  };
  const fire = (
    target: Element,
    type: string,
    where: Client,
    init: PointerEventInit = {},
  ): PointerEvent => {
    const event = new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      ...where,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  const centre = (box: { x: number; y: number; width: number; height: number }): Client =>
    at(box.x + box.width / 2, box.y + box.height / 2);
  return {
    core,
    renderer,
    container,
    scroller,
    root,
    frames,
    frame: (ms = FRAME_MS) => {
      clock.now += ms;
      frames.step();
    },
    capture,
    changes,
    at,
    part,
    barCentre: (id) => centre(core.inner.getBarRect(id)!),
    handleCentre: (id, handle) => {
      const { handles } = core.getSnapshot();
      return centre(barHandles(core.inner.getBarRect(id)!, handles)[handle]!);
    },
    linkHandle: (id, side) => {
      const { handles } = core.getSnapshot();
      return centre(barHandles(core.inner.getBarRect(id)!, handles)[side]);
    },
    fire,
    press: (target, where, init) => fire(target, 'pointerdown', where, init),
    move: (where, init) => fire(scroller, 'pointermove', where, init),
    release: (where, init) => fire(scroller, 'pointerup', where, init),
  };
}

const shift = (at: Client, dx: number, dy = 0): Client => ({
  clientX: at.clientX + dx,
  clientY: at.clientY + dy,
});

/**
 * Lays the chart out on the page for happy-dom, which does no layout: the scroller's border box
 * (800 x 400 layout px, shown `scale` times as big, as under a CSS `scale()`), and the sticky
 * header's bottom edge.
 */
function layOut(
  chart: Chart,
  where: {
    left?: number;
    top?: number;
    scale?: number;
    headerTop?: number;
    /** The scroller's height: all of the content for a chart whose page scrolls it. */
    height?: number;
  } = {},
): void {
  const { left = 0, top = 0, scale = 1, headerTop = top, height: tall = 400 } = where;
  vi.spyOn(chart.scroller, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width: 800 * scale,
    height: tall * scale,
  } as DOMRect);
  Object.defineProperty(chart.scroller, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(chart.scroller, 'offsetHeight', { value: tall, configurable: true });
  Object.defineProperty(chart.scroller, 'clientHeight', { value: tall, configurable: true });
  const header = chart.container.querySelector('.gantt__header')!;
  const height = chart.core.getSnapshot().layout.rows.headerHeight * scale;
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    top: headerTop,
    bottom: headerTop + height,
  } as DOMRect);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** The effect of one `core.send` call on the observed core. */
const sent = (chart: Chart): InteractionEvent[] =>
  chart.core.send.mock.calls.map(([event]) => event);

describe('pointer input: gestures (FR-EDIT-1)', () => {
  it('FR-EDIT-1: dragging the body moves the bar by the distance and commits once on release', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    chart.move(shift(from, 2 * DAY_PX));
    // Live: the preview is in the snapshot while the pointer is still down.
    expect(chart.core.getSnapshot().state.draft?.patches.get('design')).toBeDefined();
    expect(chart.changes).toHaveLength(0);
    chart.release(shift(from, 2 * DAY_PX));
    await settle();

    expect(chart.changes).toHaveLength(1);
    const [change] = chart.changes[0]!.changes;
    expect(chart.changes[0]!.reason).toBe('move');
    expect(change!.id).toBe('design');
    expect(change!.after.start - change!.before.start).toBe(2 * DAY);
    expect(change!.after.endExclusive - change!.before.endExclusive).toBe(2 * DAY);
    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
  });

  it('FR-EDIT-1: the start handle resizes the start edge', async () => {
    const chart = mountChart();
    const from = chart.handleCentre('design', 'resizeStart');

    chart.press(chart.part('design', '[data-handle="resize-start"]'), from);
    chart.move(shift(from, -DAY_PX));
    chart.release(shift(from, -DAY_PX));
    await settle();

    const [change] = chart.changes[0]!.changes;
    expect(chart.changes[0]!.reason).toBe('resize-start');
    expect(change!.before.start - change!.after.start).toBe(DAY);
    expect(change!.after.endExclusive).toBe(change!.before.endExclusive);
  });

  it('FR-EDIT-1: the end handle resizes the end edge', async () => {
    const chart = mountChart();
    const from = chart.handleCentre('design', 'resizeEnd');

    chart.press(chart.part('design', '[data-handle="resize-end"]'), from);
    chart.move(shift(from, 2 * DAY_PX));
    chart.release(shift(from, 2 * DAY_PX));
    await settle();

    const [change] = chart.changes[0]!.changes;
    expect(chart.changes[0]!.reason).toBe('resize-end');
    expect(change!.after.endExclusive - change!.before.endExclusive).toBe(2 * DAY);
    expect(change!.after.start).toBe(change!.before.start);
  });

  it('FR-PROG-3: the progress handle changes the progress', async () => {
    const chart = mountChart();
    const from = chart.handleCentre('design', 'progress');

    chart.press(chart.part('design', '[data-handle="progress"]'), from);
    chart.move(shift(from, 2 * DAY_PX));
    chart.release(shift(from, 2 * DAY_PX));
    await settle();

    const [change] = chart.changes[0]!.changes;
    expect(chart.changes[0]!.reason).toBe('progress');
    expect(change!.before.progress).toBe(0);
    expect(change!.after.progress).toBeGreaterThan(0);
  });

  it('FR-EDIT-1: releasing outside the chart still commits (pointer capture)', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    // Far left of and above the scroller: the release is delivered to the scroller by capture.
    const outside = { clientX: from.clientX - 300, clientY: -200 };
    chart.move(outside);
    chart.release(outside);
    await settle();

    expect(chart.changes).toHaveLength(1);
    const [change] = chart.changes[0]!.changes;
    expect(change!.before.start - change!.after.start).toBeGreaterThanOrEqual(7 * DAY);
  });

  it('FR-EDIT-4: Escape mid-drag restores the bar and commits nothing', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    const before = chart.core.inner.getBarRect('design');

    chart.press(chart.part('design'), from);
    chart.move(shift(from, 3 * DAY_PX));
    expect(chart.core.inner.getBarRect('design')).not.toEqual(before);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
    expect(chart.core.inner.getBarRect('design')).toEqual(before);
    // The rest of the press is swallowed: the release neither commits nor clicks.
    const click = vi.fn();
    chart.core.inner.on('taskClick', click);
    chart.release(shift(from, 3 * DAY_PX));
    await settle();
    expect(chart.changes).toEqual([]);
    expect(click).not.toHaveBeenCalled();
  });

  it('FR-EDIT-4: a pointer cancel (pointercancel) rolls the drag back', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, 3 * DAY_PX));

    chart.fire(chart.scroller, 'pointercancel', shift(from, 3 * DAY_PX));
    chart.release(shift(from, 3 * DAY_PX));
    await settle();

    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
    expect(chart.changes).toEqual([]);
  });

  it('FR-EDIT-1: losing the pointer capture cancels the gesture', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, 3 * DAY_PX));

    chart.fire(chart.scroller, 'lostpointercapture', from);
    await settle();

    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.changes).toEqual([]);
  });

  it('FR-EDIT-1: the lostpointercapture that follows a normal release is not a second input', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    chart.release(shift(from, DAY_PX));
    const calls = chart.core.send.mock.calls.length;

    chart.fire(chart.scroller, 'lostpointercapture', from);
    await settle();

    expect(chart.core.send.mock.calls.length).toBe(calls);
    expect(chart.changes).toHaveLength(1);
  });

  it('FR-EDIT-1: a gesture of a touch pointer works, with the touch drag threshold (8 px)', async () => {
    const touch: PointerEventInit = { pointerType: 'touch', pointerId: 5 };
    const chart = mountChart();
    const from = chart.barCentre('design');
    const click = vi.fn();
    chart.core.inner.on('taskClick', click);

    // 5 px is below the touch threshold: a tap, not a drag.
    chart.press(chart.part('design'), from, touch);
    chart.move(shift(from, 5), touch);
    chart.release(shift(from, 5), touch);
    await settle();
    expect(click).toHaveBeenCalledTimes(1);
    expect(chart.changes).toEqual([]);

    chart.press(chart.part('design'), from, touch);
    chart.move(shift(from, DAY_PX), touch);
    chart.release(shift(from, DAY_PX), touch);
    await settle();
    expect(chart.changes).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('pointer input: capture', () => {
  it('FR-EDIT-1: the primary press captures the pointer on the scroller', () => {
    const chart = mountChart();

    chart.press(chart.part('design'), chart.barCentre('design'), { pointerId: 4 });

    expect(chart.capture).toHaveBeenCalledWith(4);
  });

  it('FR-EDIT-1: a second finger and a non-primary button do not capture', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, { pointerType: 'touch', isPrimary: false });
    chart.press(chart.part('design'), from, { button: 2 });

    expect(chart.capture).not.toHaveBeenCalled();
  });

  it('FR-EDIT-1: a press on the scrollbar is left to the browser: no capture, no gesture', () => {
    const chart = mountChart();
    const bar = chart.barCentre('design');

    // The scroller is 800 wide, 400 high: past either is the scrollbar.
    chart.press(chart.scroller, { clientX: 805, clientY: bar.clientY });
    chart.press(chart.scroller, { clientX: bar.clientX, clientY: 405 });

    expect(chart.capture).not.toHaveBeenCalled();
    expect(chart.core.send).not.toHaveBeenCalled();
  });

  it('FR-EDIT-1: capture that the browser refuses (a pointer it does not know) is not an error', () => {
    const chart = mountChart();
    chart.capture.mockImplementation(() => {
      throw new DOMException('no such pointer', 'NotFoundError');
    });
    const from = chart.barCentre('design');

    expect(() => chart.press(chart.part('design'), from)).not.toThrow();

    expect(chart.core.getSnapshot().feedback.phase).toBe('pressed');
  });
});

describe('pointer input: touch scrolling (FR-EDIT-1)', () => {
  /** A cancelable `touchstart` on an element; `true` when the listener cancelled it. */
  function touch(target: Element): boolean {
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('FR-EDIT-1: a touch on a bar that can be moved is kept from becoming a scroll', () => {
    const chart = mountChart();

    expect(chart.part('design').closest('[data-movable]')).not.toBeNull();
    expect(touch(chart.part('design'))).toBe(true);
    expect(touch(chart.part('design', '[data-handle="resize-end"]'))).toBe(true);
    expect(touch(chart.part('design', '[data-handle="progress"]'))).toBe(true);
  });

  it('FR-EDIT-1: so is a touch on a link handle', () => {
    const chart = mountChart();

    expect(touch(chart.part('design', '[data-side="end"]'))).toBe(true);
  });

  it('FR-EDIT-1: a touch on a bar that cannot be edited, a row or the header scrolls as usual', () => {
    const readonly = mountChart({ editing: false });
    expect(readonly.part('design').closest('[data-readonly]')).not.toBeNull();
    expect(touch(readonly.part('design'))).toBe(false);

    const chart = mountChart();
    expect(touch(chart.container.querySelector('.gantt__row')!)).toBe(false);
    expect(touch(chart.container.querySelector('.gantt__header')!)).toBe(false);
    expect(touch(chart.scroller)).toBe(false);
  });

  it('FR-EDIT-1: the body of a bar that can be resized but not moved scrolls; its handles keep the touch', () => {
    const chart = mountChart({ editing: { move: false } });
    const bar = chart.part('design').closest('.gantt__bar')!;
    // Resizable, so not read-only; but not movable either.
    expect(bar.hasAttribute('data-readonly')).toBe(false);
    expect(bar.hasAttribute('data-movable')).toBe(false);

    expect(touch(chart.part('design'))).toBe(false);
    expect(touch(chart.part('design', '[data-handle="resize-end"]'))).toBe(true);
    expect(touch(chart.part('design', '[data-handle="resize-start"]'))).toBe(true);
    expect(touch(chart.part('design', '[data-side="end"]'))).toBe(true);
  });

  it('FR-EDIT-1: only a touchstart is held up, so scrolling by touch is not blocked otherwise', () => {
    const chart = mountChart();
    const track = chart.part('design');
    const other = (type: string): boolean => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      track.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(other('touchmove')).toBe(false);
    expect(other('touchend')).toBe(false);
  });

  it('FR-API-4: the listener ends with the chart', () => {
    const chart = mountChart();
    const track = chart.part('design');
    expect(touch(track)).toBe(true);

    chart.renderer.destroy();

    expect(touch(track)).toBe(false);
  });
});

describe('pointer input: a touch the browser pans with (FR-EDIT-7)', () => {
  const finger: PointerEventInit = { pointerType: 'touch', pointerId: 5 };

  /** A chart on which move is not allowed, and the refusals it reports. */
  function readonlyChart(options: Partial<GanttCoreOptions> = { editing: false }): {
    chart: Chart;
    refused: ReturnType<typeof vi.fn>;
    clicks: ReturnType<typeof vi.fn>;
  } {
    const chart = mountChart(options);
    const refused = vi.fn();
    const clicks = vi.fn();
    chart.core.inner.on('editRefused', refused);
    chart.core.inner.on('taskClick', clicks);
    return { chart, refused, clicks };
  }

  it('FR-EDIT-7: a swipe that starts on a bar that cannot be moved is a pan, not a refused drag', async () => {
    const { chart, refused, clicks } = readonlyChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, finger);
    // The browser pans after a few pixels and cancels the pointer; before that, moves arrive.
    chart.move(shift(from, 10), finger);
    chart.move(shift(from, 14), finger);
    chart.fire(chart.scroller, 'pointercancel', shift(from, 14), finger);
    await settle();

    expect(refused).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-EDIT-7: a swipe that ends in a release (no pan took it) is no click either, and refuses nothing', async () => {
    const { chart, refused, clicks } = readonlyChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, finger);
    chart.move(shift(from, 12), finger);
    chart.move(shift(from, 30), finger);
    chart.release(shift(from, 30), finger);
    await settle();

    expect(refused).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-EDIT-3: a tap on a bar that cannot be moved is still a click', async () => {
    const { chart, clicks } = readonlyChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, finger);
    chart.move(shift(from, 3), finger);
    chart.release(shift(from, 3), finger);
    await settle();

    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-7: the same goes for a bar that can be resized but not moved, and a resize handle still drags', async () => {
    const { chart, refused } = readonlyChart({ editing: { move: false } });
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, finger);
    chart.move(shift(from, 20), finger);
    chart.release(shift(from, 20), finger);
    await settle();
    expect(refused).not.toHaveBeenCalled();

    const end = chart.handleCentre('design', 'resizeEnd');
    chart.press(chart.part('design', '[data-handle="resize-end"]'), end, finger);
    chart.move(shift(end, DAY_PX), finger);
    chart.release(shift(end, DAY_PX), finger);
    await settle();
    expect(chart.changes).toHaveLength(1);
    expect(chart.changes[0]!.reason).toBe('resize-end');
  });

  it('FR-EDIT-7: a mouse or a pen that drags a bar that cannot be moved is refused, as before', async () => {
    const { chart, refused } = readonlyChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    chart.move(shift(from, 20));
    chart.release(shift(from, 20));
    await settle();

    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0]![0]).toMatchObject({ reason: 'permission', at: 'start' });
  });

  it('FR-EDIT-1: a touch that can be moved is not held back: its drag starts after the touch threshold', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from, finger);
    chart.move(shift(from, 12), finger);
    chart.release(shift(from, DAY_PX), finger);
    await settle();

    expect(chart.changes).toHaveLength(1);
  });
});

describe('pointer input: coordinates (architecture §4)', () => {
  it('FR-EDIT-1: x is client x minus the scroller plus the core scrollLeft, y is body y', () => {
    const chart = mountChart();
    vi.spyOn(chart.scroller, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 30,
    } as DOMRect);
    const { timeline, layout, scrollTop } = chart.core.getSnapshot();

    chart.press(chart.scroller, { clientX: 250, clientY: 200 });

    const [event] = sent(chart);
    expect(event).toMatchObject({
      type: 'down',
      x: 250 - 100 + timeline.scrollLeft,
      y: 200 - 30 + scrollTop - layout.rows.headerHeight,
    });
  });

  it('NFR-PERF-2: the scroller is measured when a press starts, never on a move or release', () => {
    const chart = mountChart();
    const measure = vi.spyOn(chart.scroller, 'getBoundingClientRect');
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    expect(measure).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 10; i++) chart.move(shift(from, i * 10));
    chart.release(shift(from, 100));

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('NFR-PERF-2: hovering measures the scroller when the pointer comes in, then reuses it until the next press', () => {
    const chart = mountChart();
    const measure = vi.spyOn(chart.scroller, 'getBoundingClientRect');
    const from = chart.barCentre('design');

    chart.fire(chart.scroller, 'pointerenter', from, { bubbles: false });
    expect(measure).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) chart.fire(chart.part('design'), 'pointermove', shift(from, i));
    expect(measure).toHaveBeenCalledTimes(1);
    chart.press(chart.part('design'), from);

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('NFR-PERF-2: a chart mounted under a still pointer measures once, at its first move', () => {
    const chart = mountChart();
    const measure = vi.spyOn(chart.scroller, 'getBoundingClientRect');
    const from = chart.barCentre('design');

    for (let i = 0; i < 5; i++) chart.fire(chart.part('design'), 'pointermove', shift(from, i));

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-8: the hover is placed where the scroller is when the pointer came in', () => {
    const chart = mountChart();
    const rect = vi.spyOn(chart.scroller, 'getBoundingClientRect');
    rect.mockReturnValue({ left: 50, top: 20 } as DOMRect);
    const { timeline } = chart.core.getSnapshot();

    chart.fire(chart.scroller, 'pointerenter', { clientX: 300, clientY: 200 }, { bubbles: false });
    // The page shifts afterwards: no move reads the scroller again, so the old place is used.
    rect.mockReturnValue({ left: 999, top: 999 } as DOMRect);
    chart.fire(chart.container.querySelector('.gantt__row')!, 'pointermove', {
      clientX: 310,
      clientY: 210,
    });

    const [move] = sent(chart);
    expect(move).toMatchObject({ type: 'move', x: 310 - 50 + timeline.scrollLeft });
  });

  it('NFR-PERF-2: the scroll position comes from the core, the element is never read', () => {
    const chart = mountChart();
    const read = vi.fn(() => 0);
    Object.defineProperty(chart.scroller, 'scrollLeft', { get: read, configurable: true });
    Object.defineProperty(chart.scroller, 'scrollTop', { get: read, configurable: true });
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    chart.release(shift(from, DAY_PX));

    expect(read).not.toHaveBeenCalled();
  });

  it('FR-EDIT-1: pointerId, pointerType, isPrimary, button, time and the modifiers go through', () => {
    const chart = mountChart();
    const event = chart.press(chart.part('design'), chart.barCentre('design'), {
      pointerId: 9,
      pointerType: 'pen',
      altKey: true,
    });

    expect(sent(chart)[0]).toMatchObject({
      type: 'down',
      pointerId: 9,
      pointerType: 'pen',
      isPrimary: true,
      button: 0,
      time: event.timeStamp,
      modifiers: { alt: true, shift: false, ctrl: false, meta: false },
      event,
    });
  });
});

describe('pointer input: targets from the DOM', () => {
  it('FR-EDIT-3: a click on a bar is a click (no native click needed), and a click after a drag is not', async () => {
    const chart = mountChart();
    const clicks: unknown[] = [];
    chart.core.inner.on('taskClick', (record, event) => clicks.push([record.id, event]));
    const from = chart.barCentre('design');

    const down = chart.press(chart.part('design'), from);
    const up = chart.release(from);
    await settle();
    expect(clicks).toEqual([['design', up]]);
    expect(down.defaultPrevented).toBe(false);

    chart.press(chart.part('design'), from);
    chart.move(shift(from, 2 * DAY_PX));
    chart.release(shift(from, 2 * DAY_PX));
    await settle();
    expect(clicks).toHaveLength(1);
  });

  it('FR-EDIT-3: a double click is two quick clicks on the same bar, without blocking the first', async () => {
    const chart = mountChart();
    const events: string[] = [];
    chart.core.inner.on('taskClick', (record) => events.push(`click ${String(record.id)}`));
    chart.core.inner.on('taskDoubleClick', (record) => events.push(`double ${String(record.id)}`));
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    chart.release(from);
    chart.press(chart.part('design'), from);
    chart.release(from);
    await settle();

    expect(events).toEqual(['click design', 'click design', 'double design']);
  });

  it('FR-SEL-1: a click on a link (its hit path) selects the link and reports linkClick', async () => {
    const chart = mountChart({ links: [{ source: 'design', target: 'build', type: 'FS' }] });
    const clicks: string[] = [];
    chart.core.inner.on('linkClick', (link) => clicks.push(link.id));
    const hit = chart.container.querySelector('.gantt__link-hit')!;
    expect(hit).not.toBeNull();
    const where = chart.barCentre('design');

    chart.press(hit, where);
    chart.release(where);
    await settle();

    expect(clicks).toEqual(['design:FS:build']);
    expect(chart.core.getSnapshot().selection.link).toBe('design:FS:build');
  });

  it('FR-EDIT-1: a task id that is a number is found again from the attribute text', async () => {
    const tasks: Task[] = [
      { id: 1, name: 'One', start: '2026-03-02', end: '2026-03-06' },
      { id: 2, name: 'Two', start: '2026-03-09', end: '2026-03-13' },
    ];
    const chart = mountChart({ tasks });
    const clicks: unknown[] = [];
    chart.core.inner.on('taskClick', (record) => clicks.push(record.id));
    const from = chart.barCentre(1);

    chart.press(chart.part(1), from);
    chart.move(shift(from, DAY_PX));
    chart.release(shift(from, DAY_PX));
    chart.press(chart.part(2), chart.barCentre(2));
    chart.release(chart.barCentre(2));
    await settle();

    expect(chart.changes[0]!.changes[0]!.id).toBe(1);
    expect(clicks).toEqual([2]);
  });

  it('FR-EDIT-1: an id that the attribute cannot tell apart (1 and "1") is left to the core hit test', async () => {
    const tasks: Task[] = [
      { id: 1, name: 'Number', start: '2026-03-02', end: '2026-03-06' },
      { id: '1', name: 'Text', start: '2026-03-02', end: '2026-03-06' },
    ];
    const chart = mountChart({ tasks });
    const clicks: unknown[] = [];
    chart.core.inner.on('taskClick', (record) => clicks.push(record.id));
    const numberAt = chart.barCentre(1);
    const textAt = chart.barCentre('1');

    chart.press(chart.part(1), numberAt);
    chart.release(numberAt);
    chart.press(chart.part('1'), textAt);
    chart.release(textAt);
    await settle();

    expect(clicks).toEqual([1, '1']);
  });

  it('FR-EDIT-1: a press on the sticky header never starts a gesture on a bar scrolled under it', async () => {
    const chart = mountChart();
    const click = vi.fn();
    chart.core.inner.on('taskClick', click);
    const bar = chart.barCentre('design');
    const header = chart.container.querySelector('.gantt__header')!;

    // Over the header, at the x of the bar (client y 5 is inside the header rows).
    chart.press(header, { clientX: bar.clientX, clientY: 5 });
    expect(chart.core.getSnapshot().feedback.gesture).toBeUndefined();
    chart.release({ clientX: bar.clientX, clientY: 5 });
    await settle();

    expect(click).not.toHaveBeenCalled();
  });

  it('FR-EDIT-8: hovering a bar and its parts reports them, and leaving the chart clears it', () => {
    const chart = mountChart();
    const centre = chart.barCentre('design');
    const end = chart.handleCentre('design', 'resizeEnd');

    chart.fire(chart.part('design'), 'pointermove', centre);
    expect(chart.core.getSnapshot().feedback.hover).toEqual({
      kind: 'task',
      id: 'design',
      part: 'body',
    });
    chart.fire(chart.part('design', '[data-handle="resize-end"]'), 'pointermove', end);
    expect(chart.core.getSnapshot().feedback.hover).toEqual({
      kind: 'task',
      id: 'design',
      part: 'resize-end',
    });

    chart.fire(chart.scroller, 'pointerleave', end, { bubbles: false });
    expect(chart.core.getSnapshot().feedback.hover.kind).toBe('empty');
  });

  it('NFR-PERF-2: moves over the same element while idle are not sent again', () => {
    const chart = mountChart();
    const centre = chart.barCentre('design');
    const track = chart.part('design');

    chart.fire(track, 'pointermove', centre);
    const calls = chart.core.send.mock.calls.length;
    for (let i = 1; i < 20; i++) chart.fire(track, 'pointermove', shift(centre, i));
    expect(chart.core.send.mock.calls.length).toBe(calls);

    chart.fire(chart.part('design', '[data-handle="resize-end"]'), 'pointermove', centre);
    expect(chart.core.send.mock.calls.length).toBe(calls + 1);
  });

  it('FR-EDIT-8: the same element means something else after a scroll or new data: it is sent again', () => {
    const chart = mountChart();
    const centre = chart.barCentre('design');
    const track = chart.part('design');
    chart.fire(track, 'pointermove', centre);
    const calls = chart.core.send.mock.calls.length;

    // The bars layer reuses its nodes for other tasks when the window moves.
    chart.core.inner.scroll({ left: 40, top: 0 });
    chart.fire(track, 'pointermove', shift(centre, 1));
    expect(chart.core.send.mock.calls.length).toBe(calls + 1);
    chart.fire(track, 'pointermove', shift(centre, 2));
    expect(chart.core.send.mock.calls.length).toBe(calls + 1);

    chart.core.inner.setTasks([{ id: 'x', name: 'X', start: '2026-03-02', end: '2026-03-04' }]);
    chart.fire(track, 'pointermove', shift(centre, 3));
    expect(chart.core.send.mock.calls.length).toBe(calls + 2);
  });

  it('FR-LINK-4: a link drag from a handle to a bar creates the link', async () => {
    const chart = mountChart();
    const from = chart.linkHandle('design', 'linkEnd');
    const to = chart.barCentre('build');
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);

    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.move(shift(from, 30, 1));
    expect(chart.core.getSnapshot().feedback.link).toBeDefined();
    chart.move(to);
    expect(chart.core.getSnapshot().feedback.link?.link).toEqual({
      source: 'design',
      target: 'build',
      type: 'FS',
    });
    chart.release(to);
    await settle();

    expect(created).toHaveBeenCalledTimes(1);
    expect(chart.core.inner.getLink('design:FS:build')).toBeDefined();
    expect(chart.core.getSnapshot().feedback.link).toBeUndefined();
  });

  it('FR-LINK-4: click-click creates a link too: the handle, then the target bar, with a preview between', async () => {
    const chart = mountChart();
    const from = chart.linkHandle('design', 'linkEnd');
    const to = chart.barCentre('build');
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);

    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.release(from);
    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');
    // Moves without a button while armed: the target is read from the element under the pointer.
    chart.fire(chart.part('build'), 'pointermove', to);
    expect(chart.core.getSnapshot().feedback.link?.target).toBe('build');
    chart.press(chart.part('build'), to);
    chart.release(to);
    await settle();

    expect(created).toHaveBeenCalledTimes(1);
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-LINK-4: Escape cancels an armed click-click link', () => {
    const chart = mountChart();
    const from = chart.linkHandle('design', 'linkEnd');
    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.release(from);
    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.core.getSnapshot().feedback.link).toBeUndefined();
  });
});

describe('pointer input: keys', () => {
  it('FR-EDIT-4, FR-SNAP-10: keys are sent while a gesture is in progress, Alt on release too', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    const calls = chart.core.send.mock.calls.length;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));

    expect(sent(chart).slice(calls)).toMatchObject([
      { type: 'key', key: 'Alt', modifiers: { alt: true } },
      { type: 'key', key: 'Alt', modifiers: { alt: false } },
    ]);
  });

  it('FR-EDIT-4: keys are not sent while idle, so typing elsewhere costs the chart nothing', () => {
    const chart = mountChart();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(chart.core.send).not.toHaveBeenCalled();
  });
});

describe('pointer input: effects through the snapshot', () => {
  it('FR-EDIT-8: data-cursor on the root follows the gesture and is gone when it ends', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);

    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    expect(chart.root.getAttribute('data-cursor')).toBe('grabbing');
    chart.release(shift(from, DAY_PX));
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);

    const end = chart.handleCentre('design', 'resizeEnd');
    chart.press(chart.part('design', '[data-handle="resize-end"]'), end);
    chart.move(shift(end, DAY_PX));
    expect(chart.root.getAttribute('data-cursor')).toBe('ew-resize');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-LINK-4, FR-LINK-6: the cursor is a crosshair while linking and not-allowed over a refused target', () => {
    const chart = mountChart();
    const from = chart.linkHandle('design', 'linkEnd');

    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.move(shift(from, 30, 1));
    expect(chart.root.getAttribute('data-cursor')).toBe('crosshair');
    // The source itself is no target.
    chart.move(chart.barCentre('design'));
    expect(chart.core.getSnapshot().feedback.link?.refusal).toBe('self');
    expect(chart.root.getAttribute('data-cursor')).toBe('not-allowed');
  });

  it('FR-EDIT-8: a handler of the app that throws at the release does not leave the cursor behind', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    expect(chart.root.getAttribute('data-cursor')).toBe('grabbing');
    // What the core does when a listener throws: everything runs, then it rethrows.
    chart.core.send.mockImplementationOnce((event) => {
      chart.core.inner.send(event);
      throw new Error('a listener failed');
    });

    // A browser reports it to the window; happy-dom rethrows from `dispatchEvent`.
    expect(() => chart.release(shift(from, DAY_PX))).toThrow('a listener failed');

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-EDIT-8: a cancel the facade handled itself (no effect returned) still clears the cursor', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    expect(chart.root.getAttribute('data-cursor')).toBe('grabbing');

    // An API call cancels the gesture; its effects never reach the renderer.
    chart.core.inner.edit.begin();
    chart.core.inner.edit.rollback();
    chart.move(shift(from, 2 * DAY_PX));

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });
});

describe('pointer input: autoscroll (FR-EDIT-6)', () => {
  /** A drag whose pointer sits in the right edge zone of the 800 px viewport. */
  function dragToRightEdge(chart: Chart): Client {
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    const edge = { clientX: 790, clientY: from.clientY };
    chart.move(edge);
    return edge;
  }

  it('FR-EDIT-6: a drag in the edge zone scrolls the scroller by the velocity every frame', () => {
    const chart = mountChart();
    dragToRightEdge(chart);
    const velocity = chart.core.getSnapshot().autoScroll;
    expect(velocity).toBeGreaterThan(0);
    const start = chart.scroller.scrollLeft;

    chart.frame();
    expect(chart.scroller.scrollLeft).toBeCloseTo(start + velocity, 6);
    chart.frame();
    chart.frame();

    expect(chart.scroller.scrollLeft).toBeCloseTo(start + 3 * velocity, 6);
  });

  it('FR-TL-5: each step is reported to the core in the same frame, which places the dragged bar for the new offset', () => {
    // Every day works: a bar dragged onto a weekend would be rolled to the Monday.
    const chart = mountChart({ calendar: { weekends: [] } });
    dragToRightEdge(chart);
    const velocity = chart.core.getSnapshot().autoScroll;
    const { scrollLeft } = chart.core.getSnapshot().timeline;
    const barX = (): number => chart.core.inner.getBarRect('design')!.x;
    const drawnX = (): number => Number(chart.part('design').getAttribute('x'));
    const before = barX();
    chart.core.scroll.mockClear();

    chart.frame();

    // No `scroll` event from the browser needed: the loop reported the offset itself.
    expect(chart.core.scroll).toHaveBeenCalledTimes(1);
    expect(chart.core.scroll).toHaveBeenLastCalledWith({
      left: scrollLeft + velocity,
      top: chart.core.getSnapshot().scrollTop,
    });
    expect(chart.core.getSnapshot().timeline.scrollLeft).toBe(scrollLeft + velocity);
    // Three steps (45 px) make the preview one snap step (a day, 40 px) later, and it is drawn
    // by the frame that scrolled, not by the next one.
    chart.frame();
    chart.frame();
    expect(barX()).toBe(before + DAY_PX);
    expect(drawnX()).toBe(barX());
  });

  it('FR-TL-5: in a mounted chart a step reports through the scroll sync, with no synthetic event', () => {
    const chart = mountChart({ calendar: { weekends: [] } });
    dragToRightEdge(chart);
    const dispatch = vi.spyOn(chart.scroller, 'dispatchEvent');
    chart.core.scroll.mockClear();

    chart.frame();

    expect(chart.core.scroll).toHaveBeenCalled();
    expect(dispatch.mock.calls.filter(([event]) => event.type === 'scroll')).toEqual([]);
  });

  it('FR-TL-5: the real scroll event that follows a step changes nothing', () => {
    const chart = mountChart();
    dragToRightEdge(chart);
    chart.frame();
    const snapshot = chart.core.getSnapshot();

    chart.scroller.dispatchEvent(new Event('scroll'));

    expect(chart.core.getSnapshot()).toBe(snapshot);
  });

  it('FR-EDIT-6: releasing the pointer stops the loop: its last frame scrolls no more and asks for none', () => {
    const chart = mountChart();
    const edge = dragToRightEdge(chart);
    chart.frame();
    const scrolled = chart.scroller.scrollLeft;
    const lefts: (number | undefined)[] = [];
    vi.spyOn(chart.scroller, 'scrollTo').mockImplementation(((scrollOptions?: ScrollToOptions) => {
      lefts.push(scrollOptions?.left);
    }) as typeof chart.scroller.scrollTo);

    chart.release(edge);
    chart.frame();
    chart.frame();

    expect(chart.frames.queued).toBe(0);
    // The render may scroll to a request of the core; the loop never goes on past `scrolled`.
    expect(lefts.every((left) => left === undefined || left <= scrolled)).toBe(true);
  });

  it('FR-EDIT-6: moving the pointer out of the edge zone stops the loop', () => {
    const chart = mountChart();
    const edge = dragToRightEdge(chart);
    chart.frame();
    const scrolled = chart.scroller.scrollLeft;

    chart.move(shift(edge, -300));
    expect(chart.core.getSnapshot().autoScroll).toBe(0);
    chart.frame();
    chart.frame();

    expect(chart.scroller.scrollLeft).toBe(scrolled);
    expect(chart.frames.queued).toBe(0);
  });

  it('FR-EDIT-6: an autoscroll the core ended by itself (a cancel through the API) stops the loop', () => {
    const chart = mountChart();
    dragToRightEdge(chart);
    chart.frame();
    const scrolled = chart.scroller.scrollLeft;

    // Nothing of this reaches the renderer as an effect; the snapshot says velocity 0.
    chart.core.inner.send({ type: 'cancel' });
    expect(chart.core.getSnapshot().autoScroll).toBe(0);
    chart.frame();
    chart.frame();

    expect(chart.scroller.scrollLeft).toBe(scrolled);
    expect(chart.frames.queued).toBe(0);
  });

  it('FR-EDIT-6: the left edge scrolls left', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move({ clientX: 10, clientY: from.clientY });
    const velocity = chart.core.getSnapshot().autoScroll;
    expect(velocity).toBeLessThan(0);
    const start = chart.scroller.scrollLeft;

    chart.frame();

    expect(chart.scroller.scrollLeft).toBeCloseTo(start + velocity, 6);
  });

  it('FR-EDIT-6: no loop runs while nothing is dragged near an edge', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');

    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    chart.release(shift(from, DAY_PX));
    // Only the render of the last publish is left to do.
    chart.frame();

    expect(chart.core.getSnapshot().autoScroll).toBe(0);
    expect(chart.frames.queued).toBe(0);
  });
});

describe('pointer input: the frame of an automatic-height chart (FR-SCROLL-3)', () => {
  it('a page scroll drops the cached frame, which the next pointer event measures again', () => {
    const scroller = document.createElement('div');
    const root = document.createElement('div');
    root.append(scroller);
    document.body.append(root);
    const core = createTestCore();
    core.setViewport({ width: 800, height: 400 });
    const controller = new AbortController();
    let moved: (() => void) | undefined;
    let stopped = false;
    const dispose = mountInput({
      core,
      root,
      scroller,
      signal: controller.signal,
      frames: createManualFrames(),
      report: () => undefined,
      onFrameMove: (listener) => {
        moved = listener;
        return () => {
          stopped = true;
        };
      },
    });
    const measure = vi.spyOn(scroller, 'getBoundingClientRect');
    const event = (type: string): PointerEvent =>
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        clientX: 5,
        clientY: 50,
      });

    // Moves over another element than the last one are sent (an unchanged hover is skipped).
    const child = document.createElement('div');
    scroller.append(child);

    scroller.dispatchEvent(event('pointerenter'));
    child.dispatchEvent(event('pointermove'));
    expect(measure).toHaveBeenCalledTimes(1);

    moved!();
    expect(measure).toHaveBeenCalledTimes(1);
    scroller.dispatchEvent(event('pointermove'));
    expect(measure).toHaveBeenCalledTimes(2);

    dispose();
    controller.abort();
    expect(stopped).toBe(true);
    core.destroy();
  });
});

describe('pointer input: destroy (FR-API-4)', () => {
  it('FR-API-4: destroy removes every listener, stops the autoscroll frame and ends the input', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move({ clientX: 790, clientY: from.clientY });
    chart.frame();
    expect(chart.frames.queued).toBe(1);

    chart.renderer.destroy();

    expect(tracker.alive()).toEqual([]);
    expect(chart.frames.queued).toBe(0);
    // The drag is cancelled at destroy (that is its last input); nothing is heard after it.
    const calls = chart.core.send.mock.calls.length;
    expect(chart.core.send.mock.calls.at(-1)).toEqual([{ type: 'cancel', pointerId: undefined }]);
    chart.fire(chart.scroller, 'pointermove', from);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(chart.core.send.mock.calls.length).toBe(calls);
  });

  it('FR-API-4: two charts keep their input apart', () => {
    const first = mountChart();
    const second = mountChart();
    const from = first.barCentre('design');

    first.press(first.part('design'), from);
    first.move(shift(from, DAY_PX));

    expect(first.core.getSnapshot().feedback.phase).toBe('dragging');
    expect(second.core.send).not.toHaveBeenCalled();
    expect(second.root.hasAttribute('data-cursor')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(second.core.send).not.toHaveBeenCalled();
  });
});

describe('pointer input: automatic height (FR-SCROLL-3)', () => {
  it('FR-SCROLL-3: the scroller already moves with the page, so its offset (the core scrollTop) is not added to y again', () => {
    const chart = mountChart();
    chart.root.setAttribute('data-height', 'auto');
    chart.core.inner.scroll({ left: 0, top: 300 });
    const { headerHeight } = chart.core.getSnapshot().layout.rows;
    // The page is scrolled 300: the chart's top edge is 300 above the viewport, and its header
    // sticks to the top of the page.
    layOut(chart, { top: -300, headerTop: 0, height: 1500 });

    chart.press(chart.scroller, { clientX: 100, clientY: 200 });

    expect(sent(chart)[0]).toMatchObject({ type: 'down', y: 200 + 300 - headerHeight });
  });

  it('FR-EDIT-1: with a fixed height the scroller keeps its place on the page and its scroll offset is added', () => {
    const chart = mountChart();
    chart.core.inner.scroll({ left: 0, top: 300 });
    const { headerHeight } = chart.core.getSnapshot().layout.rows;
    layOut(chart, { top: 20 });

    chart.press(chart.scroller, { clientX: 100, clientY: 200 });

    expect(sent(chart)[0]).toMatchObject({ type: 'down', y: 200 - 20 + 300 - headerHeight });
  });

  it('FR-SCROLL-3: the mode is read when the pointer moves, so a chart that changes its height is placed right at once', () => {
    const chart = mountChart();
    chart.core.inner.scroll({ left: 0, top: 300 });
    layOut(chart, { top: 0, height: 1500 });
    chart.press(chart.scroller, { clientX: 100, clientY: 200 });
    chart.release({ clientX: 100, clientY: 200 });
    chart.root.setAttribute('data-height', 'auto');

    chart.press(chart.scroller, { clientX: 100, clientY: 200 });

    const downs = sent(chart).filter((event) => event.type === 'down');
    expect(downs).toHaveLength(2);
    expect((downs[1] as { y: number }).y).toBe((downs[0] as { y: number }).y - 300);
  });
});

describe('pointer input: a pointer outside the visible body (FR-LINK-4)', () => {
  /** A link drag from the end handle of `design`, under way. */
  function linkDrag(chart: Chart): void {
    const from = chart.linkHandle('design', 'linkEnd');
    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.move(shift(from, 30, 1));
    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');
  }
  const target = (chart: Chart): TaskId | undefined =>
    chart.core.getSnapshot().feedback.link?.target;
  /** Client x of the middle of `build`, which is in view while the chart is at its `scrollLeft`. */
  const buildX = (chart: Chart): number => {
    const { scrollLeft } = chart.core.getSnapshot().timeline;
    const x = chart.core.inner.getBarRect('build')!.x + 20 - scrollLeft;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(800);
    return x;
  };

  it('FR-LINK-4: releasing over the sticky header links nothing to a bar that is scrolled under it', async () => {
    const chart = mountChart();
    layOut(chart);
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);
    linkDrag(chart);
    // Scrolled 60 px down: `build` (body y 57 to 87) is now behind the header (75 px).
    chart.core.inner.scroll({ left: chart.core.getSnapshot().timeline.scrollLeft, top: 60 });
    const x = buildX(chart);

    // Control: below the header the bar is under the pointer.
    chart.move({ clientX: x, clientY: 100 });
    expect(target(chart)).toBe('build');
    // Over the header it is not, whatever the layout says is under that point of the content.
    chart.move({ clientX: x, clientY: 73 });
    expect(target(chart)).toBeUndefined();
    chart.release({ clientX: x, clientY: 73 });
    await settle();

    expect(created).not.toHaveBeenCalled();
    expect(chart.core.inner.getLink('design:FS:build')).toBeUndefined();
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-LINK-4: the second click of click-click on the sticky header links nothing either', async () => {
    const chart = mountChart();
    layOut(chart);
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);
    const from = chart.linkHandle('design', 'linkEnd');
    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.release(from);
    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');
    chart.core.inner.scroll({ left: chart.core.getSnapshot().timeline.scrollLeft, top: 60 });
    const where = { clientX: buildX(chart), clientY: 73 };

    chart.press(chart.container.querySelector('.gantt__header')!, where);
    chart.release(where);
    await settle();

    expect(created).not.toHaveBeenCalled();
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-LINK-4: releasing right of the chart links nothing to a bar that is scrolled out of view there', async () => {
    const chart = mountChart();
    layOut(chart);
    chart.core.inner.scroll({ left: 0, top: 0 });
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);
    linkDrag(chart);
    // `build` is at x 840 to 1040 of the content: beyond the 800 px of the viewport.
    const row = chart.barCentre('build').clientY;

    chart.move({ clientX: 900, clientY: row });
    expect(target(chart)).toBeUndefined();
    chart.release({ clientX: 900, clientY: row });
    await settle();

    expect(created).not.toHaveBeenCalled();
  });

  it('FR-LINK-4: releasing left of the chart links nothing to a bar that is scrolled out of view there', async () => {
    const chart = mountChart();
    layOut(chart);
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);
    linkDrag(chart);
    // Scrolled 1200 px right: `build` (x 840 to 1040) is now to the left of the viewport.
    chart.core.inner.scroll({ left: 1200, top: 0 });
    const row = chart.barCentre('build').clientY;

    chart.move({ clientX: -300, clientY: row });
    expect(target(chart)).toBeUndefined();
    chart.release({ clientX: -300, clientY: row });
    await settle();

    expect(created).not.toHaveBeenCalled();
  });

  it('FR-LINK-4: a captured pointer inside the body still finds its target in the layout', async () => {
    const chart = mountChart();
    layOut(chart);
    const created = vi.fn();
    chart.core.inner.on('linkCreate', created);
    linkDrag(chart);
    const to = chart.barCentre('build');

    chart.move(to);
    chart.release(to);
    await settle();

    expect(created).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-8: hovering the scrollbar reports nothing under the pointer, whatever the content behind it is', () => {
    const chart = mountChart();
    layOut(chart);
    // Scrolled so that `phase` (x 1960 to 2440, row 3) is where a pointer on the vertical
    // scrollbar (client x 805) is in the content.
    chart.core.inner.scroll({ left: 1300, top: 0 });
    chart.frame();
    const row = chart.barCentre('phase').clientY;
    chart.fire(chart.part('phase'), 'pointermove', { clientX: 400, clientY: row });
    expect(chart.core.getSnapshot().feedback.hover).toMatchObject({ kind: 'task', id: 'phase' });

    chart.fire(chart.scroller, 'pointermove', { clientX: 805, clientY: row });

    expect(chart.core.getSnapshot().feedback.hover.kind).toBe('empty');
  });
});

describe('pointer input: the cached frame (FR-EDIT-8)', () => {
  /** A chart with a pointer inside it that has measured it once. */
  function hovering(): { chart: Chart; measure: MockInstance; over: () => void } {
    const chart = mountChart();
    const measure = vi.spyOn(chart.scroller, 'getBoundingClientRect');
    const from = chart.barCentre('design');
    chart.fire(chart.scroller, 'pointerenter', from, { bubbles: false });
    chart.fire(chart.part('design'), 'pointermove', from);
    expect(measure).toHaveBeenCalledTimes(1);
    // Moves over another element than the last one are sent: they need the frame.
    const handles = ['resize-end', 'resize-start'] as const;
    let turn = 0;
    return {
      chart,
      measure,
      over: () => {
        const handle = handles[turn++ % 2]!;
        chart.fire(chart.part('design', `[data-handle="${handle}"]`), 'pointermove', from);
      },
    };
  }

  it('FR-EDIT-8: a scroll of the page drops the frame, which the next pointer event measures again', () => {
    const { measure, over } = hovering();

    document.dispatchEvent(new Event('scroll'));
    over();

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('FR-EDIT-8: so does a scroll of any ancestor of the chart', () => {
    const { chart, measure, over } = hovering();

    chart.container.dispatchEvent(new Event('scroll'));
    over();

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('FR-EDIT-8: so does a resize of the window', () => {
    const { measure, over } = hovering();

    window.dispatchEvent(new Event('resize'));
    over();

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('FR-EDIT-8: the scroll of the chart itself (its scroller, its pin) moves nothing on the page and keeps the frame', () => {
    const { chart, measure, over } = hovering();
    const pin = document.createElement('div');
    pin.className = 'gantt__pin';
    chart.root.prepend(pin);

    chart.scroller.dispatchEvent(new Event('scroll'));
    pin.dispatchEvent(new Event('scroll'));
    chart.container.querySelector('.gantt__layer')!.dispatchEvent(new Event('scroll'));
    over();

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('FR-EDIT-8: the hover survives a page scroll that moved the chart up under a pointer that stays', () => {
    const chart = mountChart();
    layOut(chart, { top: 300 });
    const { headerHeight } = chart.core.getSnapshot().layout.rows;
    const first = chart.barCentre('design');
    // Over the first row, the chart being 300 px down the page.
    const where = { clientX: first.clientX, clientY: 300 + headerHeight + 24 };
    chart.fire(chart.scroller, 'pointerenter', where, { bubbles: false });
    chart.fire(chart.container.querySelector('.gantt__row')!, 'pointermove', where);

    // The page scrolls 200 px, and the pointer moves a little over the first row's bar.
    layOut(chart, { top: 100 });
    document.dispatchEvent(new Event('scroll'));
    const moved = { clientX: where.clientX, clientY: 100 + headerHeight + 24 };
    chart.fire(chart.part('design'), 'pointermove', moved);

    // With the frame of 300 that point would be over the header: no hover.
    expect(chart.core.getSnapshot().feedback.hover).toMatchObject({ kind: 'task', id: 'design' });
  });

  it('FR-API-4: the page listeners end with the chart', () => {
    const chart = mountChart();

    chart.renderer.destroy();

    expect(tracker.alive()).toEqual([]);
  });
});

describe('pointer input: a chart under a CSS scale() (FR-EDIT-1)', () => {
  for (const scale of [2, 0.5]) {
    const page = (at: Client): Client => ({
      clientX: at.clientX * scale,
      clientY: at.clientY * scale,
    });

    it(`FR-EDIT-1: scale(${String(scale)}): a drag of 2 days moves the bar by 2 days`, async () => {
      const chart = mountChart();
      layOut(chart, { scale });
      const from = page(chart.barCentre('design'));

      chart.press(chart.part('design'), from);
      chart.move(shift(from, 2 * DAY_PX * scale));
      chart.release(shift(from, 2 * DAY_PX * scale));
      await settle();

      const [change] = chart.changes[0]!.changes;
      expect(change!.after.start - change!.before.start).toBe(2 * DAY);
    });

    it(`FR-EDIT-1: scale(${String(scale)}): the whole box of the scroller is the chart, only past it is a scrollbar`, () => {
      const chart = mountChart();
      layOut(chart, { scale });
      const row = chart.barCentre('design').clientY * scale;

      // 790 layout px is inside; 805 is on the scrollbar, whatever the page px say.
      chart.press(chart.scroller, { clientX: 790 * scale, clientY: row });
      expect(chart.capture).toHaveBeenCalledTimes(1);
      chart.press(chart.scroller, { clientX: 805 * scale, clientY: row }, { pointerId: 2 });
      expect(chart.capture).toHaveBeenCalledTimes(1);
    });
  }
});

describe('pointer input: destroying the renderer mid-gesture (FR-API-4)', () => {
  it('FR-API-4: a drag in progress ends in the core that outlives the renderer', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, 2 * DAY_PX));
    expect(chart.core.getSnapshot().feedback.phase).toBe('dragging');
    expect(chart.core.getSnapshot().state.draft).toBeDefined();

    chart.renderer.destroy();

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
    expect(chart.changes).toEqual([]);
  });

  it('FR-API-4: so does an armed link, and a press that has not moved', () => {
    const armed = mountChart();
    const from = armed.linkHandle('design', 'linkEnd');
    armed.press(armed.part('design', '[data-side="end"]'), from);
    armed.release(from);
    expect(armed.core.getSnapshot().feedback.phase).toBe('linking');
    armed.renderer.destroy();
    expect(armed.core.getSnapshot().feedback.phase).toBe('idle');

    const pressed = mountChart();
    pressed.press(pressed.part('design'), pressed.barCentre('design'));
    expect(pressed.core.getSnapshot().feedback.phase).toBe('pressed');
    pressed.renderer.destroy();
    expect(pressed.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-API-4: nothing is sent to the core when no gesture is in progress', () => {
    const chart = mountChart();
    const calls = chart.core.send.mock.calls.length;

    chart.renderer.destroy();

    expect(chart.core.send.mock.calls.length).toBe(calls);
  });

  it('FR-API-4: a core that was destroyed first is no error', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));

    chart.core.inner.destroy();

    expect(() => {
      chart.renderer.destroy();
    }).not.toThrow();
  });
});

describe('pointer input: the core changes without a pointer event (FR-EDIT-8)', () => {
  it('FR-EDIT-8: a cancel made through the API clears the cursor at once, with no further pointer event', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));
    expect(chart.root.getAttribute('data-cursor')).toBe('grabbing');

    chart.core.inner.send({ type: 'cancel' });

    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-EDIT-6: turning scroll.autoScroll off mid-drag stops the autoscroll', () => {
    const chart = mountChart();
    const edge = { clientX: 790, clientY: chart.barCentre('design').clientY };
    chart.press(chart.part('design'), chart.barCentre('design'));
    chart.move(edge);
    chart.frame();
    expect(chart.core.getSnapshot().autoScroll).toBeGreaterThan(0);

    chart.core.inner.setOptions({ scroll: { autoScroll: false } });
    chart.frame();
    const stopped = chart.scroller.scrollLeft;
    chart.frame();
    chart.frame();

    expect(chart.scroller.scrollLeft).toBe(stopped);
    expect(chart.core.getSnapshot().autoScroll).toBe(0);
  });

  it('FR-API-4: the input hears the core through a subscription that the signal ends', () => {
    const scroller = document.createElement('div');
    const root = document.createElement('div');
    root.append(scroller);
    document.body.append(root);
    const core = observeCore(createTestCore());
    const controller = new AbortController();

    mountInput({
      core,
      root,
      scroller,
      signal: controller.signal,
      frames: createManualFrames(),
      report: () => undefined,
    });
    expect(core.subscribers()).toBe(1);
    controller.abort();

    expect(core.subscribers()).toBe(0);
    core.inner.destroy();
  });
});

describe('pointer input: an armed link (FR-LINK-4)', () => {
  /** Arms click-click: the handle of `design` clicked. */
  function arm(chart: Chart): void {
    const from = chart.linkHandle('design', 'linkEnd');
    chart.press(chart.part('design', '[data-side="end"]'), from);
    chart.release(from);
    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');
    expect(chart.core.getSnapshot().feedback.link).toBeDefined();
  }
  const press = (target: Element, init: PointerEventInit = {}): void => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 9,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        ...init,
      }),
    );
  };

  it('FR-LINK-4: a press outside the chart disarms it, with its preview and cursor', () => {
    const chart = mountChart();
    arm(chart);
    expect(chart.root.getAttribute('data-cursor')).toBe('crosshair');

    press(document.body);

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.core.getSnapshot().feedback.link).toBeUndefined();
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-LINK-4: a press inside the chart, popovers included, is not outside', () => {
    const chart = mountChart();
    arm(chart);

    press(chart.container.querySelector('.gantt__layer')!);
    press(chart.root);

    expect(chart.core.getSnapshot().feedback.phase).toBe('linking');
  });

  it('FR-LINK-4: the window losing focus disarms it', () => {
    const chart = mountChart();
    arm(chart);

    window.dispatchEvent(new Event('blur'));

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
    expect(chart.root.hasAttribute('data-cursor')).toBe(false);
  });

  it('FR-EDIT-1: and cancels a drag whose release it will never see', async () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, 2 * DAY_PX));
    expect(chart.core.getSnapshot().state.draft).toBeDefined();

    window.dispatchEvent(new Event('blur'));
    chart.release(shift(from, 2 * DAY_PX));
    await settle();

    expect(chart.core.getSnapshot().state.draft).toBeUndefined();
    expect(chart.changes).toEqual([]);
    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-LINK-4: Escape keeps cancelling an armed link', () => {
    const chart = mountChart();
    arm(chart);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });

  it('FR-EDIT-1: a press elsewhere does not end a gesture whose pointer is held (a second finger)', () => {
    const chart = mountChart();
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));

    press(document.body, { pointerId: 12, pointerType: 'touch', isPrimary: false });

    expect(chart.core.getSnapshot().feedback.phase).toBe('dragging');
  });

  it('FR-LINK-4: while nothing is armed or dragged a press elsewhere sends nothing', () => {
    const chart = mountChart();
    const calls = chart.core.send.mock.calls.length;

    press(document.body);
    window.dispatchEvent(new Event('blur'));

    expect(chart.core.send.mock.calls.length).toBe(calls);
  });
});

describe('pointer input: what a read-only chart listens to (NFR-PERF-2)', () => {
  const alive = (...types: string[]): string[] =>
    tracker
      .alive()
      .map((entry) => entry.type)
      .filter((type) => types.includes(type));

  it('NFR-PERF-2: with editing off there is no non-passive touchstart and no key listener of the input', () => {
    mountChart({ editing: false });

    expect(alive('touchstart', 'keyup')).toEqual([]);
  });

  it('FR-EDIT-1: they are added when editing is turned on, and stay until the chart is destroyed', () => {
    const chart = mountChart({ editing: false });

    chart.core.inner.setOptions({ editing: true });
    expect(alive('touchstart', 'keyup')).toEqual(['touchstart', 'keyup']);
    chart.core.inner.setOptions({ editing: false });
    chart.core.inner.setOptions({ editing: { move: true } });
    expect(alive('touchstart', 'keyup')).toEqual(['touchstart', 'keyup']);

    chart.renderer.destroy();
    expect(alive('touchstart', 'keyup')).toEqual([]);
  });

  it('FR-EDIT-1: a chart that can edit anything has them from the start', () => {
    mountChart({ editing: { links: true, move: false, resize: false, progress: false } });

    expect(alive('touchstart', 'keyup')).toEqual(['touchstart', 'keyup']);
  });

  it('FR-EDIT-4: a chart that may be edited again after a gesture began keeps Escape working', () => {
    const chart = mountChart({ editing: false });
    chart.core.inner.setOptions({ editing: true });
    const from = chart.barCentre('design');
    chart.press(chart.part('design'), from);
    chart.move(shift(from, DAY_PX));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(chart.core.getSnapshot().feedback.phase).toBe('idle');
  });
});

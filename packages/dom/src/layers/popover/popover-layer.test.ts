import {
  type CalendarDay,
  type DateTimeMs,
  type GanttCore,
  type GanttSnapshot,
  type Task,
  type TaskId,
  toDayKey,
} from '@ganttlane/core';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { placePopover, type Rect } from '../../dom-utils/position';
import {
  countNodes,
  createLayerHarness,
  createTestCore,
  describeLayerContract,
  type LayerHarness,
  trackListeners,
} from '../../testing';
import type { GanttStringsInput, LayerContext } from '../types';
import { createPopoverLayer, type PopoverLayer } from './index';
import type { DisposableNode, LinkMenuContext, TaskTooltipContext, TooltipContent } from './types';

describeLayerContract('popover', createPopoverLayer);

/** Where the chart sits in the page (the layer and the scroller cover it) and the popover's size. */
const CHART: Rect = { x: 100, y: 50, width: 800, height: 400 };
const POPOVER = { width: 120, height: 50 };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Floating wall-clock milliseconds (core's time is UTC-based numbers). */
const ms = (year: number, month: number, day: number, hour = 0): DateTimeMs =>
  Date.UTC(year, month, day, hour) as DateTimeMs;

/** The display options the harness takes (a layer may not import the renderer's `display`). */
type DisplayOptions = NonNullable<Parameters<typeof createLayerHarness>[1]>;
type PopoverContext = LayerContext<HTMLDivElement>;

interface Chart {
  readonly core: GanttCore;
  readonly harness: LayerHarness<'popover'>;
  readonly layer: PopoverLayer;
  readonly root: HTMLDivElement;
  readonly scroller: HTMLElement;
  /** The layer updates with the core's latest snapshot, as the renderer does after a publish. */
  render(): void;
  /** Changes the display options and updates. */
  display(options: DisplayOptions): void;
  /** Changes the strings and updates. */
  strings(patch: GanttStringsInput): void;
  /** The popover element, if one is open. */
  popover(): HTMLElement | null;
}

const track = { restore: (): void => undefined };
let chart: Chart | undefined;
/** The boxes the stubbed layout reports; a test may change them before it opens a popover. */
let chartBox: Rect = CHART;
let popoverBox: { width: number; height: number } = POPOVER;

beforeEach(() => {
  vi.useFakeTimers();
  chartBox = CHART;
  popoverBox = POPOVER;
  // happy-dom lays nothing out: the chart is a box at CHART, the popover a box of POPOVER.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = this.classList.contains('gantt__popover')
      ? { x: 0, y: 0, ...popoverBox }
      : this.classList.contains('gantt__layer') || this.classList.contains('gantt__scroller')
        ? chartBox
        : { x: 0, y: 0, width: 0, height: 0 };
    return {
      ...box,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON: () => box,
    };
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === document.documentElement ? 1000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === document.documentElement ? 800 : 0;
  });
});

afterEach(() => {
  chart?.layer.destroy();
  chart?.harness.abort();
  chart?.core.destroy();
  chart = undefined;
  track.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A real core under a real layer: events and snapshots are the core's, the DOM is the harness's. */
function mount(
  display: DisplayOptions = {},
  core: GanttCore = createTestCore({ links: [{ source: 'design', target: 'build' }] }),
  options: { readonly shadow?: boolean } = {},
): Chart {
  core.setViewport({ width: 800, height: 400 });
  const harness = createLayerHarness('popover', display);
  if (options.shadow) {
    // The whole chart inside an open shadow root: what a web component hosts it in.
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(harness.root.parentElement!);
  }
  const context = Object.create(harness.context, {
    getTask: { value: core.getTask },
    getLink: { value: core.getLink },
    on: { value: core.on },
    send: { value: core.send },
  }) as PopoverContext;
  const layer = createPopoverLayer();
  layer.mount(context);
  let previous: GanttSnapshot | undefined;
  const render = (): void => {
    const snapshot = core.getSnapshot();
    layer.update(snapshot, previous);
    previous = snapshot;
  };
  render();
  chart = {
    core,
    harness,
    layer,
    root: harness.root,
    scroller: harness.context.scroller,
    render,
    display(options) {
      harness.setDisplay(options);
      render();
    },
    strings(patch) {
      harness.setStrings(patch);
      render();
    },
    popover: () => harness.root.querySelector<HTMLElement>('.gantt__popover'),
  };
  return chart;
}

/** The pointer moves onto the middle of a bar (core: content coordinates). */
function hover(target: Chart, id: TaskId): void {
  const bar = target.core.getSnapshot().layout.getBarRect(id)!;
  target.core.send({
    type: 'move',
    pointerId: 1,
    x: bar.x + bar.width / 2,
    y: bar.y + bar.height / 2,
    time: 0,
  });
  target.render();
}

/** The pointer moves to where nothing is. */
function leave(target: Chart): void {
  target.core.send({ type: 'move', pointerId: 1, x: 1, y: 1, time: 0 });
  target.render();
}

/** Press, then drag the bar by `dx` px; `release` ends the drag. */
function drag(target: Chart, id: TaskId, dx: number): { release(): void } {
  const bar = target.core.getSnapshot().layout.getBarRect(id)!;
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;
  target.core.send({ type: 'down', pointerId: 1, x, y, time: 0 });
  target.core.send({ type: 'move', pointerId: 1, x: x + dx, y, time: 10 });
  target.render();
  return {
    release() {
      target.core.send({ type: 'up', pointerId: 1, x: x + dx, y, time: 20 });
      target.render();
    },
  };
}

/** The pointer is at a place in the page: the layer keeps the last one it saw. */
function pointerAt(target: Chart, at: { clientX: number; clientY: number }): void {
  target.scroller.dispatchEvent(pointer('pointermove', at));
}

/** A click on a bar, with the pointer at `page` in the page when it is given. */
function clickBar(target: Chart, id: TaskId, page?: { clientX: number; clientY: number }): void {
  if (page) pointerAt(target, page);
  const bar = target.core.getSnapshot().layout.getBarRect(id)!;
  const at = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
  target.core.send({ type: 'down', pointerId: 1, ...at, time: 0 });
  target.core.send({ type: 'up', pointerId: 1, ...at, time: 10 });
  target.render();
}

/** A click on a link (the renderer names the target, as step 4.7 does from `data-link-id`). */
function clickLink(target: Chart, id: string, page?: { clientX: number; clientY: number }): void {
  if (page) pointerAt(target, page);
  const hit = { kind: 'link', id } as const;
  target.core.send({ type: 'down', pointerId: 1, x: 0, y: 0, time: 0, target: hit });
  target.core.send({ type: 'up', pointerId: 1, x: 0, y: 0, time: 10, target: hit });
  target.render();
}

const pointer = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, ...init });

/** The anchor of a bar in page coordinates, as the layer should work it out. */
function barAnchor(target: Chart, id: TaskId): Rect {
  const snapshot = target.core.getSnapshot();
  const bar = snapshot.layout.getBarRect(id)!;
  return {
    x: CHART.x + bar.x - snapshot.timeline.scrollLeft,
    y: CHART.y + snapshot.layout.rows.headerHeight + bar.y - snapshot.scrollTop,
    width: bar.width,
    height: bar.height,
  };
}

/** Where the popover sits in the page, from the custom properties the layer writes. */
function placed(element: HTMLElement): { x: number; y: number } {
  const read = (name: string): number =>
    Number.parseFloat(element.style.getPropertyValue(name)) +
    (name.endsWith('x') ? CHART.x : CHART.y);
  return { x: read('--gantt-popover-x'), y: read('--gantt-popover-y') };
}

describe('popover layer: task tooltip on hover', () => {
  it('FR-TIP-1: opens after a short delay, with the task name, dates and progress', () => {
    const c = mount();

    hover(c, 'design');
    expect(c.popover()).toBeNull();
    vi.advanceTimersByTime(149);
    expect(c.popover()).toBeNull();
    vi.advanceTimersByTime(1);

    const popover = c.popover()!;
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.getAttribute('data-kind')).toBe('task');
    expect(popover.querySelector('.gantt__popover-title')?.textContent).toBe('Design');
    expect(popover.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 2, 2026 – Mar 6, 2026',
    );
    expect(popover.querySelector('.gantt__popover-details')?.textContent).toBe(
      '0% done · 5 working days',
    );
    expect(popover.parentElement).toBe(c.root);
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
  });

  it('FR-TIP-1: `delay` sets the wait, and 0 opens at once', () => {
    const c = mount({ tooltip: { delay: 0 } });

    hover(c, 'design');

    expect(c.popover()).not.toBeNull();
  });

  it('FR-TIP-2: sits above the bar, centred on it, inside the chart', () => {
    const c = mount({ tooltip: { delay: 0 } });

    hover(c, 'design');

    const anchor = barAnchor(c, 'design');
    const expected = placePopover({ anchor, size: POPOVER, bounds: CHART });
    expect(expected.side).toBe('top');
    expect(placed(c.popover()!)).toEqual({ x: expected.x, y: expected.y });
    expect(c.popover()!.getAttribute('data-placement')).toBe('top');
  });

  it('FR-TIP-2: flips below the bar when there is no room above it', () => {
    // The first row is right under the header: the room above the bar is the header's height.
    popoverBox = { width: 120, height: 90 };
    const c = mount({ tooltip: { delay: 0 } });
    const anchor = barAnchor(c, 'design');
    expect(anchor.y - CHART.y).toBeLessThan(popoverBox.height + 8);

    hover(c, 'design');

    expect(c.popover()!.getAttribute('data-placement')).toBe('bottom');
    expect(placed(c.popover()!).y).toBe(anchor.y + anchor.height + 8);
  });

  it('FR-TIP-2: `placement: bottom` prefers the side below, and flips above at the bottom edge', () => {
    const c = mount({ tooltip: { delay: 0, placement: 'bottom' } });
    hover(c, 'design');
    expect(c.popover()!.getAttribute('data-placement')).toBe('bottom');

    // The fourth row is the last: leave 20 px under its bar, too little for the popover.
    const last = barAnchor(c, 'child');
    chartBox = { ...CHART, height: last.y - CHART.y + last.height + 20 };
    hover(c, 'child');

    expect(c.popover()!.getAttribute('data-placement')).toBe('top');
    expect(placed(c.popover()!).y).toBe(last.y - 8 - POPOVER.height);
  });

  it('FR-TIP-2: a bar that is mostly scrolled out gets its tooltip over the part in view, inside the chart', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const build = c.core.getSnapshot().layout.getBarRect('build')!;
    // Only the first 30 px of `build` are in view, at the right edge of the chart.
    c.core.scroll({ left: build.x - 800 + 30, top: 0 });
    c.render();

    hover(c, 'build');

    const { x } = placed(c.popover()!);
    expect(x).toBe(CHART.x + CHART.width - 4 - POPOVER.width);
    expect(x + POPOVER.width).toBeLessThanOrEqual(CHART.x + CHART.width - 4);
  });

  it('FR-TIP-1: leaving the bar hides the tooltip', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    leave(c);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: moving to another bar switches at once, without a second delay, to one tooltip', () => {
    const c = mount();
    hover(c, 'design');
    vi.advanceTimersByTime(150);

    hover(c, 'build');

    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Build');
  });

  it('FR-TIP-1: hovering away before the delay shows nothing', () => {
    const c = mount();
    hover(c, 'design');
    vi.advanceTimersByTime(100);

    leave(c);
    vi.advanceTimersByTime(1000);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: `trigger: none` and `trigger: click` do not open on hover', () => {
    for (const trigger of ['none', 'click'] as const) {
      const c = mount({ tooltip: { trigger, delay: 0 } });

      hover(c, 'design');
      vi.advanceTimersByTime(1000);

      expect(c.popover(), trigger).toBeNull();
      c.layer.destroy();
      c.harness.abort();
      c.core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-3: render returning null (or empty text) shows no tooltip', () => {
    for (const empty of [null, '', '   ', {}]) {
      const c = mount({ tooltip: { delay: 0, render: () => empty } });

      hover(c, 'design');

      expect(c.popover(), JSON.stringify(empty)).toBeNull();
      c.layer.destroy();
      c.harness.abort();
      c.core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-1: changing the options while open closes a tooltip the trigger no longer allows', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    c.display({ tooltip: { trigger: 'none' } });
    vi.advanceTimersByTime(300);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-2: Escape dismisses it, and it stays dismissed until the hover changes', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(c.popover()).toBeNull();
    c.render();
    vi.advanceTimersByTime(500);
    expect(c.popover()).toBeNull();

    hover(c, 'build');
    expect(c.popover()).not.toBeNull();
  });
});

describe('popover layer: tooltip content', () => {
  it('FR-TIP-1: render is called with the context of the task (FR-TIP-6)', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const core = createTestCore({
      links: [
        { source: 'design', target: 'build' },
        { source: 'build', target: 'phase', lag: '1d' },
      ],
    });
    const c = mount({ tooltip: { delay: 0, render } }, core);

    hover(c, 'build');

    expect(render).toHaveBeenCalledTimes(1);
    const context = render.mock.calls[0]![0] as TaskTooltipContext;
    expect(context.task.id).toBe('build');
    expect(context.task).toBe(core.getTask('build'));
    expect(context.isDragging).toBe(false);
    expect(context.preview).toBeUndefined();
    expect(context.gesture).toBeUndefined();
    expect(context.parent).toBeUndefined();
    expect(context.locale).toBe('en');
    expect(context.predecessors.map((link) => link.source)).toEqual(['design']);
    expect(context.successors.map((link) => link.target)).toEqual(['phase']);
    expect(context.successors[0]!.lag.days).toBe(1);
    expect(context.api.getTask('design')).toBe(core.getTask('design'));
    expect(context.api.getLink(context.predecessors[0]!.id)).toBe(context.predecessors[0]);
  });

  it('FR-TIP-1: layer.hide() closes the popover (the facade’s hideTooltip), and a still hovered bar stays closed', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    c.layer.hide();
    c.render();

    expect(c.popover()).toBeNull();
    c.layer.hide();
  });

  it('FR-TIP-6: api.hide() closes the tooltip', () => {
    let context: TaskTooltipContext | undefined;
    const c = mount({
      tooltip: {
        delay: 0,
        render: (given) => {
          context = given;
          return 'x';
        },
      },
    });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    context!.api.hide();

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-6: the context gives the parent of a child', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render } });

    hover(c, 'child');

    const context = render.mock.calls[0]![0] as TaskTooltipContext;
    expect(context.parent?.id).toBe('phase');
  });

  it('FR-TIP-1: a string is text, never HTML', () => {
    const evil = '<img src=x onerror="globalThis.hacked = 1"> & <b>bold</b>';
    const c = mount({ tooltip: { delay: 0, render: () => evil } });

    hover(c, 'design');

    expect(c.popover()!.textContent).toBe(evil);
    expect(c.popover()!.querySelector('img, b')).toBeNull();
  });

  it('FR-TIP-1: the title of the structured form is text too', () => {
    const c = mount({ tooltip: { delay: 0, render: () => ({ title: '<b>x</b>' }) } });

    hover(c, 'design');

    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('<b>x</b>');
    expect(c.popover()!.querySelector('b')).toBeNull();
  });

  it('FR-TIP-1: a Node is appended, and {html} is parsed', () => {
    const node = document.createElement('strong');
    node.textContent = 'node';
    let content: unknown = node;
    const c = mount({ tooltip: { delay: 0, render: () => content as string } });

    hover(c, 'design');
    expect(c.popover()!.querySelector('strong')).toBe(node);

    content = { html: '<em>markup</em>' };
    hover(c, 'build');
    expect(c.popover()!.querySelector('em')?.textContent).toBe('markup');
  });

  it('FR-TIP-1: actions are buttons that call back with the context, then close the tooltip', () => {
    const onSelect = vi.fn();
    const c = mount({
      tooltip: {
        delay: 0,
        render: (context) => ({ title: context.task.name, actions: [{ label: 'Open', onSelect }] }),
      },
    });
    hover(c, 'design');
    const popover = c.popover()!;
    expect(popover.hasAttribute('data-interactive')).toBe(true);

    popover.querySelector<HTMLButtonElement>('button')!.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as { task: { id: string } }).task.id).toBe('design');
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a tooltip with actions stays when the pointer leaves the bar, until a press outside it', () => {
    const c = mount({
      tooltip: {
        delay: 0,
        render: () => ({ title: 'T', actions: [{ label: 'Go', onSelect: vi.fn() }] }),
      },
    });
    hover(c, 'design');
    const popover = c.popover()!;

    leave(c);
    vi.advanceTimersByTime(1000);
    expect(c.popover()).toBe(popover);

    popover.querySelector('button')!.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).toBe(popover);
    document.body.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a tooltip without actions does not take pointer events', () => {
    const c = mount({ tooltip: { delay: 0 } });

    hover(c, 'design');

    expect(c.popover()!.hasAttribute('data-interactive')).toBe(false);
  });

  it('FR-TIP-1: render runs when its inputs change, not on every mouse move', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render, followCursor: true } });
    hover(c, 'design');
    expect(render).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      c.scroller.dispatchEvent(pointer('pointermove', { clientX: 300 + i, clientY: 200 }));
      c.render();
    }
    vi.advanceTimersByTime(100);

    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe('popover layer: following the cursor', () => {
  it('FR-TIP-1, FR-TIP-2: sits above the cursor and follows it, without calling render', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render, followCursor: true } });
    // The cursor is in the page at (400, 300), over the second row.
    c.scroller.dispatchEvent(pointer('pointermove', { clientX: 400, clientY: 300 }));
    hover(c, 'build');

    const first = placed(c.popover()!);
    const expected = placePopover({
      anchor: { x: 400, y: 300, width: 0, height: 16 },
      size: POPOVER,
      bounds: CHART,
    });
    expect(first).toEqual({ x: expected.x, y: expected.y });
    expect(expected.side).toBe('top');

    c.scroller.dispatchEvent(pointer('pointermove', { clientX: 450, clientY: 320 }));
    expect(placed(c.popover()!)).toEqual(first);
    c.harness.scheduler.flush();

    expect(placed(c.popover()!)).toEqual({ x: first.x + 50, y: first.y + 20 });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('FR-TIP-2: flips below the cursor near the top edge, clear of the cursor image', () => {
    const c = mount({ tooltip: { delay: 0, followCursor: true } });
    c.scroller.dispatchEvent(pointer('pointermove', { clientX: 400, clientY: CHART.y + 5 }));

    hover(c, 'build');

    expect(c.popover()!.getAttribute('data-placement')).toBe('bottom');
    expect(placed(c.popover()!).y).toBe(CHART.y + 5 + 16 + 8);
  });

  it('FR-TIP-1: without a followed cursor the tooltip stays on the bar when the pointer moves', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'build');
    const before = placed(c.popover()!);

    c.scroller.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 420 }));
    c.harness.scheduler.flush();

    expect(placed(c.popover()!)).toEqual(before);
  });
});

describe('popover layer: click and focus triggers', () => {
  it('FR-TIP-1: trigger click opens on a click of the bar and stays when the pointer leaves', () => {
    const c = mount({ tooltip: { trigger: 'click' } });

    clickBar(c, 'design');

    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Design');
    leave(c);
    vi.advanceTimersByTime(1000);
    expect(c.popover()).not.toBeNull();
  });

  it('FR-TIP-1: a click on another bar replaces the tooltip', () => {
    const c = mount({ tooltip: { trigger: 'click' } });
    clickBar(c, 'design');

    clickBar(c, 'build');

    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Build');
  });

  it('FR-TIP-1: a click opens nothing for the hover trigger', () => {
    const c = mount({ tooltip: { trigger: 'hover', delay: 0 } });
    leave(c);

    clickBar(c, 'design');
    leave(c);
    vi.advanceTimersByTime(500);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a click tooltip closes on a pointer down outside it, and not on one inside', () => {
    const c = mount({
      tooltip: {
        trigger: 'click',
        render: () => ({ title: 'T', actions: [{ label: 'A', onSelect: vi.fn() }] }),
      },
    });
    clickBar(c, 'design');

    c.popover()!.querySelector('button')!.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).not.toBeNull();

    document.body.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a pointer down on a bar does not close a click tooltip (the click replaces it)', () => {
    const c = mount({ tooltip: { trigger: 'click' } });
    clickBar(c, 'design');
    const bar = document.createElementNS(SVG_NS, 'g');
    bar.setAttribute('class', 'gantt__bar');
    bar.setAttribute('data-task-id', 'build');
    c.scroller.querySelector('.gantt__body')!.append(bar);

    bar.dispatchEvent(pointer('pointerdown'));

    expect(c.popover()).not.toBeNull();
  });

  it('FR-TIP-1: Escape closes a click tooltip', () => {
    const c = mount({ tooltip: { trigger: 'click' } });
    clickBar(c, 'design');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a click tooltip sits at the click when it follows the cursor', () => {
    const c = mount({ tooltip: { trigger: 'click', followCursor: true } });

    clickBar(c, 'design', { clientX: 420, clientY: 260 });

    const expected = placePopover({
      anchor: { x: 420, y: 260, width: 0, height: 16 },
      size: POPOVER,
      bounds: CHART,
    });
    expect(placed(c.popover()!)).toEqual({ x: expected.x, y: expected.y });
  });

  it('FR-TIP-1: trigger focus is reserved for P1 and opens nothing yet', () => {
    const c = mount({ tooltip: { trigger: 'focus', delay: 0 } });
    const bar = document.createElementNS(SVG_NS, 'g');
    bar.setAttribute('class', 'gantt__bar');
    bar.setAttribute('data-task-id', 'design');
    c.scroller.querySelector('.gantt__body')!.append(bar);

    bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    hover(c, 'design');

    expect(c.popover()).toBeNull();
  });
});

describe('popover layer: dragging', () => {
  it('FR-EDIT-8: shows the previewed dates and working days while a bar is dragged, and follows the drag', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(c.popover()!.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 2, 2026 – Mar 6, 2026',
    );

    // 80 px is two days at 40 px a day: Mar 4 – Mar 8, which has the weekend in it.
    const gesture = drag(c, 'design', 80);

    expect(c.core.getSnapshot().feedback.phase).toBe('dragging');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    const element = c.popover()!;
    expect(element.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 4, 2026 – Mar 8, 2026',
    );
    expect(element.querySelector('.gantt__popover-details')?.textContent).toBe(
      '0% done · 3 working days',
    );

    gesture.release();
  });

  it('FR-EDIT-8: the render function gets isDragging, the gesture and the preview', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render } });

    drag(c, 'design', 80);

    const last = render.mock.calls.at(-1)![0] as {
      isDragging: boolean;
      gesture: string;
      preview: { start: Date; endExclusive: Date; workingDays: number };
      task: { id: string };
    };
    expect(last.isDragging).toBe(true);
    expect(last.gesture).toBe('move');
    expect(last.task.id).toBe('design');
    expect(last.preview.start).toEqual(new Date(2026, 2, 4));
    expect(last.preview.endExclusive).toEqual(new Date(2026, 2, 9));
    // Mar 4 – Mar 8 spans the weekend: the calendar counts the working days.
    expect(last.preview.workingDays).toBe(3);
  });

  it('FR-EDIT-8: opens at once when a drag starts before the delay has passed', () => {
    const c = mount();

    drag(c, 'design', 80);

    expect(c.popover()).not.toBeNull();
  });

  it('FR-EDIT-8: render runs once per previewed change while dragging, not per pointer move', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render, followCursor: true } });
    const bar = c.core.getSnapshot().layout.getBarRect('design')!;
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    c.core.send({ type: 'down', pointerId: 1, x, y, time: 0 });

    // Many moves inside one snap step (a day, 40 px): one preview.
    for (let dx = 10; dx <= 30; dx += 2) {
      c.core.send({ type: 'move', pointerId: 1, x: x + dx, y, time: dx });
      c.render();
    }
    const calls = render.mock.calls.length;
    c.core.send({ type: 'move', pointerId: 1, x: x + 61, y, time: 99 });
    c.render();

    expect(calls).toBeLessThanOrEqual(2);
    expect(render.mock.calls.length).toBe(calls + 1);
  });

  it('FR-EDIT-8: `showWhileDragging: false` hides the tooltip when a drag starts', () => {
    const c = mount({ tooltip: { delay: 0, showWhileDragging: false } });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    drag(c, 'design', 80);

    expect(c.popover()).toBeNull();
  });

  it('FR-EDIT-8: after the drop the tooltip shows the new committed dates while the pointer stays', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const gesture = drag(c, 'design', 80);

    gesture.release();

    expect(c.core.getSnapshot().feedback.phase).toBe('idle');
    expect(c.popover()!.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 4, 2026 – Mar 8, 2026',
    );
  });

  it('FR-LINK-4: no tooltip while a link is being created', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const bar = c.core.getSnapshot().layout.getBarRect('design')!;
    const end = { x: bar.x + bar.width + 10, y: bar.y + bar.height / 2 };
    c.core.send({ type: 'down', pointerId: 1, ...end, time: 0 });
    c.core.send({ type: 'move', pointerId: 1, x: end.x + 60, y: end.y, time: 10 });
    c.render();

    expect(c.core.getSnapshot().feedback.gesture).toBe('link-create');
    expect(c.popover()).toBeNull();
  });
});

describe('popover layer: scrolling and anchors', () => {
  it('FR-TIP-2: a tooltip on a bar follows it when the chart scrolls, from cached rects and the new offsets', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'build');
    const before = placed(c.popover()!);
    const reads = vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;

    c.core.scroll({ left: c.core.getSnapshot().timeline.scrollLeft + 30, top: 0 });
    c.render();
    // The scroller scrolled: its scroll event reaches the document in the capture phase.
    c.scroller.dispatchEvent(new Event('scroll'));
    c.render();

    expect(c.popover()).not.toBeNull();
    expect(placed(c.popover()!).x).toBe(before.x - 30);
    const expected = placePopover({ anchor: barAnchor(c, 'build'), size: POPOVER, bounds: CHART });
    expect(placed(c.popover()!)).toEqual({ x: expected.x, y: expected.y });
    expect(vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
  });

  it('FR-TIP-2: a scroll of anything else (the page) closes the tooltip, whose rects are stale', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');

    document.dispatchEvent(new Event('scroll'));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: layout is read when the tooltip opens or its content changes, never in update', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    const reads = vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;

    for (let i = 0; i < 5; i++) {
      c.core.scroll({ left: i * 7, top: 0 });
      c.render();
    }

    expect(vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
  });
});

describe('popover layer: accessibility of the tooltip', () => {
  it('describes the bar by the tooltip while it is open', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const bar = document.createElementNS(SVG_NS, 'g');
    bar.setAttribute('class', 'gantt__bar');
    bar.setAttribute('data-task-id', 'design');
    c.scroller.querySelector('.gantt__body')!.append(bar);

    hover(c, 'design');
    const popover = c.popover()!;
    expect(popover.id).not.toBe('');
    expect(popover.id.startsWith(c.harness.context.idPrefix)).toBe(true);
    expect(bar.getAttribute('aria-describedby')).toBe(popover.id);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(bar.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('popover layer: link menu', () => {
  const links = [{ source: 'design', target: 'build' }];

  function linkId(core: GanttCore): string {
    const [link] = core.getSnapshot().state.derived.graph.links;
    return link!.id;
  }

  it('FR-TIP-4: a click on a link opens a menu with the remove action, near the click', () => {
    const onRemove = vi.fn();
    const c = mount({ linkMenu: { onRemove } });

    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });

    const menu = c.popover()!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('data-kind')).toBe('link');
    expect(menu.hasAttribute('data-interactive')).toBe(true);
    const items = [...menu.querySelectorAll('button')];
    expect(items.map((item) => item.textContent)).toEqual(['Remove dependency']);
    expect(items[0]!.getAttribute('role')).toBe('menuitem');
    const expected = placePopover({
      anchor: { x: 500, y: 200, width: 0, height: 16 },
      size: POPOVER,
      bounds: CHART,
      side: 'bottom',
    });
    expect(placed(menu)).toEqual({ x: expected.x, y: expected.y });
    expect(menu.querySelector('.gantt__popover-title')?.textContent).toBe('Design → Build');
  });

  it('FR-TIP-4: choosing remove calls onRemove with the link and closes the menu', () => {
    const onRemove = vi.fn();
    const c = mount({ linkMenu: { onRemove } });
    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });

    c.popover()!.querySelector<HTMLButtonElement>('button')!.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0]![0]).toBe(c.core.getLink(linkId(c.core)));
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: without onRemove there is nothing to show (an empty menu is not shown)', () => {
    const c = mount();

    clickLink(c, linkId(c.core));

    expect(c.popover()).toBeNull();
  });

  it('FR-LINK-9: a link that cannot be removed gets no remove action', () => {
    const core = createTestCore({
      tasks: [
        { id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-03' },
        { id: 'b', name: 'B', start: '2026-03-04', end: '2026-03-05' },
      ],
      links: [{ source: 'a', target: 'b', editable: false }],
    });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);

    clickLink(c, linkId(core));

    expect(c.popover()).toBeNull();
  });

  it('FR-EDIT-7: no remove action when editing links is off', () => {
    const core = createTestCore({ links, editing: { links: false } });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);

    clickLink(c, linkId(core));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: render gets the link, its tasks and remove(); actions call back with the context', () => {
    const onRemove = vi.fn();
    const seen: unknown[] = [];
    const c = mount({
      linkMenu: {
        onRemove,
        render: (context) => {
          seen.push(context);
          return {
            actions: [
              { label: 'Details', onSelect: (selected) => seen.push(selected) },
              { label: 'Delete', onSelect: (selected) => selected.remove() },
            ],
          };
        },
      },
    });
    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });
    const context = seen[0] as {
      link: { id: string };
      source: { id: string };
      target: { id: string };
      canRemove: boolean;
    };
    expect(context.link.id).toBe(linkId(c.core));
    expect([context.source.id, context.target.id]).toEqual(['design', 'build']);
    expect(context.canRemove).toBe(true);

    const [details, remove] = [...c.popover()!.querySelectorAll('button')];
    details!.click();
    expect(seen[1]).toBe(context);
    expect(c.popover()).toBeNull();

    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });
    c.popover()!.querySelectorAll('button')[1]!.click();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(remove).toBeDefined();
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: render returning null shows no menu', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn(), render: () => null } });

    clickLink(c, linkId(c.core));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: without a pointer position the menu opens at the chart, inside it', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });

    clickLink(c, linkId(c.core));

    const { x, y } = placed(c.popover()!);
    expect(x).toBeGreaterThanOrEqual(CHART.x);
    expect(x + POPOVER.width).toBeLessThanOrEqual(CHART.x + CHART.width);
    expect(y).toBeGreaterThanOrEqual(CHART.y);
    expect(y + POPOVER.height).toBeLessThanOrEqual(CHART.y + CHART.height);
  });

  it('FR-TIP-4: a press makes the pointer position, so a tap with no earlier move is placed too', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    document.body.dispatchEvent(pointer('pointerdown', { clientX: 300, clientY: 250 }));

    clickLink(c, linkId(c.core));

    const expected = placePopover({
      anchor: { x: 300, y: 250, width: 0, height: 16 },
      size: POPOVER,
      bounds: CHART,
      side: 'bottom',
    });
    expect(placed(c.popover()!)).toEqual({ x: expected.x, y: expected.y });
  });

  it('FR-TIP-4: Escape closes the menu and gives the focus back', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });
    const item = c.popover()!.querySelector('button')!;
    expect(document.activeElement).toBe(item);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(c.popover()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('FR-TIP-4: a pointer down outside closes the menu, one inside does not', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });

    c.popover()!.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).not.toBeNull();

    c.scroller.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: a scroll closes the menu, the chart’s own and the page’s', () => {
    for (const source of ['chart', 'page'] as const) {
      const c = mount({ linkMenu: { onRemove: vi.fn() } });
      clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });
      expect(c.popover(), source).not.toBeNull();

      (source === 'chart' ? c.scroller : document).dispatchEvent(new Event('scroll'));

      expect(c.popover(), source).toBeNull();
      c.layer.destroy();
      c.harness.abort();
      c.core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-4: the menu replaces a tooltip that is open', () => {
    const c = mount({ tooltip: { delay: 0 }, linkMenu: { onRemove: vi.fn() } });
    hover(c, 'design');
    expect(c.popover()!.getAttribute('data-kind')).toBe('task');

    clickLink(c, linkId(c.core), { clientX: 500, clientY: 200 });

    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(c.popover()!.getAttribute('data-kind')).toBe('link');
  });
});

describe('popover layer: locale and strings (FR-I18N-1, FR-I18N-2)', () => {
  const links = [{ source: 'design', target: 'build' }];
  const linkOf = (core: GanttCore): string => core.getSnapshot().state.derived.graph.links[0]!.id;
  const subtitle = (c: Chart): string | undefined =>
    c.popover()?.querySelector('.gantt__popover-subtitle')?.textContent;
  const details = (c: Chart): string | undefined =>
    c.popover()?.querySelector('.gantt__popover-details')?.textContent;
  const title = (c: Chart): string | undefined =>
    c.popover()?.querySelector('.gantt__popover-title')?.textContent;

  it('FR-I18N-1: the contexts carry the chart’s locale, the tooltip’s and the link menu’s', () => {
    const tooltip = vi.fn((context: TaskTooltipContext) => context.locale);
    const menu = vi.fn((context: LinkMenuContext) => context.locale);
    const core = createTestCore({ locale: 'uk', links });
    const c = mount({ tooltip: { delay: 0, render: tooltip }, linkMenu: { render: menu } }, core);

    hover(c, 'design');
    expect(tooltip.mock.calls[0]![0].locale).toBe('uk');
    expect(c.popover()!.textContent).toBe('uk');

    clickLink(c, linkOf(core));
    expect(menu.mock.calls[0]![0].locale).toBe('uk');
    expect(c.popover()!.textContent).toBe('uk');
  });

  it('FR-I18N-1: changing the locale redraws the open tooltip, dates and numbers, in the same place', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(subtitle(c)).toBe('Mar 2, 2026 – Mar 6, 2026');
    const at = placed(c.popover()!);

    c.core.setOptions({ locale: 'uk' });
    c.render();

    expect(subtitle(c)).toMatch(/^2 бер\.? 2026.* – 6 бер\.? 2026/);
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(placed(c.popover()!)).toEqual(at);
  });

  it('FR-I18N-1: a custom render is called again with the new locale', () => {
    const render = vi.fn((context: TaskTooltipContext) => `locale ${context.locale}`);
    const c = mount({ tooltip: { delay: 0, render } });
    hover(c, 'design');
    expect(c.popover()!.textContent).toBe('locale en');

    c.core.setOptions({ locale: 'de' });
    c.render();

    expect(render).toHaveBeenCalledTimes(2);
    expect(c.popover()!.textContent).toBe('locale de');
  });

  it('FR-I18N-1: a locale with another calendar writes its years in the open tooltip', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');

    c.core.setOptions({ locale: 'th-TH-u-ca-buddhist' });
    c.render();

    expect(subtitle(c)).toContain('2569');
    expect(subtitle(c)).not.toContain('2026');
  });

  it('FR-I18N-2: new strings redraw the open tooltip, which stays one popover', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');
    expect(details(c)).toBe('0% done · 5 working days');

    c.strings({
      progress: (percent) => `${percent} % виконано`,
      workingDays: (days) => `${days} р. д.`,
    });

    expect(details(c)).toBe('0 % виконано · 5 р. д.');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    c.strings({ progress: undefined });
    expect(details(c)).toBe('0% done · 5 р. д.');
  });

  it('FR-I18N-2: function strings get the chart’s locale, and the new one after it changes', () => {
    const workingDays = vi.fn((days: number, locale: string) => `${String(days)}@${locale}`);
    const c = mount({ tooltip: { delay: 0 } });
    c.strings({ workingDays });
    hover(c, 'design');
    expect(workingDays).toHaveBeenLastCalledWith(5, 'en');

    c.core.setOptions({ locale: 'uk' });
    c.render();

    expect(workingDays).toHaveBeenLastCalledWith(5, 'uk');
    expect(details(c)).toBe('0% done · 5@uk');
  });

  it('FR-I18N-2: a tooltip opened by a click stays open, and stays, when its strings change', () => {
    const c = mount({ tooltip: { trigger: 'click' } });
    clickBar(c, 'design');
    expect(details(c)).toBe('0% done · 5 working days');

    c.strings({ workingDays: (days) => `${String(days)} d` });

    expect(details(c)).toBe('0% done · 5 d');
    leave(c);
    expect(c.popover()).not.toBeNull();
  });

  it('FR-I18N-2: an unchanged set of strings redraws nothing, a changed one makes the popover again', () => {
    const render = vi.fn((_context: unknown) => 'x');
    const c = mount({ tooltip: { delay: 0, render } });
    hover(c, 'design');
    expect(render).toHaveBeenCalledTimes(1);

    c.strings({});
    c.strings({ chartLabel: 'Gantt chart', progress: 'no function' as never });
    expect(render).toHaveBeenCalledTimes(1);

    // The layer does not know which key moved: any new set of strings makes it again.
    c.strings({ chartLabel: 'Plan' });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('FR-I18N-2: the default link menu takes its title and its action from the strings', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    c.strings({
      removeLink: 'Видалити залежність',
      linkTitle: (source, target) => `${source} ⇒ ${target}`,
    });

    clickLink(c, linkOf(c.core), { clientX: 500, clientY: 200 });

    const menu = c.popover()!;
    expect(title(c)).toBe('Design ⇒ Build');
    expect([...menu.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Видалити залежність',
    ]);
  });

  it('FR-I18N-2: the link title is made from the two names and the locale', () => {
    const linkTitle = vi.fn(
      (source: string, target: string, locale: string) => `${source}>${target}@${locale}`,
    );
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, createTestCore({ locale: 'uk', links }));
    c.strings({ linkTitle });

    clickLink(c, linkOf(c.core));

    expect(linkTitle).toHaveBeenCalledWith('Design', 'Build', 'uk');
    expect(title(c)).toBe('Design>Build@uk');
  });

  it('FR-I18N-2: a link whose tasks have no record is titled by the ids it holds', () => {
    const core: GanttCore = { ...createTestCore({ links }), getTask: () => undefined };
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);

    clickLink(c, linkOf(core));

    expect(title(c)).toBe('design → build');
  });

  it('FR-I18N-2: new strings or a new locale redraw the open link menu in place, the focus kept and given back', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    clickLink(c, linkOf(c.core), { clientX: 500, clientY: 200 });
    const at = placed(c.popover()!);
    expect(document.activeElement).toBe(c.popover()!.querySelector('button'));

    c.strings({ removeLink: 'Видалити' });

    const menu = c.popover()!;
    expect(menu.querySelector('button')!.textContent).toBe('Видалити');
    expect(placed(menu)).toEqual(at);
    expect(document.activeElement).toBe(menu.querySelector('button'));

    // The locale reaches the title function, and the menu is drawn again for it.
    const linkTitle = vi.fn(
      (source: string, target: string, locale: string) => `${source}>${target}@${locale}`,
    );
    c.strings({ linkTitle });
    c.core.setOptions({ locale: 'uk' });
    c.render();
    expect(title(c)).toBe('Design>Build@uk');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);

    // Escape gives the focus back to where it was before the menu first opened.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(c.popover()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('FR-I18N-2: a menu the focus has left does not take it back when it is redrawn', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    clickLink(c, linkOf(c.core), { clientX: 500, clientY: 200 });
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();

    c.strings({ removeLink: 'Видалити' });

    expect(c.popover()!.querySelector('button')!.textContent).toBe('Видалити');
    expect(document.activeElement).toBe(elsewhere);
  });

  it('FR-I18N-1: a locale or strings change opens nothing by itself', () => {
    const c = mount({ tooltip: { delay: 0 } });

    c.core.setOptions({ locale: 'uk' });
    c.render();
    c.strings({ workingDays: () => 'x' });

    expect(c.popover()).toBeNull();
  });

  it('FR-I18N-1: a day label is the application’s own text: a new locale leaves its popover alone', () => {
    const core = createTestCore({
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-05', name: 'Founders Day' }] },
    });
    const c = mount({}, core);
    const snapshot = core.getSnapshot();
    const x = snapshot.timeline.scale.dateToX(ms(2026, 2, 5, 12));
    c.scroller.querySelector('.gantt__body')!.dispatchEvent(
      pointer('pointermove', {
        clientX: CHART.x + x - snapshot.timeline.scrollLeft,
        clientY: 300,
      }),
    );
    vi.advanceTimersByTime(150);
    const label = c.popover();
    expect(label?.textContent).toBe('Founders Day');

    core.setOptions({ locale: 'uk' });
    c.render();
    c.strings({ removeLink: 'x' });

    expect(c.popover()).toBe(label);
  });
});

describe('popover layer: highlighted and holiday days', () => {
  const day = toDayKey(ms(2026, 2, 4));

  /** A highlighted day as the grid layer draws it, inside the body. */
  function addHighlight(target: Chart, id: string, key: number): SVGRectElement {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'gantt__highlight');
    rect.setAttribute('data-highlight', id);
    rect.setAttribute('data-day', String(key));
    target.scroller.querySelector('.gantt__body')!.append(rect);
    return rect;
  }

  it('FR-TIP-5, FR-UI-3: hovering a highlighted day shows its label', () => {
    const c = mount({ highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] });
    const rect = addHighlight(c, 'launch', day);

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    expect(c.popover()).toBeNull();
    vi.advanceTimersByTime(150);

    const popover = c.popover()!;
    expect(popover.textContent).toBe('Launch');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.getAttribute('data-kind')).toBe('day');
    const expected = placePopover({
      anchor: { x: 300, y: 200, width: 0, height: 16 },
      size: POPOVER,
      bounds: CHART,
    });
    expect(placed(popover)).toEqual({ x: expected.x, y: expected.y });
  });

  it('FR-UI-3: a label function is told about the day', () => {
    const label = vi.fn((d: CalendarDay) => `Day ${String(d.day)}/${String(d.month)}`);
    const c = mount({
      highlightDays: [{ id: 'range', range: { start: '2026-03-02', end: '2026-03-06' }, label }],
    });
    const rect = addHighlight(c, 'range', day);

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(150);

    expect(c.popover()!.textContent).toBe('Day 4/3');
    expect(label.mock.calls[0]![0]).toMatchObject({
      dayKey: day,
      year: 2026,
      month: 3,
      day: 4,
      weekday: 3,
    });
  });

  it('FR-TIP-5: a highlight without a label shows nothing', () => {
    const c = mount({ highlightDays: [{ id: 'plain', dates: ['2026-03-04'] }] });
    const rect = addHighlight(c, 'plain', day);

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(1000);

    expect(c.popover()).toBeNull();
  });

  it('FR-CAL-2, FR-TIP-5: hovering a holiday shows its name from the calendar', () => {
    const core = createTestCore({
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-05', name: 'Founders Day' }] },
    });
    const c = mount({}, core);
    const body = c.scroller.querySelector('.gantt__body')!;
    const snapshot = core.getSnapshot();
    const x = snapshot.timeline.scale.dateToX(ms(2026, 2, 5, 12));

    body.dispatchEvent(
      pointer('pointermove', { clientX: CHART.x + x - snapshot.timeline.scrollLeft, clientY: 300 }),
    );
    vi.advanceTimersByTime(150);

    expect(c.popover()!.textContent).toBe('Founders Day');
  });

  it('FR-TIP-5: a holiday that is a highlighted day shows both names', () => {
    const core = createTestCore({
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Founders Day' }] },
    });
    const c = mount(
      { highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] },
      core,
    );
    const rect = addHighlight(c, 'launch', day);

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(150);

    expect(c.popover()!.textContent).toBe('Launch · Founders Day');
  });

  it('FR-TIP-5: an ordinary day, a weekend without a name and the header show nothing', () => {
    const c = mount();
    const body = c.scroller.querySelector('.gantt__body')!;
    const snapshot = c.core.getSnapshot();
    const x = (at: DateTimeMs): number =>
      CHART.x + snapshot.timeline.scale.dateToX(at) - snapshot.timeline.scrollLeft;

    body.dispatchEvent(pointer('pointermove', { clientX: x(ms(2026, 2, 4, 12)), clientY: 300 }));
    body.dispatchEvent(pointer('pointermove', { clientX: x(ms(2026, 2, 7, 12)), clientY: 300 }));
    c.scroller
      .querySelector('.gantt__header')!
      .dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 60 }));
    vi.advanceTimersByTime(1000);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-5: the label goes away when the pointer leaves the day, and when it leaves the chart', () => {
    const c = mount({ highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] });
    const rect = addHighlight(c, 'launch', day);
    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(150);
    expect(c.popover()).not.toBeNull();

    c.scroller
      .querySelector('.gantt__body')!
      .dispatchEvent(pointer('pointermove', { clientX: 301, clientY: 200 }));
    vi.advanceTimersByTime(300);
    expect(c.popover()).toBeNull();

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(150);
    expect(c.popover()).not.toBeNull();
    c.scroller.dispatchEvent(pointer('pointerleave'));
    vi.advanceTimersByTime(300);
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-5: highlightTooltip.followCursor makes the label follow the pointer; otherwise it stays', () => {
    const base = { highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] };
    for (const followCursor of [false, true]) {
      const c = mount({ ...base, highlightTooltip: { followCursor }, tooltip: { delay: 0 } });
      const rect = addHighlight(c, 'launch', day);
      rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
      const first = placed(c.popover()!);

      rect.dispatchEvent(pointer('pointermove', { clientX: 330, clientY: 210 }));
      c.harness.scheduler.flush();

      expect(placed(c.popover()!), String(followCursor)).toEqual(
        followCursor ? { x: first.x + 30, y: first.y + 10 } : first,
      );
      c.layer.destroy();
      c.harness.abort();
      c.core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-5: no label over a bar, which has the task tooltip, though the same place off the bar has one', () => {
    // A named holiday under the bar's shape: the day the pointer is over has a name to show.
    const core = createTestCore({
      calendar: { weekends: [0, 6], holidays: [{ date: '2026-03-04', name: 'Founders Day' }] },
    });
    const c = mount({}, core);
    const bar = document.createElementNS(SVG_NS, 'g');
    bar.setAttribute('class', 'gantt__bar');
    const track = document.createElementNS(SVG_NS, 'rect');
    bar.append(track);
    const body = c.scroller.querySelector('.gantt__body')!;
    body.append(bar);
    const snapshot = core.getSnapshot();
    const x =
      CHART.x + snapshot.timeline.scale.dateToX(ms(2026, 2, 4, 12)) - snapshot.timeline.scrollLeft;

    track.dispatchEvent(pointer('pointermove', { clientX: x, clientY: 200 }));
    vi.advanceTimersByTime(1000);
    expect(c.popover()).toBeNull();

    body.dispatchEvent(pointer('pointermove', { clientX: x, clientY: 201 }));
    vi.advanceTimersByTime(150);
    expect(c.popover()!.textContent).toBe('Founders Day');
  });

  it('FR-TIP-5: no label during a gesture, only the tooltip of the dragged task', () => {
    const c = mount({ highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] });
    const rect = addHighlight(c, 'launch', day);
    const gesture = drag(c, 'design', 80);

    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(1000);

    expect(c.popover()!.getAttribute('data-kind')).toBe('task');
    gesture.release();
  });

  it('FR-TIP-5: a scroll closes a label (the content moves under a still pointer)', () => {
    const c = mount({ highlightDays: [{ id: 'launch', dates: ['2026-03-04'], label: 'Launch' }] });
    const rect = addHighlight(c, 'launch', day);
    rect.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 200 }));
    vi.advanceTimersByTime(150);

    c.scroller.dispatchEvent(new Event('scroll'));

    expect(c.popover()).toBeNull();
  });
});

describe('popover layer: an open popover follows the data and the options (FR-TIP-1, FR-TIP-4)', () => {
  const links = [{ source: 'design', target: 'build' }];
  const linkOf = (core: GanttCore): string => core.getSnapshot().state.derived.graph.links[0]!.id;
  const title = (c: Chart): string | undefined =>
    c.popover()?.querySelector('.gantt__popover-title')?.textContent;
  const TWO_TASKS = [
    { id: 'design', name: 'Design', start: '2026-03-02', end: '2026-03-06' },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  ];
  const AT = { clientX: 500, clientY: 200 };

  it('FR-TIP-1: a click tooltip is made again from a new record, and its actions get the new context', () => {
    const onSelect = vi.fn();
    const c = mount({
      tooltip: {
        trigger: 'click',
        render: (context) => ({ title: context.task.name, actions: [{ label: 'Go', onSelect }] }),
      },
    });
    clickBar(c, 'design');
    expect(title(c)).toBe('Design');

    c.core.setTasks([{ ...TWO_TASKS[0]!, name: 'Design v2' }, TWO_TASKS[1]!]);
    c.render();

    expect(title(c)).toBe('Design v2');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    c.popover()!.querySelector('button')!.click();
    expect((onSelect.mock.calls[0]![0] as TaskTooltipContext).task.name).toBe('Design v2');
  });

  it('FR-TIP-1: a click tooltip closes when its task is gone', () => {
    const c = mount({ tooltip: { trigger: 'click' } });
    clickBar(c, 'design');
    expect(c.popover()).not.toBeNull();

    c.core.setTasks([TWO_TASKS[1]!]);
    c.render();

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-6: a click tooltip is made again when the links around its task change', () => {
    const c = mount(
      {
        tooltip: {
          trigger: 'click',
          render: (context) => `${String(context.predecessors.length)} in`,
        },
      },
      createTestCore(),
    );
    clickBar(c, 'build');
    expect(c.popover()!.textContent).toBe('0 in');

    c.core.setLinks(links);
    c.render();

    expect(c.popover()!.textContent).toBe('1 in');
  });

  it('FR-TIP-1: a click tooltip follows the options: new content redraws it, a trigger that is no longer click closes it', () => {
    const c = mount({ tooltip: { trigger: 'click', render: () => 'one' } });
    clickBar(c, 'design');

    c.display({ tooltip: { trigger: 'click', render: () => 'two' } });
    expect(c.popover()!.textContent).toBe('two');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);

    c.display({ tooltip: { trigger: 'none' } });
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: an open link menu is made again when its link changes, and closes when the link is gone', () => {
    const core = createTestCore({ links });
    const c = mount(
      {
        linkMenu: {
          onRemove: vi.fn(),
          render: (context) => `editable: ${String(context.link.editable)}`,
        },
      },
      core,
    );
    clickLink(c, linkOf(core), AT);
    expect(c.popover()!.textContent).toBe('editable: true');

    core.setLinks([{ source: 'design', target: 'build', editable: false }]);
    c.render();
    expect(c.popover()!.textContent).toBe('editable: false');

    core.setLinks([]);
    c.render();
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: a link menu follows the options: a new render redraws it, none for the link closes it', () => {
    const core = createTestCore({ links });
    const onRemove = vi.fn();
    const c = mount({ linkMenu: { onRemove, render: () => 'one' } }, core);
    clickLink(c, linkOf(core), AT);

    c.display({ linkMenu: { onRemove, render: () => 'two' } });
    expect(c.popover()!.textContent).toBe('two');

    // No `onRemove` left and the default content: nothing to offer, so nothing is shown.
    c.display({ linkMenu: {} });
    expect(c.popover()).toBeNull();
  });

  it('FR-EDIT-7: a link menu closes when editing links is turned off', () => {
    for (const render of [undefined, () => 'info'] as const) {
      const core = createTestCore({ links });
      const c = mount({ linkMenu: { onRemove: vi.fn(), ...(render && { render }) } }, core);
      clickLink(c, linkOf(core), AT);
      expect(c.popover()).not.toBeNull();

      core.setOptions({ editing: { links: false } });
      c.render();

      expect(c.popover()).toBeNull();
      c.layer.destroy();
      c.harness.abort();
      core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-4: a context kept by the application asks again when remove() is called', () => {
    const first = vi.fn();
    const second = vi.fn();
    const core = createTestCore({ links });
    const saved: LinkMenuContext[] = [];
    const render = (context: LinkMenuContext): string => {
      saved.push(context);
      return 'menu';
    };
    const c = mount({ linkMenu: { onRemove: first, render } }, core);
    clickLink(c, linkOf(core), AT);
    const context = saved[0]!;
    expect(context.canRemove).toBe(true);

    // The handler is the current option's, not the one the menu opened with.
    c.harness.setDisplay({ linkMenu: { onRemove: second, render } });
    context.remove();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toBe(core.getLink(linkOf(core)));

    // Editing links went off, and the link went away: there is nothing left to remove.
    clickLink(c, linkOf(core), AT);
    core.setOptions({ editing: { links: false } });
    c.render();
    expect(saved.at(-1)!.canRemove).toBe(false);
    saved.at(-1)!.remove();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('FR-TIP-4: choosing the default remove action uses the onRemove that is set now', () => {
    const first = vi.fn();
    const second = vi.fn();
    const core = createTestCore({ links });
    const c = mount({ linkMenu: { onRemove: first } }, core);
    clickLink(c, linkOf(core), AT);
    const button = c.popover()!.querySelector('button')!;

    // The option changes and the layer has not updated yet: the click still reads what is set.
    c.harness.setDisplay({ linkMenu: { onRemove: second } });
    button.click();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('popover layer: hover, scroll and sticky popovers (FR-TIP-1, FR-TIP-4, FR-EDIT-8)', () => {
  const links = [{ source: 'design', target: 'build' }];
  const linkOf = (core: GanttCore): string => core.getSnapshot().state.derived.graph.links[0]!.id;
  const AT = { clientX: 500, clientY: 200 };

  it('FR-TIP-1: a scroll of the page or of another element does not cancel a pending hover tooltip', () => {
    const c = mount();
    hover(c, 'design');
    vi.advanceTimersByTime(60);

    document.dispatchEvent(new Event('scroll'));
    const other = document.createElement('div');
    document.body.append(other);
    other.dispatchEvent(new Event('scroll'));
    c.scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(90);

    expect(c.popover()).not.toBeNull();
    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Design');
  });

  it('FR-TIP-2: a scroll of the page closes a tooltip that is open, as before', () => {
    const c = mount({ tooltip: { delay: 0 } });
    hover(c, 'design');

    document.dispatchEvent(new Event('scroll'));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-2: with an automatic height the pin of the header scrolls with the chart, and the tooltip stays', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const chartRoot = c.root.parentElement!;
    chartRoot.setAttribute('data-height', 'auto');
    const pin = document.createElement('div');
    pin.className = 'gantt__pin';
    chartRoot.insertBefore(pin, c.scroller);
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    c.scroller.dispatchEvent(new Event('scroll'));
    pin.dispatchEvent(new Event('scroll'));

    expect(c.popover()).not.toBeNull();
  });

  it('FR-EDIT-8: a preview that a scroll of the page closed comes back with the next update, while the drag lasts', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const gesture = drag(c, 'design', 80);
    expect(c.popover()).not.toBeNull();

    document.dispatchEvent(new Event('scroll'));
    expect(c.popover()).toBeNull();
    c.render();

    expect(c.popover()).not.toBeNull();
    expect(c.popover()!.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 4, 2026 – Mar 8, 2026',
    );
    gesture.release();
  });

  it('FR-EDIT-8: a preview that was hidden on purpose stays hidden for the drag', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const gesture = drag(c, 'design', 80);

    c.layer.hide();
    c.render();

    expect(c.popover()).toBeNull();
    gesture.release();
  });

  it('FR-TIP-4: a hover tooltip does not open over a link menu: the menu stays and keeps the focus', () => {
    const core = createTestCore({ links });
    const c = mount({ tooltip: { delay: 0 }, linkMenu: { onRemove: vi.fn() } }, core);
    clickLink(c, linkOf(core), AT);
    const menu = c.popover()!;
    const item = menu.querySelector('button')!;
    expect(document.activeElement).toBe(item);

    hover(c, 'design');
    hover(c, 'build');
    vi.advanceTimersByTime(500);

    expect(c.popover()).toBe(menu);
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(document.activeElement).toBe(item);
  });

  it('FR-TIP-4: a hover that is pending when the menu opens does not replace it either', () => {
    const core = createTestCore({ links });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);
    hover(c, 'design');
    expect(c.popover()).toBeNull();

    clickLink(c, linkOf(core), AT);
    const menu = c.popover()!;
    vi.advanceTimersByTime(500);

    expect(c.popover()).toBe(menu);
  });

  it('FR-TIP-1: a tooltip with actions is not replaced by hovering another bar, until it is closed', () => {
    const c = mount({
      tooltip: {
        delay: 0,
        render: (context) => ({
          title: context.task.name,
          actions: [{ label: 'Go', onSelect: vi.fn() }],
        }),
      },
    });
    hover(c, 'design');
    const popover = c.popover()!;

    hover(c, 'build');
    vi.advanceTimersByTime(500);
    expect(c.popover()).toBe(popover);
    expect(popover.querySelector('.gantt__popover-title')?.textContent).toBe('Design');

    // A press outside closes it, and the hover over a bar is asked for again.
    document.body.dispatchEvent(pointer('pointerdown'));
    expect(c.popover()).toBeNull();
    hover(c, 'build');
    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Build');
  });

  it('FR-EDIT-8: dragging a bar still shows its preview over a tooltip with actions', () => {
    const c = mount({
      tooltip: {
        delay: 0,
        render: (context) => ({
          title: context.isDragging ? 'dragging' : context.task.name,
          actions: [{ label: 'Go', onSelect: vi.fn() }],
        }),
      },
    });
    hover(c, 'design');
    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('Design');

    drag(c, 'build', 80);

    expect(c.popover()!.querySelector('.gantt__popover-title')?.textContent).toBe('dragging');
  });
});

describe('popover layer: inside a shadow root (FR-TIP-1, FR-TIP-4)', () => {
  const links = [{ source: 'design', target: 'build' }];
  const linkOf = (core: GanttCore): string => core.getSnapshot().state.derived.graph.links[0]!.id;
  const AT = { clientX: 500, clientY: 200 };
  /**
   * A press as the browser sends it to the document: the target is retargeted to the shadow
   * host (happy-dom does not), and only the composed path still names the element pressed.
   */
  const press = (target: Element): void => {
    const host = (target.getRootNode() as ShadowRoot).host;
    const event = pointer('pointerdown', { composed: true });
    Object.defineProperty(event, 'target', { get: () => host });
    target.dispatchEvent(event);
  };

  it('FR-TIP-4: a press on an action of the menu is no press outside it', () => {
    const core = createTestCore({ links });
    const onRemove = vi.fn();
    const c = mount({ linkMenu: { onRemove } }, core, { shadow: true });
    clickLink(c, linkOf(core), AT);
    const menu = c.popover()!;
    const button = menu.querySelector('button')!;

    press(button);
    expect(c.popover()).toBe(menu);
    button.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('FR-TIP-4: a press on the chart outside the menu still closes it', () => {
    const core = createTestCore({ links });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core, { shadow: true });
    clickLink(c, linkOf(core), AT);

    press(c.scroller);

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-1: a press on a bar does not close a click tooltip (the click replaces it)', () => {
    const c = mount({ tooltip: { trigger: 'click' } }, undefined, { shadow: true });
    clickBar(c, 'design');
    const bar = document.createElementNS(SVG_NS, 'g');
    bar.setAttribute('class', 'gantt__bar');
    bar.setAttribute('data-task-id', 'build');
    c.scroller.querySelector('.gantt__body')!.append(bar);

    press(bar);

    expect(c.popover()).not.toBeNull();
  });

  it('FR-TIP-4: the scroll of the chart is heard inside the shadow root too', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, undefined, { shadow: true });
    clickLink(c, linkOf(c.core), AT);
    expect(c.popover()).not.toBeNull();

    // A scroll event does not leave a shadow root.
    c.scroller.dispatchEvent(new Event('scroll'));

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-2: the tooltip follows the bar when the chart scrolls', () => {
    const c = mount({ tooltip: { delay: 0 } }, undefined, { shadow: true });
    hover(c, 'build');

    c.scroller.dispatchEvent(new Event('scroll'));

    expect(c.popover()).not.toBeNull();
  });
});

describe('popover layer: accessibility (FR-TIP-1, FR-TIP-4)', () => {
  const links = [{ source: 'design', target: 'build' }];
  const linkOf = (core: GanttCore): string => core.getSnapshot().state.derived.graph.links[0]!.id;
  const AT = { clientX: 500, clientY: 200 };
  const barNode = (target: Chart, id: string): SVGGElement => {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('class', 'gantt__bar');
    node.setAttribute('data-task-id', id);
    target.scroller.querySelector('.gantt__body')!.append(node);
    return node;
  };

  it('FR-TIP-1: aria-describedby follows the task when the bar node is reused for another one', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const first = barNode(c, 'design');
    hover(c, 'design');
    const { id } = c.popover()!;
    expect(first.getAttribute('aria-describedby')).toBe(id);

    // The pool gives the node to another task, and another node draws `design`.
    first.setAttribute('data-task-id', 'build');
    const second = barNode(c, 'design');
    c.render();

    expect(first.hasAttribute('aria-describedby')).toBe(false);
    expect(second.getAttribute('aria-describedby')).toBe(id);
  });

  it('FR-TIP-1: aria-describedby is removed when no bar shows the task any more', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const only = barNode(c, 'design');
    hover(c, 'design');
    expect(only.hasAttribute('aria-describedby')).toBe(true);

    only.remove();
    c.render();

    expect(only.hasAttribute('aria-describedby')).toBe(false);
    expect(c.popover()).not.toBeNull();
  });

  it('FR-TIP-4: after an action the focus goes back to where it was before the menu opened, and then onSelect runs', () => {
    const core = createTestCore({ links });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    clickLink(c, linkOf(core), AT);
    const item = c.popover()!.querySelector('button')!;
    expect(document.activeElement).toBe(item);

    item.click();

    expect(c.popover()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('FR-TIP-4: the focus goes back also when the press on the button took it away (Safari does not focus what it presses)', () => {
    const core = createTestCore({ links });
    const c = mount({ linkMenu: { onRemove: vi.fn() } }, core);
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    clickLink(c, linkOf(core), AT);
    const item = c.popover()!.querySelector('button')!;
    expect(document.activeElement).toBe(item);

    item.dispatchEvent(pointer('pointerdown'));
    // The press moved the focus off the button, to the page, before the click came.
    item.blur();
    expect(document.activeElement).not.toBe(item);
    item.click();

    expect(c.popover()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('FR-TIP-1: the focus is back where it was by the time onSelect runs, for a tooltip with actions too', () => {
    let focused: Element | null = null;
    const c = mount({
      tooltip: {
        delay: 0,
        render: () => ({
          title: 'T',
          actions: [
            {
              label: 'Go',
              onSelect: () => {
                focused = document.activeElement;
              },
            },
          ],
        }),
      },
    });
    const before = document.createElement('input');
    document.body.append(before);
    before.focus();
    hover(c, 'design');
    const button = c.popover()!.querySelector('button')!;
    button.focus();

    button.click();

    expect(focused).toBe(before);
    expect(document.activeElement).toBe(before);
  });

  it('FR-TIP-1: an action does not take the focus when the popover did not hold it', () => {
    const c = mount({
      tooltip: {
        delay: 0,
        render: () => ({ title: 'T', actions: [{ label: 'Go', onSelect: vi.fn() }] }),
      },
    });
    const origin = document.createElement('input');
    const elsewhere = document.createElement('input');
    document.body.append(origin, elsewhere);
    origin.focus();
    hover(c, 'design');
    elsewhere.focus();

    c.popover()!.querySelector('button')!.click();

    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('popover layer: content, errors and layout reads (FR-TIP-1, FR-TIP-3, FR-TIP-5, FR-EDIT-8)', () => {
  it('FR-TIP-3: whitespace-only structured content or markup shows nothing', () => {
    for (const content of [
      { title: '   ' },
      { title: ' ', subtitle: '\n', details: '\t' },
      { html: '<div> </div>' },
      { html: '<p>\n</p><span> </span>' },
    ]) {
      const c = mount({ tooltip: { delay: 0, render: () => content } });

      hover(c, 'design');

      expect(c.popover(), JSON.stringify(content)).toBeNull();
      c.layer.destroy();
      c.harness.abort();
      c.core.destroy();
      chart = undefined;
    }
  });

  it('FR-TIP-1: a throwing render closes the popover that was open, rethrows, and is not asked again', () => {
    const render = vi.fn((context: TaskTooltipContext) => {
      if (context.task.id === 'build') throw new Error('render failed');
      return context.task.name;
    });
    const c = mount({ tooltip: { delay: 0, render } });
    hover(c, 'design');
    expect(c.popover()!.textContent).toBe('Design');

    expect(() => {
      hover(c, 'build');
    }).toThrow('render failed');

    expect(c.popover()).toBeNull();
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(0);
    const calls = render.mock.calls.length;
    c.render();
    c.render();
    expect(render.mock.calls.length).toBe(calls);
    // The state is clean: the next hover works.
    hover(c, 'design');
    expect(c.popover()!.textContent).toBe('Design');
  });

  it('FR-TIP-1: a render that throws in the delay timer leaves nothing open, and the error is not swallowed', () => {
    const c = mount({
      tooltip: {
        render: () => {
          throw new Error('late failure');
        },
      },
    });
    hover(c, 'design');

    expect(() => vi.advanceTimersByTime(150)).toThrow('late failure');

    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-4: a throwing link menu render leaves no menu behind and reaches onError', () => {
    const links = [{ source: 'design', target: 'build' }];
    const core = createTestCore({ links });
    // The menu opens from the core's `linkClick` event: since ADR-025 the core's input methods do
    // not throw after a change, a listener's error goes to the `error` event instead.
    const errors: unknown[] = [];
    core.on('error', (payload) => errors.push(payload.error));
    const c = mount(
      {
        linkMenu: {
          onRemove: vi.fn(),
          render: () => {
            throw new Error('menu failed');
          },
        },
      },
      core,
    );

    clickLink(c, core.getSnapshot().state.derived.graph.links[0]!.id, { clientX: 5, clientY: 5 });

    expect(errors).toEqual([new Error('menu failed')]);
    expect(c.popover()).toBeNull();
  });

  it('FR-TIP-5: the scroller is measured once for many moves over days, and again after a scroll, a press or an entry', () => {
    const c = mount();
    const body = c.scroller.querySelector('.gantt__body')!;
    const scrollerReads = (): number =>
      vi
        .mocked(Element.prototype.getBoundingClientRect)
        .mock.contexts.filter((element) => element === c.scroller).length;
    const move = (x: number): void => {
      body.dispatchEvent(pointer('pointermove', { clientX: x, clientY: 300 }));
    };

    for (let x = 200; x < 260; x += 3) move(x);
    expect(scrollerReads()).toBe(1);

    document.dispatchEvent(new Event('scroll'));
    move(300);
    move(301);
    expect(scrollerReads()).toBe(2);

    document.body.dispatchEvent(pointer('pointerdown'));
    move(310);
    expect(scrollerReads()).toBe(3);

    c.scroller.dispatchEvent(new Event('pointerenter'));
    move(320);
    expect(scrollerReads()).toBe(4);
  });

  it('FR-EDIT-8: while a bar is dragged the popover is updated in place, with one layout read a frame', () => {
    const c = mount({ tooltip: { delay: 0 } });
    const gesture = drag(c, 'design', 40);
    const element = c.popover()!;
    const reads = (): number =>
      vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;
    const bar = c.core.getSnapshot().layout.getBarRect('design')!;
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;
    const before = reads();

    for (const dx of [80, 120, 160]) {
      c.core.send({ type: 'move', pointerId: 1, x: x + dx, y, time: 30 + dx });
      c.render();
    }

    expect(c.popover()).toBe(element);
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
    expect(reads() - before).toBeLessThanOrEqual(3);
    // Four days on, past the weekend: the content is the preview of the last frame.
    expect(element.querySelector('.gantt__popover-subtitle')?.textContent).toBe(
      'Mar 9, 2026 – Mar 13, 2026',
    );
    gesture.release();
  });
});

describe('popover layer: anchors by height mode (FR-SCROLL-3, FR-TIP-2)', () => {
  const manyTasks = Array.from({ length: 30 }, (_, i) => ({
    id: `t${String(i)}`,
    name: `T${String(i)}`,
    start: '2026-03-02',
    end: '2026-03-06',
  }));

  /** The popover's page position the layer should give a bar of the scrolled chart. */
  function placedFor(auto: boolean): { actual: { x: number; y: number }; expected: Rect } {
    const core = createTestCore({ tasks: manyTasks });
    chartBox = { ...CHART, height: 700 };
    const c = mount({ tooltip: { delay: 0 } }, core);
    if (auto) c.root.parentElement!.setAttribute('data-height', 'auto');
    core.scroll({ left: 0, top: 120 });
    c.render();
    const snapshot = core.getSnapshot();
    expect(snapshot.scrollTop).toBe(120);

    hover(c, 't4');

    const bar = snapshot.layout.getBarRect('t4')!;
    // Fixed: the scroller's own offset moves the rows under its box. Auto: the scroller's box
    // already moved with the page, and the core's offset is that same page offset.
    const y =
      chartBox.y + snapshot.layout.rows.headerHeight + bar.y - (auto ? 0 : snapshot.scrollTop);
    const anchor = { x: chartBox.x + bar.x, y, width: bar.width, height: bar.height };
    const { x: px, y: py } = placePopover({ anchor, size: POPOVER, bounds: chartBox });
    return { actual: placed(c.popover()!), expected: { x: px, y: py, width: 0, height: 0 } };
  }

  it('FR-SCROLL-3, FR-TIP-2: with an automatic height the bar anchor takes no scroll offset', () => {
    const { actual, expected } = placedFor(true);

    expect(actual).toEqual({ x: expected.x, y: expected.y });
  });

  it('FR-TIP-2: with a fixed height the scroll offset of the chart is subtracted', () => {
    const { actual, expected } = placedFor(false);

    expect(actual).toEqual({ x: expected.x, y: expected.y });
  });
});

describe('popover layer: content with a lifetime (DisposableNode, FR-TIP-1, FR-TIP-4)', () => {
  const AT = { clientX: 500, clientY: 200 };

  /**
   * A render function whose nodes are told when the popover is done with them, in order, in
   * `log`. `share` makes it return one node for the same key, as a framework's portal host does.
   */
  function hosting<TContext>(
    keyOf: (context: TContext) => string,
    options: { readonly share?: boolean; readonly text?: string } = {},
  ) {
    const log: string[] = [];
    const live = new Set<string>();
    const nodes = new Map<string, { node: HTMLElement; uses: number }>();
    let made = 0;
    const render = (context: TContext) => {
      const key = keyOf(context);
      const label = `${key}#${String(++made)}`;
      let shared = options.share ? nodes.get(key) : undefined;
      if (shared === undefined) {
        const node = document.createElement('div');
        node.dataset.host = key;
        node.append(options.text ?? key);
        shared = { node, uses: 0 };
        if (options.share) nodes.set(key, shared);
      }
      const held = shared;
      held.uses++;
      log.push(`make ${label}`);
      live.add(label);
      return {
        node: held.node,
        dispose: () => {
          expect(live.delete(label), `${label} disposed twice`).toBe(true);
          held.uses--;
          log.push(`dispose ${label}`);
        },
      };
    };
    return { render, log, live, nodes };
  }

  const taskKey = (context: TaskTooltipContext): string => String(context.task.id);
  const linkKey = (context: LinkMenuContext): string => context.link.id;

  it('shows the node as it is and disposes it, once, when the tooltip closes', () => {
    const { render, log, live } = hosting(taskKey);
    const c = mount({ tooltip: { delay: 0, render } });

    hover(c, 'design');

    const popover = c.popover()!;
    expect(popover.firstElementChild?.getAttribute('data-host')).toBe('design');
    expect(log).toEqual(['make design#1']);

    leave(c);

    expect(c.popover()).toBeNull();
    expect(log).toEqual(['make design#1', 'dispose design#1']);
    expect(live.size).toBe(0);
    c.render();
    c.layer.hide();
    expect(log).toHaveLength(2);
  });

  it('makes the content of another task first, then disposes the old one', () => {
    const { render, log, live } = hosting(taskKey);
    const c = mount({ tooltip: { delay: 0, render } });
    hover(c, 'design');

    hover(c, 'build');

    expect(log).toEqual(['make design#1', 'make build#2', 'dispose design#1']);
    expect([...live]).toEqual(['build#2']);
    expect(c.popover()!.firstElementChild?.getAttribute('data-host')).toBe('build');
    expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(1);
  });

  it('is made again in place from new inputs: the new content first, so that it may share the node', () => {
    const { render, log, nodes } = hosting(taskKey, { share: true });
    const c = mount({ tooltip: { trigger: 'click', render } });
    clickBar(c, 'design');
    const popover = c.popover()!;
    const node = popover.firstElementChild;

    c.core.setTasks([
      { id: 'design', name: 'Design v2', start: '2026-03-02', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ]);
    c.render();

    expect(log).toEqual(['make design#1', 'make design#2', 'dispose design#1']);
    expect(c.popover()).toBe(popover);
    // The node both contents shared is the one in the popover, and is still there.
    expect(popover.children).toHaveLength(1);
    expect(popover.firstElementChild).toBe(node);
    expect(nodes.get('design')?.uses).toBe(1);
  });

  it('is disposed when the render function is replaced, when it is removed, and on destroy', () => {
    const first = hosting(taskKey);
    const c = mount({ tooltip: { trigger: 'click', render: first.render } });
    clickBar(c, 'design');

    const second = hosting(taskKey);
    c.display({ tooltip: { trigger: 'click', render: second.render } });
    expect(first.log).toEqual(['make design#1', 'dispose design#1']);
    expect(second.log).toEqual(['make design#1']);

    c.display({ tooltip: { trigger: 'click', render: () => 'plain text' } });
    expect(second.log).toEqual(['make design#1', 'dispose design#1']);
    expect(c.popover()!.textContent).toBe('plain text');

    c.display({ tooltip: { trigger: 'click', render: second.render } });
    expect(second.live.size).toBe(1);
    c.layer.destroy();
    expect(second.live.size).toBe(0);
    expect(c.root.childNodes).toHaveLength(0);
  });

  it('is disposed by Escape, by api.hide(), and by a press outside a click tooltip', () => {
    let context: TaskTooltipContext | undefined;
    const { render, live } = hosting<TaskTooltipContext>((given) => {
      context = given;
      return 'x';
    });
    const c = mount({ tooltip: { trigger: 'click', render } });

    clickBar(c, 'design');
    expect(live.size).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(live.size).toBe(0);

    clickBar(c, 'build');
    expect(live.size).toBe(1);
    context!.api.hide();
    expect(live.size).toBe(0);

    clickBar(c, 'design');
    expect(live.size).toBe(1);
    document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
    expect(c.popover()).toBeNull();
    expect(live.size).toBe(0);
  });

  it('FR-TIP-3: content that has a lifetime and shows nothing (whitespace) hides the tooltip and is disposed at once', () => {
    const log: string[] = [];
    const c = mount({
      tooltip: {
        delay: 0,
        render: () => ({
          node: document.createTextNode('  '),
          dispose: () => log.push('dispose'),
        }),
      },
    });

    hover(c, 'design');

    expect(c.popover()).toBeNull();
    expect(log).toEqual(['dispose']);
  });

  it('FR-TIP-3: a tooltip that is made again as empty closes and disposes both contents', () => {
    let empty = false;
    const log: string[] = [];
    const c = mount({
      tooltip: {
        trigger: 'click',
        render: () => {
          const node = empty ? document.createTextNode(' ') : document.createElement('div');
          if (!empty) node.textContent = 'full';
          const label = empty ? 'new' : 'old';
          return { node, dispose: () => log.push(`dispose ${label}`) };
        },
      },
    });
    clickBar(c, 'design');
    expect(c.popover()).not.toBeNull();

    empty = true;
    c.core.setTasks([
      { id: 'design', name: 'Design v2', start: '2026-03-02', end: '2026-03-06' },
      { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
    ]);
    c.render();

    expect(c.popover()).toBeNull();
    expect(log.sort()).toEqual(['dispose new', 'dispose old']);
  });

  it('a render that throws closes the popover and disposes its content before the error goes on', () => {
    let fail = false;
    const log: string[] = [];
    const c = mount({
      tooltip: {
        delay: 0,
        render: (context) => {
          if (fail && context.task.id === 'build') throw new Error('render failed');
          const node = document.createElement('div');
          node.append(String(context.task.id));
          return { node, dispose: () => log.push(`dispose ${String(context.task.id)}`) };
        },
      },
    });
    hover(c, 'design');
    fail = true;

    expect(() => {
      hover(c, 'build');
    }).toThrow('render failed');

    expect(c.popover()).toBeNull();
    expect(log).toEqual(['dispose design']);
  });

  it('a link menu with such content is disposed when it closes, and takes pointer events', () => {
    const { render, log, live } = hosting(linkKey);
    const c = mount({ linkMenu: { onRemove: vi.fn(), render } });
    const id = c.core.getSnapshot().state.derived.graph.links[0]!.id;

    clickLink(c, id, AT);

    const menu = c.popover()!;
    expect(menu.getAttribute('data-kind')).toBe('link');
    expect(menu.hasAttribute('data-interactive')).toBe(true);
    expect(menu.firstElementChild?.getAttribute('data-host')).toBe(id);
    expect(live.size).toBe(1);

    document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));

    expect(c.popover()).toBeNull();
    expect(log).toEqual([`make ${id}#1`, `dispose ${id}#1`]);
  });

  it('a menu moves the focus to the first button of its content, which is there when it opens', () => {
    const c = mount({
      linkMenu: {
        onRemove: vi.fn(),
        render: () => {
          const node = document.createElement('div');
          node.append(document.createElement('button'), document.createElement('button'));
          return { node, dispose: () => undefined };
        },
      },
    });
    const id = c.core.getSnapshot().state.derived.graph.links[0]!.id;

    clickLink(c, id, AT);

    expect(document.activeElement).toBe(c.popover()!.querySelector('button'));
  });

  it('takes pointer events only when the popover stays: a click tooltip does, a hover tooltip does not', () => {
    const { render } = hosting(taskKey);
    const hovered = mount({ tooltip: { delay: 0, render } });
    hover(hovered, 'design');
    expect(hovered.popover()!.hasAttribute('data-interactive')).toBe(false);
    hovered.layer.destroy();
    hovered.harness.abort();
    document.body.replaceChildren();

    const clicked = mount({ tooltip: { trigger: 'click', render } });
    clickBar(clicked, 'design');
    expect(clicked.popover()!.hasAttribute('data-interactive')).toBe(true);
    // A plain node is as it was: no pointer events.
    clicked.display({ tooltip: { trigger: 'click', render: () => document.createElement('b') } });
    expect(clicked.popover()!.hasAttribute('data-interactive')).toBe(false);
  });

  it('does not stay open on a hover only because its content has a lifetime', () => {
    const { render } = hosting(taskKey);
    const c = mount({ tooltip: { delay: 0, render } });
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();

    leave(c);

    expect(c.popover()).toBeNull();
  });
});

/** An element that counts how often it was taken out of the document: a node moved, not kept. */
class Counted extends HTMLElement {
  disconnects = 0;
  disconnectedCallback(): void {
    this.disconnects++;
  }
}
customElements.define('x-counted-host', Counted);

describe('popover layer: hosted content that is used (focus, portals, attachment; phase 5 review)', () => {
  const AT = { clientX: 500, clientY: 200 };
  const RENAMED: readonly Task[] = [
    { id: 'design', name: 'Design v2', start: '2026-03-02', end: '2026-03-06' },
    { id: 'build', name: 'Build', start: '2026-03-09', end: '2026-03-13' },
  ];

  /** A host with a button and an input in it, and a render function that returns it every time. */
  function sharedHost(extra: Partial<DisposableNode> = {}) {
    const host = new Counted();
    const button = document.createElement('button');
    const input = document.createElement('input');
    host.append(button, input);
    const dispose = vi.fn();
    const render = () => ({ node: host, dispose, ...extra });
    return { host, button, input, dispose, render };
  }

  it('FR-TIP-1: a click tooltip made again with the host it had keeps the host in the page and the focus in its input', () => {
    const { host, input, render } = sharedHost();
    const c = mount({ tooltip: { trigger: 'click', render } });
    clickBar(c, 'design');
    const popover = c.popover()!;
    input.focus();
    input.value = 'typed';

    c.core.setTasks(RENAMED);
    c.render();

    expect(c.popover()).toBe(popover);
    expect(host.disconnects).toBe(0);
    expect(popover.children).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('typed');
  });

  it('FR-TIP-1, FR-TIP-4: a menu made again keeps the focus where it is, and does not send it to the first button', () => {
    const { host, button, input, render } = sharedHost();
    const c = mount({ linkMenu: { onRemove: vi.fn(), render } });
    const id = c.core.getSnapshot().state.derived.graph.links[0]!.id;
    clickLink(c, id, AT);
    // The menu took the focus when it opened; the user moved on to the input.
    expect(document.activeElement).toBe(button);
    input.focus();

    c.core.setTasks(RENAMED);
    c.render();

    expect(host.disconnects).toBe(0);
    expect(document.activeElement).toBe(input);
  });

  it('FR-TIP-1: a made-again popover that held the focus gives it to the first button when the content is new', () => {
    let made = 0;
    const c = mount({
      tooltip: {
        trigger: 'click',
        render: () => {
          const node = document.createElement('div');
          node.append(document.createElement('button'), document.createElement('input'));
          node.dataset.made = String(++made);
          return { node, dispose: vi.fn() };
        },
      },
    });
    clickBar(c, 'design');
    c.popover()!.querySelector('input')!.focus();

    c.core.setTasks(RENAMED);
    c.render();

    const popover = c.popover()!;
    expect(popover.querySelector('[data-made="2"]')).not.toBeNull();
    expect(document.activeElement).toBe(popover.querySelector('button'));
  });

  describe('owns', () => {
    /** A node of the page outside the chart, as the portal of a select or a menu makes. */
    function portal(): { readonly root: HTMLElement; readonly option: HTMLElement } {
      const root = document.createElement('div');
      const option = document.createElement('button');
      root.append(option);
      document.body.append(root);
      return { root, option };
    }

    it('FR-TIP-1: a press on what the content owns is not a press outside, and one elsewhere is', () => {
      const { root, option } = portal();
      const { render } = sharedHost({ owns: (target) => root.contains(target) });
      const c = mount({ tooltip: { trigger: 'click', render } });
      clickBar(c, 'design');
      expect(c.popover()).not.toBeNull();

      option.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      root.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));

      expect(c.popover()).not.toBeNull();

      document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));

      expect(c.popover()).toBeNull();
    });

    it('FR-TIP-4: the same for the menu', () => {
      const { root, option } = portal();
      const { render } = sharedHost({ owns: (target) => root.contains(target) });
      const c = mount({ linkMenu: { onRemove: vi.fn(), render } });
      clickLink(c, c.core.getSnapshot().state.derived.graph.links[0]!.id, AT);

      option.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      expect(c.popover()).not.toBeNull();

      document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      expect(c.popover()).toBeNull();
    });

    it('FR-TIP-1: a scroll of what the content owns (a long list in a portal) does not close the popover, another scroll does', () => {
      const { root, option } = portal();
      const { render } = sharedHost({ owns: (target) => root.contains(target) });
      const c = mount({ tooltip: { trigger: 'click', render } });
      clickBar(c, 'design');

      option.dispatchEvent(new Event('scroll'));
      root.dispatchEvent(new Event('scroll'));
      expect(c.popover()).not.toBeNull();

      document.body.dispatchEvent(new Event('scroll'));
      expect(c.popover()).toBeNull();
    });

    it('FR-TIP-1: it is the owns of the content shown now that counts: a made-again popover has the new one', () => {
      const first = portal();
      const second = portal();
      let mine = first.root;
      const { render } = sharedHost();
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => {
            const answer = render();
            const root = mine;
            return { ...answer, owns: (target: Node) => root.contains(target) };
          },
        },
      });
      clickBar(c, 'design');
      mine = second.root;
      c.core.setTasks(RENAMED);
      c.render();

      first.option.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));

      expect(c.popover()).toBeNull();
      clickBar(c, 'design');
      second.option.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
      expect(c.popover()).not.toBeNull();
    });

    it('FR-TIP-1: a press outside content that owns nothing closes the popover, as it did', () => {
      const { option } = portal();
      const { render } = sharedHost();
      const c = mount({ tooltip: { trigger: 'click', render } });
      clickBar(c, 'design');

      option.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));

      expect(c.popover()).toBeNull();
    });

    it('FR-TIP-1: a scroll inside the popover itself (a long list in its content) does not close it', () => {
      const { input, render } = sharedHost();
      const c = mount({ tooltip: { trigger: 'click', render } });
      clickBar(c, 'design');

      input.dispatchEvent(new Event('scroll'));

      expect(c.popover()).not.toBeNull();
    });
  });

  describe('attached', () => {
    const measuredPopovers = (): number =>
      vi
        .mocked(Element.prototype.getBoundingClientRect)
        .mock.contexts.filter((element) =>
          (element as Element).classList.contains('gantt__popover'),
        ).length;

    it('FR-TIP-1: is called once the popover is in the chart and before it is measured', () => {
      const seen: { inChart: boolean; measured: number }[] = [];
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => ({
            node: document.createElement('div'),
            dispose: vi.fn(),
            attached: () => {
              seen.push({
                inChart: c.popover()?.parentElement === c.root,
                measured: measuredPopovers(),
              });
              c.popover()!.firstElementChild!.append('drawn when attached');
            },
          }),
        },
      });

      clickBar(c, 'design');

      expect(seen).toEqual([{ inChart: true, measured: 0 }]);
      expect(measuredPopovers()).toBe(1);
      expect(c.popover()!.textContent).toBe('drawn when attached');
    });

    it('FR-TIP-1: is called again when the popover is made again, with the new content', () => {
      const calls: string[] = [];
      let made = 0;
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => {
            const label = `#${String(++made)}`;
            return {
              node: Object.assign(document.createElement('div'), { textContent: label }),
              dispose: vi.fn(),
              attached: () => calls.push(label),
            };
          },
        },
      });
      clickBar(c, 'design');

      c.core.setTasks(RENAMED);
      c.render();

      expect(calls).toEqual(['#1', '#2']);
    });

    it('FR-TIP-3: content that is empty until it is attached, and then has something, is shown', () => {
      const dispose = vi.fn();
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => {
            const node = document.createElement('div');
            return { node, dispose, attached: () => node.append('late') };
          },
        },
      });

      clickBar(c, 'design');

      expect(c.popover()!.textContent).toBe('late');
      expect(dispose).not.toHaveBeenCalled();
    });

    it('FR-TIP-3: content that is still empty after it is attached hides the popover and is disposed once', () => {
      const dispose = vi.fn();
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => ({
            node: document.createElement('div'),
            dispose,
            attached: () => undefined,
          }),
        },
      });

      clickBar(c, 'design');

      expect(c.popover()).toBeNull();
      expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(0);
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('FR-TIP-1: what the content focuses when it is attached keeps the focus, in a menu too', () => {
      const shared = sharedHost();
      const c = mount({
        linkMenu: {
          onRemove: vi.fn(),
          render: () => ({ ...shared.render(), attached: () => shared.input.focus() }),
        },
      });

      clickLink(c, c.core.getSnapshot().state.derived.graph.links[0]!.id, AT);

      expect(document.activeElement).toBe(shared.input);
    });

    it('FR-TIP-1: a popover made again whose content hides it while it is attached closes, and both contents are disposed once', () => {
      const log: string[] = [];
      let hide = false;
      let made = 0;
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: (context) => {
            const label = `#${String(++made)}`;
            const node = Object.assign(document.createElement('div'), { textContent: label });
            return {
              node,
              dispose: () => log.push(`dispose ${label}`),
              attached: () => {
                // A framework's layout effect that closes what it has just drawn.
                if (hide) context.api.hide();
              },
            };
          },
        },
      });
      clickBar(c, 'design');
      expect(c.popover()).not.toBeNull();

      hide = true;
      c.core.setTasks(RENAMED);
      c.render();

      expect(c.popover()).toBeNull();
      expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(0);
      expect(log.sort()).toEqual(['dispose #1', 'dispose #2']);
      // The state is clean: the next click opens a popover again.
      hide = false;
      clickBar(c, 'build');
      expect(c.popover()!.textContent).toBe('#3');
    });

    it('FR-TIP-1: content with no attached hook is shown as it always was', () => {
      const c = mount({
        tooltip: {
          trigger: 'click',
          render: () => ({
            node: Object.assign(document.createElement('b'), { textContent: 'x' }),
            dispose: vi.fn(),
          }),
        },
      });

      clickBar(c, 'design');

      expect(c.popover()!.textContent).toBe('x');
    });
  });

  describe('what hosted content shows (FR-TIP-3)', () => {
    /** A hosted node with this markup; `log` hears the dispose. */
    const hostedMarkup = (markup: string, log: string[] = []) => {
      const node = document.createElement('div');
      // eslint-disable-next-line no-restricted-properties -- a test fixture
      node.innerHTML = markup;
      return { node, dispose: () => log.push('dispose') };
    };

    it.each([
      ['an element around nothing', '<div></div>'],
      ['nested elements around whitespace', '<p> <span>\n</span></p>'],
    ])('%s shows no popover, and the content is disposed', (_name, markup) => {
      const log: string[] = [];
      const c = mount({ tooltip: { delay: 0, render: () => hostedMarkup(markup, log) } });

      hover(c, 'design');

      expect(c.popover()).toBeNull();
      expect(log).toEqual(['dispose']);
    });

    it.each([
      ['an image', '<img src="data:," alt="">'],
      ['a control', '<div><input></div>'],
      ['text', '<div>x</div>'],
    ])('%s shows the popover', (_name, markup) => {
      const c = mount({ tooltip: { delay: 0, render: () => hostedMarkup(markup) } });

      hover(c, 'design');

      expect(c.popover()).not.toBeNull();
    });

    it('a plain node is shown as it is, however empty it looks', () => {
      const c = mount({ tooltip: { delay: 0, render: () => document.createElement('div') } });

      hover(c, 'design');

      expect(c.popover()).not.toBeNull();
    });
  });

  describe('fuzz: a popover with hosted content, whatever happens to it', () => {
    // `late`: a node that is empty until the popover is in the chart (`attached` draws it).
    type Mode = 'shared' | 'fresh' | 'empty' | 'late' | 'plain';
    type Step =
      | { readonly kind: 'open'; readonly id: 'design' | 'build' }
      | { readonly kind: 'close' }
      | { readonly kind: 'remake' }
      | { readonly kind: 'escape' }
      | { readonly kind: 'press' }
      | { readonly kind: 'render'; readonly mode: Mode };

    const step: fc.Arbitrary<Step> = fc.oneof(
      fc.record({ kind: fc.constant('open' as const), id: fc.constantFrom('design', 'build') }),
      fc.constant({ kind: 'close' as const }),
      fc.constant({ kind: 'remake' as const }),
      fc.constant({ kind: 'escape' as const }),
      fc.constant({ kind: 'press' as const }),
      fc.record({
        kind: fc.constant('render' as const),
        mode: fc.constantFrom<Mode>('shared', 'fresh', 'empty', 'late', 'plain'),
      }),
    );

    /** Runs a history: each content is disposed once, at most one lives, none after destroy. */
    function replay(steps: readonly Step[], trigger: 'hover' | 'click'): void {
      const live = new Set<string>();
      const nodes = new Map<string, HTMLElement>();
      let made = 0;
      let revision = 0;
      let mode: Mode = 'shared';
      const render = (context: TaskTooltipContext): TooltipContent => {
        if (mode === 'plain') return `plain ${String(context.task.id)}`;
        const key = String(context.task.id);
        const label = `${key}#${String(++made)}`;
        let node = mode === 'shared' ? nodes.get(key) : undefined;
        if (node === undefined) {
          node = document.createElement('div');
          if (mode !== 'empty' && mode !== 'late') node.append(key);
          if (mode === 'shared') nodes.set(key, node);
        }
        live.add(label);
        const drawn = node;
        return {
          node,
          dispose: () => {
            expect(live.delete(label), `${label} disposed twice or never made`).toBe(true);
          },
          ...(mode === 'late' && { attached: () => drawn.append(key) }),
        };
      };
      const c = mount({ tooltip: { trigger, delay: 0, render } });
      const expectInvariants = (what: string): void => {
        expect(live.size, `${what}: at most one content alive`).toBeLessThanOrEqual(1);
        expect(c.root.querySelectorAll('.gantt__popover').length, what).toBeLessThanOrEqual(1);
        if (live.size === 1) expect(c.popover(), `${what}: a live content is shown`).not.toBeNull();
        if (c.popover() === null)
          expect(live.size, `${what}: nothing shown, nothing alive`).toBe(0);
      };
      try {
        for (const next of steps) {
          switch (next.kind) {
            case 'open':
              if (trigger === 'click') clickBar(c, next.id);
              else hover(c, next.id);
              break;
            case 'close':
              if (trigger === 'hover') leave(c);
              else document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
              break;
            case 'remake':
              revision++;
              c.core.setTasks([
                { ...RENAMED[0]!, name: `Design v${String(revision)}` },
                RENAMED[1]!,
              ]);
              c.render();
              break;
            case 'escape':
              document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
              );
              break;
            case 'press':
              document.body.dispatchEvent(pointer('pointerdown', { clientX: 5, clientY: 5 }));
              break;
            case 'render':
              mode = next.mode;
              c.display({ tooltip: { trigger, delay: 0, render: (context) => render(context) } });
              break;
          }
          expectInvariants(JSON.stringify(next));
        }
        c.layer.destroy();
        expect([...live], 'after destroy').toEqual([]);
        expect(c.root.querySelectorAll('.gantt__popover')).toHaveLength(0);
      } finally {
        c.layer.destroy();
        c.harness.abort();
        c.core.destroy();
        chart = undefined;
        document.body.replaceChildren();
      }
    }

    it('FR-TIP-1: after any history, on hover', () => {
      fc.assert(
        fc.property(fc.array(step, { minLength: 1, maxLength: 16 }), (steps) => {
          replay(steps, 'hover');
        }),
        { numRuns: 60 },
      );
    });

    it('FR-TIP-1: after any history, on click', () => {
      fc.assert(
        fc.property(fc.array(step, { minLength: 1, maxLength: 16 }), (steps) => {
          replay(steps, 'click');
        }),
        { numRuns: 60 },
      );
    });
  });
});

describe('popover layer: destroy', () => {
  it('FR-API-4: destroy removes the popover, clears the timers and leaves no listener', () => {
    const tracker = trackListeners();
    track.restore = () => {
      tracker.restore();
    };
    const c = mount({ tooltip: { delay: 0 }, linkMenu: { onRemove: vi.fn() } });
    const before = countNodes(c.root);
    hover(c, 'design');
    expect(c.popover()).not.toBeNull();
    // A pending show and a pending hide: nothing may fire after destroy.
    leave(c);
    hover(c, 'build');

    c.layer.destroy();
    c.harness.abort();

    expect(c.popover()).toBeNull();
    expect(countNodes(c.root)).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
    expect(c.harness.scheduler.pending).toBe(false);
    expect(tracker.alive()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new Event('scroll'));
  });

  it('FR-API-4: a menu that is open at destroy leaves nothing, not even the focus handler', () => {
    const c = mount({ linkMenu: { onRemove: vi.fn() } });
    clickLink(c, [...c.core.getSnapshot().state.derived.graph.links][0]!.id, {
      clientX: 500,
      clientY: 200,
    });
    expect(c.popover()).not.toBeNull();

    c.layer.destroy();

    expect(c.root.childNodes).toHaveLength(0);
  });

  it('FR-API-4: a layer that was never given a snapshot destroys cleanly', () => {
    const harness = createLayerHarness('popover');
    const layer = createPopoverLayer();

    layer.mount(harness.context);
    layer.destroy();
    harness.abort();

    expect(harness.root.childNodes).toHaveLength(0);
  });
});

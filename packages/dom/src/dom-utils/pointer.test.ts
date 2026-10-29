import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHtml, createSvg } from '../shared';
import {
  hitTargetOf,
  keyInput,
  measureFrame,
  pointerInput,
  pointerOnScrollbar,
  pointerOutsideBody,
} from './pointer';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/**
 * An element that reports the given box, as a laid-out scroller would. `width` / `height` are the
 * border box on the page and `offsetWidth` / `offsetHeight` its layout size: they differ when an
 * ancestor is scaled by a CSS transform.
 */
function boxed(box: {
  left: number;
  top: number;
  width?: number;
  height?: number;
  offsetWidth?: number;
  offsetHeight?: number;
  clientLeft?: number;
  clientTop?: number;
  clientWidth: number;
  clientHeight: number;
}): HTMLElement {
  const element = createHtml(document, 'div');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: box.left,
    top: box.top,
    bottom: box.top + (box.height ?? 0),
    width: box.width ?? 0,
    height: box.height ?? 0,
  } as DOMRect);
  for (const name of [
    'clientLeft',
    'clientTop',
    'clientWidth',
    'clientHeight',
    'offsetWidth',
    'offsetHeight',
  ] as const) {
    Object.defineProperty(element, name, { value: box[name] ?? 0 });
  }
  return element;
}

const FRAME = {
  left: 100,
  top: 50,
  width: 700,
  height: 400,
  scaleX: 1,
  scaleY: 1,
  bodyTop: 110,
};
const SCROLL = { scrollLeft: 300, scrollTop: 20, headerHeight: 60 };

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { pointerId: 7, bubbles: true, ...init });
}

describe('measureFrame', () => {
  it('FR-EDIT-1: reads the scroller content origin and client size, borders excluded', () => {
    const scroller = boxed({
      left: 90,
      top: 40,
      clientLeft: 2,
      clientTop: 3,
      clientWidth: 683,
      clientHeight: 394,
    });

    expect(measureFrame(scroller)).toMatchObject({ left: 92, top: 43, width: 683, height: 394 });
  });

  it('FR-EDIT-1: without a header the rows begin at the top of the scroller, and nothing is scaled', () => {
    const scroller = boxed({ left: 90, top: 40, clientWidth: 683, clientHeight: 394 });

    expect(measureFrame(scroller)).toMatchObject({ scaleX: 1, scaleY: 1, bodyTop: 40 });
  });

  it('FR-EDIT-1: the rows begin at the bottom edge of the header, wherever it sticks', () => {
    const scroller = boxed({ left: 0, top: -300, clientWidth: 800, clientHeight: 1200 });
    // A header stuck to the top of the page: its place is not the scroller's top.
    const header = boxed({ left: 0, top: 0, clientWidth: 800, clientHeight: 60 });
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 60 } as DOMRect);

    expect(measureFrame(scroller, header).bodyTop).toBe(60);
  });

  it('FR-EDIT-1: under a CSS scale() ancestor the frame says how many client px a CSS px is', () => {
    for (const k of [2, 0.5]) {
      const scroller = boxed({
        left: 40,
        top: 20,
        // The border box is 800 x 400 in layout; the page shows it k times as big.
        width: 800 * k,
        height: 400 * k,
        offsetWidth: 800,
        offsetHeight: 400,
        clientLeft: 2,
        clientTop: 2,
        clientWidth: 796,
        clientHeight: 396,
      });

      // The client offsets (the border) are layout px: they are scaled to the page's too.
      expect(measureFrame(scroller), `scale ${String(k)}`).toEqual({
        left: 40 + 2 * k,
        top: 20 + 2 * k,
        width: 796,
        height: 396,
        scaleX: k,
        scaleY: k,
        bodyTop: 20 + 2 * k,
      });
    }
  });
});

describe('pointerInput: coordinates (architecture §4)', () => {
  it('FR-EDIT-1: x is client x minus the content origin plus scrollLeft, y is body y', () => {
    const input = pointerInput(
      'move',
      pointer('pointermove', { clientX: 150, clientY: 130 }),
      FRAME,
      SCROLL,
    );

    // 150 - 100 + 300, and 130 - 50 + 20 - 60 (the sticky header is not part of the body).
    expect(input).toMatchObject({ type: 'move', x: 350, y: 40 });
  });

  it('FR-EDIT-1: the scroll offsets come from the arguments, never from the DOM', () => {
    const first = pointerInput('up', pointer('pointerup', { clientX: 100, clientY: 50 }), FRAME, {
      scrollLeft: 0,
      scrollTop: 0,
      headerHeight: 0,
    });
    const scrolled = pointerInput(
      'up',
      pointer('pointerup', { clientX: 100, clientY: 50 }),
      FRAME,
      { scrollLeft: 1000, scrollTop: 500, headerHeight: 0 },
    );

    expect([first.x, first.y]).toEqual([0, 0]);
    expect([scrolled.x, scrolled.y]).toEqual([1000, 500]);
  });

  it('FR-EDIT-1: a pointer left of or above the chart (released outside) has negative offsets', () => {
    const input = pointerInput('up', pointer('pointerup', { clientX: 10, clientY: 5 }), FRAME, {
      scrollLeft: 0,
      scrollTop: 0,
      headerHeight: 0,
    });

    expect([input.x, input.y]).toEqual([-90, -45]);
  });

  it('FR-EDIT-1: under a CSS scale() the offset is converted from page px to chart px', () => {
    const at = (type: string, init: PointerEventInit): PointerEvent => pointer(type, init);
    const none = { scrollLeft: 0, scrollTop: 0, headerHeight: 0 };

    // scale(2): 80 page px are 40 chart px, so a 2-day drag (80 px) is 160 page px, not 80.
    const doubled = { ...FRAME, scaleX: 2, scaleY: 2 };
    expect(
      pointerInput('move', at('pointermove', { clientX: 260, clientY: 150 }), doubled, none),
    ).toMatchObject({ x: 80, y: 50 });
    // scale(0.5): the same chart px take half the page px.
    const halved = { ...FRAME, scaleX: 0.5, scaleY: 0.5 };
    expect(
      pointerInput('move', at('pointermove', { clientX: 140, clientY: 70 }), halved, none),
    ).toMatchObject({ x: 80, y: 40 });
    // The scroll offsets and the header are chart px already: only the offset is converted.
    expect(
      pointerInput('move', at('pointermove', { clientX: 260, clientY: 150 }), doubled, SCROLL),
    ).toMatchObject({ x: 80 + 300, y: 50 + 20 - 60 });
  });
});

describe('pointerInput: the event', () => {
  it('FR-EDIT-1: carries pointerId, pointerType, isPrimary, button, time and the native event', () => {
    const event = pointer('pointerdown', {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: 120,
      clientY: 90,
    });

    const input = pointerInput('down', event, FRAME, SCROLL);

    expect(input).toMatchObject({
      type: 'down',
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      time: event.timeStamp,
      event,
    });
  });

  it('FR-SNAP-10: carries the modifier keys', () => {
    const input = pointerInput(
      'move',
      pointer('pointermove', { altKey: true, shiftKey: true, ctrlKey: false, metaKey: true }),
      FRAME,
      SCROLL,
    );

    expect(input.modifiers).toEqual({ alt: true, shift: true, ctrl: false, meta: true });
  });

  it('FR-LINK-4: carries the explicit target it is given, and none otherwise', () => {
    const target = { kind: 'link', id: 'a-FS->b' } as const;

    expect(pointerInput('down', pointer('pointerdown'), FRAME, SCROLL, target).target).toBe(target);
    expect(pointerInput('down', pointer('pointerdown'), FRAME, SCROLL).target).toBeUndefined();
  });
});

describe('pointerOnScrollbar', () => {
  it('FR-EDIT-1: a press past the client box of the scroller is on its scrollbar', () => {
    const at = (clientX: number, clientY: number): boolean =>
      pointerOnScrollbar(pointer('pointerdown', { clientX, clientY }), FRAME);

    expect(at(150, 100)).toBe(false);
    expect(at(799, 449)).toBe(false);
    // The vertical scrollbar sits right of the client width, the horizontal one below the height.
    expect(at(800, 100)).toBe(true);
    expect(at(150, 450)).toBe(true);
  });

  it('FR-EDIT-1: under a CSS scale() the client box is as many page px as it is scaled to', () => {
    const doubled = { ...FRAME, scaleX: 2, scaleY: 2 };
    const at = (clientX: number, clientY: number): boolean =>
      pointerOnScrollbar(pointer('pointerdown', { clientX, clientY }), doubled);

    // 700 chart px are 1400 page px wide: the right half of the box is not a scrollbar.
    expect(at(100 + 1000, 100)).toBe(false);
    expect(at(100 + 1399, 100)).toBe(false);
    expect(at(100 + 1400, 100)).toBe(true);
    expect(at(150, 50 + 799)).toBe(false);
    expect(at(150, 50 + 800)).toBe(true);

    const halved = { ...FRAME, scaleX: 0.5, scaleY: 0.5 };
    expect(
      pointerOnScrollbar(pointer('pointerdown', { clientX: 100 + 349, clientY: 100 }), halved),
    ).toBe(false);
    expect(
      pointerOnScrollbar(pointer('pointerdown', { clientX: 100 + 350, clientY: 100 }), halved),
    ).toBe(true);
  });
});

describe('pointerOutsideBody', () => {
  const at = (clientX: number, clientY: number, frame = FRAME): boolean =>
    pointerOutsideBody(pointer('pointermove', { clientX, clientY }), frame);

  it('FR-EDIT-1: inside is the part of the scroller that shows rows: right of its left edge, below the header, before the scrollbars', () => {
    expect(at(150, 200)).toBe(false);
    expect(at(100, 110)).toBe(false);
    expect(at(799, 449)).toBe(false);
  });

  it('FR-EDIT-1: left of the chart, over the sticky header, and on or past the scrollbars are outside', () => {
    expect(at(99, 200)).toBe(true);
    expect(at(150, 109)).toBe(true);
    expect(at(150, 20)).toBe(true);
    expect(at(800, 200)).toBe(true);
    expect(at(150, 450)).toBe(true);
    expect(at(2000, 2000)).toBe(true);
  });

  it('FR-EDIT-1: the edges follow the scale of the page', () => {
    const doubled = { ...FRAME, scaleX: 2, scaleY: 2, bodyTop: 230 };

    expect(at(100 + 1000, 300, doubled)).toBe(false);
    expect(at(100 + 1400, 300, doubled)).toBe(true);
    expect(at(150, 229, doubled)).toBe(true);
    expect(at(150, 230, doubled)).toBe(false);
  });
});

describe('keyInput', () => {
  it('FR-EDIT-4, FR-SNAP-10: carries the key and the modifiers held after it', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', altKey: true });

    expect(keyInput(event)).toEqual({
      type: 'key',
      key: 'Escape',
      modifiers: { alt: true, shift: false, ctrl: false, meta: false },
    });
  });
});

describe('hitTargetOf: targets from the DOM (the unstyled contract)', () => {
  /** A bar group with its parts, a link group with its hit path and a row of the same task. */
  function chart(): {
    bar: SVGGElement;
    track: SVGElement;
    resizeStart: SVGElement;
    resizeEnd: SVGElement;
    progress: SVGElement;
    linkStart: SVGElement;
    linkEnd: SVGElement;
    link: SVGGElement;
    hit: SVGElement;
    row: SVGElement;
  } {
    const track = createSvg(document, 'rect', { class: 'gantt__bar-track' });
    const resizeStart = createSvg(document, 'rect', {
      class: 'gantt__handle',
      'data-handle': 'resize-start',
    });
    const resizeEnd = createSvg(document, 'rect', {
      class: 'gantt__handle',
      'data-handle': 'resize-end',
    });
    const progress = createSvg(document, 'rect', {
      class: 'gantt__handle',
      'data-handle': 'progress',
    });
    const linkStart = createSvg(document, 'circle', {
      class: 'gantt__link-handle',
      'data-side': 'start',
    });
    const linkEnd = createSvg(document, 'circle', {
      class: 'gantt__link-handle',
      'data-side': 'end',
    });
    const bar = createSvg(
      document,
      'g',
      { class: 'gantt__bar', 'data-task-id': 'a' },
      track,
      resizeStart,
      resizeEnd,
      progress,
      linkStart,
      linkEnd,
    );
    const hit = createSvg(document, 'path', { class: 'gantt__link-hit', 'data-link-id': 'l1' });
    const link = createSvg(document, 'g', { class: 'gantt__link', 'data-link-id': 'l1' }, hit);
    const row = createSvg(document, 'rect', { class: 'gantt__row', 'data-task-id': 'a' });
    return { bar, track, resizeStart, resizeEnd, progress, linkStart, linkEnd, link, hit, row };
  }
  const same = (raw: string): string => raw;

  it('FR-EDIT-1: the bar and every handle map to the part of the task they are', () => {
    const parts = chart();

    expect(hitTargetOf(parts.track, same)).toEqual({ kind: 'task', id: 'a', part: 'body' });
    expect(hitTargetOf(parts.bar, same)).toEqual({ kind: 'task', id: 'a', part: 'body' });
    expect(hitTargetOf(parts.resizeStart, same)).toEqual({
      kind: 'task',
      id: 'a',
      part: 'resize-start',
    });
    expect(hitTargetOf(parts.resizeEnd, same)).toEqual({
      kind: 'task',
      id: 'a',
      part: 'resize-end',
    });
    expect(hitTargetOf(parts.progress, same)).toEqual({
      kind: 'task',
      id: 'a',
      part: 'progress',
    });
    expect(hitTargetOf(parts.linkStart, same)).toEqual({
      kind: 'task',
      id: 'a',
      part: 'link-start',
    });
    expect(hitTargetOf(parts.linkEnd, same)).toEqual({ kind: 'task', id: 'a', part: 'link-end' });
  });

  it('FR-LINK-5: a link and its hit path resolve to the link, through closest', () => {
    const parts = chart();

    expect(hitTargetOf(parts.hit, same)).toEqual({ kind: 'link', id: 'l1' });
    expect(hitTargetOf(parts.link, same)).toEqual({ kind: 'link', id: 'l1' });
  });

  it('FR-EDIT-1: an unknown handle kind is the body, whatever its text (no prototype keys)', () => {
    const odd = createSvg(document, 'rect', { 'data-handle': 'constructor' });
    const bar = createSvg(document, 'g', { class: 'gantt__bar', 'data-task-id': 'a' }, odd);
    document.body.append(bar);

    expect(hitTargetOf(odd, same)).toEqual({ kind: 'task', id: 'a', part: 'body' });
    odd.setAttribute('data-handle', 'toString');
    expect(hitTargetOf(odd, same)).toEqual({ kind: 'task', id: 'a', part: 'body' });
  });

  it('FR-EDIT-1: the row of a task carries its id but is not a bar: the hit test decides', () => {
    expect(hitTargetOf(chart().row, same)).toBeUndefined();
  });

  it('FR-EDIT-1: anything else, and no element, is left to the core hit test', () => {
    expect(hitTargetOf(document.createElement('div'), same)).toBeUndefined();
    expect(hitTargetOf(null, same)).toBeUndefined();
  });

  it('FR-EDIT-1: an id the resolver cannot place is left to the core hit test', () => {
    const { track } = chart();

    expect(hitTargetOf(track, () => undefined)).toBeUndefined();
  });

  it('FR-EDIT-1: the resolver maps the attribute text back to the task id', () => {
    const { track } = chart();

    expect(hitTargetOf(track, (raw) => (raw === 'a' ? 7 : undefined))).toEqual({
      kind: 'task',
      id: 7,
      part: 'body',
    });
  });
});

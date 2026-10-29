import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertContainer } from './container';
import { createChart, createGantt } from './create-gantt';
import { mountRenderer } from './renderer';
import type { ListenerTracker } from './testing';
import {
  createContainer,
  createManualFrames,
  createTestCore,
  stubScrollerSize,
  trackListeners,
} from './testing';

const TASKS = [{ id: 'a', name: 'A', start: '2026-03-02', end: '2026-03-06' }];

let tracker: ListenerTracker;

beforeEach(() => {
  vi.useFakeTimers();
  tracker = trackListeners();
  stubScrollerSize(800, 400);
});

afterEach(() => {
  tracker.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/**
 * An element that this realm's `HTMLElement` does not recognise, as one of an iframe or of another
 * window is (`instanceof` looks at the prototype chain of the realm that made the element; the
 * test DOM has one set of classes for all its windows, so the prototype is hidden here). It works
 * like the element it wraps.
 */
function foreignElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return new Proxy(element, {
    getPrototypeOf: () => Object.prototype,
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
}

/** What an untyped caller (plain JavaScript, `any`) can hand over as the container. */
const NOT_ELEMENTS: readonly [string, unknown, RegExp][] = [
  [
    'a selector string',
    '#chart',
    /got the string "#chart"\. Pass the element itself, not a selector/,
  ],
  [
    'a long string, cut short',
    `#${'x'.repeat(100)}`,
    new RegExp(`got the string "#${'x'.repeat(39)}…"`),
  ],
  ['null, a querySelector that found nothing', null, /got null\. Is the element there yet/],
  ['undefined', undefined, /got undefined\. Is the element there yet/],
  ['a number', 42, /got a number\.$/],
  ['a function', () => undefined, /got a function\.$/],
  ['a plain object', {}, /got an object that is not a DOM node\.$/],
  ['the document', document, /got a DOM node that is not an element \(nodeType 9\)\.$/],
  [
    'a text node',
    document.createTextNode('text'),
    /got a DOM node that is not an element \(nodeType 3\)\.$/,
  ],
  [
    'a document fragment',
    document.createDocumentFragment(),
    /got a DOM node that is not an element \(nodeType 11\)\.$/,
  ],
];

describe('the container of a chart (FR-API-1)', () => {
  describe('createGantt', () => {
    for (const [what, value, message] of NOT_ELEMENTS) {
      it(`FR-API-1: throws a TypeError that says what is wrong when the container is ${what}`, () => {
        const container = value as HTMLElement;

        expect(() => createGantt(container, { tasks: TASKS })).toThrow(TypeError);
        expect(() => createGantt(container, { tasks: TASKS })).toThrow(
          /^createGantt: `container` must be a DOM element, got /,
        );
        expect(() => createGantt(container, { tasks: TASKS })).toThrow(message);
      });
    }

    it('FR-API-1: checks the container before it makes anything', () => {
      const now = vi.fn(() => '2026-03-04');

      expect(() => createGantt('#chart' as unknown as HTMLElement, { tasks: TASKS, now })).toThrow(
        TypeError,
      );

      // The core reads its clock when it is made.
      expect(now).not.toHaveBeenCalled();
      expect(document.body.childElementCount).toBe(0);
    });

    it('FR-API-1: takes an element of another window, which is no instance of this one’s HTMLElement', () => {
      const foreign = foreignElement();
      expect(foreign instanceof HTMLElement).toBe(false);
      expect(foreign.nodeType).toBe(1);

      expect(() => {
        assertContainer(foreign, 'createGantt');
      }).not.toThrow();
      const gantt = createGantt(foreign, {
        tasks: TASKS,
        now: () => '2026-03-04',
        renderer: { frames: createManualFrames() },
      });

      expect(foreign.querySelector('.gantt__scroller')).not.toBeNull();
      gantt.destroy();
      expect(foreign.childElementCount).toBe(0);
    });
  });

  describe('createChart and its mount', () => {
    it('FR-API-1: createChart throws the same TypeError, and makes nothing, for a bad container', () => {
      const now = vi.fn(() => '2026-03-04');

      expect(() => createChart({ tasks: TASKS, now }, null as unknown as HTMLElement)).toThrow(
        /^createChart: `container` must be a DOM element, got null\./,
      );

      expect(now).not.toHaveBeenCalled();
    });

    it('FR-API-1: createChart without a container is not an error: it is mounted later', () => {
      const chart = createChart({ tasks: TASKS, now: () => '2026-03-04' });

      const container = createContainer();
      chart.mount(container);

      expect(container.querySelector('.gantt__scroller')).not.toBeNull();
      chart.gantt.destroy();
    });

    it('FR-API-1: mount() with a bad container throws, and the renderer that is mounted stays', () => {
      const container = createContainer();
      const chart = createChart(
        { tasks: TASKS, now: () => '2026-03-04', renderer: { frames: createManualFrames() } },
        container,
      );
      const drawn = container.querySelector('.gantt');
      expect(drawn).not.toBeNull();

      expect(() => {
        chart.mount('#elsewhere' as unknown as HTMLElement);
      }).toThrow(/^mount: `container` must be a DOM element, got the string "#elsewhere"\./);

      // A typo does not cost the chart its view.
      expect(container.querySelector('.gantt')).toBe(drawn);
      chart.gantt.destroy();
      expect(container.childElementCount).toBe(0);
    });
  });

  describe('mountRenderer', () => {
    for (const [what, value, message] of NOT_ELEMENTS) {
      it(`FR-API-1: throws a TypeError when the container is ${what}`, () => {
        const core = createTestCore();

        expect(() => mountRenderer(value as HTMLElement, core)).toThrow(TypeError);
        expect(() => mountRenderer(value as HTMLElement, core)).toThrow(
          /^mountRenderer: `container` must be a DOM element, got /,
        );
        expect(() => mountRenderer(value as HTMLElement, core)).toThrow(message);
      });
    }

    it('FR-API-1: takes an element of another window', () => {
      const foreign = foreignElement();
      const mounted = mountRenderer(foreign, createTestCore(), { frames: createManualFrames() });

      expect(foreign.querySelector('.gantt__scroller')).not.toBeNull();
      mounted.destroy();
      expect(foreign.childElementCount).toBe(0);
    });
  });
});

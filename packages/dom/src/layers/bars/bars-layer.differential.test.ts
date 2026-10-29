import {
  createGanttCore,
  type EditingOption,
  type GanttSnapshot,
  type Task,
} from '@ganttlane/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { createLayerHarness } from '../../testing';

type DisplayOptions = NonNullable<Parameters<typeof createLayerHarness>[1]>;
import { createBarsLayer } from './index';

// The bars layer keeps views alive between updates. Whatever the history, what is drawn must be
// what a layer that is mounted fresh on the same snapshot draws: a leftover of an earlier state
// (an attribute, a label, a handle) is a bug. This replays random histories against that oracle.
// Labels that are `DisposableNode`s are held to a second oracle: the ones alive are exactly the
// ones in the DOM, each is disposed once, and a destroyed layer holds none.

const NOW = '2026-03-04';
const BASE = Date.UTC(2026, 0, 5);
const DAY = 86_400_000;
const iso = (offset: number): string => new Date(BASE + offset * DAY).toISOString().slice(0, 10);

/** 150 tasks of every kind a view has to reset: locked, read-only, unlinkable, milestones, … */
const TASKS: readonly Task[] = Array.from({ length: 150 }, (_, i): Task => {
  const start = (i * 3) % 120;
  const milestone = i % 19 === 7;
  return {
    id: `t${i}`,
    name: `Task ${i}${'x'.repeat(i % 9)}`,
    start: iso(start),
    end: iso(start + (milestone ? 0 : (i % 6) + 1)),
    ...(milestone && { type: 'milestone' as const }),
    ...(i % 11 === 0 && { locked: true }),
    ...(i % 13 === 5 && { linkable: false }),
    ...(i % 17 === 3 && { editable: false }),
    ...(i % 17 === 9 && { editable: true }),
    ...(i % 7 === 0 && { className: 'seven  marked' }),
    ...(i % 5 === 0 && { color: '#c33' }),
    ...(i % 8 === 2 && { progressColor: '#363' }),
    progress: (i * 7) % 101,
  };
});

const EDITING: readonly EditingOption[] = [
  true,
  false,
  { move: false },
  { resize: false, progress: false },
  { move: false, resize: false, progress: false },
];

type Renderer = 'none' | 'text' | 'element' | 'fragment' | 'hosted';
type LabelMode = 'auto' | 'inside' | 'outside' | 'none';

type Op =
  | { readonly kind: 'scroll'; readonly left: number; readonly top: number }
  | { readonly kind: 'select'; readonly ids: readonly number[] }
  | { readonly kind: 'editing'; readonly index: number }
  | { readonly kind: 'label'; readonly mode: LabelMode }
  | { readonly kind: 'renderer'; readonly renderer: Renderer }
  | { readonly kind: 'handles'; readonly link: number; readonly offset: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('scroll' as const),
    left: fc.integer({ min: 0, max: 5000 }),
    top: fc.integer({ min: 0, max: 150 * 48 }),
  }),
  fc.record({
    kind: fc.constant('select' as const),
    ids: fc.array(fc.integer({ min: 0, max: 149 }), { maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('editing' as const),
    index: fc.integer({ min: 0, max: EDITING.length - 1 }),
  }),
  fc.record({
    kind: fc.constant('label' as const),
    mode: fc.constantFrom<LabelMode>('auto', 'inside', 'outside', 'none'),
  }),
  fc.record({
    kind: fc.constant('renderer' as const),
    renderer: fc.constantFrom<Renderer>('none', 'text', 'element', 'fragment', 'hosted'),
  }),
  fc.record({
    kind: fc.constant('handles' as const),
    link: fc.constantFrom(4, 6, 9),
    offset: fc.constantFrom(8, 10, 16),
  }),
);

/** The nodes of `DisposableNode` labels that were made and not disposed yet. */
const live = new Set<Element>();

/** A `renderBarLabel` of each kind; nodes are made per call, as the contract asks. */
function rendererOf(kind: Renderer) {
  switch (kind) {
    case 'none':
      return undefined;
    case 'text':
      return ({ name }: { name: string }) => `» ${name}`;
    case 'element':
      return ({ name }: { name: string }) => {
        const span = document.createElement('span');
        span.textContent = `<${name}>`;
        return span;
      };
    case 'fragment':
      return ({ name }: { name: string }) => {
        const fragment = document.createDocumentFragment();
        const bold = document.createElement('b');
        bold.textContent = name;
        fragment.append(bold, '!');
        return fragment;
      };
    case 'hosted':
      return ({ name }: { name: string }) => {
        const node = document.createElement('span');
        node.dataset.hosted = '';
        node.textContent = `[${name}]`;
        let done = false;
        live.add(node);
        return {
          node,
          dispose: () => {
            if (done) throw new Error('a node was disposed twice');
            done = true;
            live.delete(node);
          },
        };
      };
  }
}

afterEach(() => {
  document.body.replaceChildren();
  live.clear();
});

/**
 * The DOM below a node as text, the same for equal DOMs whatever order attributes (and the
 * custom properties of `style`) were set in, which a long-lived view cannot keep.
 */
function canonical(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  const attributes = [...node.attributes]
    .map(({ name, value }) =>
      name === 'style'
        ? `style=${value
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .sort()
            .join(';')}`
        : `${name}=${value}`,
    )
    .sort();
  const children = [...node.childNodes].map(canonical).join('');
  return `<${node.localName} ${attributes.join(' ')}>${children}</${node.localName}>`;
}

/** What the fresh layer draws for a snapshot: the oracle. */
function drawFresh(snapshot: GanttSnapshot, display: DisplayOptions): string {
  const harness = createLayerHarness('bars', display, 'test-fresh');
  const layer = createBarsLayer();
  try {
    layer.mount(harness.context);
    layer.update(snapshot, undefined);
    return canonical(harness.root);
  } finally {
    layer.destroy();
    harness.root.closest('.gantt')?.remove();
  }
}

/**
 * Applies a history of operations to a long-lived layer and checks, after each, that it shows
 * what a fresh layer shows for the same snapshot and display.
 */
function replay(ops: readonly Op[]): void {
  const core = createGanttCore({ tasks: TASKS, calendar: { weekends: [0, 6] }, now: () => NOW });
  core.setViewport({ width: 800, height: 300 });
  // Every history starts at the first bars, not at "today", which lies past all of them.
  core.scroll({ left: 0, top: 0 });
  let display: DisplayOptions = { barLabel: 'auto' };
  const persistent = createLayerHarness('bars', display);
  const layer = createBarsLayer();
  try {
    layer.mount(persistent.context);
    let previous = core.getSnapshot();
    layer.update(previous, undefined);

    for (const step of ops) {
      switch (step.kind) {
        case 'scroll':
          core.scroll({ left: step.left, top: step.top });
          break;
        case 'select':
          core.select(step.ids.map((id) => `t${id}`));
          break;
        case 'editing':
          core.setOptions({ editing: EDITING[step.index] });
          break;
        case 'label':
          display = { ...display, barLabel: step.mode };
          persistent.setDisplay(display);
          break;
        case 'renderer':
          display = { ...display, renderBarLabel: rendererOf(step.renderer) };
          persistent.setDisplay(display);
          break;
        case 'handles':
          core.setOptions({
            interaction: { handles: { link: step.link, linkOffset: step.offset } },
          });
          break;
      }
      const snapshot = core.getSnapshot();
      layer.update(snapshot, previous);
      previous = snapshot;
      expect(canonical(persistent.root), JSON.stringify(step)).toBe(drawFresh(snapshot, display));
      // The nodes alive are the nodes shown: a label that is hidden, replaced, or whose bar left
      // the window has been disposed. As sets: bars that enter above the window are made later
      // than the ones below them but come first in the DOM.
      const shown = [...persistent.root.querySelectorAll('[data-hosted]')];
      expect(
        shown.filter((node) => !live.has(node)),
        JSON.stringify(step),
      ).toEqual([]);
      expect(live.size, JSON.stringify(step)).toBe(shown.length);
    }
    layer.destroy();
    expect([...live], 'after destroy').toEqual([]);
  } finally {
    layer.destroy();
    core.destroy();
    document.body.replaceChildren();
  }
}

describe('bars layer: a long-lived layer draws what a fresh one draws', () => {
  it('FR-BAR-1, NFR-PERF-3: after any history of scrolls, selections and option changes', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 14 }), (ops) => {
        replay(ops);
      }),
      { numRuns: 60 },
    );
  });

  it('FR-BAR-5: a fragment label shown, hidden and shown again, across bars that leave and enter', () => {
    replay([
      { kind: 'renderer', renderer: 'fragment' },
      { kind: 'label', mode: 'none' },
      { kind: 'label', mode: 'inside' },
      { kind: 'scroll', left: 0, top: 3000 },
      { kind: 'scroll', left: 0, top: 0 },
      { kind: 'label', mode: 'outside' },
    ]);
  });

  it('FR-BAR-5: a DisposableNode label is disposed when hidden, replaced or scrolled away', () => {
    replay([
      { kind: 'renderer', renderer: 'hosted' },
      { kind: 'label', mode: 'none' },
      { kind: 'label', mode: 'inside' },
      { kind: 'renderer', renderer: 'text' },
      { kind: 'renderer', renderer: 'hosted' },
      { kind: 'scroll', left: 2000, top: 0 },
      { kind: 'renderer', renderer: 'hosted' },
      { kind: 'scroll', left: 0, top: 0 },
      { kind: 'select', ids: [0, 1] },
      { kind: 'label', mode: 'outside' },
    ]);
  });

  it('FR-EDIT-1: bars that change from editable to read-only and back, and move rows', () => {
    replay([
      { kind: 'select', ids: [1, 2] },
      { kind: 'editing', index: 4 },
      { kind: 'scroll', left: 0, top: 2000 },
      { kind: 'editing', index: 2 },
      { kind: 'scroll', left: 1500, top: 0 },
      { kind: 'editing', index: 0 },
    ]);
  });

  it('the oracle can tell: a stale attribute on a reused node would be found', () => {
    const core = createGanttCore({ tasks: TASKS, calendar: { weekends: [0, 6] }, now: () => NOW });
    core.setViewport({ width: 800, height: 300 });
    core.scroll({ left: core.getBarRect('t0')!.x - 50, top: 0 });
    const persistent = createLayerHarness('bars');
    const layer = createBarsLayer();
    layer.mount(persistent.context);
    layer.update(core.getSnapshot(), undefined);
    expect(persistent.root.childElementCount).toBeGreaterThan(0);
    persistent.root.firstElementChild?.setAttribute('data-leftover', '');

    expect(canonical(persistent.root)).not.toBe(drawFresh(core.getSnapshot(), {}));
    layer.destroy();
    core.destroy();
  });
});

import { barHandles, type GanttCore, type GanttSnapshot } from '@ganttlane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLayerHarness, createTestCore, describeLayerContract } from '../../testing';
import { createOverlayLayer } from './index';

describeLayerContract('overlay', createOverlayLayer);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface Overlay {
  readonly core: GanttCore;
  readonly root: SVGGElement;
  /** Draws the core's current snapshot. */
  draw(): GanttSnapshot;
  /** A press on the end link handle of `design`, then a drag by `dx`, over `target`. */
  linkFrom(target?: { id: string; part: 'body' }, dx?: number): void;
  release(): void;
  destroy(): void;
}

/** A real core, with the overlay layer drawing its snapshots into a real skeleton. */
function overlay(): Overlay {
  const core = createTestCore();
  core.setViewport({ width: 900, height: 400 });
  const harness = createLayerHarness('overlay');
  const layer = createOverlayLayer();
  layer.mount(harness.context);
  let previous: GanttSnapshot | undefined;
  const draw = (): GanttSnapshot => {
    const next = core.getSnapshot();
    layer.update(next, previous);
    previous = next;
    return next;
  };
  draw();
  const handle = (): { x: number; y: number } => {
    const bar = core.getBarRect('design')!;
    const box = barHandles(bar).linkEnd;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    core,
    root: harness.root,
    draw,
    linkFrom(target, dx = 40) {
      const from = handle();
      core.send({
        type: 'down',
        pointerId: 1,
        x: from.x,
        y: from.y,
        time: 0,
        isPrimary: true,
        pointerType: 'mouse',
        target: { kind: 'task', id: 'design', part: 'link-end' },
      });
      core.send({
        type: 'move',
        pointerId: 1,
        x: from.x + dx,
        y: from.y + 5,
        time: 1,
        ...(target && { target: { kind: 'task', id: target.id, part: target.part } }),
      });
    },
    release() {
      core.send({ type: 'up', pointerId: 1, x: 0, y: 0, time: 2 });
    },
    destroy() {
      layer.destroy();
      core.destroy();
    },
  };
}

const previewOf = (root: Element): Element | null => root.querySelector('path.gantt__link-preview');

describe('overlay layer: the link preview (FR-LINK-4)', () => {
  it('FR-LINK-4: draws nothing while no link is being created', () => {
    const chart = overlay();

    chart.draw();

    expect(chart.root.childNodes).toHaveLength(0);
    chart.destroy();
  });

  it('FR-LINK-4: a link drag from a handle draws a line from the handle to the pointer', () => {
    const chart = overlay();
    chart.linkFrom(undefined, 60);

    chart.draw();

    const line = previewOf(chart.root);
    expect(line).not.toBeNull();
    const { link } = chart.core.getSnapshot().feedback;
    expect(link).toBeDefined();
    const { from, to } = link!;
    expect(line!.getAttribute('d')).toBe(`M${from.x} ${from.y}L${to.x} ${to.y}`);
    expect(to.x).toBe(from.x + 60);
    chart.destroy();
  });

  it('FR-LINK-4: the line is a direct child of the overlay, as the unstyled contract says', () => {
    const chart = overlay();
    chart.linkFrom();

    chart.draw();

    expect(chart.root.children).toHaveLength(1);
    expect(chart.root.firstElementChild?.tagName.toLowerCase()).toBe('path');
    expect(chart.root.firstElementChild?.getAttribute('class')).toBe('gantt__link-preview');
    chart.destroy();
  });

  it('FR-LINK-4: the line is valid (data-valid) until a refusal: free space and a valid target', () => {
    const chart = overlay();
    chart.linkFrom();
    chart.draw();
    expect(previewOf(chart.root)?.hasAttribute('data-valid')).toBe(true);

    // A valid target: the line ends at the target's anchor, not at the pointer.
    chart.linkFrom({ id: 'build', part: 'body' }, 10);
    chart.draw();
    const { link, to } = chart.core.getSnapshot().feedback.link!;
    expect(link).toEqual({ source: 'design', target: 'build', type: 'FS' });
    expect(previewOf(chart.root)?.hasAttribute('data-valid')).toBe(true);
    expect(previewOf(chart.root)?.getAttribute('d')).toContain(`L${to.x} ${to.y}`);
    chart.destroy();
  });

  it('FR-LINK-6: a refused target (the source itself) makes the line invalid', () => {
    const chart = overlay();
    chart.linkFrom({ id: 'design', part: 'body' }, 10);

    chart.draw();

    expect(chart.core.getSnapshot().feedback.link?.refusal).toBe('self');
    expect(previewOf(chart.root)).not.toBeNull();
    expect(previewOf(chart.root)?.hasAttribute('data-valid')).toBe(false);
    chart.destroy();
  });

  it('FR-LINK-4: the line follows the pointer on the one node, and goes with the gesture', () => {
    const chart = overlay();
    chart.linkFrom(undefined, 20);
    chart.draw();
    const line = previewOf(chart.root);
    const before = line?.getAttribute('d');

    chart.core.send({ type: 'move', pointerId: 1, x: 500, y: 90, time: 3 });
    chart.draw();

    expect(previewOf(chart.root)).toBe(line);
    expect(line?.getAttribute('d')).not.toBe(before);

    chart.release();
    chart.draw();
    expect(previewOf(chart.root)).toBeNull();
    expect(chart.root.childNodes).toHaveLength(0);
    chart.destroy();
  });

  it('NFR-PERF-2: an unchanged preview writes nothing to the DOM', () => {
    const chart = overlay();
    chart.linkFrom();
    chart.draw();
    const line = previewOf(chart.root)!;
    const set = vi.spyOn(line, 'setAttribute');
    const append = vi.spyOn(chart.root, 'append');

    chart.draw();
    chart.draw();

    expect(set).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    chart.destroy();
  });

  it('FR-API-4: destroy removes a line that is still shown', () => {
    const chart = overlay();
    chart.linkFrom();
    chart.draw();
    expect(previewOf(chart.root)).not.toBeNull();

    chart.destroy();

    expect(chart.root.childNodes).toHaveLength(0);
  });
});

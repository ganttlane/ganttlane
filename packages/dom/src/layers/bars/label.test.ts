import { createGanttCore, type TaskModel } from '@ganttlane/core';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LABEL_FONT_SIZE, ESTIMATE_MARGIN, estimateTextWidth, resolveLabel } from './label';

describe('estimateTextWidth (FR-BAR-1)', () => {
  const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).join(
    '',
  );
  /** The estimate of `text` at `size` px without the margin, as `advances` em / 1000. */
  const wide = (advances: number, size: number): number =>
    (advances * size * ESTIMATE_MARGIN) / 1000;

  it('sums the Arial advances of the printable ASCII characters, with the margin', () => {
    // 1000 px type: the sum is the table's total in 1/1000 em, which also checks its length.
    expect(estimateTextWidth(PRINTABLE_ASCII, 1000)).toBeCloseTo(wide(50_058, 1000));
    expect(ESTIMATE_MARGIN).toBeGreaterThan(1);
  });

  it('is zero for no text and grows with the text and the font size', () => {
    expect(estimateTextWidth('')).toBe(0);
    expect(estimateTextWidth('ab', 10) * 2).toBeCloseTo(estimateTextWidth('abab', 10));
    expect(estimateTextWidth('Design', 24)).toBeCloseTo(2 * estimateTextWidth('Design', 12));
  });

  it('defaults to the size of the default theme', () => {
    expect(DEFAULT_LABEL_FONT_SIZE).toBe(12);
    expect(estimateTextWidth('Design')).toBe(estimateTextWidth('Design', DEFAULT_LABEL_FONT_SIZE));
  });

  it('knows narrow from wide letters', () => {
    expect(estimateTextWidth('iiii')).toBeLessThan(estimateTextWidth('nnnn'));
    expect(estimateTextWidth('nnnn')).toBeLessThan(estimateTextWidth('MMMM'));
    expect(estimateTextWidth('WWWW')).toBeGreaterThan(estimateTextWidth('wwww'));
  });

  it('counts full-width and astral characters as one em, once', () => {
    expect(estimateTextWidth('日本語', 10)).toBeCloseTo(wide(3000, 10));
    expect(estimateTextWidth('한글', 10)).toBeCloseTo(wide(2000, 10));
    expect(estimateTextWidth('😀', 10)).toBeCloseTo(wide(1000, 10));
  });

  it('gives other scripts an average width and combining marks none', () => {
    expect(estimateTextWidth('Дизайн', 10)).toBeCloseTo(wide(6 * 560, 10));
    // "e" with a combining acute accent adds no width to "e".
    expect(estimateTextWidth('é', 10)).toBe(estimateTextWidth('e', 10));
  });

  it('ignores control characters', () => {
    expect(estimateTextWidth('a\n\tb', 10)).toBe(estimateTextWidth('ab', 10));
  });
});

describe('resolveLabel (FR-BAR-5)', () => {
  const core = createGanttCore({
    tasks: [{ id: 'a', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', progress: 20 }],
  });
  afterAll(() => {
    core.destroy();
  });
  const model: TaskModel = core.getSnapshot().state.derived.model.taskById.get('a')!;
  const measure = (text: string): number => text.length;
  const fail = vi.fn();

  it('shows the task name without a renderer', () => {
    const label = resolveLabel(model, 20, undefined, measure, fail);

    expect(label).toMatchObject({ text: 'Alpha', node: undefined, width: 5, progress: 20 });
    expect(label.model).toBe(model);
  });

  it('passes id, name, the caller task and progress to the renderer', () => {
    const renderer = vi.fn(() => 'custom');
    const label = resolveLabel(model, 35, renderer, measure, fail);

    expect(renderer).toHaveBeenCalledWith({
      id: 'a',
      name: 'Alpha',
      task: model.task,
      progress: 35,
    });
    expect(label).toMatchObject({ text: 'custom', node: undefined, width: 6, renderer });
  });

  it('takes the text of a node for the estimate and keeps the node', () => {
    const node = document.createElement('b');
    node.append('Bold ', document.createElement('i'));
    node.lastElementChild!.textContent = 'move';
    const label = resolveLabel(model, 0, () => node, measure, fail);

    expect(label.node).toBe(node);
    expect(label.text).toBe('Bold move');
    expect(label.width).toBe(9);
  });

  it('FR-BAR-5: takes the node and the dispose of a DisposableNode, with no text and no width', () => {
    const node = document.createElement('b');
    node.textContent = 'Hosted';
    const dispose = vi.fn();
    const label = resolveLabel(model, 0, () => ({ node, dispose }), measure, fail);

    expect(label.node).toBe(node);
    expect(label.dispose).toBe(dispose);
    // What its owner draws into the node is the owner's, and a node that is kept between calls
    // holds the text of the last: the width of such content is not known, never measured.
    expect(label.text).toBe('');
    expect(label.width).toBe(0);
    // Making the content disposes nothing: when to do that is the layer's business.
    expect(dispose).not.toHaveBeenCalled();
  });

  it('FR-BAR-5: a plain node, a string and the name have nothing to dispose', () => {
    for (const answer of [document.createElement('i'), 'text', null]) {
      expect(resolveLabel(model, 0, () => answer, measure, fail).dispose).toBeUndefined();
    }
  });

  it('falls back to the name for null, undefined and something that is not a node', () => {
    for (const answer of [null, undefined, 42, {}, [], true]) {
      const label = resolveLabel(model, 0, () => answer as never, measure, fail);
      expect(label.text).toBe('Alpha');
      expect(label.node).toBeUndefined();
    }
  });

  it('keeps an empty string: the caller wants no label', () => {
    expect(resolveLabel(model, 0, () => '', measure, fail).text).toBe('');
  });

  it('reports a renderer that throws and shows the name', () => {
    const boom = new Error('boom');
    const failures: unknown[] = [];
    const label = resolveLabel(
      model,
      0,
      () => {
        throw boom;
      },
      measure,
      (error) => failures.push(error),
    );

    expect(failures).toEqual([boom]);
    expect(label.text).toBe('Alpha');
    expect(label.node).toBeUndefined();
  });
});

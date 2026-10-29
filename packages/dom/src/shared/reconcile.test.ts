import { describe, expect, it, vi } from 'vitest';

import { createHtml, createReconciler, createSvg, setAttrs } from './index';

interface Item {
  id: string;
  label: string;
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id, label: id.toUpperCase() }));

/** A list of `<li>` nodes keyed by id, with a spy per hook. */
function list(container: Element = document.createElement('ul')) {
  const hooks = {
    create: vi.fn((item: Item) => createHtml(document, 'li', { 'data-key': item.id })),
    update: vi.fn((node: HTMLElement, item: Item) => {
      setAttrs(node, { title: item.label });
    }),
    remove: vi.fn((_node: HTMLElement) => undefined),
  };
  const reconciler = createReconciler<Item, string, HTMLElement>(container, {
    key: (item) => item.id,
    node: (node) => node,
    ...hooks,
  });
  const keys = (): (string | undefined)[] =>
    [...container.children].map((child) => (child as HTMLElement).dataset.key);
  return { container, reconciler, hooks, keys };
}

describe('createReconciler', () => {
  it('FR-BAR-1: builds the nodes in order, create then update', () => {
    const { reconciler, hooks, keys } = list();

    reconciler.sync(items('a', 'b', 'c'));

    expect(keys()).toEqual(['a', 'b', 'c']);
    expect(hooks.create).toHaveBeenCalledTimes(3);
    expect(hooks.update).toHaveBeenCalledTimes(3);
    expect(hooks.create.mock.invocationCallOrder[0]).toBeLessThan(
      hooks.update.mock.invocationCallOrder[0] ?? 0,
    );
    expect([...reconciler.views.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('NFR-PERF-1: reuses the nodes of known keys and updates them in place', () => {
    const { container, reconciler, hooks } = list();
    reconciler.sync(items('a', 'b'));
    const [a, b] = [...container.children];
    hooks.create.mockClear();

    reconciler.sync([
      { id: 'a', label: 'changed' },
      { id: 'b', label: 'B' },
    ]);

    expect(hooks.create).not.toHaveBeenCalled();
    expect([...container.children]).toEqual([a, b]);
    expect(a?.getAttribute('title')).toBe('changed');
  });

  it('NFR-PERF-1: touches the DOM only for what changed (nothing for an identical list)', () => {
    const container = document.createElement('ul');
    const { reconciler } = list(container);
    reconciler.sync(items('a', 'b', 'c'));
    const insert = vi.spyOn(container, 'insertBefore');
    const append = vi.spyOn(container, 'append');
    const removeChild = vi.spyOn(container, 'removeChild');

    reconciler.sync(items('a', 'b', 'c'));
    reconciler.sync(items('a', 'b', 'c', 'd'));

    expect(insert).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
    expect(removeChild).not.toHaveBeenCalled();
  });

  it('removes nodes whose key left the list, calling remove first', () => {
    const { container, reconciler, hooks, keys } = list();
    reconciler.sync(items('a', 'b', 'c'));
    const b = container.children[1];

    reconciler.sync(items('a', 'c'));

    expect(keys()).toEqual(['a', 'c']);
    expect(hooks.remove).toHaveBeenCalledOnce();
    expect(hooks.remove).toHaveBeenCalledWith(b);
    expect(b?.isConnected).toBe(false);
    expect(reconciler.views.has('b')).toBe(false);
  });

  it('moves nodes to follow the new order without recreating them', () => {
    const { container, reconciler, hooks, keys } = list();
    reconciler.sync(items('a', 'b', 'c', 'd'));
    const before = new Map(
      [...container.children].map((el) => [(el as HTMLElement).dataset.key, el]),
    );
    hooks.create.mockClear();

    reconciler.sync(items('d', 'b', 'a', 'c'));

    expect(keys()).toEqual(['d', 'b', 'a', 'c']);
    expect(hooks.create).not.toHaveBeenCalled();
    for (const el of container.children) {
      expect(before.get((el as HTMLElement).dataset.key)).toBe(el);
    }
  });

  it('handles insertions in the middle and a mix of changes', () => {
    const { reconciler, keys } = list();
    reconciler.sync(items('a', 'c', 'e'));

    reconciler.sync(items('a', 'b', 'c', 'd', 'e'));
    expect(keys()).toEqual(['a', 'b', 'c', 'd', 'e']);

    reconciler.sync(items('e', 'x', 'a'));
    expect(keys()).toEqual(['e', 'x', 'a']);

    reconciler.sync([]);
    expect(keys()).toEqual([]);
  });

  it('keeps the first item when two share a key', () => {
    const { reconciler, keys } = list();

    reconciler.sync([
      { id: 'a', label: 'first' },
      { id: 'a', label: 'second' },
    ]);

    expect(keys()).toEqual(['a']);
    expect(reconciler.views.get('a')?.getAttribute('title')).toBe('first');
  });

  it('supports views that are not nodes (a node plus references to its children)', () => {
    const g = createSvg(document, 'g');
    interface BarView {
      root: SVGGElement;
      rect: SVGRectElement;
    }
    const reconciler = createReconciler<{ id: string; width: number }, string, BarView>(g, {
      key: (item) => item.id,
      create: () => {
        const root = createSvg(document, 'g');
        const rect = createSvg(document, 'rect');
        root.append(rect);
        return { root, rect };
      },
      update: (view, item) => {
        setAttrs(view.rect, { width: item.width });
      },
      node: (view) => view.root,
    });

    reconciler.sync([{ id: 't1', width: 10 }]);
    const view = reconciler.views.get('t1');
    reconciler.sync([{ id: 't1', width: 20 }]);

    expect(reconciler.views.get('t1')).toBe(view);
    expect(view?.rect.getAttribute('width')).toBe('20');
    expect(g.childNodes).toHaveLength(1);
  });

  it('clear removes every view and calls remove for each', () => {
    const { container, reconciler, hooks } = list();
    reconciler.sync(items('a', 'b'));

    reconciler.clear();

    expect(container.childNodes).toHaveLength(0);
    expect(reconciler.views.size).toBe(0);
    expect(hooks.remove).toHaveBeenCalledTimes(2);
  });

  it('clear removes the remaining views even if one remove hook throws, then reports it', () => {
    const { container, reconciler, hooks } = list();
    reconciler.sync(items('a', 'b', 'c'));
    hooks.remove.mockImplementationOnce(() => {
      throw new Error('broken view');
    });

    expect(() => {
      reconciler.clear();
    }).toThrow('broken view');
    expect(container.childNodes).toHaveLength(0);
  });
});

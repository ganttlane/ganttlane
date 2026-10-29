import { throwCollected } from '../dom-utils/errors';

/**
 * How a {@link Reconciler} builds and updates the views of a keyed list. A *view* is whatever a
 * layer keeps per item: just its node, or an object with the node and references to its
 * children (a bar with its label, progress and handles), so that an update never has to
 * search the subtree.
 *
 * @typeParam TItem - One entry of the data list (a row, a bar, a link).
 * @typeParam TKey - Identity of an item (a task id, a link id, a day key).
 * @typeParam TView - What is kept per item.
 */
export interface ReconcilerSpec<TItem, TKey, TView> {
  /** The identity of an item. Keys must be unique within one list; the first item wins. */
  key(item: TItem): TKey;
  /**
   * Builds the view's nodes: structure only. {@link ReconcilerSpec.update} is called right
   * after with the same item, so attributes are written in one place.
   */
  create(item: TItem): TView;
  /** Brings a view in line with its item; write through `setAttrs` to touch only changes. */
  update(view: TView, item: TItem): void;
  /** The node of a view, the one that sits in the container. */
  node(view: TView): Node;
  /** Called before a view whose key left the list is detached, to release what it holds. */
  remove?(view: TView): void;
}

/** A keyed list kept in sync with data, see {@link createReconciler}. */
export interface Reconciler<TItem, TKey, TView> {
  /**
   * Makes the container hold exactly the nodes of `items`, in their order: views of known keys
   * are updated in place and moved only when needed, new keys get a new view, gone keys lose
   * theirs. `O(items)` plus the DOM writes that were really needed.
   *
   * @param items - The wanted list.
   */
  sync(items: readonly TItem[]): void;
  /** Removes every view (a layer's `destroy`). */
  clear(): void;
  /** The live views by key. */
  readonly views: ReadonlyMap<TKey, TView>;
}

/**
 * Creates the keyed reconciliation of one list into one container: the `reconcile(container,
 * items, key, create, update, remove)` every layer needs, with the key to view map held in the
 * returned object (per list, nothing global) so that nodes survive between updates.
 *
 * The container belongs to the list: nodes in it that the reconciler did not create end up
 * after the managed ones. Give every list its own `<g>` or `<div>`.
 *
 * @param container - Where the nodes live.
 * @param spec - How to key, create, update and release views.
 * @returns The list handle.
 */
export function createReconciler<TItem, TKey, TView>(
  container: Element,
  spec: ReconcilerSpec<TItem, TKey, TView>,
): Reconciler<TItem, TKey, TView> {
  const views = new Map<TKey, TView>();

  const drop = (view: TView): void => {
    try {
      spec.remove?.(view);
    } finally {
      spec.node(view).parentNode?.removeChild(spec.node(view));
    }
  };

  return {
    views,
    sync(items): void {
      const wanted = new Map<TKey, TItem>();
      for (const item of items) {
        const key = spec.key(item);
        if (!wanted.has(key)) wanted.set(key, item);
      }

      for (const [key, view] of views) {
        if (wanted.has(key)) continue;
        views.delete(key);
        drop(view);
      }

      // The retained nodes are in their old order and the stale ones are gone, so a list
      // that only grew, shrank or changed in place moves nothing.
      let cursor: ChildNode | null = container.firstChild;
      for (const [key, item] of wanted) {
        let view = views.get(key);
        if (view === undefined) {
          view = spec.create(item);
          views.set(key, view);
        }
        spec.update(view, item);
        const node = spec.node(view);
        if (node === cursor) cursor = cursor.nextSibling;
        else container.insertBefore(node, cursor);
      }
    },
    clear(): void {
      const all = [...views.values()];
      views.clear();
      const errors: unknown[] = [];
      for (const view of all) {
        try {
          drop(view);
        } catch (error) {
          errors.push(error);
        }
      }
      throwCollected(errors, 'Several views failed to be removed');
    },
  };
}

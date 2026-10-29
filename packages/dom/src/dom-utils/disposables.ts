import { throwCollected } from './errors';

/** A function that releases one resource (idempotent where the resource allows it). */
export type Dispose = () => void;

/** A bag of {@link Dispose} functions released together, newest first. */
export interface Disposables {
  /**
   * Registers a resource's release function. After {@link Disposables.dispose} it runs at
   * once, so a resource acquired late never leaks.
   *
   * @param dispose - Releases the resource.
   * @returns `dispose`, so that `const stop = bag.add(core.subscribe(...))` reads naturally.
   */
  add<T extends Dispose>(dispose: T): T;
  /**
   * Releases everything registered, newest first (the reverse of acquiring). Every function
   * runs even if an earlier one throws; the errors are rethrown afterwards (a single one as
   * is, several as an `AggregateError`). Idempotent: the second call does nothing.
   */
  dispose(): void;
  /** Whether {@link Disposables.dispose} has been called. */
  readonly disposed: boolean;
}

/**
 * Creates an empty {@link Disposables}: the owner of observers, frame handles, subscriptions
 * and DOM nodes of one instance. Listeners are not kept here, they belong to the instance's
 * `AbortController` (see {@link listen}).
 *
 * @returns A new bag.
 */
export function createDisposables(): Disposables {
  const stack: Dispose[] = [];
  let disposed = false;

  return {
    add<T extends Dispose>(dispose: T): T {
      if (disposed) dispose();
      else stack.push(dispose);
      return dispose;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        try {
          next();
        } catch (error) {
          errors.push(error);
        }
      }
      throwCollected(errors, 'Several resources failed to dispose');
    },
    get disposed(): boolean {
      return disposed;
    },
  };
}

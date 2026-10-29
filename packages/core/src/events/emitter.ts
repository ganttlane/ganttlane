/**
 * A typed event emitter (Observer pattern) with an `error` channel
 * for listener failures. No globals, no timers: everything happens synchronously inside `emit`.
 */

/** Removes a listener or a hook; calling it again does nothing. */
export type Unsubscribe = () => void;

/** A listener of an event with payload `T`. */
export type Listener<T> = (payload: T) => void;

/**
 * Payload of the `error` channel: something the caller supplied threw or rejected. Errors are
 * never swallowed. With a listener of `error` it gets this payload. Without one the error goes to
 * the code that triggered the event:
 * - an event caused by an API call is rethrown by that call, once the change is made: as a
 *   throw, or, for a method that returns a promise, as a rejection (several errors are one
 *   `AggregateError`). A failed before-hook is the exception: `updateTask` and `addLink` return
 *   its error in their result (`reason: 'error'`);
 * - an event caused by renderer input (`setViewport`, `scroll`, `send`, `refreshNow`) does not
 *   throw, because those methods never do after they changed the chart: the error goes to the
 *   host's unhandled-rejection channel. So does the error of a before-hook that failed during a
 *   gesture (a drag, a drawn link), which has no call to return it to.
 */
export interface ErrorPayload {
  /** The thrown value or the rejection reason, as it was. */
  readonly error: unknown;
  /** A listener of an event (`'listener'`) or a before-hook (`'hook'`) threw or rejected. */
  readonly source: 'listener' | 'hook';
  /** The event whose listener threw (`'tasksChange'`), or the hook chain (`'beforeTaskChange'`). */
  readonly name: string;
}

/** What every event map of an {@link Emitter} has: the `error` channel. */
export interface EmitterEvents {
  /** A listener or a hook failed. */
  readonly error: ErrorPayload;
}

/**
 * A typed emitter over an event map (`{ name: payload }`). Its methods need no `this`.
 *
 * @typeParam Events - Payload type of each event name; includes the `error` channel.
 */
export interface Emitter<Events extends EmitterEvents> {
  /**
   * Adds a listener. Listeners of an event are called in subscription order; the same function
   * added twice is called twice (each subscription is its own).
   *
   * @returns A function that removes this subscription (idempotent).
   */
  readonly on: <K extends keyof Events & string>(
    name: K,
    listener: Listener<Events[K]>,
  ) => Unsubscribe;
  /**
   * Calls the listeners of `name` with `payload`, see {@link createEmitter} for the order and the
   * handling of listener errors.
   */
  readonly emit: <K extends keyof Events & string>(name: K, payload: Events[K]) => void;
  /** Whether `name` has at least one listener. */
  readonly hasListeners: (name: keyof Events & string) => boolean;
  /** Removes every listener of every event, also from an emit in progress. */
  readonly clear: () => void;
}

/** One subscription; `active` turns `false` when it is removed. */
interface Entry {
  readonly listener: Listener<never>;
  active: boolean;
}

/**
 * Creates a typed emitter. No globals: every emitter is independent.
 *
 * - **Order:** listeners are called in subscription order. A listener added while an event is
 *   being emitted is called from the next `emit`; a listener removed (or `clear`ed) during an emit
 *   is not called any more, also by that emit. After its `Unsubscribe` returns, a listener is
 *   never called again.
 * - **Listener errors:** a listener that throws does not stop the others. After all listeners
 *   ran, each error is emitted on `error` as `{ error, source: 'listener', name }`. When nobody
 *   listens to `error`, or when an `error` listener itself threw, the errors are rethrown from
 *   `emit` instead (one as it is, several as an `AggregateError`), so they are never lost.
 * - Emitting an event without listeners, `error` included, does nothing.
 *
 * @typeParam Events - Payload type of each event name; must include the `error` channel.
 * @returns The emitter.
 *
 * @example
 * ```ts
 * interface Events extends EmitterEvents { readonly saved: { readonly id: string } }
 * const emitter = createEmitter<Events>();
 * const off = emitter.on('saved', ({ id }) => log(id));
 * emitter.on('error', ({ error, name }) => report(name, error));
 * emitter.emit('saved', { id: 'a' });
 * off();
 * ```
 */
export function createEmitter<Events extends EmitterEvents>(): Emitter<Events> {
  // Copy on write: an emit iterates over the list it started with.
  const lists = new Map<string, readonly Entry[]>();

  const hasListeners = (name: string): boolean =>
    (lists.get(name) ?? []).some((entry) => entry.active);

  const on = <K extends keyof Events & string>(
    name: K,
    listener: Listener<Events[K]>,
  ): Unsubscribe => {
    const entry: Entry = { listener, active: true };
    lists.set(name, [...(lists.get(name) ?? []), entry]);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const rest = (lists.get(name) ?? []).filter((other) => other !== entry);
      if (rest.length === 0) lists.delete(name);
      else lists.set(name, rest);
    };
  };

  const emit = <K extends keyof Events & string>(name: K, payload: Events[K]): void => {
    const list = lists.get(name);
    if (list === undefined) return;
    let errors: unknown[] | undefined;
    for (const entry of list) {
      if (!entry.active) continue;
      try {
        (entry.listener as Listener<Events[K]>)(payload);
      } catch (error) {
        (errors ??= []).push(error);
      }
    }
    if (errors === undefined) return;
    if (name === 'error' || !hasListeners('error')) throwAll(errors, threw(errors, name));
    let failed: unknown[] | undefined;
    for (const error of errors) {
      const info: ErrorPayload = Object.freeze({ error, source: 'listener', name });
      try {
        emit('error', info as Events['error']);
      } catch (thrown) {
        (failed ??= []).push(thrown);
      }
    }
    if (failed !== undefined) throwAll(failed, threw(failed, 'error'));
  };

  const clear = (): void => {
    for (const list of lists.values()) for (const entry of list) entry.active = false;
    lists.clear();
  };

  return Object.freeze({ on, emit, hasListeners, clear });
}

/**
 * Throws the errors collected while notifying: one as it is, several as an `AggregateError`
 * with `message`.
 *
 * @param errors - At least one error.
 * @param message - Message of the `AggregateError`, e.g. `'2 listeners of "tasksChange" threw'`.
 * @internal
 */
export function throwAll(errors: readonly unknown[], message: string): never {
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

function threw(errors: readonly unknown[], name: string): string {
  return `${errors.length} listeners of "${name}" threw`;
}

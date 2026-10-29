/**
 * Before-hooks (Chain of Responsibility, `docs/architecture.md` §10, FR-TX-2, FR-LINK-6): the
 * hooks that may confirm, cancel or modify an edit before it is committed, and their registry.
 * The change controller runs the chains.
 */

import type { Link } from '../model';
import type { ChangeReason, ChangeSet, Conflict } from '../schedule';
import type { Unsubscribe } from './emitter';

/**
 * A value or a promise of it. `Awaitable<void>` lets a hook be any function returning nothing,
 * also one declared `(…): void` or `async (…): Promise<void>`.
 */
export type Awaitable<T> = T | PromiseLike<T>;

/** What a `beforeTaskChange` hook receives (`onBeforeTaskChange`, FR-TX-2). Frozen. */
export interface BeforeTaskChangeContext {
  /**
   * The change set to commit: re-validated, so every value is aligned to the granularity. A hook
   * that runs after another one that replaced it sees the replacement.
   */
  readonly changeSet: ChangeSet;
  /** `changeSet.reason`. */
  readonly reason: ChangeReason;
  /** `changeSet.conflicts`: the conflicts the change set would cause (FR-SCH-6). */
  readonly conflicts: readonly Conflict[];
}

/**
 * What a `beforeTaskChange` hook answers: `false` cancels the commit, a `ChangeSet` replaces the
 * one being committed (it is re-validated, FR-SNAP-13), `true` or nothing lets it pass.
 */
export type BeforeTaskChangeResult = boolean | ChangeSet | undefined;

/**
 * A `beforeTaskChange` hook (FR-TX-2): confirms, cancels or modifies a change set before it is
 * committed, synchronously or asynchronously (e.g. after asking the user). Throwing or rejecting
 * cancels the commit and reports the error on the `error` channel.
 *
 * @example
 * ```ts
 * // "The bar lands on a non-working day: move it to a working day, or keep it?"
 * const hook: BeforeTaskChangeHook = async ({ conflicts }) => {
 *   if (!conflicts.some((c) => c.type === 'non-working-start')) return;
 *   if ((await ask()) === 'ignore') return true;
 *   const options = { skipNonWorkingDays: { resize: true } };
 *   return propagate(command, { ...store.getSnapshot().derived, options }); // rolled to Monday
 * };
 * ```
 */
export type BeforeTaskChangeHook = (
  context: BeforeTaskChangeContext,
) => Awaitable<BeforeTaskChangeResult> | Awaitable<void>;

/** What a `beforeLinkCreate` hook receives (`onBeforeLinkCreate`, FR-LINK-6). Frozen. */
export interface BeforeLinkCreateContext {
  /** The link to create: as given, or a copy with a free `id` (see `LinkCreatePayload.id`). */
  readonly link: Link;
  /** Its id: `link.id`, the default `` `${source}:${type}:${target}` ``, or a free one. */
  readonly id: string;
  /**
   * Whether the link would close a cycle of links (FR-LINK-7). Such a link is always rejected,
   * whatever the hooks answer; they are told so that they can explain why.
   */
  readonly wouldCreateCycle: boolean;
}

/** What a `beforeLinkCreate` hook answers: `false` cancels, `true` or nothing lets it pass. */
export type BeforeLinkCreateResult = boolean | undefined;

/**
 * A `beforeLinkCreate` hook (FR-LINK-6): confirms or cancels a new link, synchronously or
 * asynchronously. Throwing or rejecting cancels and reports the error on the `error` channel.
 */
export type BeforeLinkCreateHook = (
  context: BeforeLinkCreateContext,
) => Awaitable<BeforeLinkCreateResult> | Awaitable<void>;

/** The hook chains by name. */
export interface HookMap {
  /** Before a change set is committed (FR-TX-2). */
  readonly beforeTaskChange: BeforeTaskChangeHook;
  /** Before a link is created (FR-LINK-6). */
  readonly beforeLinkCreate: BeforeLinkCreateHook;
}

/** Name of a hook chain. */
export type HookName = keyof HookMap;

/**
 * A registry of before-hooks: one chain per {@link HookName}, in registration order. Its methods
 * need no `this`.
 */
export interface Hooks {
  /**
   * Appends a hook to its chain; the same function added twice runs twice.
   *
   * @returns A function that removes this registration (idempotent).
   */
  readonly add: <K extends HookName>(name: K, hook: HookMap[K]) => Unsubscribe;
  /**
   * The hooks of a chain, in registration order, for one run: iterated lazily, it skips hooks
   * removed before their turn (also while an earlier hook is awaited) and leaves out hooks added
   * after the iteration started.
   */
  readonly chain: <K extends HookName>(name: K) => Iterable<HookMap[K]>;
  /** Removes every hook of every chain, also from runs in progress. */
  readonly clear: () => void;
}

/** One registration; `active` turns `false` when it is removed. */
interface Entry {
  readonly hook: HookMap[HookName];
  active: boolean;
}

/**
 * Creates an empty hook registry (FR-TX-2, FR-LINK-6). Several hooks of a chain run one after
 * another in registration order, each seeing the result of the previous one (see
 * `createChangeController`). No globals: every registry is independent.
 *
 * @returns The registry.
 *
 * @example
 * ```ts
 * const hooks = createHooks();
 * const remove = hooks.add('beforeTaskChange', ({ conflicts }) => conflicts.length === 0);
 * for (const hook of hooks.chain('beforeTaskChange')) await hook(context);
 * remove();
 * ```
 */
export function createHooks(): Hooks {
  const chains = new Map<HookName, readonly Entry[]>();

  const add = <K extends HookName>(name: K, hook: HookMap[K]): Unsubscribe => {
    const entry: Entry = { hook, active: true };
    chains.set(name, [...(chains.get(name) ?? []), entry]);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      chains.set(
        name,
        (chains.get(name) ?? []).filter((other) => other !== entry),
      );
    };
  };

  function* chain<K extends HookName>(name: K): Generator<HookMap[K], void, undefined> {
    for (const entry of chains.get(name) ?? []) {
      if (entry.active) yield entry.hook as HookMap[K];
    }
  }

  const clear = (): void => {
    for (const list of chains.values()) for (const entry of list) entry.active = false;
    chains.clear();
  };

  return Object.freeze({ add, chain, clear });
}
